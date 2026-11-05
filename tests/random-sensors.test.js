const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(){
  let now=Date.parse('2026-11-05T03:00:00.000Z');
  class Clock extends Date {static now(){return now;}}
  const nodes=new Map();
  const handlers={};
  const requests=[];
  const intervals=[];
  const socket={connected:true,on:(name,fn)=>{handlers[name]=fn;}};
  function node(id){
    if(!nodes.has(id)) {
      const children=new Map();
      nodes.set(id,{value:0,checked:true,textContent:'',className:'',innerHTML:'',classList:{toggle(){}},querySelector(selector){if(!children.has(selector))children.set(selector,{textContent:'',value:0});return children.get(selector);}});
    }
    return nodes.get(id);
  }
  const context=vm.createContext({Date:Clock,console,setActivePage(){},setInterval(fn){intervals.push(fn);},
    document:{getElementById:node},
    window:{Chart:class {constructor(canvas,config){this.data=config.data;this.options=config.options;}update(){}}},
    iotApi:{request:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),socket:()=>socket}
  });
  context.Chart=context.window.Chart;
  vm.runInContext(fs.readFileSync('frontend/js/random-sensors.js','utf8'),context);
  const run=code=>vm.runInContext(code,context);
  run('randomBackendReachable=true;randomSystem={mqttConnected:true,sensorOnline:true}');
  return {run,node,handlers,requests,intervals,socket,advance:ms=>{now+=ms;}};
}
test('independent warning boundaries, percentages and max values',()=>{
  const {run,node}=setup();
  run('randomApplyCurrent({sensor4:5,sensor5:51,sensor6:1001,recordedAt:new Date(Date.now()).toISOString()})');
  assert.equal(node('sensor4Card').querySelector('.random-state').textContent,'SAFE');
  assert.equal(node('sensor5Card').querySelector('.random-state').textContent,'WARNING');
  assert.equal(node('sensor6Card').querySelector('.random-percent').textContent,'100.0%');
  run('randomApplyCurrent({sensor4:6,sensor5:50,sensor6:500,recordedAt:new Date(Date.now()).toISOString()})');
  assert.equal(node('sensor4Card').querySelector('.random-state').textContent,'WARNING');
  assert.equal(node('sensor5Card').querySelector('.random-state').textContent,'SAFE');
  assert.equal(node('sensor6Card').querySelector('.random-state').textContent,'SAFE');
});
test('stale and offline data stop blinking; another fresh sensor cannot refresh a missing sensor',()=>{
  const {run,node,advance,handlers}=setup();
  run('randomApplyCurrent({sensor4:11,sensor5:101,sensor6:1001,recordedAt:new Date(Date.now()).toISOString()})');
  advance(10001);
  run('randomApplyCurrent({sensor5:101,recordedAt:new Date(Date.now()).toISOString()})');
  assert.equal(node('sensor4Card').querySelector('.random-state').textContent,'STALE');
  assert.equal(node('sensor4Card').className.includes('warning'),false);
  assert.equal(node('sensor5Card').querySelector('.random-state').textContent,'WARNING');
  handlers.disconnect();
  assert.equal(node('sensor5Card').querySelector('.random-state').textContent,'OFFLINE');
  assert.equal(node('sensor5Card').className.includes('warning'),false);
});
test('per-sensor database timestamps and out-of-order snapshots preserve freshness',()=>{
  const {run,node}=setup();
  run('randomApplyCurrent({sensor4:8,sensor5:99,recordedAt:new Date(Date.now()).toISOString(),sensorRecordedAt:{sensor4:new Date(Date.now()).toISOString(),sensor5:"2026-11-05T02:00:00Z"}})');
  assert.equal(node('sensor4Card').querySelector('.random-state').textContent,'WARNING');
  assert.equal(node('sensor5Card').querySelector('.random-state').textContent,'STALE');
  run('randomApplyCurrent({sensor4:1,recordedAt:"2026-11-05T02:00:00Z"})');
  assert.equal(node('sensor4Card').querySelector('.random-value').textContent,'8');
});
test('chart merges duplicate history/realtime points and keeps raw values in tooltips',()=>{
  const {run}=setup();
  run('randomMergePoints("sensor6",[{value:1001,recordedAt:new Date(Date.now()).toISOString()}]);randomMergePoints("sensor6",[{value:1001,recordedAt:new Date(Date.now()).toISOString()}]);randomDrawChart()');
  assert.equal(run('randomSeries.sensor6.length'),1);
  assert.equal(run('randomChart.data.datasets[2].data[0]'),100);
  assert.equal(run('randomChart.data.datasets[2].rawValues[0]'),1001);
  assert.equal(run('randomChart.options.plugins.tooltip.callbacks.label({dataset:randomChart.data.datasets[2],dataIndex:0,parsed:{y:100}})'),'Sensor 6: 1001 (100.0%)');
});
test('history snapshot remains fixed when live telemetry arrives',()=>{
  const {run,node,handlers}=setup();
  node('randomLive').checked=false;
  handlers['sensor:update']({sensor4:11,recordedAt:'2026-11-05T03:00:00.000Z'});
  assert.equal(run('randomSeries.sensor4.length'),0);
  assert.equal(node('sensor4Card').querySelector('.random-value').textContent,'11');
});

function historyPoints(count=20,offset=0){
  return Array.from({length:count},(_,i)=>({value:i%12,recordedAt:new Date(Date.parse('2026-11-05T03:00:00Z')+(i+offset)*2000).toISOString()}));
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('opening page automatically loads 20 readings, then realtime evicts the oldest and deduplicates',async()=>{
  const {run,requests,handlers}=setup();
  const history=requests.find(r=>r.url==='/api/sensor-data/chart?limit=20');
  assert.ok(history);
  const points=historyPoints();
  handlers['sensor:update']({sensor4:8,recordedAt:points.at(-1).recordedAt});
  history.resolve({sensor4:points});await flush();
  assert.equal(run('randomSeries.sensor4.length'),20);
  handlers['sensor:update']({sensor4:9,recordedAt:'2026-11-05T03:00:40Z'});
  assert.equal(run('randomSeries.sensor4.length'),20);
  assert.equal(run('randomSeries.sensor4[0].recordedAt'),'2026-11-05T03:00:02.000Z');
  handlers['sensor:update']({sensor4:9,recordedAt:'2026-11-05T03:00:40.000Z'});
  assert.equal(run('randomSeries.sensor4.length'),20);
  assert.equal(run('randomChart.data.labels.length'),20);
  assert.equal(run('randomChart.options.plugins.tooltip.enabled'),false);
  assert.equal(run('randomChart.options.elements.point.radius'),0);
});
test('pausing ignores pending history and realtime; resuming reloads the latest 20',async()=>{
  const {run,node,requests,handlers}=setup();
  const initial=requests.find(r=>r.url.includes('/chart?'));
  node('randomLive').checked=false;node('randomLive').onchange();
  initial.resolve({sensor4:historyPoints()});await flush();
  handlers['sensor:update']({sensor4:11,recordedAt:'2026-11-05T03:01:00Z'});
  assert.equal(run('randomSeries.sensor4.length'),0);
  assert.equal(node('sensor4Card').querySelector('.random-value').textContent,'11');
  node('randomLive').checked=true;node('randomLive').onchange();
  const resumed=requests.filter(r=>r.url.includes('/chart?')).at(-1);
  assert.notEqual(resumed,initial);
  resumed.resolve({sensor4:historyPoints(20,20)});await flush();
  assert.equal(run('randomSeries.sensor4.length'),20);
  assert.equal(run('randomSeries.sensor4.at(-1).recordedAt'),'2026-11-05T03:01:18.000Z');
});
test('disconnect polling and reconnect reload history only while live is enabled',async()=>{
  const {run,node,requests,handlers,socket,intervals}=setup();
  requests.find(r=>r.url.includes('/chart?')).reject(new Error('Network unavailable'));await flush();
  assert.equal(node('randomError').textContent,'Network unavailable');
  socket.connected=false;handlers.disconnect();
  assert.equal(node('randomConnection').textContent,'OFFLINE');
  intervals[1]();
  let historyRequests=requests.filter(r=>r.url.includes('/chart?'));
  assert.equal(historyRequests.length,2);
  socket.connected=true;handlers.connect();
  historyRequests=requests.filter(r=>r.url.includes('/chart?'));
  assert.equal(historyRequests.length,3);
  historyRequests.at(-1).resolve({sensor4:historyPoints()});await flush();
  assert.equal(run('randomSeries.sensor4.length'),20);
  assert.equal(node('randomError').textContent,'');
  node('randomLive').checked=false;node('randomLive').onchange();
  handlers.connect();socket.connected=false;intervals[1]();
  assert.equal(requests.filter(r=>r.url.includes('/chart?')).length,3);
});
