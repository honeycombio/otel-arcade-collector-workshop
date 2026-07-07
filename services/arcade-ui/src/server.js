const path = require('path');
const http = require('http');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const healthRoutes = require('./routes/health');
const gameRoutes = require('./routes/games');
const collectorRoutes    = require('./routes/collector');
const deployRoutes       = require('./routes/deploy');
const telemetrygenRoutes = require('./routes/telemetrygen');

const app = express();
app.use(express.json({ limit: '64kb' }));

// Reverse-proxy /viz/* → visualizer:8090 so the iframe stays on the same
// origin as arcade-ui (no separate Instruqt service tab needed for port 8090).
const VIZ_TARGET = process.env.VISUALIZER_ORIGIN || 'http://visualizer:8090';

app.use('/viz', createProxyMiddleware({
  target: VIZ_TARGET,
  changeOrigin: true,
  pathRewrite: { '^/viz': '' },
  proxyTimeout: 10000,
  timeout: 10000,
  on: {
    error: (err, req, res) => {
      console.error('Visualizer proxy error:', err.message);
      if (!res.headersSent) {
        res.writeHead(502).end('Visualizer unavailable');
      }
    },
  },
}));

app.use(healthRoutes);
app.use(gameRoutes);
app.use(collectorRoutes);
app.use(deployRoutes);
app.use(telemetrygenRoutes);

// Serve js-yaml browser build for client-side YAML linting.
app.get('/js/js-yaml.min.js', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'node_modules', 'js-yaml', 'dist', 'js-yaml.min.js'));
});

// Static lobby + game pages.
app.use(express.static(path.join(__dirname, '..', 'public')));

const port = parseInt(process.env.PORT || '3000', 10);
const server = http.createServer(app);

// Proxy WebSocket upgrades for /ws → visualizer:8090/ws.
// The Visualizer JS connects to wss://location.host/ws; inside the iframe
// that resolves to the arcade-ui host, so we forward it here.
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    const wsProxy = createProxyMiddleware({
      target: VIZ_TARGET,
      changeOrigin: true,
      ws: true,
    });
    wsProxy.upgrade(req, socket, head);
    socket.on('error', (err) => {
      console.error('WS proxy socket error:', err.message);
      socket.destroy();
    });
  }
});

server.listen(port, () => {
  console.log(`arcade-ui listening on :${port}`);
});
