const express = require('express');
const { pool } = require('../db');
const { pageOptions, httpError, searchText, sqlLike } = require('../utils/validation');
const { displayTime, isoTime } = require('../utils/time');
const sensors = require('../utils/sensors');

const router = express.Router();
const sensorNames = sensors.map(sensor => sensor.name);
const outputKey = Object.fromEntries(sensors.map(sensor => [sensor.name, sensor.key]));

router.get('/latest', getLatest);
router.get('/chart', getChart);
router.get('/history', getHistory);

async function getLatest(req, res) {
  const [rows] = await pool.query(
    `SELECT s.name,sd.value,sd.created_at
     FROM sensors s
     LEFT JOIN sensor_data sd ON sd.id = (
       SELECT x.id FROM sensor_data x
       WHERE x.sensor_id = s.id
       ORDER BY x.created_at DESC,x.id DESC
       LIMIT 1
     )
     WHERE s.name IN (?)
     ORDER BY s.id`,
    [sensorNames]
  );
  const latest = {
    ...Object.fromEntries(sensors.map(sensor => [sensor.key, null])),
    time: null,
    recordedAt: null,
    sensorRecordedAt: {}
  };
  let newest = null;
  for (const row of rows) {
    const key = outputKey[row.name];
    if (key) {
      latest[key] = row.value == null ? null : Number(row.value);
      // Mỗi cảm biến giữ thời điểm riêng để phát hiện STALE khi thiếu một trường.
      latest.sensorRecordedAt[key] = isoTime(row.created_at);
    }
    if (row.created_at && (!newest || row.created_at > newest)) newest = row.created_at;
  }
  latest.time = displayTime(newest);
  latest.recordedAt = isoTime(newest);
  res.json(latest);
}

async function getChart(req, res) {
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw httpError(400, 'limit phải từ 1 đến 200');
  }
  const result = {};
  for (const { key, name } of sensors) {
    const [rows] = await pool.execute(
      `SELECT sd.value,sd.created_at
       FROM sensor_data sd
       JOIN sensors s ON s.id=sd.sensor_id
       WHERE s.name=?
       ORDER BY sd.created_at DESC,sd.id DESC
       LIMIT ${limit}`,
      [name]
    );
    result[key] = rows.reverse().map(row => ({
      time: displayTime(row.created_at),
      recordedAt: isoTime(row.created_at),
      value: Number(row.value)
    }));
  }
  res.json(result);
}

async function getHistory(req, res) {
  const { page, size, offset } = pageOptions(req.query);
  const type = searchText(req.query.type || 'All Sensors');
  const value = searchText(req.query.value);
  if (!['All Sensors', ...sensorNames, 'Time'].includes(type)) {
    throw httpError(400, 'type không hợp lệ');
  }

  // Chỉ hiển thị sáu cảm biến đang dùng; lịch sử khác vẫn nằm trong DB.
  const conditions = [`s.name IN (${sensorNames.map(() => '?').join(',')})`];
  const params = [...sensorNames];
  if (type === 'Time') {
    if (value) {
      conditions.push("DATE_FORMAT(DATE_ADD(sd.created_at, INTERVAL 7 HOUR),'%Y-%m-%d %H:%i:%s') LIKE ?");
      params.push(sqlLike(value));
    }
  } else if (type === 'All Sensors') {
    if (value) {
      const search = sqlLike(value);
      conditions.push(`(LOWER(s.name) LIKE LOWER(?)
        OR CAST(sd.value AS CHAR) LIKE ?
        OR DATE_FORMAT(DATE_ADD(sd.created_at, INTERVAL 7 HOUR),'%Y-%m-%d %H:%i:%s') LIKE ?)`);
      params.push(search, search, search);
    }
  } else {
    conditions.push('s.name=?');
    params.push(type);
    if (value) {
      conditions.push('CAST(sd.value AS CHAR) LIKE ?');
      params.push(sqlLike(value));
    }
  }

  const where = ' WHERE ' + conditions.join(' AND ');
  const from = `
    FROM sensor_data sd
    JOIN sensors s ON s.id=sd.sensor_id`;
  const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total' + from + where, params);
  const [rows] = await pool.execute(
    `SELECT sd.id,s.name AS sensorName,sd.sensor_id AS sensorId,sd.value,sd.created_at
     ${from}${where}
     ORDER BY sd.created_at DESC,sd.id DESC
     LIMIT ${size} OFFSET ${offset}`,
    params
  );
  res.json({
    content: rows.map(row => ({
      id: Number(row.id),
      sensorId: row.sensorId,
      sensorName: row.sensorName,
      type: row.sensorName,
      value: Number(row.value),
      time: displayTime(row.created_at),
      createdAt: isoTime(row.created_at)
    })),
    page,
    size,
    totalElements: Number(total),
    totalPages: Math.ceil(Number(total) / size)
  });
}

module.exports = router;
