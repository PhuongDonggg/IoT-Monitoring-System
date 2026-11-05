const {test}=require('node:test');
const assert=require('node:assert/strict');
const calls=[];
const emitted=[];
let registry=[{id:20,name:'Temperature'},{id:21,name:'Humidity'},{id:22,name:'Light'},{id:37,name:'Sensor 4'},{id:41,name:'Sensor 5'},{id:59,name:'Sensor 6'}];
let failInsert=false;
const conn={
  async beginTransaction(){calls.push(['begin']);},
  async query(sql,params){
    calls.push([sql,params]);
    if(sql.startsWith('SELECT id,name')) return [registry];
    if(sql.startsWith('SELECT UTC_TIMESTAMP'))return [[{received:new Date('2026-11-05T02:00:00.000Z')}]];
    if(failInsert)throw new Error('Insert failed');
    return [{affectedRows:6}];
  },
  async commit(){calls.push(['commit']);},async rollback(){calls.push(['rollback']);},release(){calls.push(['release']);}
};
const pool={async getConnection(){return conn;},async execute(sql,params){calls.push([sql,params]);return [{affectedRows:1}];}};
require.cache[require.resolve('../src/db')]={exports:{pool}};
require.cache[require.resolve('../src/config')]={exports:{mqtt:{}}};
const MqttService=require('../src/services/mqtt');
const service=new MqttService({emit:(...args)=>emitted.push(args)},{onStatus:async(...args)=>calls.push(['onStatus',...args])});
function reset(){calls.length=0;emitted.length=0;failInsert=false;}
test('six values use actual registry IDs and one transaction/timestamp',async()=>{
  reset();
  const data={temperature:28,humidity:65,light:450,sensor4:11,sensor5:101,sensor6:1001};
  await service.handleMessage('iot/sensors/data',JSON.stringify(data));
  const insert=calls.find(c=>c[0].startsWith('INSERT'));
  assert.deepEqual(insert[1].filter((_,i)=>i%3===0),[20,21,22,37,41,59]);
  assert.deepEqual(insert[1].filter((_,i)=>i%3===1),Object.values(data));
  assert.ok(insert[1].filter((_,i)=>i%3===2).every(t=>t===insert[1][2]));
  assert.ok(calls.find(c=>c[0]==='commit'));
  assert.deepEqual(emitted[0][1],{...data,time:'2026-11-05 09:00:00',recordedAt:'2026-11-05T02:00:00.000Z'});
});
test('database failure rolls back, releases and never emits sensor data',async()=>{
  reset();failInsert=true;
  await assert.rejects(service.handleMessage('iot/sensors/data','{"sensor6":1001}'),/Insert failed/);
  assert.ok(calls.find(c=>c[0]==='rollback'));
  assert.equal(calls.at(-1)[0],'release');
  assert.equal(emitted.length,0);
});
test('invalid and missing fields cannot save invalid values or stop valid sensors',async()=>{
  reset();await service.handleMessage('iot/sensors/data','{"sensor4":99,"sensor5":0}');
  assert.deepEqual(calls.find(c=>c[0].startsWith('INSERT'))[1].slice(0,2),[41,0]);
  assert.equal(emitted[0][1].sensor4,undefined);
  reset();await service.handleMessage('iot/sensors/data','bad JSON');
  assert.equal(calls.length,0);
});
test('old firmware and missing migration still allow legacy readings',async()=>{
  reset();const savedRegistry=registry;registry=registry.slice(0,3);
  try {
    await service.handleMessage('iot/sensors/data','{"temperature":28,"humidity":65,"light":450,"sensor4":8}');
    assert.equal(calls.find(c=>c[0].startsWith('INSERT'))[1].length,9);
    assert.equal(emitted[0][1].sensor4,undefined);
  } finally {registry=savedRegistry;}
});
test('device ACK still updates database and control synchronization',async()=>{
  reset();await service.handleMessage('iot/devices/status','{"device":2,"status":"OFF"}');
  assert.deepEqual(calls[0][1],['OFF',2]);
  assert.deepEqual(calls.at(-1),['onStatus',2,'OFF']);
  assert.equal(emitted[0][0],'device:status');
});
