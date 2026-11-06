const { pool } = require('../db');
const { httpError } = require('../utils/validation');
const { commandTimeoutMs } = require('../config');

class ControlService {
  constructor(io) {
    this.io = io;
    this.mqtt = null;
    this.busy = new Set(); // Khóa cả thời gian đang chờ tạo lịch sử trong SQL.
    this.pending = new Map(); // Lệnh đã tạo, kèm timer và cờ chống chốt hai lần.
    this.cooldownUntil = new Map(); // Thời điểm được gửi lệnh tiếp theo sau FAILED.
  }

  setMqtt(service) {
    this.mqtt = service;
  }

  async initialize() {
    // Lệnh chưa xác nhận trước khi backend khởi động lại được đánh dấu FAILED.
    await pool.query(
      `UPDATE action_history
       SET status='FAILED',
           error_reason='Backend restarted before receiving confirmation',
           finished_at=UTC_TIMESTAMP(3)
       WHERE status='PENDING'`
    );

    // Giữ devices.status cũ; ESP8266 gửi lại trạng thái khi kết nối MQTT.
  }

  async create(userId, id, action) {
    if (!['ON', 'OFF'].includes(action)) {
      throw httpError(400, 'action phải là ON hoặc OFF');
    }

    if (!this.mqtt || !this.mqtt.connected()) {
      throw httpError(503, 'MQTT Broker chưa kết nối');
    }

    if (this.busy.has(id)) {
      throw httpError(409, 'Thiết bị đang có lệnh chưa hoàn tất');
    }

    if (Date.now() < (this.cooldownUntil.get(id) || 0)) {
      throw httpError(409, 'Thiết bị đang trong thời gian chờ sau timeout');
    }

    // Khóa trước khi chờ SQL để hai request không cùng tạo lệnh cho một thiết bị.
    this.busy.add(id);

    let rowId;

    try {
      const [deviceRows] = await pool.execute(
        'SELECT id FROM devices WHERE id=?',
        [id]
      );

      if (!deviceRows.length) {
        throw httpError(404, 'Thiết bị không tồn tại');
      }

      const [result] = await pool.execute(
        `INSERT INTO action_history (user_id,device_id,action,status,created_at)
         VALUES (?,?,?,'PENDING',UTC_TIMESTAMP(3))`,
        [userId, id, action]
      );

      rowId = Number(result.insertId);

      const entry = {
        id: rowId,
        deviceId: id,
        action,
        settled: false,
        timer: null
      };

      this.pending.set(id, entry);

      entry.timer = setTimeout(() => {
        void this.finish(
          entry,
          'FAILED',
          'ESP8266 timeout: no matching status within 5 seconds'
        );
      }, commandTimeoutMs);

      this.io.emit('action:update', {
        id: rowId,
        deviceId: id,
        action,
        status: 'PENDING'
      });

      try {
        await this.mqtt.publishCommand(id, action);
      } catch {
        await this.finish(entry, 'FAILED', 'MQTT publish failed');

        throw httpError(503, 'Không gửi được lệnh tới MQTT Broker');
      }

      return {
        id: rowId,
        deviceId: id,
        action,
        status: 'PENDING',
        timeoutSeconds: commandTimeoutMs / 1000
      };
    } catch (err) {
      if (!rowId || !this.pending.has(id)) {
        this.busy.delete(id);
      }

      throw err;
    }
  }

  async onStatus(id, status) {
    const entry = this.pending.get(id);

    if (!entry || entry.settled) {
      return;
    }

    if (entry.action === status) {
      await this.finish(entry, 'SUCCESS', null);
    } else {
      await this.finish(
        entry,
        'FAILED',
        `Firmware reported ${status} instead of ${entry.action}`
      );
    }
  }

  async finish(entry, status, reason) {
    if (entry.settled) {
      return;
    }

    // ACK và timeout có thể đến gần nhau; mỗi lệnh chỉ được chốt một lần.
    entry.settled = true;
    clearTimeout(entry.timer);

    try {
      await pool.execute(
        `UPDATE action_history
         SET status=?,error_reason=?,finished_at=UTC_TIMESTAMP(3)
         WHERE id=? AND status='PENDING'`,
        [status, reason, entry.id]
      );

      this.io.emit('action:update', {
        id: entry.id,
        deviceId: entry.deviceId,
        action: entry.action,
        status,
        errorReason: reason
      });
    } catch (err) {
      console.error('Không cập nhật được action_history:', err.message);
    } finally {
      if (this.pending.get(entry.deviceId) === entry) {
        this.pending.delete(entry.deviceId);
      }

      if (status === 'FAILED') {
        this.cooldownUntil.set(entry.deviceId, Date.now() + 5000);
      }

      this.busy.delete(entry.deviceId);
    }
  }
}

module.exports = ControlService;
