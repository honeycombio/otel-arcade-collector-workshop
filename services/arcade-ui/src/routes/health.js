const express = require('express');

const router = express.Router();

router.get('/health', (_req, res) => res.json({ status: 'ok' }));
router.get('/ready', (_req, res) => res.json({ status: 'ready' }));

module.exports = router;
