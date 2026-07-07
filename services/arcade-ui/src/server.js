const path = require('path');
const express = require('express');

const healthRoutes = require('./routes/health');
const gameRoutes = require('./routes/games');
const collectorRoutes    = require('./routes/collector');
const deployRoutes       = require('./routes/deploy');
const telemetrygenRoutes = require('./routes/telemetrygen');

const app = express();
app.use(express.json({ limit: '64kb' }));

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
app.listen(port, () => {
  console.log(`arcade-ui listening on :${port}`);
});
