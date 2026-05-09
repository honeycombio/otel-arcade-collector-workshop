const express = require('express');
const { randomBytes } = require('crypto');

const router = express.Router();
const COLLECTOR_OTLP_HTTP = process.env.COLLECTOR_OTLP_HTTP || 'http://otel-collector-agent:4318';

function hex(len) { return randomBytes(len).toString('hex'); }

// ── OTLP helpers ──────────────────────────────────────────────────────────────

function sAttr(key, value)   { return { key, value: { stringValue: String(value) } }; }
function iAttr(key, value)   { return { key, value: { intValue: value } }; }
function dAttr(key, value)   { return { key, value: { doubleValue: value } }; }
function resourceAttrs(name) {
  return [sAttr('service.name', name), sAttr('service.version', '0.1.0'), sAttr('app.name', name)]; // DELIBERATE
}

function makeEvent(name, attrs = []) {
  return {
    timeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
    name,
    attributes: attrs,
  };
}

function makeSpan({ traceId, parentSpanId, name, kind = 2, attrs = [], events = [], offsetMs = 0, durationMs = 2 }) {
  const start = BigInt(Date.now() + offsetMs) * 1_000_000n;
  const end   = start + BigInt(durationMs) * 1_000_000n;
  const span = {
    traceId,
    spanId:            hex(8),
    parentSpanId,
    name,
    kind,
    startTimeUnixNano: String(start),
    endTimeUnixNano:   String(end),
    attributes:        attrs,
    status:            { code: 1 },
  };
  if (events.length) span.events = events;
  return span;
}

async function sendLog({ serviceName, severity = 'INFO', body, attrs = [], traceId = '', spanId = '' }) {
  const severityNumber = { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17 }[severity] ?? 9;
  const nowNs = String(BigInt(Date.now()) * 1_000_000n);
  const payload = {
    resourceLogs: [{
      resource: { attributes: resourceAttrs(serviceName) },
      scopeLogs: [{
        scope: { name: 'telemetrygen' },
        logRecords: [{
          timeUnixNano:         nowNs,
          observedTimeUnixNano: nowNs,
          severityNumber,
          severityText:         severity,
          body:                 { stringValue: body },
          attributes:           attrs,
          traceId,
          spanId,
        }],
      }],
    }],
  };
  return fetch(`${COLLECTOR_OTLP_HTTP}/v1/logs`, {
    method:  'POST',
    headers: { 'content-type': 'application/json', 'x-collector-source': 'agent' },
    body:    JSON.stringify(payload),
  });
}

// ── Single span ───────────────────────────────────────────────────────────────

router.post('/api/telemetrygen', async (req, res) => {
  const {
    serviceName = 'test-service',
    spanName    = 'test.span',
    attributes  = [],
    events      = [],
    withLog     = false,
    withError   = false,
    durationMs  = 5,
  } = req.body || {};

  if (!spanName || typeof spanName !== 'string') {
    return res.status(400).json({ error: 'spanName required' });
  }

  const traceId = hex(16);
  const spanId  = hex(8);
  const nowMs   = Date.now();
  const startNs = String(BigInt(nowMs) * 1_000_000n);
  const endNs   = String(BigInt(nowMs + Math.max(1, durationMs)) * 1_000_000n);

  const attrList = (Array.isArray(attributes) ? attributes : [])
    .filter((a) => a && a.key)
    .map(({ key, value }) => ({ key, value: { stringValue: String(value ?? '') } }));

  const eventList = (Array.isArray(events) ? events : [])
    .filter((e) => e && e.name)
    .map((e) => makeEvent(e.name));

  const span = {
    traceId, spanId,
    name:               spanName,
    kind:               2,
    startTimeUnixNano:  startNs,
    endTimeUnixNano:    endNs,
    attributes:         attrList,
    status:             withError ? { code: 2, message: 'error' } : { code: 1 },
  };
  if (eventList.length) span.events = eventList;

  const payload = {
    resourceSpans: [{
      resource: {
        attributes: [
          sAttr('service.name',    serviceName),
          sAttr('service.version', '0.0.0'),
          sAttr('app.name',        serviceName), // DELIBERATE: redundant
        ],
      },
      scopeSpans: [{ scope: { name: 'telemetrygen' }, spans: [span] }],
    }],
  };

  try {
    const sends = [
      fetch(`${COLLECTOR_OTLP_HTTP}/v1/traces`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', 'x-collector-source': 'agent' },
        body:    JSON.stringify(payload),
      }),
    ];
    if (withLog) {
      sends.push(sendLog({
        serviceName,
        severity: 'INFO',
        body:     `span generated: ${spanName}`,
        attrs:    attrList,
        traceId,
        spanId,
      }));
    }
    const [r] = await Promise.all(sends);
    res.json({ ok: r.ok, traceId, spanId, service: serviceName, span: spanName });
  } catch (err) {
    res.status(502).json({ error: `Collector unreachable: ${err.message}` });
  }
});

// ── Session generator ─────────────────────────────────────────────────────────
// Simulates realistic multi-span game sessions across all three services,
// preserving all deliberate telemetry smells for OTTL practice.

const PLAYER_IDS = ['u_load01', 'u_load02', 'u_load03', 'u_load04', 'u_load05'];
const UA_STRING  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.97';

const GAME_CFG = {
  memory:       { events: () => randInt(8, 20),  eventType: 'flip',      score: () => randInt(100, 600)  },
  typing:       { events: () => randInt(4, 12),  eventType: 'progress',  score: () => randInt(200, 1500) },
  whackamole:   { events: () => randInt(10, 30), eventType: 'hit',       score: () => randInt(50, 400)   },
  reaction:     { events: () => 5,               eventType: 'trial',     score: () => randInt(600, 950)  },
  'math-sprint':{ events: () => 10,              eventType: 'answer',    score: () => randInt(50, 100)   },
  'simon-says': { events: () => randInt(5, 15),  eventType: 'sequence',  score: () => randInt(100, 800)  },
  'speed-tap':  { events: () => randInt(6, 12),  eventType: 'tap_burst', score: () => randInt(80, 180)   },
};

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function buildSession(game, playerId, traceId) {
  const cfg       = GAME_CFG[game] || GAME_CFG.memory;
  const sessionId = 'sess_' + hex(8);
  const score     = cfg.score();
  const eventN    = cfg.events();
  let t = 0; // relative offset ms

  const uiSpans  = [];
  const apiSpans = [];
  const lbSpans  = [];

  // ── arcade-ui: game start ──────────────────────────────────────────────
  const httpStartId = hex(8);
  uiSpans.push(makeSpan({
    traceId, name: `POST /api/games/${game}/start`, kind: 2,
    attrs: [sAttr('player.id', playerId), sAttr('browser.user_agent', UA_STRING), sAttr('game.name', game)], // DELIBERATE: PII + full UA
    offsetMs: t, durationMs: 12,
  }));
  uiSpans.push(makeSpan({
    traceId, parentSpanId: httpStartId, name: 'arcade.game.start', kind: 3,
    attrs:  [sAttr('player.id', playerId), sAttr('game.name', game), sAttr('game.session.id', sessionId)], // DELIBERATE: PII
    events: [makeEvent('player.validated'), makeEvent('session.created', [sAttr('game.session.id', sessionId)])],
    offsetMs: t + 1, durationMs: 8,
  }));

  // ── score-api: session create ──────────────────────────────────────────
  apiSpans.push(makeSpan({
    traceId, name: 'game.session.start', kind: 2, // DELIBERATE: naming style A
    attrs:  [sAttr('player.id', playerId), sAttr('game.name', game), sAttr('game.session.id', sessionId)], // DELIBERATE: PII
    events: [makeEvent('db.transaction.started')],
    offsetMs: t + 2, durationMs: 6,
  }));
  apiSpans.push(makeSpan({
    traceId,
    name: `INSERT INTO sessions (id, game, player_id, started_at) VALUES ('${sessionId}','${game}','${playerId}','2026-05-01T12:00:00Z')`, // DELIBERATE: SQL smell + PII
    kind: 3,
    attrs: [sAttr('db.system', 'sqlite'), sAttr('db.statement', `INSERT INTO sessions VALUES ('${sessionId}',...)`), sAttr('player.id', playerId)], // DELIBERATE
    offsetMs: t + 3, durationMs: 2,
  }));
  t += 15;

  // ── arcade-ui + score-api: events ─────────────────────────────────────
  for (let i = 0; i < eventN; i++) {
    uiSpans.push(makeSpan({
      traceId, name: `POST /api/games/${game}/events`, kind: 2,
      attrs: [sAttr('player.id', playerId), sAttr('game.name', game), sAttr('browser.user_agent', UA_STRING)], // DELIBERATE
      offsetMs: t, durationMs: 5,
    }));
    apiSpans.push(makeSpan({
      traceId, name: 'game_session_v2_event', kind: 2, // DELIBERATE: naming style B
      attrs:  [sAttr('player.id', playerId), sAttr('game.name', game), sAttr('game.event.type', cfg.eventType), sAttr('game.session.id', sessionId)], // DELIBERATE: PII
      events: [makeEvent(cfg.eventType + '.recorded', [iAttr('sequence', i + 1)])],
      offsetMs: t + 1, durationMs: 4,
    }));
    apiSpans.push(makeSpan({
      traceId,
      name: `INSERT INTO events (session_id, event_type, data) VALUES ('${sessionId}','${cfg.eventType}','{}')`, // DELIBERATE: SQL smell
      kind: 3,
      attrs: [sAttr('db.system', 'sqlite'), sAttr('db.statement', `INSERT INTO events VALUES ('${sessionId}',...)`), sAttr('player.id', playerId)], // DELIBERATE
      offsetMs: t + 2, durationMs: 1,
    }));
    t += 8;
  }

  // ── arcade-ui + score-api: complete ───────────────────────────────────
  uiSpans.push(makeSpan({
    traceId, name: `POST /api/games/${game}/complete`, kind: 2,
    attrs: [sAttr('player.id', playerId), sAttr('game.name', game), sAttr('browser.user_agent', UA_STRING)], // DELIBERATE
    offsetMs: t, durationMs: 30,
  }));
  apiSpans.push(makeSpan({
    traceId, name: 'GameSession/Complete', kind: 2, // DELIBERATE: naming style C
    attrs:  [sAttr('player.id', playerId), sAttr('game.name', game), sAttr('game.session.id', sessionId), iAttr('game.events_count', eventN)], // DELIBERATE: PII
    events: [
      makeEvent('score.finalized',      [iAttr('score', score)]),
      makeEvent('leaderboard.updated',  [iAttr('rank', randInt(1, 20))]),
    ],
    offsetMs: t + 1, durationMs: 25,
  }));
  apiSpans.push(makeSpan({
    traceId,
    name: `SELECT * FROM sessions WHERE id = '${sessionId}'`, // DELIBERATE: SQL smell + literal ID
    kind: 3,
    attrs: [sAttr('db.system', 'sqlite'), sAttr('db.statement', `SELECT * FROM sessions WHERE id = '${sessionId}'`), sAttr('player.id', playerId)], // DELIBERATE
    offsetMs: t + 2, durationMs: 2,
  }));
  apiSpans.push(makeSpan({
    traceId, name: 'score.compute', kind: 3,
    attrs: [sAttr('algorithm', 'weighted-sum-v1'), iAttr('raw_score', randInt(80, 900)), dAttr('bonus_multiplier', 1.2), sAttr('player.id', playerId), sAttr('game.name', game)], // DELIBERATE: PII
    offsetMs: t + 5, durationMs: 3,
  }));
  apiSpans.push(makeSpan({
    traceId,
    name: `INSERT INTO scores (session_id, game, player_id, score) VALUES ('${sessionId}','${game}','${playerId}',${score})`, // DELIBERATE: SQL smell + PII
    kind: 3,
    attrs: [sAttr('db.system', 'sqlite'), sAttr('db.statement', `INSERT INTO scores VALUES ('${sessionId}',...)`), sAttr('player.id', playerId)], // DELIBERATE
    offsetMs: t + 9, durationMs: 2,
  }));

  // ── leaderboard: receive score ─────────────────────────────────────────
  lbSpans.push(makeSpan({
    traceId,
    name: `INSERT INTO scores (session_id, game, player_id, score) VALUES ('${sessionId}','${game}','${playerId}',${score})`, // DELIBERATE: SQL smell + PII
    kind: 3,
    attrs: [sAttr('db.system', 'sqlite'), sAttr('db.statement', `INSERT INTO scores VALUES...`), sAttr('player.id', playerId), sAttr('game.name', game)], // DELIBERATE
    offsetMs: t + 15, durationMs: 3,
  }));
  lbSpans.push(makeSpan({
    traceId, name: 'leaderboard.rank.compute', kind: 3,
    attrs: [sAttr('game.name', game), sAttr('player.id', playerId), iAttr('leaderboard.rank', randInt(1, 20))], // DELIBERATE: PII
    offsetMs: t + 18, durationMs: 2,
  }));

  // ── leaderboard: log records (DELIBERATE: DEBUG noise, PII in attrs) ───
  const rank = randInt(1, 20);
  const nowNs = String(BigInt(Date.now() + t + 20) * 1_000_000n);
  const lbLogs = [
    {
      timeUnixNano: nowNs, observedTimeUnixNano: nowNs,
      severityNumber: 5, severityText: 'DEBUG',
      body: { stringValue: 'score recorded' },
      attributes: [
        sAttr('session_id', sessionId), sAttr('game', game),
        sAttr('player.id', playerId), // DELIBERATE: PII in logs
        iAttr('score', score), iAttr('rank', rank),
      ],
      traceId,
    },
    {
      timeUnixNano: nowNs, observedTimeUnixNano: nowNs,
      severityNumber: 5, severityText: 'DEBUG',
      body: { stringValue: 'served leaderboard' },
      attributes: [sAttr('game', game), iAttr('limit', 5), iAttr('count', Math.min(rank, 5))],
      traceId,
    },
  ];

  return { traceId, sessionId, uiSpans, apiSpans, lbSpans, lbLogs };
}

function buildOtlpPayload(sessions) {
  const byService = { 'arcade-ui': [], 'score-api': [], leaderboard: [] };
  for (const s of sessions) {
    byService['arcade-ui'].push(...s.uiSpans);
    byService['score-api'].push(...s.apiSpans);
    byService.leaderboard.push(...s.lbSpans);
  }
  return {
    resourceSpans: Object.entries(byService)
      .filter(([, spans]) => spans.length > 0)
      .map(([svc, spans]) => ({
        resource: { attributes: resourceAttrs(svc) },
        scopeSpans: [{ scope: { name: 'telemetrygen' }, spans }],
      })),
  };
}

function buildOtlpLogPayload(sessions) {
  const records = sessions.flatMap((s) => s.lbLogs);
  if (!records.length) return null;
  return {
    resourceLogs: [{
      resource: { attributes: resourceAttrs('leaderboard') },
      scopeLogs: [{ scope: { name: 'telemetrygen' }, logRecords: records }],
    }],
  };
}

router.post('/api/telemetrygen/session', async (req, res) => {
  let { game = 'memory', sessions = 5 } = req.body || {};
  sessions = Math.min(Math.max(1, parseInt(sessions, 10) || 1), 50);

  const games = game === 'mixed'
    ? Array.from({ length: sessions }, () => pick(Object.keys(GAME_CFG)))
    : Array.from({ length: sessions }, () => game);

  const built      = games.map((g) => buildSession(g, pick(PLAYER_IDS), hex(16)));
  const payload    = buildOtlpPayload(built);
  const logPayload = buildOtlpLogPayload(built);

  const spanCount = payload.resourceSpans.reduce(
    (n, rs) => n + rs.scopeSpans.reduce((m, ss) => m + ss.spans.length, 0), 0
  );
  const logCount = built.reduce((n, s) => n + s.lbLogs.length, 0);

  try {
    const sends = [
      fetch(`${COLLECTOR_OTLP_HTTP}/v1/traces`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', 'x-collector-source': 'agent' },
        body:    JSON.stringify(payload),
      }),
    ];
    if (logPayload) {
      sends.push(fetch(`${COLLECTOR_OTLP_HTTP}/v1/logs`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', 'x-collector-source': 'agent' },
        body:    JSON.stringify(logPayload),
      }));
    }
    const [r] = await Promise.all(sends);
    res.json({
      ok:       r.ok,
      sessions: built.length,
      spanCount,
      logCount,
      traceIds: built.map((s) => s.traceId),
    });
  } catch (err) {
    res.status(502).json({ error: `Collector unreachable: ${err.message}` });
  }
});

module.exports = router;
