const path = require('path');
const http = require('http');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const healthRoutes = require('./routes/health');
const gameRoutes = require('./routes/games');
const collectorRoutes    = require('./routes/collector');
const deployRoutes       = require('./routes/deploy');
const telemetrygenRoutes = require('./routes/telemetrygen');

const VISUALIZER_ORIGIN = process.env.VISUALIZER_ORIGIN || 'http://visualizer:8090';

const app = express();
app.use(express.json({ limit: '64kb' }));

// Proxy /viz/* → visualizer HTTP (iframe host).
app.use('/viz', createProxyMiddleware({
  target: VISUALIZER_ORIGIN,
  changeOrigin: true,
  pathRewrite: { '^/viz': '' },
}));

// Proxy /ws → visualizer WebSocket.
// The visualizer JS connects to wss://location.host/ws; inside the arcade-ui
// iframe that resolves to this server, so we forward it to the visualizer.
const wsProxy = createProxyMiddleware({
  target: VISUALIZER_ORIGIN,
  changeOrigin: true,
  ws: true,
});
app.use('/ws', wsProxy);

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
server.on('upgrade', wsProxy.upgrade);
server.listen(port, () => {
  console.log(`arcade-ui listening on :${port}`);
});
