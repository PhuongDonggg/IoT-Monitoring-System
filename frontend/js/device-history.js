setActivePage('history');
let historyPage=1;
let historySize=Number(document.getElementById('historyLines').value);
let activeHistoryFilter={};
let historyRequestId=0;
function historyPill(status) {return `<span class="status-pill ${iotApi.escape(String(status).toLowerCase())}">${iotApi.escape(status)}</span>`;}
function renderHistoryPages(pages){
  const count=Math.max(1,pages), current=historyPage;
  const nums=new Set([1,count]);
  for(let n=Math.max(1,current-2);n<=Math.min(count,current+2);n++)nums.add(n);
  const ordered=[...nums].sort((a,b)=>a-b);
  let prev=0;const buttons=[];
  ordered.forEach(n=>{if(n-prev>1)buttons.push('<span class="page-dots">…</span>');buttons.push(`<button class="page-btn ${n===current?'active':''}" data-p="${n}">${n}</button>`);prev=n;});
  document.getElementById('historyPages').innerHTML=`<button class="page-btn" data-p="prev" ${current===1?'disabled':''}>‹</button>${buttons.join('')}<button class="page-btn" data-p="next" ${current===count?'disabled':''}>›</button>`;
  document.querySelectorAll('#historyPages .page-btn').forEach(b=>b.onclick=()=>{
    const next=b.dataset.p==='prev'?Math.max(1,current-1):b.dataset.p==='next'?Math.min(count,current+1):Number(b.dataset.p);
    if(next!==historyPage){historyPage=next;loadHistory();}
  });
}
async function loadHistory(){
  const requestId=++historyRequestId;
  const tbody=document.getElementById('historyRows');
  tbody.innerHTML='<tr class="empty-row"><td colspan="6">Loading...</td></tr>';
  const params=new URLSearchParams({...activeHistoryFilter,page:String(historyPage),size:String(historySize)});
  try{
    const r=await iotApi.request('/api/devices/action-history?'+params.toString());
    if(requestId!==historyRequestId)return;
    const e=iotApi.escape;
    tbody.innerHTML=r.content.length?r.content.map(x=>`<tr><td><strong>${e(x.id)}</strong></td><td>${e(x.deviceName)}</td><td>${e(x.action)}</td><td>${historyPill(x.status)}</td><td><span class="time-value">${e(x.time)}</span>${timeCopyButton(x.time)}</td><td>${e(x.user)}</td></tr>`).join(''):'<tr class="empty-row"><td colspan="6">No matching device history.</td></tr>';
    const first=r.totalElements?(historyPage-1)*historySize+1:0;
    document.getElementById('historyRecords').textContent=`Showing ${first} to ${Math.min(historyPage*historySize,r.totalElements)} of ${r.totalElements} records`;
    renderHistoryPages(r.totalPages);
  }catch(err){
    if(requestId!==historyRequestId)return;
    tbody.innerHTML=`<tr class="empty-row"><td colspan="6">${iotApi.escape(err.message)}</td></tr>`;
    document.getElementById('historyRecords').textContent='Cannot load history';
    document.getElementById('historyPages').innerHTML='';
  }
}
function selectedHistoryFilters(){
  const filter={};
  const device=document.getElementById('deviceFilter').value;
  const action=document.getElementById('actionFilter').value;
  const status=document.getElementById('statusFilter').value;
  const time=document.getElementById('historyTime').value.trim();
  if(device!=='All Devices')filter.deviceId=String(Number(device.replace('Device ','')));
  if(action!=='All Actions')filter.action=action;
  if(status!=='All Status')filter.status=status;
  if(time)filter.time=time;
  return filter;
}
document.getElementById('historySearch').onclick=()=>{activeHistoryFilter=selectedHistoryFilters();historyPage=1;loadHistory();};
document.getElementById('historyLines').onchange=e=>{historySize=Number(e.target.value);historyPage=1;loadHistory();};
document.getElementById('historyReset').onclick=()=>{
  document.getElementById('deviceFilter').value='All Devices';
  document.getElementById('actionFilter').value='All Actions';
  document.getElementById('statusFilter').value='All Status';
  document.getElementById('historyTime').value='';
  activeHistoryFilter={};historyPage=1;loadHistory();
};
document.getElementById('historyTime').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('historySearch').click();});
const historySocket=iotApi.socket();
if(historySocket)historySocket.on('action:update',()=>loadHistory());
loadHistory();
