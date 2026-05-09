const express = require('express');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

const router = express.Router();
const tracer = trace.getTracer('arcade-ui/games');

const SCORE_API = process.env.SCORE_API_URL || 'http://score-api:8080';
const LEADERBOARD = process.env.LEADERBOARD_URL || 'http://leaderboard:5000';

const VALID_GAMES = new Set([
  'memory', 'typing', 'whackamole',
  'reaction', 'target-shooter', 'word-scramble',
  'math-sprint', 'simon-says', 'speed-tap',
  'wave-defender', 'bid-wars', 'hot-cache',
  'pixel-sort', 'chain-reaction', 'deadline-dash',
]);

// In-memory cache for hot-cache game — simulates a warmed question store.
// Shared across all concurrent players so early answers benefit later ones.
const hotCacheStore = new Set();

const COLLECTOR_OTLP_HTTP = process.env.COLLECTOR_OTLP_HTTP || 'http://otel-collector-agent:4318';

function annotate(req, attrs) {
  const span = trace.getActiveSpan();
  if (!span) return;
  // DELIBERATE smells: full UA string, player.id PII on every span.
  span.setAttributes({
    'browser.user_agent': req.headers['user-agent'] || 'unknown',
    'player.id': req.headers['x-player-id'] || 'anonymous',
    ...attrs,
  });
}

async function forward(method, path, body) {
  const opts = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${SCORE_API}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

router.post('/api/games/:gameId/start', async (req, res) => {
  const { gameId } = req.params;
  if (!VALID_GAMES.has(gameId)) return res.status(400).json({ error: 'unknown game' });
  const playerId = req.headers['x-player-id'] || 'anonymous';
  const playerName = req.headers['x-player-name'] || '';
  annotate(req, { 'game.name': gameId });

  const span = tracer.startSpan('arcade.game.start');
  span.setAttributes({
    'game.name': gameId,
    'player.id': playerId,
  });
  try {
    const r = await forward('POST', '/sessions', { game: gameId, player_id: playerId, player_name: playerName });
    span.setAttribute('game.session.id', r.body && r.body.id);
    res.status(r.status).json(r.body);
  } catch (err) {
    span.recordException(err);
    res.status(502).json({ error: 'score-api unreachable', detail: String(err) });
  } finally {
    span.end();
  }
});

router.post('/api/games/:gameId/events', async (req, res) => {
  const { gameId } = req.params;
  const sessionId = req.body && req.body.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });
  annotate(req, { 'game.name': gameId, 'game.session.id': sessionId });

  const span = tracer.startSpan('arcade.game.event');
  span.setAttributes({
    'game.name': gameId,
    'game.session.id': sessionId,
    'game.event.type': (req.body && req.body.type) || 'action',
  });
  try {
    const r = await forward('POST', `/sessions/${sessionId}/events`, {
      type: (req.body && req.body.type) || 'action',
      data: (req.body && req.body.data) || {},
    });
    res.status(r.status).json(r.body);
  } catch (err) {
    span.recordException(err);
    res.status(502).json({ error: 'score-api unreachable', detail: String(err) });
  } finally {
    span.end();
  }
});

router.post('/api/games/:gameId/complete', async (req, res) => {
  const { gameId } = req.params;
  const sessionId = req.body && req.body.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });
  annotate(req, { 'game.name': gameId, 'game.session.id': sessionId });

  const difficulty = (req.body && req.body.difficulty) || 'medium';
  const span = tracer.startSpan('arcade.game.complete');
  span.setAttributes({
    'game.name': gameId,
    'game.session.id': sessionId,
    'game.client.score': (req.body && req.body.client_score) || 0,
    'game.difficulty': difficulty,
  });
  try {
    const r = await forward('POST', `/sessions/${sessionId}/complete`, { difficulty });
    res.status(r.status).json(r.body);
  } catch (err) {
    span.recordException(err);
    res.status(502).json({ error: 'score-api unreachable', detail: String(err) });
  } finally {
    span.end();
  }
});

router.get('/api/leaderboard', async (req, res) => {
  const game = req.query.game || '';
  const limit = Math.min(parseInt(req.query.limit || '5', 10), 20);

  annotate(req, { 'leaderboard.game': game || 'all', 'leaderboard.limit': limit });

  const span = tracer.startSpan('arcade.leaderboard.fetch');
  span.setAttributes({
    'leaderboard.game': game || 'all',
    'leaderboard.limit': limit,
  });
  try {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (game) qs.set('game', game);
    const fetchRes = await fetch(`${LEADERBOARD}/leaderboard?${qs}`, {
      headers: { 'content-type': 'application/json' },
    });
    const text = await fetchRes.text();
    let json;
    try { json = JSON.parse(text); } catch { json = []; }
    res.status(fetchRes.status).json(json);
  } catch (err) {
    span.recordException(err);
    res.status(502).json({ error: 'leaderboard unreachable', detail: String(err) });
  } finally {
    span.end();
  }
});

// ── Wave Defender: fan-out wave resolution ────────────────────────────────────
// Each enemy in the completed wave gets its own parallel child span.
// Trace shape: wave.resolve → [wave.enemy.resolve × N] (parallel fan-out).
router.post('/api/games/wave-defender/wave', async (req, res) => {
  const { session_id, wave_number, enemies } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  annotate(req, { 'game.name': 'wave-defender', 'game.session.id': session_id });

  const waveSpan = tracer.startSpan('wave.resolve');
  waveSpan.setAttributes({
    'game.name':       'wave-defender',
    'wave.number':     wave_number || 1,
    'wave.enemy_count': (enemies || []).length,
  });
  const ctx = trace.setSpan(context.active(), waveSpan);

  const points = await Promise.all(
    (enemies || []).map(async (enemy) => {
      const s = tracer.startSpan('wave.enemy.resolve', {}, ctx);
      s.setAttributes({
        'enemy.type':      enemy.type      || 'drone',
        'enemy.destroyed': !!enemy.destroyed,
        'enemy.points':    enemy.destroyed ? (enemy.points || 10) : 0,
      });
      await new Promise(r => setTimeout(r, 4 + Math.random() * 22)); // simulates variable enemy-resolution latency
      s.end();
      return enemy.destroyed ? (enemy.points || 10) : 0;
    })
  );

  const wavePoints = points.reduce((a, b) => a + b, 0);
  waveSpan.setAttribute('wave.points', wavePoints);
  waveSpan.end();

  try {
    await forward('POST', `/sessions/${session_id}/events`, {
      type: 'wave_complete',
      data: { wave_number, wave_points: wavePoints, enemies_destroyed: points.filter(p => p > 0).length },
    });
  } catch (_) {}

  res.json({ ok: true, wave_points: wavePoints });
});

// ── Bid Wars: retry loop with contention error spans ──────────────────────────
// Each bid runs up to 3 attempts; failed attempts carry SpanStatusCode.ERROR.
// Trace shape: bid.place → [bid.attempt(error), bid.attempt(error?), bid.attempt(ok)].
router.post('/api/games/bid-wars/bid', async (req, res) => {
  const { session_id, item_id, bid_amount, time_remaining } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  annotate(req, { 'game.name': 'bid-wars', 'game.session.id': session_id });

  const bidSpan = tracer.startSpan('bid.place');
  bidSpan.setAttributes({
    'bid.item_id':        item_id     || 'unknown',
    'bid.amount':         bid_amount  || 0,
    'bid.time_remaining': time_remaining || 0,
  });
  const ctx = trace.setSpan(context.active(), bidSpan);

  // Fail rates drop on each retry so the bid eventually succeeds.
  const FAIL_RATES = [0.6, 0.3, 0.0];
  let success = false;
  let totalAttempts = 0;

  for (let i = 0; i < 3; i++) {
    totalAttempts = i + 1;
    const failed = Math.random() < FAIL_RATES[i];
    const s = tracer.startSpan('bid.attempt', {}, ctx);
    s.setAttributes({ 'bid.attempt_number': i + 1, 'bid.amount': bid_amount || 0, 'bid.contention': failed });

    if (failed) {
      await new Promise(r => setTimeout(r, 40 + Math.random() * 80));
      s.setStatus({ code: SpanStatusCode.ERROR, message: 'bid contention: concurrent bid in progress' });
      s.recordException(new Error('bid contention'));
    } else {
      await new Promise(r => setTimeout(r, 8 + Math.random() * 18));
      s.setStatus({ code: SpanStatusCode.OK });
      success = true;
    }
    s.end();
    if (success) break;
  }

  bidSpan.setAttributes({ 'bid.success': success, 'bid.total_attempts': totalAttempts });
  if (!success) bidSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'bid failed after max retries' });
  bidSpan.end();

  try {
    await forward('POST', `/sessions/${session_id}/events`, {
      type: 'bid',
      data: { item_id, bid_amount, success, attempts: totalAttempts },
    });
  } catch (_) {}

  res.json({ ok: true, success, attempts: totalAttempts });
});

// ── Hot Cache: cache-hit vs cache-miss branching ──────────────────────────────
// Cold questions produce a cache.lookup child span; hot questions skip it.
// Trace shape (cold): cache.question.resolve → cache.lookup
// Trace shape (hot):  cache.question.resolve  (no child)
router.post('/api/games/hot-cache/answer', async (req, res) => {
  const { session_id, question_id, is_correct, response_ms } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  annotate(req, { 'game.name': 'hot-cache', 'game.session.id': session_id });

  const cacheHit = hotCacheStore.has(question_id);
  if (!cacheHit) hotCacheStore.add(question_id);

  const resolveSpan = tracer.startSpan('cache.question.resolve');
  resolveSpan.setAttributes({
    'cache.hit':       cacheHit,
    'cache.source':    cacheHit ? 'memory' : 'lookup',
    'question.id':     question_id || 'unknown',
    'answer.correct':  !!is_correct,
    'response.time_ms': response_ms || 0,
  });
  const ctx = trace.setSpan(context.active(), resolveSpan);

  if (!cacheHit) {
    const lookupSpan = tracer.startSpan('cache.lookup', {}, ctx);
    lookupSpan.setAttributes({
      'lookup.reason': 'cache_miss',
      'lookup.source': 'question_store',
      'question.id':   question_id || 'unknown',
    });
    await new Promise(r => setTimeout(r, 28 + Math.random() * 44));
    lookupSpan.setAttribute('lookup.result', 'found');
    lookupSpan.end();
  } else {
    await new Promise(r => setTimeout(r, 2 + Math.random() * 6));
  }

  resolveSpan.end();

  try {
    await forward('POST', `/sessions/${session_id}/events`, {
      type: 'answer',
      data: { question_id, is_correct, cache_hit: cacheHit, response_ms },
    });
  } catch (_) {}

  res.json({ ok: true, cache_hit: cacheHit });
});

// ── Pixel Sort: scatter-gather with explicit merge span ───────────────────────
// Partitions run in parallel (scatter); sort.merge is a dedicated child span (gather).
// Trace shape: sort.run → [sort.partition × N parallel] → sort.merge (sequential after all).
router.post('/api/games/pixel-sort/sort', async (req, res) => {
  const { session_id, sectors } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  annotate(req, { 'game.name': 'pixel-sort', 'game.session.id': session_id });

  const sortSpan = tracer.startSpan('sort.run');
  sortSpan.setAttributes({
    'game.name':        'pixel-sort',
    'sort.sector_count': (sectors || []).length,
  });
  const ctx = trace.setSpan(context.active(), sortSpan);

  const partitionResults = await Promise.all(
    (sectors || []).map(async (sector) => {
      const s = tracer.startSpan('sort.partition', {}, ctx);
      s.setAttributes({
        'sort.color':     sector.color     || 'unknown',
        'sort.row_count': sector.row_count || 0,
        'sort.sector':    sector.sector    || 'unknown',
      });
      await new Promise(r => setTimeout(r, 5 + Math.random() * 20));
      s.setAttribute('sort.throughput_mbs', Math.round(10 + Math.random() * 40));
      s.end();
      return sector.row_count || 0;
    })
  );

  const totalRows = partitionResults.reduce((a, b) => a + b, 0);

  const mergeSpan = tracer.startSpan('sort.merge', {}, ctx);
  mergeSpan.setAttributes({
    'sort.total_rows':  totalRows,
    'sort.sector_count': partitionResults.length,
  });
  await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
  mergeSpan.setAttribute('sort.output_rows', totalRows);
  mergeSpan.end();

  sortSpan.setAttribute('sort.total_rows', totalRows);
  sortSpan.end();

  try {
    await forward('POST', `/sessions/${session_id}/events`, {
      type: 'sort',
      data: { sector_count: (sectors || []).length, total_rows: totalRows },
    });
  } catch (_) {}

  res.json({ ok: true, total_rows: totalRows });
});

// ── Chain Reaction: saga with compensating transactions ───────────────────────
// Successful chains produce sequential saga.step spans; failures add saga.compensate
// spans in reverse order to roll back each completed step.
// Trace shape (success): saga.execute → [saga.step × N sequential]
// Trace shape (failure): saga.execute → [saga.step × M] → saga.step(ERROR) → [saga.compensate × M reverse]
router.post('/api/games/chain-reaction/execute', async (req, res) => {
  const { session_id, steps, failed_at } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  annotate(req, { 'game.name': 'chain-reaction', 'game.session.id': session_id });

  const failed = failed_at !== null && failed_at !== undefined;

  const sagaSpan = tracer.startSpan('saga.execute');
  sagaSpan.setAttributes({
    'game.name':       'chain-reaction',
    'saga.step_count': (steps || []).length,
    'saga.failed':     failed,
  });
  const ctx = trace.setSpan(context.active(), sagaSpan);

  const completedSteps = failed ? (steps || []).slice(0, failed_at) : (steps || []);

  for (let i = 0; i < completedSteps.length; i++) {
    const s = tracer.startSpan('saga.step', {}, ctx);
    s.setAttributes({ 'saga.step.index': i, 'saga.step.action': completedSteps[i], 'saga.step.success': true });
    await new Promise(r => setTimeout(r, 8 + Math.random() * 20));
    s.setStatus({ code: SpanStatusCode.OK });
    s.end();
  }

  if (failed) {
    const failSpan = tracer.startSpan('saga.step', {}, ctx);
    failSpan.setAttributes({ 'saga.step.index': failed_at, 'saga.step.action': (steps || [])[failed_at] || 'unknown', 'saga.step.success': false });
    await new Promise(r => setTimeout(r, 8 + Math.random() * 20));
    failSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'wrong step selected — chain broken' });
    failSpan.recordException(new Error('chain reaction broken'));
    failSpan.end();

    for (let i = completedSteps.length - 1; i >= 0; i--) {
      const s = tracer.startSpan('saga.compensate', {}, ctx);
      s.setAttributes({ 'saga.step.index': i, 'saga.step.action': completedSteps[i], 'saga.compensate.reason': 'chain_failure_rollback' });
      await new Promise(r => setTimeout(r, 6 + Math.random() * 14));
      s.end();
    }

    sagaSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'saga failed — chain broken at step ' + failed_at });
  }

  sagaSpan.end();

  try {
    await forward('POST', `/sessions/${session_id}/events`, {
      type: 'chain',
      data: { step_count: (steps || []).length, failed, failed_at: failed ? failed_at : null },
    });
  } catch (_) {}

  res.json({ ok: true, failed });
});

// ── Deadline Dash: deadline/timeout propagation ───────────────────────────────
// Each order has a deadline_ms budget. Steps run sequentially; any step that starts
// or completes after the deadline receives SpanStatusCode.ERROR (deadline_exceeded).
// Trace shape: order.fulfill → [fulfillment.step × 3 sequential]; late steps get ERROR.
router.post('/api/games/deadline-dash/order', async (req, res) => {
  const { session_id, order_id, deadline_ms } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  annotate(req, { 'game.name': 'deadline-dash', 'game.session.id': session_id });

  const STEPS = [
    { name: 'inventory_check', minMs: 80,  maxMs: 300 },
    { name: 'payment_charge',  minMs: 150, maxMs: 500 },
    { name: 'shipment_book',   minMs: 200, maxMs: 800 },
  ];

  const deadline = deadline_ms || 2000;
  const orderSpan = tracer.startSpan('order.fulfill');
  orderSpan.setAttributes({
    'game.name':          'deadline-dash',
    'order.id':           order_id || 'unknown',
    'order.deadline_ms':  deadline,
  });
  const ctx = trace.setSpan(context.active(), orderSpan);

  const startMs = Date.now();
  let deadlineHit = false;
  const stepResults = [];

  for (const step of STEPS) {
    const elapsed   = Date.now() - startMs;
    const remaining = deadline - elapsed;
    const duration  = step.minMs + Math.random() * (step.maxMs - step.minMs);

    const s = tracer.startSpan('fulfillment.step', {}, ctx);
    s.setAttributes({
      'fulfillment.step.name':             step.name,
      'fulfillment.step.duration_ms':      Math.round(duration),
      'fulfillment.deadline_remaining_ms': Math.round(remaining),
    });

    if (remaining <= 0) {
      deadlineHit = true;
      await new Promise(r => setTimeout(r, Math.min(duration, 50)));
      s.setStatus({ code: SpanStatusCode.ERROR, message: 'deadline exceeded before step could start' });
      s.setAttribute('fulfillment.step.status', 'deadline_exceeded');
      s.end();
      stepResults.push({ name: step.name, status: 'timeout' });
      continue;
    }

    await new Promise(r => setTimeout(r, duration));
    const elapsedAfter = Date.now() - startMs;

    if (elapsedAfter > deadline) {
      deadlineHit = true;
      s.setStatus({ code: SpanStatusCode.ERROR, message: 'step completed after deadline expired' });
      s.setAttribute('fulfillment.step.status', 'deadline_exceeded');
    } else {
      s.setStatus({ code: SpanStatusCode.OK });
      s.setAttribute('fulfillment.step.status', 'ok');
    }
    s.end();
    stepResults.push({ name: step.name, status: elapsedAfter > deadline ? 'timeout' : 'ok' });
  }

  orderSpan.setAttributes({
    'order.fulfilled':         !deadlineHit,
    'order.deadline_exceeded':  deadlineHit,
    'order.total_ms':           Date.now() - startMs,
  });
  if (deadlineHit) orderSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'order not fulfilled within deadline' });
  orderSpan.end();

  try {
    await forward('POST', `/sessions/${session_id}/events`, {
      type: 'order',
      data: { order_id, fulfilled: !deadlineHit, deadline_exceeded: deadlineHit },
    });
  } catch (_) {}

  res.json({ ok: true, fulfilled: !deadlineHit, deadline_exceeded: deadlineHit, steps: stepResults });
});

// Proxy browser OTLP/JSON spans to the Collector's HTTP receiver.
router.post('/api/browser-traces', async (req, res) => {
  try {
    const r = await fetch(`${COLLECTOR_OTLP_HTTP}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-collector-source': 'agent' },
      body: JSON.stringify(req.body),
    });
    res.status(r.ok ? 200 : 502).json({ ok: r.ok });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

module.exports = router;
