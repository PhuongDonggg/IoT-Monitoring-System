// Integration check: real SQL + HTTP routes, all test readings rolled back.
// Never connects to MQTT or sends device commands.
const assert=require('node:assert/strict');
const path=require('node:path');
const express=require('express');
const {pool}=require('../src/db');
const {requireAuth,signToken}=require('../src/auth');
const MqttService=require('../src/services/mqtt');
const sensorRoutes=require('../src/routes/sensors');
const sensors=require('../src/utils/sensors');

(async()=>{
  let conn,server;
  const original={getConnection:pool.getConnection,query:pool.query,execute:pool.execute};
  try {
    conn=await original.getConnection.call(pool);
    const [registry]=await conn.query('SELECT id,name,unit FROM sensors ORDER BY id');
    for(const s of sensors)assert.equal(registry.filter(r=>r.name===s.name).length,1,`Missing/duplicate registry entry: ${s.name}`);
    // MqttService requests a transaction and commit. Keep its transaction open
    // so real route queries can inspect these rows before rolling them back.
    let commitRequested=false;
    pool.getConnection=async()=>({
      beginTransaction:()=>conn.beginTransaction(),query:(...args)=>conn.query(...args),
      commit:async()=>{commitRequested=true;},rollback:()=>conn.rollback(),release(){}
    });
    pool.query=(...args)=>conn.query(...args);
    pool.execute=(...args)=>conn.execute(...args);
    const events=[];
    const mqtt=new MqttService({emit:(...args)=>events.push(args)},{onStatus:async()=>{}});
    const payload={temperature:28,humidity:65,light:450,sensor4:11,sensor5:101,sensor6:1001};
    await mqtt.handleMessage('iot/sensors/data',JSON.stringify(payload));
    assert.ok(commitRequested);
    const event=events.find(e=>e[0]==='sensor:update')[1];
    assert.equal(event.sensor6,1001);
    const [written]=await conn.execute('SELECT sd.id,s.name,sd.value FROM sensor_data sd JOIN sensors s ON s.id=sd.sensor_id WHERE sd.created_at=?',[new Date(event.recordedAt)]);
    for(const sensor of sensors)assert.ok(written.some(r=>r.name===sensor.name&&Number(r.value)===payload[sensor.key]));
    console.log('OK: actual MQTT handler writes six values with real registry IDs in a transaction; DOUBLE stores 1001.');

    const app=express();
    app.use('/api/sensor-data',requireAuth,sensorRoutes);
    app.use(express.static(path.join(__dirname,'..','frontend')));
    app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
    server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    const url='http://127.0.0.1:'+server.address().port+'/api/sensor-data';
    const headers={Authorization:'Bearer '+signToken({id:1,username:'integration-check'})};
    assert.equal((await fetch(url+'/latest')).status,401);
    const get=async path=>{const response=await fetch(url+path,{headers});assert.equal(response.status,200);return response.json();};
    const latest=await get('/latest');
    for(const s of sensors){assert.equal(latest[s.key],payload[s.key]);assert.equal(latest.sensorRecordedAt[s.key],event.recordedAt);}
    const chart=await get('/chart?limit=1');
    for(const s of sensors)assert.equal(chart[s.key][0].value,payload[s.key]);
    for(const name of ['Sensor 4','Sensor 5','Sensor 6']) {
      const history=await get('/history?'+new URLSearchParams({type:name,page:'1',size:'5'}));
      assert.ok(history.content.length);
      assert.ok(history.content.every(r=>r.sensorName===name));
    }
    // All Sensors, Time and free-text search must all exclude retired registry entries.
    const [[{total:activeTotal}]]=await conn.query('SELECT COUNT(*) AS total FROM sensor_data sd JOIN sensors s ON s.id=sd.sensor_id WHERE s.name IN (?)',[sensors.map(s=>s.name)]);
    for(const type of ['All Sensors','Time']) {
      const history=await get('/history?'+new URLSearchParams({type,page:'1',size:'10'}));
      assert.equal(history.totalElements,Number(activeTotal));
      assert.ok(history.content.every(row=>sensors.some(s=>s.name===row.sensorName)));
    }
    assert.equal((await get('/history?type=All%20Sensors&value=CO2')).totalElements,0);
    assert.equal((await fetch(url+'/history?type=CO2',{headers})).status,400);
    assert.equal(Object.hasOwn(latest,'co2'),false);
    assert.equal(Object.hasOwn(chart,'co2'),false);
    assert.equal((await fetch(url+'/chart?limit=201',{headers})).status,400);
    assert.equal((await fetch(url+'/history?type=Unknown',{headers})).status,400);
    for(const file of ['dashboard.html','sensor-data.html','device-history.html','profile.html','random-sensors.html','js/random-sensors.js','css/random-sensors.css']) {
      const response=await fetch('http://127.0.0.1:'+server.address().port+'/'+file);
      assert.equal(response.status,200,file);
      if(file.endsWith('.html'))assert.ok((await response.text()).includes('data-page="random"'),file+' navigation');
    }
    console.log('OK: real MySQL latest/chart/history SQL, new filters, pagination, authentication and invalid-query responses.');
    console.log('OK: five authenticated-page shells link Random Sensors; its HTML/JS/CSS are served successfully.');
    await conn.rollback();
    const [after]=await conn.query('SELECT COUNT(*) AS total FROM sensor_data WHERE id IN (?)',[written.map(row=>row.id)]);
    assert.equal(Number(after[0].total),0);
    const [registryAfter]=await conn.query('SELECT id,name,unit FROM sensors ORDER BY id');
    assert.deepEqual(registryAfter,registry);
    console.log('OK: rollback complete; test readings were not retained and sensor registry is unchanged.');
  } catch(err) {
    console.error('Integration check failed:',err.message);
    process.exitCode=1;
  } finally {
    Object.assign(pool,original);
    if(conn){await conn.rollback();conn.release();}
    if(server)await new Promise(resolve=>server.close(resolve));
    await pool.end();
  }
})();
