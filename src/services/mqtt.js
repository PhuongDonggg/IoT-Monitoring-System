const mqtt=require('mqtt');
const crypto=require('node:crypto');
const {pool}=require('../db');
const {mqtt:settings}=require('../config');
const {parseSensorPayload,parseStatusPayload}=require('../utils/validation');
const {displayTime,isoTime}=require('../utils/time');
const sensors=require('../utils/sensors');
class MqttService {
  constructor(io,control) {
    this.io=io;this.control=control;this.client=null;this.isConnected=false;this.lastSensorAt=0;
  }
  connected() { return this.isConnected && Boolean(this.client?.connected); }
  deviceTelemetryOnline() { return this.lastSensorAt>0 && (Date.now()-this.lastSensorAt)<10000; }
  status() {return {mqttConnected:this.connected(),sensorOnline:this.deviceTelemetryOnline(),lastSensorReceivedAt:this.lastSensorAt ? new Date(this.lastSensorAt).toISOString():null};}
  start() {
    const url=`${settings.protocol}://${settings.host}:${settings.port}`;
    this.client=mqtt.connect(url, {
      username:settings.username,password:settings.password,
      clientId:'iot_backend_'+crypto.randomBytes(5).toString('hex'),
      reconnectPeriod:3000,connectTimeout:10000,clean:true,
      // Firmware dùng QoS0: không gửi lại lệnh cũ cho thiết bị.
      resubscribe:true
    });
    this.client.on('connect',()=>{
      this.isConnected=true;
      this.client.subscribe(['iot/sensors/data','iot/devices/status'],{qos:0},err=>{
        if(err) console.error('Không subscribe được topic MQTT:',err.message);
        else console.log('MQTT connected; subscribed sensor and device status');
      });
      this.io.emit('system:status',this.status());
    });
    this.client.on('close',()=>{
      this.isConnected=false;
      this.lastSensorAt=0;
      this.io.emit('system:status',this.status());
    });
    this.client.on('error',e=>console.error('MQTT connection error:',e.message));
    this.client.on('message',(topic,payload)=>{
      void this.handleMessage(topic,payload.toString('utf8')).catch(e=>console.error('MQTT message handling error:',e.message));
    });
  }
  async handleMessage(topic,data) {
    if(topic==='iot/sensors/data') {
      const d=parseSensorPayload(data);
      if(!d) {console.warn('Bỏ qua MQTT sensor payload không hợp lệ');return;}
      const conn=await pool.getConnection();
      let createdAt;
      const saved={};
      try {
        await conn.beginTransaction();
        const present=sensors.filter(s=>Object.hasOwn(d,s.key));
        const [registry]=await conn.query('SELECT id,name FROM sensors WHERE name IN (?)',[present.map(s=>s.name)]);
        const ids=new Map(registry.map(s=>[s.name,s.id]));
        const values=[];
        const placeholders=[];
        const [t]=await conn.query('SELECT UTC_TIMESTAMP(3) AS received');
        createdAt=t[0].received;
        for(const sensor of present) {
          if(!ids.has(sensor.name)) {
            console.warn(`Chưa đăng ký ${sensor.name}; chạy npm run migrate:random-sensors`);
            continue;
          }
          placeholders.push('(?,?,?)');
          values.push(ids.get(sensor.name),d[sensor.key],createdAt);
          saved[sensor.key]=d[sensor.key];
        }
        if(placeholders.length) await conn.query('INSERT INTO sensor_data(sensor_id,value,created_at) VALUES '+placeholders.join(','),values);
        await conn.commit();
      } catch(e) {await conn.rollback();throw e;}
      finally {conn.release();}
      if(!Object.keys(saved).length) return;
      this.lastSensorAt=Date.now();
      this.io.emit('sensor:update',{...saved,time:displayTime(createdAt),recordedAt:isoTime(createdAt)});
      this.io.emit('system:status',this.status());
    }
    if(topic==='iot/devices/status') {
      const s=parseStatusPayload(data);
      if(!s) {console.warn('Bỏ qua MQTT status payload không hợp lệ');return;}
      const [result]=await pool.execute('UPDATE devices SET status=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?',[s.status,s.deviceId]);
      if(!result.affectedRows) return;
      this.io.emit('device:status',{deviceId:s.deviceId,status:s.status,confirmedAt:new Date().toISOString()});
      await this.control.onStatus(s.deviceId,s.status);
    }
  }
  async publishCommand(id,action) {
    if (!this.connected()) throw new Error('MQTT disconnected');
    const message=`${id}:${action}`;
    await new Promise((resolve,reject)=>{
      this.client.publish('iot/devices/command',message,{qos:0,retain:false},err=>err ? reject(err):resolve());
    });
  }
}
module.exports=MqttService;
