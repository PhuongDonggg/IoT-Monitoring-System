const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseSensorPayload,parseStatusPayload}=require('../src/utils/validation');

test('legacy payload and partial DHT failure remain supported',()=>{
  const old={temperature:28.5,humidity:65,light:450};
  assert.deepEqual(parseSensorPayload(JSON.stringify(old)),old);
  assert.deepEqual(parseSensorPayload('{"light":450,"sensor4":8,"sensor6":700}'),{light:450,sensor4:8,sensor6:700});
});
test('every integer in the random ranges, including zero and maxima, is accepted',()=>{
  for(const [key,max] of [['sensor4',11],['sensor5',101],['sensor6',1001]]) {
    for(let value=0;value<=max;value++) assert.deepEqual(parseSensorPayload(JSON.stringify({[key]:value})),{[key]:value});
    for(const value of [-1,max+1,.5,'1',null,true,{},[]]) assert.equal(parseSensorPayload(JSON.stringify({[key]:value})),null);
  }
});
test('malformed data is rejected without discarding valid siblings',()=>{
  for(const raw of ['{','null','[]','42','{}','{"sensor4":1e999}']) assert.equal(parseSensorPayload(raw),null);
  assert.deepEqual(parseSensorPayload('{"temperature":null,"sensor4":12,"sensor5":101,"sensor6":1001}'),{sensor5:101,sensor6:1001});
  for(const field of [{temperature:126},{humidity:101},{light:1024},{light:1.2}]) assert.equal(parseSensorPayload(JSON.stringify(field)),null);
});
test('device status validation remains unchanged',()=>{
  assert.deepEqual(parseStatusPayload('{"device":3,"status":"ON"}'),{deviceId:3,status:'ON'});
  assert.equal(parseStatusPayload('{"device":4,"status":"ON"}'),null);
});
test('retired CO2 fields are ignored and cannot become Sensor 4',()=>{
  assert.equal(parseSensorPayload('{"co2":900,"co2Warning":true}'),null);
  assert.deepEqual(parseSensorPayload('{"co2":900,"sensor4":11,"sensor5":101,"sensor6":1001}'),{sensor4:11,sensor5:101,sensor6:1001});
  assert.equal(parseSensorPayload('{"co2":8,"sensor4":900}'),null);
});
