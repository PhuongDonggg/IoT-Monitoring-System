const express = require('express');
const { pool } = require('../db');
const { httpError, deviceId, pageOptions, searchText, sqlLike } = require('../utils/validation');
const { displayTime, isoTime } = require('../utils/time');

function createDeviceRoutes(control) {
  const router = express.Router();
  router.get('/', listDevices);
  router.get('/action-history', getActionHistory);
  router.get('/:id/status', getDeviceStatus);
  router.post('/:id/control', async (req, res) => {
    const id = deviceId(req.params.id);
    const result = await control.create(req.user.id, id, req.body?.action);
    res.status(202).json(result);
  });
  return router;
}

async function listDevices(req, res) {
  const [rows] = await pool.query('SELECT id,name,status,updated_at FROM devices ORDER BY id');
  res.json(rows.map(device => ({
    id: device.id,
    name: device.name,
    status: device.status,
    updatedAt: isoTime(device.updated_at)
  })));
}

async function getDeviceStatus(req, res) {
  const id = deviceId(req.params.id);
  const [rows] = await pool.execute('SELECT status,updated_at FROM devices WHERE id=?', [id]);
  if (!rows.length) throw httpError(404, 'Thiết bị không tồn tại');
  res.json({ deviceId: id, status: rows[0].status, updatedAt: isoTime(rows[0].updated_at) });
}

async function getActionHistory(req, res) {
  const { page, size, offset } = pageOptions(req.query);
  const device = searchText(req.query.deviceId);
  const action = searchText(req.query.action);
  const status = searchText(req.query.status);
  const time = searchText(req.query.time);
  const conditions = [];
  const params = [];

  if (device) {
    conditions.push('ah.device_id=?');
    params.push(deviceId(device));
  }
  if (action) {
    if (!['ON', 'OFF'].includes(action)) throw httpError(400, 'action không hợp lệ');
    conditions.push('ah.action=?');
    params.push(action);
  }
  if (status) {
    if (!['PENDING', 'SUCCESS', 'FAILED'].includes(status)) throw httpError(400, 'status không hợp lệ');
    conditions.push('ah.status=?');
    params.push(status);
  }
  if (time) {
    conditions.push("DATE_FORMAT(DATE_ADD(ah.created_at, INTERVAL 7 HOUR),'%Y-%m-%d %H:%i:%s') LIKE ?");
    params.push(sqlLike(time));
  }

  // COUNT và truy vấn trang dùng cùng bộ lọc, mọi giá trị tìm kiếm đều có tham số.
  const from = `
    FROM action_history ah
    JOIN devices d ON d.id=ah.device_id
    JOIN users u ON u.id=ah.user_id`;
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total' + from + where, params);
  const [rows] = await pool.execute(
    `SELECT ah.id,ah.user_id AS userId,ah.device_id,
            ah.action,ah.status,ah.error_reason,ah.created_at,ah.finished_at,
            d.name AS deviceName,u.username,u.full_name
     ${from}${where}
     ORDER BY ah.created_at DESC,ah.id DESC
     LIMIT ${size} OFFSET ${offset}`,
    params
  );
  res.json({
    content: rows.map(row => ({
      id: Number(row.id),
      deviceId: row.device_id,
      deviceName: row.deviceName,
      action: row.action,
      status: row.status,
      errorReason: row.error_reason,
      time: displayTime(row.created_at),
      createdAt: isoTime(row.created_at),
      finishedAt: isoTime(row.finished_at),
      userId: row.userId,
      user: row.full_name || row.username
    })),
    page,
    size,
    totalElements: Number(total),
    totalPages: Math.ceil(Number(total) / size)
  });
}

module.exports = createDeviceRoutes;
