setActivePage('sensor');
let sensorPage = 1;
let sensorPageSize = Number(document.getElementById('sensorLines').value);
let activeSensorFilter = {type:'All Sensors',value:''};
let sensorRequestId=0;
function formatSensorValue(sensor) { const unit={Temperature:'°C',Humidity:'%',Light:'lux'}[sensor.type]; return unit ? `${sensor.value} ${unit}` : String(sensor.value); }
function renderSensorPages(pages) {
  const count=Math.max(1,pages), current=sensorPage;
  const nums=new Set([1,count]);
  for(let n=Math.max(1,current-2);n<=Math.min(count,current+2);n++)nums.add(n);
  const ordered=[...nums].sort((a,b)=>a-b);
  let prior=0;
  const buttons=[];
  ordered.forEach(n=>{if(n-prior>1)buttons.push('<span class="page-dots">…</span>');buttons.push(`<button class="page-btn ${n===current?'active':''}" data-p="${n}">${n}</button>`);prior=n;});
  document.getElementById('sensorPages').innerHTML=`<button class="page-btn" data-p="prev" ${current===1?'disabled':''}>‹</button>${buttons.join('')}<button class="page-btn" data-p="next" ${current===count?'disabled':''}>›</button>`;
  document.querySelectorAll('#sensorPages .page-btn').forEach(btn=>btn.onclick=()=>{
    const next=btn.dataset.p==='prev'?Math.max(1,current-1):btn.dataset.p==='next'?Math.min(count,current+1):Number(btn.dataset.p);
    if(next!==sensorPage){sensorPage=next;loadSensor();}
  });
}
async function loadSensor() {
  const requestId=++sensorRequestId;
  const tbody=document.getElementById('sensorRows');
  tbody.innerHTML='<tr class="empty-row"><td colspan="4">Loading...</td></tr>';
  const params=new URLSearchParams({...activeSensorFilter,page:String(sensorPage),size:String(sensorPageSize)});
  try{
    const r=await iotApi.request('/api/sensor-data/history?'+params.toString());
    if(requestId!==sensorRequestId)return;
    const esc=iotApi.escape;
    tbody.innerHTML=r.content.length?r.content.map(x=>`<tr><td><strong>${esc(x.id)}</strong></td><td>${esc(x.type)}</td><td><strong>${esc(formatSensorValue(x))}</strong></td><td><span class="time-value">${esc(x.time)}</span>${timeCopyButton(x.time)}</td></tr>`).join(''):'<tr class="empty-row"><td colspan="4">No matching sensor data.</td></tr>';
    const first=r.totalElements?(sensorPage-1)*sensorPageSize+1:0;
    const last=Math.min(sensorPage*sensorPageSize,r.totalElements);
    document.getElementById('sensorRecords').textContent=`Showing ${first} to ${last} of ${r.totalElements} records`;
    renderSensorPages(r.totalPages);
  }catch(err){
    if(requestId!==sensorRequestId)return;
    tbody.innerHTML=`<tr class="empty-row"><td colspan="4">${iotApi.escape(err.message)}</td></tr>`;
    document.getElementById('sensorRecords').textContent='Cannot load data';
    document.getElementById('sensorPages').innerHTML='';
  }
}
document.getElementById('sensorSearch').onclick=()=>{
  activeSensorFilter={type:document.getElementById('sensorType').value,value:document.getElementById('sensorValue').value.trim()};
  sensorPage=1;loadSensor();
};
document.getElementById('sensorLines').onchange=e=>{sensorPageSize=Number(e.target.value);sensorPage=1;loadSensor();};
document.getElementById('sensorReset').onclick=()=>{
  document.getElementById('sensorType').value='All Sensors';
  document.getElementById('sensorValue').value='';
  activeSensorFilter={type:'All Sensors',value:''};sensorPage=1;loadSensor();
};
document.getElementById('sensorValue').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('sensorSearch').click();});
loadSensor();
