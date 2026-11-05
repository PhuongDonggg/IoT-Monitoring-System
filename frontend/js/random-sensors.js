setActivePage('random');
const randomDefinitions = [
  {key:'sensor4',name:'Sensor 4',max:11,threshold:5.5,color:'#198c8f'},
  {key:'sensor5',name:'Sensor 5',max:101,threshold:50.5,color:'#2f7bc7'},
  {key:'sensor6',name:'Sensor 6',max:1001,threshold:500.5,color:'#c27c12'}
];
const randomLatest = {};
const randomChartLimit = 20;
const randomSeries = Object.fromEntries(randomDefinitions.map(s=>[s.key,[]]));
const staleAfterMs = 10000;
let randomSystem = null;
let randomBackendReachable = false;
let randomChart = null;
let historyRequestId = 0;
let latestRequestId = 0;
let systemRequestId = 0;
const randomGrid = document.getElementById('randomCards');
randomGrid.innerHTML = randomDefinitions.map(s=>`
  <article class="card random-card offline" id="${s.key}Card" aria-labelledby="${s.key}Name">
    <div class="random-card-head"><h2 id="${s.key}Name">${s.name}</h2><span class="random-state">OFFLINE</span></div>
    <div class="random-value">--</div><div class="random-range">Range 0–${s.max} · Warning &gt; ${s.threshold}</div>
    <div class="random-meter-label"><span>Percentage of maximum</span><strong class="random-percent">--%</strong></div>
    <progress max="100" value="0" aria-label="${s.name} percentage"></progress>
    <div class="random-updated">No sensor data received</div>
  </article>`).join('');

function randomIsValid(value,s) {return Number.isInteger(value)&&value>=0&&value<=s.max;}
function randomRender() {
  const online = randomBackendReachable && randomSystem?.mqttConnected && randomSystem?.sensorOnline;
  const fresh = randomDefinitions.every(s=>randomLatest[s.key] && Date.now()-Date.parse(randomLatest[s.key].recordedAt)<staleAfterMs);
  const badge = document.getElementById('randomConnection');
  badge.textContent = !online ? 'OFFLINE' : fresh ? 'LIVE' : 'STALE';
  badge.classList.toggle('connected',Boolean(online&&fresh));
  randomDefinitions.forEach(s=>{
    const card=document.getElementById(s.key+'Card');
    const point=randomLatest[s.key];
    const percentage=point ? point.value/s.max*100 : null;
    const stale=!point || Date.now()-Date.parse(point.recordedAt)>=staleAfterMs;
    const state=!online?'OFFLINE':stale?'STALE':point.value>s.threshold?'WARNING':'SAFE';
    card.className='card random-card '+state.toLowerCase();
    card.querySelector('.random-state').textContent=state;
    card.querySelector('.random-value').textContent=point ? String(point.value) : '--';
    card.querySelector('.random-percent').textContent=percentage===null?'--%':percentage.toFixed(1)+'%';
    card.querySelector('progress').value=percentage??0;
    card.querySelector('.random-updated').textContent=point ? 'Last received: '+(point.time||point.recordedAt) : 'No sensor data received';
  });
}
function randomApplyCurrent(data) {
  randomDefinitions.forEach(s=>{
    const recordedAt=data.sensorRecordedAt ? data.sensorRecordedAt[s.key] : data.recordedAt;
    if(!randomIsValid(data[s.key],s)||!recordedAt||!Number.isFinite(Date.parse(recordedAt))) return;
    if(randomLatest[s.key] && Date.parse(randomLatest[s.key].recordedAt)>Date.parse(recordedAt)) return;
    randomLatest[s.key]={value:data[s.key],recordedAt,time:data.sensorRecordedAt ? new Date(recordedAt).toLocaleString('en-GB',{timeZone:'Asia/Ho_Chi_Minh'}) : data.time};
  });
  randomRender();
}
function randomMergePoints(key,points) {
  const s=randomDefinitions.find(s=>s.key===key);
  const byTime=new Map();
  for(const p of [...randomSeries[key],...points]) {
    if(randomIsValid(p.value,s)&&Number.isFinite(Date.parse(p.recordedAt))) {
      const recordedAt=new Date(p.recordedAt).toISOString();
      byTime.set(recordedAt,{...p,recordedAt});
    }
  }
  randomSeries[key]=[...byTime.values()].sort((a,b)=>Date.parse(a.recordedAt)-Date.parse(b.recordedAt)).slice(-randomChartLimit);
}
function randomDrawChart() {
  if(!randomChart) return;
  const times=[...new Set(Object.values(randomSeries).flatMap(series=>series.map(p=>p.recordedAt)))].sort().slice(-randomChartLimit);
  randomChart.data.labels=times.map(t=>new Date(t).toLocaleTimeString('en-GB',{timeZone:'Asia/Ho_Chi_Minh',hour12:false}));
  randomDefinitions.forEach((s,i)=>{
    const values=new Map(randomSeries[s.key].map(p=>[p.recordedAt,p.value]));
    const dataset=randomChart.data.datasets[i];
    dataset.rawValues=times.map(t=>values.has(t)?values.get(t):null);
    dataset.data=dataset.rawValues.map(value=>value===null?null:value/s.max*100);
  });
  randomChart.update('none');
}
function randomMakeChart() {
  if(!window.Chart) {
    document.getElementById('randomError').textContent='Cannot load Chart.js from CDN. Check your Internet connection; sensor cards remain available.';
    return;
  }
  randomChart=new Chart(document.getElementById('randomChart'),{
    type:'line',
    data:{labels:[],datasets:randomDefinitions.map(s=>({label:s.name,data:[],rawValues:[],borderColor:s.color,backgroundColor:s.color,tension:.2,borderWidth:2,spanGaps:false}))},
    options:{responsive:true,maintainAspectRatio:false,animation:false,events:[],elements:{point:{radius:0,hoverRadius:0}},interaction:{mode:'none',intersect:false},
      plugins:{legend:{position:'top'},tooltip:{enabled:false,callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.dataset.rawValues[ctx.dataIndex]} (${Number(ctx.parsed.y).toFixed(1)}%)`}}},
      scales:{y:{min:0,max:100,title:{display:true,text:'Percentage of maximum (%)'},ticks:{callback:value=>value+'%'}},x:{ticks:{maxTicksLimit:8,maxRotation:0}}}}
  });
}
async function randomLoadHistory() {
  const requestId=++historyRequestId;
  try {
    const data=await iotApi.request('/api/sensor-data/chart?limit='+randomChartLimit);
    if(requestId!==historyRequestId||!document.getElementById('randomLive').checked) return;
    randomDefinitions.forEach(s=>{
      randomMergePoints(s.key,data[s.key]||[]);
    });
    randomDrawChart();
    if(randomChart) document.getElementById('randomError').textContent='';
  } catch(err) {if(requestId===historyRequestId)document.getElementById('randomError').textContent=err.message;}
}
async function randomLoadLatest() {
  const requestId=++latestRequestId;
  try {
    const data=await iotApi.request('/api/sensor-data/latest');
    if(requestId!==latestRequestId) return;
    randomApplyCurrent(data);
  } catch { /* Freshness and system polling show STALE/OFFLINE. */ }
}
async function randomLoadSystem() {
  const requestId=++systemRequestId;
  try {
    const data=await iotApi.request('/api/system/status');
    if(requestId!==systemRequestId) return;
    randomSystem=data;
    randomBackendReachable=true;
  } catch {if(requestId===systemRequestId)randomBackendReachable=false;}
  randomRender();
}
document.getElementById('randomLive').onchange=()=>{
  // Invalidate in-flight snapshots so pausing also stops delayed REST updates.
  ++historyRequestId;
  if(document.getElementById('randomLive').checked) randomLoadHistory();
};
randomMakeChart();
randomRender();
randomLoadHistory();
randomLoadLatest();
randomLoadSystem();
const randomSocket=iotApi.socket();
if(randomSocket) {
  randomSocket.on('sensor:update',data=>{
    randomBackendReachable=true;
    randomApplyCurrent(data);
    if(!document.getElementById('randomLive').checked) return;
    randomDefinitions.forEach(s=>{
      if(randomIsValid(data[s.key],s)) randomMergePoints(s.key,[{value:data[s.key],recordedAt:data.recordedAt,time:data.time}]);
    });
    randomDrawChart();
  });
  randomSocket.on('system:status',data=>{
    ++systemRequestId;randomSystem=data;randomBackendReachable=true;randomRender();
  });
  randomSocket.on('connect',()=>{randomLoadSystem();randomLoadLatest();if(document.getElementById('randomLive').checked)randomLoadHistory();});
  const disconnected=()=>{++systemRequestId;randomBackendReachable=false;randomRender();};
  randomSocket.on('disconnect',disconnected);
  randomSocket.on('connect_error',disconnected);
}
setInterval(randomRender,1000);
setInterval(()=>{
  randomLoadSystem();
  randomLoadLatest();
  if(!randomSocket?.connected&&document.getElementById('randomLive').checked)randomLoadHistory();
},5000);
