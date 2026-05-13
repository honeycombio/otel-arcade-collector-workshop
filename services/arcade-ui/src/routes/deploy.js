const express = require('express');
const fs      = require('fs');
const http    = require('http');
const yaml    = require('js-yaml');

const router = express.Router();

// ── Config ────────────────────────────────────────────────────────────────────

const DOCKER_SOCKET            = '/var/run/docker.sock';
const GATEWAY_IMAGE            = process.env.COLLECTOR_IMAGE              || 'otel/opentelemetry-collector-contrib:0.151.0';
const GATEWAY_CONTAINER_NAME   = process.env.GATEWAY_CONTAINER_NAME       || 'otel-arcade-otel-collector-gateway-1';
const GATEWAY_NETWORK          = process.env.GATEWAY_NETWORK              || 'otel-arcade_arcade';
const GATEWAY_CONFIG_PATH      = process.env.GATEWAY_CONFIG_PATH          || '/app/gateway-config.yaml';
const GATEWAY_CONFIG_HOST_PATH = process.env.GATEWAY_CONFIG_HOST_PATH     || '';
const AGENT_CONFIG_PATH        = process.env.COLLECTOR_CONFIG_PATH        || '/app/collector-config.yaml';
const AGENT_CONTAINER_NAME     = process.env.COLLECTOR_CONTAINER_NAME     || 'otel-arcade-otel-collector-agent-1';
const LOADGEN_CONTAINER_NAME   = process.env.LOADGEN_CONTAINER_NAME       || 'otel-arcade-loadgen-1';
const LOADGEN_IMAGE            = process.env.LOADGEN_IMAGE                || 'otel-arcade-loadgen';

const DEFAULT_GATEWAY_CONFIG = `# OTel Arcade — Gateway Collector.
# Receives OTLP from agents and forwards to Honeycomb and the Visualizer.
# In Lab 3, point your agent's exporters at otel-collector-gateway:4317.

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 128

exporters:
  debug:
    verbosity: basic
  otlp/backend:
    endpoint: \${env:OTEL_EXPORTER_ENDPOINT}
    headers:
      x-honeycomb-team: \${env:HONEYCOMB_API_KEY}
  otlphttp/visualizer:
    endpoint: http://visualizer:4318
    encoding: json
    headers:
      x-collector-source: gateway
    tls:
      insecure: true

service:
  telemetry:
    metrics:
      readers:
        - pull:
            exporter:
              prometheus:
                host: "0.0.0.0"
                port: 8888
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [debug, otlp/backend, otlphttp/visualizer]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [debug, otlp/backend, otlphttp/visualizer]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [debug, otlp/backend, otlphttp/visualizer]
`;

const PLACEHOLDER_GATEWAY_CONFIG =
  '# OTel Arcade — Gateway Collector\n' +
  '# Not deployed yet. Use ⚙ Deploy & Configure → Gateway tab to deploy.\n';

function gatewayConfigHasPipelines() {
  try {
    const doc = yaml.load(fs.readFileSync(GATEWAY_CONFIG_PATH, 'utf8'));
    return !!(doc?.service?.pipelines && Object.keys(doc.service.pipelines).length > 0);
  } catch (_) { return false; }
}

// ── IDE Watch Mode state ──────────────────────────────────────────────────────

const watchState = {
  agent: {
    enabled: false, timer: null, writeInProgress: false, watcher: null,
    get configPath()     { return AGENT_CONFIG_PATH; },
    get containerName()  { return AGENT_CONTAINER_NAME; },
  },
  gateway: {
    enabled: false, timer: null, writeInProgress: false, watcher: null,
    get configPath()     { return GATEWAY_CONFIG_PATH; },
    get containerName()  { return GATEWAY_CONTAINER_NAME; },
  },
};

function startWatcher(ctx) {
  if (ctx.watcher) return;
  try {
    ctx.watcher = fs.watch(ctx.configPath, () => {
      if (ctx.writeInProgress) return;
      clearTimeout(ctx.timer);
      ctx.timer = setTimeout(() => handleExternalChange(ctx), 1000);
    });
    ctx.watcher.on('error', () => stopWatcher(ctx));
  } catch (e) {
    console.error(`[watch] Cannot watch ${ctx.configPath}:`, e.message);
  }
}

function stopWatcher(ctx) {
  if (ctx.watcher) { ctx.watcher.close(); ctx.watcher = null; }
  clearTimeout(ctx.timer);
}

async function handleExternalChange(ctx) {
  let raw;
  try { raw = fs.readFileSync(ctx.configPath, 'utf8'); } catch (e) {
    console.error('[watch] Read failed after external change:', e.message);
    return;
  }
  try { yaml.load(raw); } catch (e) {
    console.warn(`[watch] Invalid YAML in ${ctx.configPath} — skipping restart:`, e.message);
    return;
  }
  console.log(`[watch] External change in ${ctx.configPath} — restarting ${ctx.containerName}`);
  try { await restartContainer(ctx.containerName); }
  catch (e) { console.error('[watch] Restart failed:', e.message); }
}

// ── Docker socket helpers ─────────────────────────────────────────────────────

function dockerRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body != null ? JSON.stringify(body) : null;
    const headers = bodyStr
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
      : {};
    const req = http.request(
      { socketPath: DOCKER_SOCKET, path: apiPath, method, headers },
      (res) => {
        let data = '';
        res.on('data', (d) => { data += d; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function inspectContainer(name) {
  const res = await dockerRequest('GET', `/v1.41/containers/${encodeURIComponent(name)}/json`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`Docker inspect returned ${res.status}: ${res.body}`);
  return JSON.parse(res.body);
}

async function removeContainer(name) {
  await dockerRequest('DELETE', `/v1.41/containers/${encodeURIComponent(name)}?force=true`);
}

async function createContainer(name, spec) {
  const res = await dockerRequest('POST', `/v1.41/containers/create?name=${encodeURIComponent(name)}`, spec);
  if (res.status !== 201) throw new Error(`Docker create returned ${res.status}: ${res.body}`);
  return JSON.parse(res.body);
}

async function startContainer(name) {
  const res = await dockerRequest('POST', `/v1.41/containers/${encodeURIComponent(name)}/start`);
  if (res.status !== 204 && res.status !== 304)
    throw new Error(`Docker start returned ${res.status}: ${res.body}`);
}

async function restartContainer(name) {
  const res = await dockerRequest('POST', `/v1.41/containers/${encodeURIComponent(name)}/restart?t=5`);
  if (res.status !== 204) throw new Error(`Docker restart returned ${res.status}: ${res.body}`);
}

// Parse Docker's multiplexed log stream (8-byte framing header per chunk).
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

function streamContainerLogs(containerName, req, res) {
  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const dockerReq = http.request({
    socketPath: DOCKER_SOCKET,
    path: `/v1.41/containers/${encodeURIComponent(containerName)}/logs?stdout=1&stderr=1&follow=1&tail=100`,
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
    res.write(`data: ${JSON.stringify(`(log stream unavailable: ${err.message})`)}\n\n`);
    res.end();
  });
  dockerReq.end();
  req.on('close', () => dockerReq.destroy());
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Status: inspect both containers via Docker socket.
router.get('/api/deploy/status', async (req, res) => {
  try {
    const [agentResult, gatewayResult] = await Promise.allSettled([
      inspectContainer(AGENT_CONTAINER_NAME),
      inspectContainer(GATEWAY_CONTAINER_NAME),
    ]);

    const agentC   = agentResult.status   === 'fulfilled' ? agentResult.value   : null;
    const gatewayC = gatewayResult.status === 'fulfilled' ? gatewayResult.value : null;

    res.json({
      agent: {
        deployed: true,
        ready:    agentC && agentC.State.Running ? 1 : 0,
        desired:  1,
      },
      gateway: {
        deployed: gatewayC !== null,
        ready:    gatewayC && gatewayC.State.Running ? 1 : 0,
        desired:  gatewayC !== null ? 1 : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agent routes (delegates to the local collector container) ─────────────────

router.get('/api/deploy/agent/config', (req, res) => {
  try {
    res.json({ config: fs.readFileSync(AGENT_CONFIG_PATH, 'utf8') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/deploy/agent/config', async (req, res) => {
  const { config } = req.body || {};
  if (!config || typeof config !== 'string')
    return res.status(400).json({ error: 'config (string) required' });

  try { yaml.load(config); } catch (err) {
    return res.status(400).json({ error: `YAML parse error: ${err.message}` });
  }
  watchState.agent.writeInProgress = true;
  try {
    fs.writeFileSync(AGENT_CONFIG_PATH, config, 'utf8');
  } catch (err) {
    return res.status(500).json({ error: `Could not write config: ${err.message}` });
  } finally {
    setImmediate(() => { watchState.agent.writeInProgress = false; });
  }
  try {
    await restartContainer(AGENT_CONTAINER_NAME);
    res.json({ ok: true, message: 'Agent config updated. Collector restarted.' });
  } catch (err) {
    res.status(500).json({ error: `Restart failed: ${err.message}` });
  }
});

router.post('/api/deploy/agent/restart', async (req, res) => {
  try {
    await restartContainer(AGENT_CONTAINER_NAME);
    res.json({ ok: true, message: 'Agent restarted.' });
  } catch (err) {
    res.status(500).json({ error: `Restart failed: ${err.message}` });
  }
});

router.get('/api/deploy/agent/logs', (req, res) => {
  streamContainerLogs(AGENT_CONTAINER_NAME, req, res);
});

// ── Gateway routes (Docker container lifecycle) ───────────────────────────────

router.post('/api/deploy/gateway', async (req, res) => {
  if (!GATEWAY_CONFIG_HOST_PATH) {
    return res.status(500).json({
      error: 'GATEWAY_CONFIG_HOST_PATH is not set. Ensure docker-compose.yaml passes it to the arcade-ui service.',
    });
  }

  try {
    // Write default config when no pipelines are defined (initial/placeholder state).
    if (!fs.existsSync(GATEWAY_CONFIG_PATH) || !gatewayConfigHasPipelines()) {
      fs.writeFileSync(GATEWAY_CONFIG_PATH, DEFAULT_GATEWAY_CONFIG, 'utf8');
    }

    // Remove any existing gateway container.
    const existing = await inspectContainer(GATEWAY_CONTAINER_NAME);
    if (existing) await removeContainer(GATEWAY_CONTAINER_NAME);

    // Create and start the gateway container on the shared arcade network.
    // NetworkingConfig (not HostConfig.NetworkMode) is required to set a network alias,
    // so the agent can reach the gateway as "otel-collector-gateway" via Docker DNS.
    const honeycombKey = (req.body && req.body.apiKey) || process.env.HONEYCOMB_API_KEY || '';
    await createContainer(GATEWAY_CONTAINER_NAME, {
      Image: GATEWAY_IMAGE,
      Cmd:   ['--config=/etc/otelcol-contrib/config.yaml'],
      Env: [
        `HONEYCOMB_API_KEY=${honeycombKey}`,
        `OTEL_EXPORTER_ENDPOINT=${process.env.OTEL_EXPORTER_ENDPOINT || 'api.honeycomb.io:443'}`,
      ],
      HostConfig: {
        Binds: [`${GATEWAY_CONFIG_HOST_PATH}:/etc/otelcol-contrib/config.yaml:ro`],
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [GATEWAY_NETWORK]: {
            Aliases: ['otel-collector-gateway'],
          },
        },
      },
    });

    await startContainer(GATEWAY_CONTAINER_NAME);
    res.json({ ok: true, message: 'Gateway container started.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/deploy/gateway/config', (req, res) => {
  try {
    const config = fs.existsSync(GATEWAY_CONFIG_PATH)
      ? fs.readFileSync(GATEWAY_CONFIG_PATH, 'utf8')
      : DEFAULT_GATEWAY_CONFIG;
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/deploy/gateway/config', async (req, res) => {
  const { config } = req.body || {};
  if (!config || typeof config !== 'string')
    return res.status(400).json({ error: 'config (string) required' });

  try { yaml.load(config); } catch (err) {
    return res.status(400).json({ error: `YAML parse error: ${err.message}` });
  }
  watchState.gateway.writeInProgress = true;
  try {
    fs.writeFileSync(GATEWAY_CONFIG_PATH, config, 'utf8');
  } catch (err) {
    return res.status(500).json({ error: `Could not write config: ${err.message}` });
  } finally {
    setImmediate(() => { watchState.gateway.writeInProgress = false; });
  }
  try {
    await restartContainer(GATEWAY_CONTAINER_NAME);
    res.json({ ok: true, message: 'Gateway config updated. Container restarted.' });
  } catch (err) {
    res.status(500).json({ error: `Restart failed: ${err.message}` });
  }
});

router.delete('/api/deploy/gateway', async (req, res) => {
  try {
    const existing = await inspectContainer(GATEWAY_CONTAINER_NAME);
    if (!existing) return res.status(404).json({ error: 'Gateway container not found.' });
    await removeContainer(GATEWAY_CONTAINER_NAME);
    try { fs.writeFileSync(GATEWAY_CONFIG_PATH, PLACEHOLDER_GATEWAY_CONFIG, 'utf8'); } catch (_) {}
    res.json({ ok: true, message: 'Gateway container removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/deploy/gateway/logs', (req, res) => {
  streamContainerLogs(GATEWAY_CONTAINER_NAME, req, res);
});

// ── Load generator routes ─────────────────────────────────────────────────────

router.get('/api/deploy/loadgen/status', async (req, res) => {
  try {
    const c = await inspectContainer(LOADGEN_CONTAINER_NAME);
    res.json({
      deployed: c !== null,
      running:  c ? c.State.Running : false,
      rps:      c ? (c.Config.Env || []).reduce((v, e) => {
        const m = e.match(/^LOADGEN_RPS=(\d+)$/);
        return m ? parseInt(m[1], 10) : v;
      }, 5) : 5,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/deploy/loadgen/start', async (req, res) => {
  const rps = Math.max(1, Math.min(50, parseInt((req.body || {}).rps || 5, 10)));

  try {
    const existing = await inspectContainer(LOADGEN_CONTAINER_NAME);
    if (existing) await removeContainer(LOADGEN_CONTAINER_NAME);

    await createContainer(LOADGEN_CONTAINER_NAME, {
      Image: LOADGEN_IMAGE,
      Env: [
        `LOADGEN_RPS=${rps}`,
        'SCORE_API_URL=http://score-api:8080',
      ],
      HostConfig: { AutoRemove: false },
      NetworkingConfig: {
        EndpointsConfig: { [GATEWAY_NETWORK]: {} },
      },
    });
    await startContainer(LOADGEN_CONTAINER_NAME);
    res.json({ ok: true, message: `Load generator started at ${rps} RPS.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/deploy/loadgen/stop', async (req, res) => {
  try {
    const existing = await inspectContainer(LOADGEN_CONTAINER_NAME);
    if (!existing) return res.status(404).json({ error: 'Load generator is not running.' });
    await removeContainer(LOADGEN_CONTAINER_NAME);
    res.json({ ok: true, message: 'Load generator stopped.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── IDE Watch Mode routes ─────────────────────────────────────────────────────

router.get('/api/deploy/agent/watch', (req, res) => {
  res.json({ enabled: watchState.agent.enabled });
});

router.post('/api/deploy/agent/watch', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean')
    return res.status(400).json({ error: 'enabled (boolean) required' });
  watchState.agent.enabled = enabled;
  if (enabled) {
    startWatcher(watchState.agent);
    res.json({ ok: true, message: 'Watch mode enabled. Save collector-config.yaml in your IDE to auto-restart.' });
  } else {
    stopWatcher(watchState.agent);
    res.json({ ok: true, message: 'Watch mode disabled.' });
  }
});

router.get('/api/deploy/gateway/watch', (req, res) => {
  res.json({ enabled: watchState.gateway.enabled });
});

router.post('/api/deploy/gateway/watch', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean')
    return res.status(400).json({ error: 'enabled (boolean) required' });
  if (enabled && !fs.existsSync(GATEWAY_CONFIG_PATH))
    return res.status(400).json({ error: 'Deploy the gateway first before enabling watch mode.' });
  watchState.gateway.enabled = enabled;
  if (enabled) {
    startWatcher(watchState.gateway);
    res.json({ ok: true, message: 'Watch mode enabled. Save gateway-config.yaml in your IDE to auto-restart.' });
  } else {
    stopWatcher(watchState.gateway);
    res.json({ ok: true, message: 'Watch mode disabled.' });
  }
});

module.exports = router;
