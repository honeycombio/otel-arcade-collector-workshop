const express = require('express');
const fs = require('fs');
const http = require('http');
const yaml = require('js-yaml');

const router = express.Router();

const CONFIG_PATH    = process.env.COLLECTOR_CONFIG_PATH    || '/app/collector-config.yaml';
const CONTAINER_NAME = process.env.COLLECTOR_CONTAINER_NAME || 'otel-arcade-otel-collector-agent-1';
const DOCKER_SOCKET  = '/var/run/docker.sock';
const METRICS_URL    = process.env.COLLECTOR_METRICS_URL    || 'http://otel-collector-agent:8888/metrics';

// ── IDE Watch Mode state ─────────────────────────────────────────
let watchEnabled    = false;
let watchTimer      = null;
let writeInProgress = false;
let watcher         = null;

// ── Docker socket helpers ────────────────────────────────────────

function dockerRequest(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: DOCKER_SOCKET, path, method },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function restartContainer(name) {
  const res = await dockerRequest('POST', `/v1.41/containers/${encodeURIComponent(name)}/restart?t=5`);
  if (res.status !== 204) {
    throw new Error(`Docker restart returned ${res.status}: ${res.body}`);
  }
}

// Poll collector :8888/metrics until it responds (max ~15 s).
async function waitForCollector(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(METRICS_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* still starting */ }
  }
  return false;
}

// Parse Docker's multiplexed log stream (8-byte framing header per chunk).
// Header: [stream(1B), 0x00, 0x00, 0x00, size_big_endian(4B)]
function drainMuxBuffer(buf) {
  const lines = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    if (offset + 8 + size > buf.length) break;
    const text = buf.slice(offset + 8, offset + 8 + size).toString('utf8');
    offset += 8 + size;
    text.split('\n').forEach((l) => { const t = l.trimEnd(); if (t) lines.push(t); });
  }
  return { lines, remainder: buf.slice(offset) };
}

// ── IDE Watch Mode helpers ───────────────────────────────────────

function startWatcher() {
  if (watcher) return;
  try {
    watcher = fs.watch(CONFIG_PATH, () => {
      if (writeInProgress) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(handleExternalChange, 1000);
    });
    watcher.on('error', () => stopWatcher());
  } catch (e) {
    console.error('[watch] Cannot watch collector config:', e.message);
  }
}

function stopWatcher() {
  if (watcher) { watcher.close(); watcher = null; }
  clearTimeout(watchTimer);
}

async function handleExternalChange() {
  let raw;
  try { raw = fs.readFileSync(CONFIG_PATH, 'utf8'); } catch (e) {
    console.error('[watch] Read failed after external change:', e.message);
    return;
  }
  try { yaml.load(raw); } catch (e) {
    console.warn('[watch] Invalid YAML — skipping restart:', e.message);
    return;
  }
  console.log('[watch] External change detected — restarting collector');
  try { await restartContainer(CONTAINER_NAME); }
  catch (e) { console.error('[watch] Restart failed:', e.message); }
}

// ── Routes ──────────────────────────────────────────────────────

router.get('/api/collector/config', (req, res) => {
  try {
    const config = fs.readFileSync(CONFIG_PATH, 'utf8');
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: `Could not read config: ${err.message}` });
  }
});

router.post('/api/collector/config', async (req, res) => {
  const { config } = req.body || {};
  if (!config || typeof config !== 'string') {
    return res.status(400).json({ error: 'config (string) required' });
  }

  // Validate YAML syntax before touching anything.
  try {
    yaml.load(config);
  } catch (err) {
    return res.status(400).json({ error: `YAML parse error: ${err.message}` });
  }

  // Write the file. Flag suppresses the IDE watcher from double-restarting.
  writeInProgress = true;
  try {
    fs.writeFileSync(CONFIG_PATH, config, 'utf8');
  } catch (err) {
    return res.status(500).json({ error: `Could not write config: ${err.message}` });
  } finally {
    setImmediate(() => { writeInProgress = false; });
  }

  // Restart the Collector via Docker Engine API.
  try {
    await restartContainer(CONTAINER_NAME);
  } catch (err) {
    return res.status(500).json({ error: `Restart failed: ${err.message}` });
  }

  // Wait for the Collector to come back up.
  const ok = await waitForCollector(15000);
  if (!ok) {
    return res.status(500).json({
      error: 'Collector did not come back up within 15 s — check `docker compose logs otel-collector-agent` for errors.',
    });
  }

  res.json({ ok: true, message: 'Config saved. Collector restarted successfully.' });
});

router.post('/api/collector/restart', async (req, res) => {
  try {
    await restartContainer(CONTAINER_NAME);
    res.json({ ok: true, message: 'Collector restarted.' });
  } catch (err) {
    res.status(500).json({ error: `Restart failed: ${err.message}` });
  }
});

// SSE endpoint — streams Collector container logs to the browser.
router.get('/api/collector/logs', (req, res) => {
  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const dockerReq = http.request({
    socketPath: DOCKER_SOCKET,
    path: `/v1.41/containers/${encodeURIComponent(CONTAINER_NAME)}/logs?stdout=1&stderr=1&follow=1&tail=100`,
    method: 'GET',
  }, (dockerRes) => {
    let buf = Buffer.alloc(0);
    dockerRes.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { lines, remainder } = drainMuxBuffer(buf);
      buf = remainder;
      lines.forEach((line) => res.write(`data: ${JSON.stringify(line)}\n\n`));
    });
    dockerRes.on('end', () => res.end());
  });

  dockerReq.on('error', (err) => {
    res.write(`data: ${JSON.stringify('(log stream unavailable: ' + err.message + ')')}\n\n`);
    res.end();
  });
  dockerReq.end();
  req.on('close', () => dockerReq.destroy());
});

router.get('/api/collector/watch', (req, res) => {
  res.json({ enabled: watchEnabled });
});

router.post('/api/collector/watch', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) required' });
  }
  watchEnabled = enabled;
  if (enabled) {
    startWatcher();
    res.json({ ok: true, message: 'Watch mode enabled. Save collector-config.yaml in your IDE to auto-restart.' });
  } else {
    stopWatcher();
    res.json({ ok: true, message: 'Watch mode disabled.' });
  }
});

module.exports = router;
