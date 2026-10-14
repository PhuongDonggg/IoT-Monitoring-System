function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function pageOptions(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const size = query.size === undefined ? 10 : Number(query.size);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) throw httpError(400, 'page phải là số nguyên dương <= 1000000');
  if (![1,5,10].includes(size)) throw httpError(400, 'size chỉ chấp nhận 1, 5 hoặc 10');
  return {page, size, offset: (page - 1) * size};
}
function searchText(value, max = 100) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw httpError(400, 'Giá trị bộ lọc không hợp lệ');
  const text = value.trim();
  if (text.length > max) throw httpError(400, `Bộ lọc quá dài (tối đa ${max} ký tự)`);
  return text;
}
function sqlLike(value) { return '%' + value.replace(/[\\%_]/g, '\\$&') + '%'; }
function deviceId(value) {
  const id = Number(value);
  if (!/^[1-3]$/.test(String(value)) || !Number.isInteger(id)) throw httpError(404, 'Thiết bị không tồn tại');
  return id;
}
function parseSensorPayload(payload) {
  let d;
  try { d = JSON.parse(payload); } catch { return null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const {temperature, humidity, light} = d;
  if (![temperature, humidity, light].every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  if (temperature < -40 || temperature > 125 || humidity < 0 || humidity > 100 || !Number.isInteger(light) || light < 0 || light > 1023) return null;
  return {temperature, humidity, light};
}
function parseStatusPayload(payload) {
  let d;
  try { d = JSON.parse(payload); } catch { return null; }
  if (!d || !Number.isInteger(d.device) || d.device < 1 || d.device > 3 || !['ON','OFF'].includes(d.status)) return null;
  return {deviceId: d.device, status: d.status};
}
module.exports = {httpError, pageOptions, searchText, sqlLike, deviceId, parseSensorPayload, parseStatusPayload};
