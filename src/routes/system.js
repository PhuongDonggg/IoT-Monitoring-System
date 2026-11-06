const express = require('express');
const { pool } = require('../db');

function createSystemRoutes(mqtt) {
  const router = express.Router();
  router.get('/status', async (req, res) => res.json(mqtt.status()));
  router.get('/health', createHealthHandler(mqtt));
  return router;
}

function createHealthHandler(mqtt) {
  return async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: mqtt.connected() ? 'ok' : 'degraded', database: 'connected', ...mqtt.status() });
    } catch {
      res.status(503).json({ status: 'down', database: 'disconnected', ...mqtt.status() });
    }
  };
}

module.exports = { createSystemRoutes, createHealthHandler };
