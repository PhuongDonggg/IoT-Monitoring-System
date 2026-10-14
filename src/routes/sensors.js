const express = require('express');
const {pool} = require('../db');
const {pageOptions, httpError, searchText, sqlLike} = require('../utils/validation');
const {displayTime, isoTime} = require('../utils/time');
const r = express.Router();
const sensorNames = ['Temperature', 'Humidity', 'Light'];
const outputKey = {Temperature:'temperature', Humidity:'humidity', Light:'light'};
r.get('/latest', async (req,res) => {
  const [rows] = await pool.query(`
    SELECT s.name, sd.value, sd.created_at FROM sensors s
    LEFT JOIN sensor_data sd ON sd.id = (
      SELECT x.id FROM sensor_data x WHERE x.sensor_id = s.id
      ORDER BY x.created_at DESC,x.id DESC LIMIT 1
    ) WHERE s.id IN (1,2,3) ORDER BY s.id`);
  const out = {temperature:null, humidity:null, light:null, time:null, recordedAt:null};
  let newest = null;
  for (const row of rows) {
    if (outputKey[row.name]) out[outputKey[row.name]] = row.value == null ? null : Number(row.value);
    if (row.created_at && (!newest || row.created_at > newest)) newest = row.created_at;
  }
  out.time = displayTime(newest);
  out.recordedAt = isoTime(newest);
  res.json(out);
});
r.get('/chart', async (req,res) => {
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw httpError(400,'limit phải từ 1 đến 200');
  const result = {};
  for (const [idx, key] of ['temperature','humidity','light'].entries()) {
    const [rows] = await pool.execute(`SELECT value,created_at FROM sensor_data WHERE sensor_id=? ORDER BY created_at DESC,id DESC LIMIT ${limit}`, [idx+1]);
    result[key] = rows.reverse().map(x => ({time:displayTime(x.created_at), recordedAt:isoTime(x.created_at), value:Number(x.value)}));
  }
  res.json(result);
});
r.get('/history', async (req,res) => {
  const {page,size,offset} = pageOptions(req.query);
  const type = searchText(req.query.type || 'All Sensors');
  const value = searchText(req.query.value);
  if (!['All Sensors',...sensorNames,'Time'].includes(type)) throw httpError(400,'type không hợp lệ');
  const where = [];
  const params = [];
  if (type === 'Time') {
    if (value) {where.push("DATE_FORMAT(DATE_ADD(sd.created_at, INTERVAL 7 HOUR),'%Y-%m-%d %H:%i:%s') LIKE ?");params.push(sqlLike(value));}
  } else {
    if (type === 'All Sensors') {
      if (value) {
        const search=sqlLike(value);
        where.push("(LOWER(s.name) LIKE LOWER(?) OR CAST(sd.value AS CHAR) LIKE ? OR DATE_FORMAT(DATE_ADD(sd.created_at, INTERVAL 7 HOUR),'%Y-%m-%d %H:%i:%s') LIKE ?)");
        params.push(search,search,search);
      }
    } else {
      where.push('s.name=?');params.push(type);
      if (value) {where.push('CAST(sd.value AS CHAR) LIKE ?');params.push(sqlLike(value));}
    }
  }
  const clause = where.length ? ' WHERE '+where.join(' AND ') : '';
  const base = ' FROM sensor_data sd JOIN sensors s ON s.id=sd.sensor_id';
  const [[{total}]] = await pool.execute('SELECT COUNT(*) AS total'+base+clause,params);
  const [rows] = await pool.execute('SELECT sd.id,s.name AS sensorName,sd.sensor_id AS sensorId,sd.value,sd.created_at'+base+clause+` ORDER BY sd.created_at DESC,sd.id DESC LIMIT ${size} OFFSET ${offset}`, params);
  res.json({content:rows.map(x=>({id:Number(x.id),sensorId:x.sensorId, sensorName:x.sensorName, type:x.sensorName, value:Number(x.value), time:displayTime(x.created_at), createdAt:isoTime(x.created_at)})),page,size,totalElements:Number(total),totalPages:Math.ceil(Number(total)/size)});
});
module.exports = r;
