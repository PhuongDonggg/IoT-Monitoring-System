const test=require('node:test');
const assert=require('node:assert/strict');
const {pageOptions,parseSensorPayload,parseStatusPayload}=require('../src/utils/validation');
const {displayTime}=require('../src/utils/time');
test('Pagination giống tùy chọn Number of lines của FE',()=>{
  assert.deepEqual(pageOptions({page:'2',size:'5'}),{page:2,size:5,offset:5});
  assert.throws(()=>pageOptions({page:'0'}));
  assert.throws(()=>pageOptions({size:'99'}));
});
test('Sensor MQTT validation',()=>{
  assert.deepEqual(parseSensorPayload('{"temperature":28.5,"humidity":71,"light":645}'),{temperature:28.5,humidity:71,light:645});
  assert.equal(parseSensorPayload('{"temperature":"28.5","humidity":71,"light":645}'),null);
  assert.equal(parseSensorPayload('{"temperature":28.5,"humidity":71,"light":1024}'),null);
});
test('Sensor MQTT giữ nguyên giá trị ADC ánh sáng',()=>{
  assert.equal(parseSensorPayload('{"temperature":28.5,"humidity":71,"light":645}').light,645);
  assert.equal(parseSensorPayload('{"temperature":28.5,"humidity":71,"light":0}').light,0);
  assert.equal(parseSensorPayload('{"temperature":28.5,"humidity":71,"light":1023}').light,1023);
});
test('Status MQTT chỉ nhận ba thiết bị ON/OFF',()=>{
  assert.deepEqual(parseStatusPayload('{"device":1,"status":"ON"}'),{deviceId:1,status:'ON'});
  assert.equal(parseStatusPayload('{"device":4,"status":"ON"}'),null);
  assert.equal(parseStatusPayload('{"device":1,"status":"INVALID"}'),null);
});
test('Database UTC phải hiển thị giờ Việt Nam',()=>{
  assert.equal(displayTime(new Date('2026-10-11T13:00:00Z')),'2026-10-11 20:00:00');
});
