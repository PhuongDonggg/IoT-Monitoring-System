const express=require('express');
const http=require('node:http');
const path=require('node:path');
const {Server}=require('socket.io');
const {port}=require('./config');
const {pool,testConnection}=require('./db');
const {verifyToken,requireAuth}=require('./auth');
const {httpError}=require('./utils/validation');
const ControlService=require('./services/control');
const MqttService=require('./services/mqtt');
const authRoutes=require('./routes/auth');
const sensorRoutes=require('./routes/sensors');
const deviceRoutes=require('./routes/devices');
const systemRoutes=require('./routes/system');

async function main(){
  await testConnection();
  console.log('MySQL connection OK');
  const app=express();
  app.disable('x-powered-by');
  app.use(express.json({limit:'16kb'}));
  const server=http.createServer(app);
  const io=new Server(server,{cors:{origin:false}});
  io.use((socket,next)=>{
    try {socket.data.user=verifyToken(socket.handshake.auth?.token);next();}
    catch {next(new Error('Unauthorized'));}
  });
  const control=new ControlService(io);
  await control.initialize();
  const mqtt=new MqttService(io,control);
  control.setMqtt(mqtt);
  app.get('/api/health',async(req,res)=>{
    try {await pool.query('SELECT 1');res.json({status:mqtt.connected()?'ok':'degraded',database:'connected',...mqtt.status()});}
    catch {res.status(503).json({status:'down',database:'disconnected',...mqtt.status()});}
  });
  app.use('/api/auth',authRoutes);
  app.use('/api/sensor-data',requireAuth,sensorRoutes);
  app.use('/api/devices',requireAuth,deviceRoutes(control));
  app.use('/api/system',requireAuth,systemRoutes(mqtt));
  app.use('/api',(req,res,next)=>next(httpError(404,'API không tồn tại')));
  // Phục vụ trực tiếp frontend đã kết nối API, giữ nguyên HTML/CSS gốc.
  app.use(express.static(path.join(__dirname,'..','frontend')));
  app.get('/',(req,res)=>res.redirect('/index.html'));
  app.use((req,res,next)=>next(httpError(404,'Trang không tồn tại')));
  app.use((err,req,res,next)=>{
    if(err.type==='entity.parse.failed')return res.status(400).json({error:'JSON không hợp lệ'});
    const code=err.status>=400&&err.status<600?err.status:500;
    if(code===500)console.error('Backend error:',err.message);
    res.status(code).json({error:code===500?'Lỗi máy chủ':err.message});
  });
  mqtt.start();
  server.listen(port,'127.0.0.1',()=>console.log(`Backend chạy tại http://127.0.0.1:${port}`));
  process.on('SIGINT',async()=>{
    console.log('\nStopping backend...');
    mqtt.client?.end(true);
    io.close();
    await pool.end();
    server.close(()=>process.exit(0));
  });
}
main().catch(err=>{console.error('Không khởi động được backend:',err.message);process.exitCode=1;});
