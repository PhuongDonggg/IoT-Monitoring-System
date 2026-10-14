const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const fe=path.join(root,'frontend');
function read(f){return fs.readFileSync(path.join(root,f),'utf8');}
test('All Sensors searches sensor name, value, and displayed time',()=>{
  const route=read('src/routes/sensors.js');
  assert.match(route,/type === 'All Sensors'/);
  assert.match(route,/\(LOWER\(s\.name\) LIKE LOWER\(\?\) OR CAST\(sd\.value AS CHAR\) LIKE \? OR DATE_FORMAT\(DATE_ADD\(sd\.created_at, INTERVAL 7 HOUR\),'%Y-%m-%d %H:%i:%s'\) LIKE \?\)/);
  assert.match(route,/params\.push\(search,search,search\)/);
});
test('Năm trang frontend và JS điều khiển được tích hợp',()=>{
  for (const filename of ['index.html','dashboard.html','sensor-data.html','device-history.html','profile.html']) {
    const doc=read('frontend/'+filename);
    assert.ok(doc.includes('js/api.js'),filename);
    assert.ok(fs.existsSync(path.join(fe,filename)));
  }
});
test('Không còn mảng dữ liệu demo và đăng nhập giả',()=>{
  for (const file of ['frontend/js/dashboard.js','frontend/js/sensor-data.js','frontend/js/device-history.js','frontend/js/login.js']) {
    const code=read(file);
    assert.doesNotMatch(code,/const (sensorData|historyData)\s*=\s*\[/);
    assert.doesNotMatch(code,/iotLoggedIn', '1'/);
  }
});
test('Topic firmware và backend tương thích',()=>{
  const ino=read('firmware/code/code.ino');
  const mqtt=read('src/services/mqtt.js');
  for(const topic of ['iot/sensors/data','iot/devices/command','iot/devices/status']){
    assert.ok(ino.includes(topic)); assert.ok(mqtt.includes(topic));
  }
  assert.ok(ino.includes('publishAllDeviceStates'));
});
test('Postman collection JSON chứa endpoint backend',()=>{
  const coll=JSON.parse(read('postman/IoT_Monitoring_System.postman_collection.json'));
  const endpoints=coll.item.flatMap(f=>f.item.map(i=>i.request.url));
  for(const needle of ['/api/auth/login','/api/sensor-data/latest','/api/devices','/api/health']) {
    assert.ok(endpoints.some(url=>url.includes(needle)),needle);
  }
});
test('Giữ nguyên các tệp cấu hình local bắt buộc',()=>{
  assert.ok(fs.existsSync(path.join(root,'.env')));
  assert.ok(fs.existsSync(path.join(root,'firmware','code','secrets.h')));
});
