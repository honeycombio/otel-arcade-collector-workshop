const express = require('express');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');
const { logs, SeverityNumber } = require('@opentelemetry/api-logs');
const logger = logs.getLogger('arcade-ui/games');

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
  'power-surge', 'vault-sync', 'laser-grid',
  'canary-deploy', 'pulse',
]);

// In-memory cache for hot-cache game — simulates a warmed question store.
// Shared across all concurrent players so early answers benefit later ones.
const hotCacheStore = new Set();

// Power Surge: per-session circuit breaker state.
// Map<sessionId, Map<nodeId, { state: 'closed'|'open'|'half-open', openAt: number|null }>>
const circuitStore = new Map();

// Laser Grid: per-session token bucket.
// Map<sessionId, { tokens: number, lastRefill: number }>
const tokenBucketStore = new Map();

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
    logger.emit({
      body: 'game started',
      severityNumber: SeverityNumber.INFO,
      attributes: { 'game.name': gameId, 'game.session.id': r.body && r.body.id },
    });
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
    logger.emit({
      body: `game event: ${(req.body && req.body.type) || 'action'}`,
      severityNumber: SeverityNumber.INFO,
      attributes: {
        'game.name': gameId,
        'game.session.id': sessionId,
        'event.type': (req.body && req.body.type) || 'action',
      },
    });
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
    logger.emit({
      body: 'game completed',
      severityNumber: SeverityNumber.INFO,
      attributes: { 'game.name': gameId, 'game.session.id': sessionId },
    });
    const r = await forward('POST', `/sessions/${sessionId}/complete`, { difficulty });
    res.status(r.status).json(r.body);
  } catch (err) {
    span.recordException(err);
    res.status(502).json({ error: 'score-api unreachable', detail: String(err) });
  } finally {
    span.end();
    if (gameId === 'power-surge') circuitStore.delete(sessionId);
    if (gameId === 'laser-grid')  tokenBucketStore.delete(sessionId);
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
    logger.emit({
      body: 'leaderboard fetched',
      severityNumber: SeverityNumber.INFO,
      attributes: { 'leaderboard.game': game || 'all', 'leaderboard.limit': limit },
    });
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

// ── Power Surge: circuit-breaker pattern ─────────────────────────────────────
// CLOSED:    circuit.handle alone (fast, ok, circuit.state: closed)
// OPEN:      circuit.handle alone (fast, ERROR, circuit.state: open, no child)
// HALF-OPEN: circuit.handle → circuit.probe child (variable latency, probe.outcome: success|failure)
router.post('/api/games/power-surge/circuit', async (req, res) => {
  const { session_id, node_id, client_state } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  annotate(req, { 'game.name': 'power-surge', 'game.session.id': session_id });

  if (!circuitStore.has(session_id)) circuitStore.set(session_id, new Map());
  const sessionCircuits = circuitStore.get(session_id);
  if (!sessionCircuits.has(node_id)) sessionCircuits.set(node_id, { state: 'closed', openAt: null });
  const circuit = sessionCircuits.get(node_id);

  // Transition OPEN → HALF-OPEN after 3 seconds
  if (circuit.state === 'open' && circuit.openAt && (Date.now() - circuit.openAt) >= 3000) {
    circuit.state = 'half-open';
    circuit.openAt = null;
  }

  const handleSpan = tracer.startSpan('circuit.handle');
  handleSpan.setAttributes({
    'game.name':       'power-surge',
    'circuit.node_id': node_id || 'unknown',
    'circuit.state':   circuit.state,
  });
  const ctx = trace.setSpan(context.active(), handleSpan);

  let probeSuccess = null;

  if (circuit.state === 'closed') {
    await new Promise(r => setTimeout(r, 5 + Math.random() * 15));
    handleSpan.setAttribute('circuit.passed', true);
    handleSpan.setStatus({ code: SpanStatusCode.OK });

  } else if (circuit.state === 'open') {
    await new Promise(r => setTimeout(r, 2 + Math.random() * 5));
    handleSpan.setAttribute('circuit.passed', false);
    handleSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'circuit open — request rejected' });
    handleSpan.recordException(new Error('circuit breaker open'));

  } else {
    // HALF-OPEN: send a probe to test recovery
    const probeSpan = tracer.startSpan('circuit.probe', {}, ctx);
    probeSuccess = Math.random() < 0.75;
    probeSpan.setAttributes({
      'circuit.probe.outcome': probeSuccess ? 'success' : 'failure',
      'circuit.node_id':       node_id || 'unknown',
    });
    await new Promise(r => setTimeout(r, 60 + Math.random() * 120));
    probeSpan.end();

    if (probeSuccess) {
      circuit.state = 'closed';
      circuit.openAt = null;
      handleSpan.setAttribute('circuit.passed', true);
      handleSpan.setStatus({ code: SpanStatusCode.OK });
    } else {
      circuit.state = 'open';
      circuit.openAt = Date.now();
      handleSpan.setAttribute('circuit.passed', false);
      handleSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'circuit probe failed — reopening' });
      handleSpan.recordException(new Error('circuit probe failure'));
    }
  }

  handleSpan.end();
  sessionCircuits.set(node_id, circuit);

  try {
    await forward('POST', `/sessions/${session_id}/events`, {
      type: 'circuit',
      data: { node_id, circuit_state: circuit.state, probe_success: probeSuccess },
    });
  } catch (_) {}

  res.json({ ok: true, circuit_state: circuit.state, probe_success: probeSuccess });
});

// ── Vault Sync: two-phase commit ─────────────────────────────────────────────
// SUCCESS: txn.run → [txn.prepare.* parallel] → txn.commit → [txn.confirm.* parallel]
// FAILURE: txn.run → [txn.prepare.*(some ERROR)] → txn.abort → [txn.rollback.* parallel for prepared vaults]
router.post('/api/games/vault-sync/transaction', async (req, res) => {
  const { session_id, vault_ids, abort_vault } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  annotate(req, { 'game.name': 'vault-sync', 'game.session.id': session_id });

  const vaults = vault_ids || ['vault_A', 'vault_B', 'vault_C'];

  const txnSpan = tracer.startSpan('txn.run');
  txnSpan.setAttributes({
    'game.name':       'vault-sync',
    'txn.vault_count': vaults.length,
    'txn.abort_vault': abort_vault || 'none',
  });
  const ctx = trace.setSpan(context.active(), txnSpan);

  // Phase 1: parallel PREPARE
  const prepareResults = await Promise.all(
    vaults.map(async (vault) => {
      const s = tracer.startSpan(`txn.prepare.${vault}`, {}, ctx);
      s.setAttributes({ 'txn.vault': vault, 'txn.phase': 'prepare' });
      await new Promise(r => setTimeout(r, 30 + Math.random() * 70));
      const ok = vault !== abort_vault;
      s.setAttribute('txn.prepare.ok', ok);
      if (ok) {
        s.setStatus({ code: SpanStatusCode.OK });
      } else {
        s.setStatus({ code: SpanStatusCode.ERROR, message: 'vault refused prepare: lock conflict' });
        s.recordException(new Error('prepare failed: ' + vault));
      }
      s.end();
      return { vault, ok };
    })
  );

  const allPrepared = prepareResults.every(r => r.ok);
  const prepared = prepareResults.filter(r => r.ok).map(r => r.vault);

  if (allPrepared) {
    // Phase 2 (success): COMMIT then parallel CONFIRMs
    const commitSpan = tracer.startSpan('txn.commit', {}, ctx);
    commitSpan.setAttributes({ 'txn.vault_count': vaults.length });
    await new Promise(r => setTimeout(r, 15 + Math.random() * 25));
    commitSpan.setStatus({ code: SpanStatusCode.OK });
    commitSpan.end();

    await Promise.all(
      vaults.map(async (vault) => {
        const s = tracer.startSpan(`txn.confirm.${vault}`, {}, ctx);
        s.setAttributes({ 'txn.vault': vault, 'txn.phase': 'confirm' });
        await new Promise(r => setTimeout(r, 20 + Math.random() * 40));
        s.setStatus({ code: SpanStatusCode.OK });
        s.end();
      })
    );

    txnSpan.setAttribute('txn.committed', true);
    txnSpan.setStatus({ code: SpanStatusCode.OK });
  } else {
    // Phase 2 (failure): ABORT then parallel ROLLBACKs for vaults that prepared successfully
    const abortSpan = tracer.startSpan('txn.abort', {}, ctx);
    abortSpan.setAttributes({ 'txn.failed_vault': abort_vault, 'txn.prepared_count': prepared.length });
    await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
    abortSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'transaction aborted due to prepare failure' });
    abortSpan.end();

    await Promise.all(
      prepared.map(async (vault) => {
        const s = tracer.startSpan(`txn.rollback.${vault}`, {}, ctx);
        s.setAttributes({ 'txn.vault': vault, 'txn.phase': 'rollback' });
        await new Promise(r => setTimeout(r, 15 + Math.random() * 35));
        s.end();
      })
    );

    txnSpan.setAttribute('txn.committed', false);
    txnSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'two-phase commit aborted' });
  }

  txnSpan.end();

  try {
    await forward('POST', `/sessions/${session_id}/events`, {
      type: 'transaction',
      data: { vault_count: vaults.length, committed: allPrepared, failed_vault: abort_vault || null },
    });
  } catch (_) {}

  res.json({ ok: true, committed: allPrepared, failed_vault: abort_vault || null });
});

// ── Laser Grid: rate limiter / token bucket ───────────────────────────────────
// PERMITTED:  shot.fire → shot.process (fast, tokens > 0)
// THROTTLED:  shot.fire → rate.backoff (delay span) → shot.process (tokens in [-3, 0))
// REJECTED:   shot.fire alone (ERROR, tokens < -3)
// Bucket: capacity = 10, refill = 2 tokens/sec.
router.post('/api/games/laser-grid/shot', async (req, res) => {
  const { session_id, target_id } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  annotate(req, { 'game.name': 'laser-grid', 'game.session.id': session_id });

  const now = Date.now();
  if (!tokenBucketStore.has(session_id)) tokenBucketStore.set(session_id, { tokens: 10, lastRefill: now });
  const bucket = tokenBucketStore.get(session_id);

  // Refill at 2 tokens/sec, capped at 10
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(10, bucket.tokens + elapsed * 2);
  bucket.lastRefill = now;

  const tokensBefore = bucket.tokens;
  bucket.tokens -= 1;

  let outcome, wait_ms = 0;
  if (bucket.tokens >= 0) {
    outcome = 'permitted';
  } else if (bucket.tokens >= -3) {
    outcome = 'throttled';
    wait_ms = Math.round(-bucket.tokens * 500);
  } else {
    outcome = 'rejected';
  }

  const fireSpan = tracer.startSpan('shot.fire');
  fireSpan.setAttributes({
    'game.name':          'laser-grid',
    'rate.outcome':       outcome,
    'rate.tokens_before': Math.round(tokensBefore * 10) / 10,
    'shot.target_id':     target_id || 'unknown',
  });
  const ctx = trace.setSpan(context.active(), fireSpan);

  if (outcome === 'permitted') {
    const processSpan = tracer.startSpan('shot.process', {}, ctx);
    processSpan.setAttributes({ 'rate.tokens_remaining': Math.round(bucket.tokens * 10) / 10, 'shot.target_id': target_id || 'unknown' });
    await new Promise(r => setTimeout(r, 8 + Math.random() * 20));
    processSpan.setStatus({ code: SpanStatusCode.OK });
    processSpan.end();
    fireSpan.setStatus({ code: SpanStatusCode.OK });

  } else if (outcome === 'throttled') {
    const backoffSpan = tracer.startSpan('rate.backoff', {}, ctx);
    backoffSpan.setAttributes({
      'rate.throttled':      true,
      'rate.wait_ms':        wait_ms,
      'rate.tokens_deficit': Math.round(-bucket.tokens * 10) / 10,
    });
    await new Promise(r => setTimeout(r, wait_ms));
    backoffSpan.end();

    const processSpan = tracer.startSpan('shot.process', {}, ctx);
    processSpan.setAttributes({ 'rate.tokens_remaining': Math.round(bucket.tokens * 10) / 10, 'rate.throttled': true, 'shot.target_id': target_id || 'unknown' });
    await new Promise(r => setTimeout(r, 8 + Math.random() * 20));
    processSpan.setStatus({ code: SpanStatusCode.OK });
    processSpan.end();
    fireSpan.setStatus({ code: SpanStatusCode.OK });

  } else {
    // Rejected: ERROR, no children, very fast
    await new Promise(r => setTimeout(r, 2 + Math.random() * 5));
    fireSpan.setAttributes({ 'rate.rejected': true });
    fireSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'rate limit exceeded — shot rejected' });
    fireSpan.recordException(new Error('rate limit: token bucket exhausted'));
  }

  fireSpan.end();
  tokenBucketStore.set(session_id, bucket);

  try {
    await forward('POST', `/sessions/${session_id}/events`, {
      type: 'shot',
      data: { target_id, outcome, tokens: Math.round(bucket.tokens * 10) / 10 },
    });
  } catch (_) {}

  res.json({ ok: true, outcome, tokens_remaining: Math.round(bucket.tokens * 10) / 10, wait_ms });
});

// ── Canary Deploy: traffic-split routing ─────────────────────────────────────
// Each request is routed to v1 (stable) or v2 (canary) based on canary_pct.
// V1 always succeeds. V2 has 30% error rate and higher latency variance.
// Trace shape (v1): deploy.route → service.v1.handle  (always OK)
// Trace shape (v2 ok):  deploy.route → service.v2.handle  (OK)
// Trace shape (v2 err): deploy.route → service.v2.handle  (ERROR, canary.error: true)
router.post('/api/games/canary-deploy/request', async (req, res) => {
  const { session_id, request_id, canary_pct } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  annotate(req, { 'game.name': 'canary-deploy', 'game.session.id': session_id });

  const pct = typeof canary_pct === 'number' ? canary_pct : 0;
  const isCanary = Math.random() * 100 < pct;
  const version = isCanary ? 'v2' : 'v1';

  const routeSpan = tracer.startSpan('deploy.route');
  routeSpan.setAttributes({
    'game.name':       'canary-deploy',
    'route.version':   version,
    'route.canary_pct': pct,
    'request.id':      request_id || 'unknown',
  });
  const ctx = trace.setSpan(context.active(), routeSpan);

  const serviceSpan = tracer.startSpan(isCanary ? 'service.v2.handle' : 'service.v1.handle', {}, ctx);
  serviceSpan.setAttribute('service.version', version);

  let errored = false;
  if (isCanary) {
    const latency = 40 + Math.random() * 80;
    serviceSpan.setAttribute('service.latency_ms', Math.round(latency));
    await new Promise(r => setTimeout(r, latency));
    if (Math.random() < 0.30) {
      errored = true;
      serviceSpan.setAttribute('canary.error', true);
      serviceSpan.setAttribute('service.ok', false);
      serviceSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'canary service error: unexpected response' });
      serviceSpan.recordException(new Error('canary v2 error'));
    } else {
      serviceSpan.setAttribute('service.ok', true);
      serviceSpan.setStatus({ code: SpanStatusCode.OK });
    }
  } else {
    const latency = 20 + Math.random() * 40;
    serviceSpan.setAttribute('service.latency_ms', Math.round(latency));
    await new Promise(r => setTimeout(r, latency));
    serviceSpan.setAttribute('service.ok', true);
    serviceSpan.setStatus({ code: SpanStatusCode.OK });
  }

  serviceSpan.end();
  routeSpan.setAttribute('route.errored', errored);
  routeSpan.end();

  try {
    await forward('POST', `/sessions/${session_id}/events`, {
      type: 'deploy_request',
      data: { request_id, version, errored },
    });
  } catch (_) {}

  res.json({ ok: true, version, service_ok: !errored });
});

// ── Pulse: pub-sub fan-out to named subscribers ───────────────────────────────
// One event fans out to 4 subscribers in parallel, each with its own span name,
// latency profile, and failure rate.
// Trace shape: event.publish → [subscriber.metrics.process,
//                               subscriber.audit.process,
//                               subscriber.notify.process,
//                               subscriber.cache.process]  (all parallel)
router.post('/api/games/pulse/publish', async (req, res) => {
  const { session_id, event_id, event_type } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  annotate(req, { 'game.name': 'pulse', 'game.session.id': session_id });

  const SUBSCRIBERS = [
    { name: 'metrics', minMs: 15,  maxMs: 40,  failRate: 0.00 },
    { name: 'audit',   minMs: 60,  maxMs: 140, failRate: 0.00 },
    { name: 'notify',  minMs: 50,  maxMs: 120, failRate: 0.20 },
    { name: 'cache',   minMs: 10,  maxMs: 30,  failRate: 0.10 },
  ];

  const publishSpan = tracer.startSpan('event.publish');
  publishSpan.setAttributes({
    'game.name':              'pulse',
    'event.id':               event_id   || 'unknown',
    'event.type':             event_type || 'unknown',
    'event.subscriber_count': SUBSCRIBERS.length,
  });
  const ctx = trace.setSpan(context.active(), publishSpan);

  const results = await Promise.all(
    SUBSCRIBERS.map(async (sub) => {
      const s = tracer.startSpan(`subscriber.${sub.name}.process`, {}, ctx);
      const latency = sub.minMs + Math.random() * (sub.maxMs - sub.minMs);
      const failed  = Math.random() < sub.failRate;
      s.setAttributes({
        'subscriber.name':       sub.name,
        'subscriber.latency_ms': Math.round(latency),
        'subscriber.ok':         !failed,
        'event.type':            event_type || 'unknown',
      });
      await new Promise(r => setTimeout(r, latency));
      if (failed) {
        s.setStatus({ code: SpanStatusCode.ERROR, message: sub.name + ' subscriber processing failed' });
        s.recordException(new Error(sub.name + ' failed to process event ' + (event_id || '')));
      } else {
        s.setStatus({ code: SpanStatusCode.OK });
      }
      s.end();
      return { name: sub.name, ok: !failed };
    })
  );

  const allFailed = results.every(r => !r.ok);
  publishSpan.setAttribute('event.all_failed', allFailed);
  if (allFailed) publishSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'all subscribers failed' });
  publishSpan.end();

  try {
    await forward('POST', `/sessions/${session_id}/events`, {
      type: 'publish',
      data: { event_id, event_type, subscriber_count: SUBSCRIBERS.length, failed_count: results.filter(r => !r.ok).length },
    });
  } catch (_) {}

  res.json({ ok: true, results });
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
