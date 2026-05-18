const path = require('path');
const http = require('http');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const yaml = require('js-yaml');

const { makeReceiver } = require('./otlp-receiver');
const { startScraper } = require('./collector-scraper');

const UI_PORT                = parseInt(process.env.PORT                 || '8090', 10);
const OTLP_PORT              = parseInt(process.env.OTLP_PORT            || '4318', 10);
const COLLECTOR_METRICS_URL  = process.env.COLLECTOR_METRICS_URL         || 'http://otel-collector:8888/metrics';
const GATEWAY_METRICS_URL    = process.env.GATEWAY_METRICS_URL           || '';
const SCRAPE_INTERVAL_MS     = parseInt(process.env.SCRAPE_INTERVAL_MS   || '5000', 10);
const AGENT_CONFIG_PATH      = process.env.COLLECTOR_CONFIG_PATH         || '/app/collector-agent-config.yaml';
const GATEWAY_CONFIG_PATH    = process.env.GATEWAY_CONFIG_PATH           || '/app/collector-gateway-config.yaml';

// ── Config parser ─────────────────────────────────────────────────────────

function parseConfig(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const doc = yaml.load(raw);
    const pipelines = {};
    const defs = (doc && doc.service && doc.service.pipelines) || {};
    for (const [name, pl] of Object.entries(defs)) {
      pipelines[name] = {
        receivers:  pl.receivers  || [],
        processors: pl.processors || [],
        exporters:  pl.exporters  || [],
      };
    }
    return { ok: true, pipelines };
  } catch (e) {
    return { ok: false, error: e.message, pipelines: {} };
  }
}

let cachedConfigs = {
  agent:   parseConfig(AGENT_CONFIG_PATH),
  gateway: parseConfig(GATEWAY_CONFIG_PATH),
};

function reloadConfig(key, filePath) {
  cachedConfigs = { ...cachedConfigs, [key]: parseConfig(filePath) };
  broadcast({ type: 'config', payload: cachedConfigs });
}

// Watch a config file and reload on change.
// Uses fs.watchFile (stat polling) instead of fs.watch (inotify) because
// inotify events are not propagated across the macOS↔Docker FUSE boundary,
// making fs.watch unreliable on bind-mounted volumes. watchFile also handles
// files that don't exist yet (e.g. collector-gateway-config.yaml before first deploy).
function watchConfig(filePath, key) {
  fs.watchFile(filePath, { persistent: false, interval: 1000 }, () => {
    reloadConfig(key, filePath);
  });
}

watchConfig(AGENT_CONFIG_PATH,   'agent');
watchConfig(GATEWAY_CONFIG_PATH, 'gateway');

// ── UI server ─────────────────────────────────────────────────────────────
const app = express();
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/buffer', (_req, res) => res.json(receiver.buffer.list()));

const distDir = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
  app.get('/', (_req, res) => {
    res.set('content-type', 'text/html').send(
      '<pre style="font-family:monospace;padding:24px">visualizer server is running but client/dist is not built.\n' +
      'Run `npm run build` (or `npm run dev` for HMR via Vite on :5173).</pre>'
    );
  });
}

const server = http.createServer(app);

// ── WebSocket fan-out ──────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'snapshot',     payload: receiver.buffer.list() }));
  ws.send(JSON.stringify({ type: 'raw-snapshot', payload: receiver.rawBuffer.list() }));
  ws.send(JSON.stringify({ type: 'config',       payload: cachedConfigs }));
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

// ── OTLP/HTTP receiver (separate port) ─────────────────────────────────────
const receiver = makeReceiver({ broadcast });
// keepAliveTimeout must exceed the Collector's batch.timeout (default 5s) to
// prevent the Node.js 18+ default 5s keep-alive timeout from racing with
// in-flight requests from the Go HTTP client, which causes EOF / connection
// reset errors on the Collector side.
const otlpServer = receiver.app.listen(OTLP_PORT, () => {
  console.log(`visualizer OTLP/HTTP receiver listening on :${OTLP_PORT}`);
});
otlpServer.keepAliveTimeout = 65000;
otlpServer.headersTimeout   = 66000;

// ── Service graph broadcaster ───────────────────────────────────────────────
setInterval(() => {
  const edges = receiver.getServiceGraph();
  if (edges.length > 0) broadcast({ type: 'service-graph', payload: edges });
}, 5000);

// ── Collector self-metrics scrapers ────────────────────────────────────────
startScraper({
  url:         COLLECTOR_METRICS_URL,
  intervalMs:  SCRAPE_INTERVAL_MS,
  broadcast,
  type:        'metrics',
});

if (GATEWAY_METRICS_URL) {
  startScraper({
    url:        GATEWAY_METRICS_URL,
    intervalMs: SCRAPE_INTERVAL_MS,
    broadcast,
    type:       'gateway-metrics',
  });
}

server.listen(UI_PORT, () => {
  console.log(`visualizer UI listening on :${UI_PORT} (ws at /ws)`);
});
