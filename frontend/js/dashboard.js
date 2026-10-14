setActivePage('dashboard');
const chartCtx = document.getElementById('sensorChart');
let chart = null;
const chartLimit = 20;
const sensorSeries = {temperature:[], humidity:[], light:[]};
function makeChart() {
  if (!window.Chart) {
    const label=document.querySelector('.chart-card .card-title');
    label.title='Không tải được Chart.js từ CDN. Kiểm tra kết nối Internet.';
    return;
  }
  chart = new Chart(chartCtx, {
    type:'line',
    data:{labels:[],datasets:[
      {label:'Temperature (°C)',data:[],borderColor:'#198c8f',backgroundColor:'#198c8f',tension:.25,pointRadius:0,borderWidth:2.5,yAxisID:'y'},
      {label:'Humidity (%)',data:[],borderColor:'#2f7bc7',backgroundColor:'#2f7bc7',tension:.25,pointRadius:0,borderWidth:2.5,yAxisID:'y'},
      {label:'Light (lux)',data:[],borderColor:'#f0aa24',backgroundColor:'#f0aa24',tension:.25,pointRadius:0,borderWidth:2.5,yAxisID:'yLight'}
    ]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,events:[],
      plugins:{legend:{position:'top',labels:{boxWidth:24,boxHeight:4,padding:16,color:'#17243b',font:context=>({size:context.chart.width<480?12:14,weight:'500'})}}},
      scales:{x:{grid:{color:'#f1f3f6'},ticks:{color:'#6b7688',font:{size:12},maxTicksLimit:7,maxRotation:0,autoSkipPadding:12,padding:8}},
        y:{position:'left',min:0,max:100,ticks:{stepSize:25,color:'#6b7688',font:{size:12},padding:8},grid:{color:'#edf1f4'}},
        yLight:{position:'right',min:0,grace:'10%',ticks:{color:'#a07828',font:{size:11}},grid:{drawOnChartArea:false}}
      }
    }
  });
}
function drawSeries() {
  if (!chart) return;
  const timeList = Array.from(new Set(Object.values(sensorSeries).flatMap(points=>points.map(p=>p.recordedAt||p.time)))).sort().slice(-chartLimit);
  chart.data.labels = timeList.map(t=>{ const p=Object.values(sensorSeries).flat().find(x=>(x.recordedAt||x.time)===t); return (p?.time||t||'').slice(11,19); });
  ['temperature','humidity','light'].forEach((k,i)=>{
    const byTime=new Map(sensorSeries[k].map(p=>[p.recordedAt||p.time,p.value]));
    chart.data.datasets[i].data = timeList.map(t=>byTime.has(t)?byTime.get(t):null);
  });
  chart.update('none');
}
function updateCurrent(d) {
  const fields=[['tempNow','temperature','°C'],['humNow','humidity','%'],['lightNow','light','lux']];
  fields.forEach(([id,key,unit])=>{ const el=document.getElementById(id); el.textContent=typeof d[key]==='number'?`${d[key]} ${unit}`:`-- ${unit}`; });
  document.querySelectorAll('.sensor-value .updated').forEach(el=>el.textContent = d.time ? `Updated ${d.time}` : 'No real sensor data yet');
}
function appendSensor(d) {
  const t = d.recordedAt || d.time;
  if (!t) return;
  for (const key of ['temperature','humidity','light']) {
    if (typeof d[key] !== 'number') continue;
    const list = sensorSeries[key];
    // Không nhân đôi điểm lúc Socket.IO và REST trả cùng dữ liệu.
    const index = list.findIndex(item=>(item.recordedAt||item.time)===t);
    if (index!==-1) list.splice(index,1);
    list.push({time:d.time,recordedAt:t,value:d[key]});
    list.sort((a,b)=>String(a.recordedAt||a.time).localeCompare(String(b.recordedAt||b.time)));
    if (list.length>chartLimit) list.splice(0,list.length-chartLimit);
  }
  updateCurrent(d);
  drawSeries();
}
function setDeviceState(card, status, busy=false) {
  const label=card.querySelector('.state');
  label.textContent=status;
  label.className='state '+(status==='ON'?'on':status==='OFF'?'off':'unknown');
  card.querySelector('.processing').textContent=busy?'PENDING...':'';
  card.querySelectorAll('.device-btn').forEach(button=>{
    button.classList.toggle('active',button.dataset.action===status);
    button.disabled=busy || status==='UNKNOWN' || !mqttConnected;
  });
}
const deviceStates = new Map([[1,'UNKNOWN'],[2,'UNKNOWN'],[3,'UNKNOWN']]);
const pendingDevices = new Set();
let mqttConnected = false;
function refreshDeviceCard(id) {
  const card = document.querySelector(`.device-card[data-device="${id}"]`);
  if (card) setDeviceState(card, deviceStates.get(id)||'UNKNOWN', pendingDevices.has(id));
}
async function loadDevices() {
  try {
    const devices=await iotApi.request('/api/devices');
    devices.forEach(device=>{deviceStates.set(device.id,device.status);refreshDeviceCard(device.id);});
  } catch(err) { console.warn('Device load:',err.message); }
}
async function loadSystem() {
  try {const s=await iotApi.request('/api/system/status');mqttConnected=Boolean(s.mqttConnected);}
  catch {mqttConnected=false;}
  for (const id of deviceStates.keys()) refreshDeviceCard(id);
}
function showDeviceError() {
  const title=document.querySelector('.device-panel .card-title');
  title.textContent='Device Control — Command failed';
  setTimeout(()=>{title.textContent='Device Control';},6500);
}
document.querySelectorAll('.device-card').forEach(card=>{
  const id=Number(card.dataset.device);
  refreshDeviceCard(id);
  card.querySelectorAll('.device-btn').forEach(button=>button.addEventListener('click',async()=>{
    if (!mqttConnected || pendingDevices.has(id)) return;
    pendingDevices.add(id);refreshDeviceCard(id);
    try {
      await iotApi.request(`/api/devices/${id}/control`,{method:'POST',body:JSON.stringify({action:button.dataset.action})});
      // Fallback: nếu Socket.IO rớt, bỏ PENDING cục bộ và truy vấn trạng thái thực.
      setTimeout(()=>{ if(pendingDevices.has(id)){pendingDevices.delete(id);loadDevices();} },6500);
      // Kết quả thực tế chỉ được xác nhận bằng MQTT ACK hoặc API status.
    } catch { pendingDevices.delete(id);refreshDeviceCard(id);showDeviceError(); }
  }));
});
async function loadDashboard(){
  const results = await Promise.allSettled([
    iotApi.request('/api/sensor-data/latest'),iotApi.request(`/api/sensor-data/chart?limit=${chartLimit}`)
  ]);
  if(results[0].status==='fulfilled')updateCurrent(results[0].value);
  if(results[1].status==='fulfilled'){
    const chartData=results[1].value;
    ['temperature','humidity','light'].forEach(k=>sensorSeries[k]=chartData[k]||[]);
    drawSeries();
  }
}
makeChart();
loadDashboard();
Promise.all([loadSystem(),loadDevices()]);
const liveSocket=iotApi.socket();
if(liveSocket){
  liveSocket.on('sensor:update',appendSensor);
  liveSocket.on('device:status',event=>{deviceStates.set(Number(event.deviceId),event.status);refreshDeviceCard(Number(event.deviceId));});
  liveSocket.on('action:update',event=>{
    if(event.status!=='PENDING'){
      pendingDevices.delete(Number(event.deviceId));
      refreshDeviceCard(Number(event.deviceId));
      if(event.status==='FAILED')showDeviceError();
    }
  });
  liveSocket.on('system:status',event=>{mqttConnected=Boolean(event.mqttConnected);for(const id of deviceStates.keys())refreshDeviceCard(id);refreshSystemIndicator();});
  liveSocket.on('connect',()=>{loadDashboard();loadDevices();loadSystem();});
}
// Đồng bộ sau sự cố mạng và trường hợp sự kiện đã xảy ra trước khi client subscribe.
setInterval(()=>{loadDevices();loadSystem();},10000);
