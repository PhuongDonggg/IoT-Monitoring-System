// Read-only verification against the actual server used by the frontend.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {port}=require('../src/config');
const {signToken}=require('../src/auth');
const {pool}=require('../src/db');
const sensors=require('../src/utils/sensors');
(async()=>{
  try {
    const base=`http://127.0.0.1:${port}`;
    const headers={Authorization:'Bearer '+signToken({id:1,username:'readonly-live-check'})};
    const names=sensors.map(s=>s.name);
    const [counts]=await pool.query('SELECT s.id,s.name,COUNT(sd.id) AS samples FROM sensors s LEFT JOIN sensor_data sd ON sd.sensor_id=s.id GROUP BY s.id,s.name ORDER BY s.id');
    const total=counts.filter(s=>names.includes(s.name)).reduce((n,s)=>n+Number(s.samples),0);
    const get=async query=>{
      const response=await fetch(base+'/api/sensor-data/history?'+new URLSearchParams(query),{headers,cache:'no-store'});
      assert.equal(response.status,200);
      assert.equal(response.headers.get('cache-control'),'no-store');
      const data=await response.json();
      assert.ok(data.content.every(row=>names.includes(row.type)),'Only the six active sensors may appear');
      return data;
    };
    for(const size of [1,5,10]) {
      const first=await get({type:'All Sensors',page:1,size});
      const pages=Math.ceil(total/size);
      assert.equal(first.totalElements,total);
      assert.equal(first.totalPages,pages);
      assert.equal(first.content.length,Math.min(total,size));
      if(pages){const last=await get({type:'All Sensors',page:pages,size});assert.equal(last.content.length,total-(pages-1)*size);}
      console.log('LIVE pagination OK:',JSON.stringify({size,totalElements:first.totalElements,totalPages:first.totalPages,firstPageTypes:first.content.map(r=>r.type)}));
    }
    assert.equal((await get({type:'Time',page:1,size:10})).totalElements,total);
    assert.equal((await get({type:'All Sensors',value:'CO2',page:1,size:10})).totalElements,0);
    const retired=await fetch(base+'/api/sensor-data/history?type=CO2',{headers});
    assert.equal(retired.status,400);
    for(const s of counts.filter(s=>names.includes(s.name)))assert.equal((await get({type:s.name,page:1,size:10})).totalElements,Number(s.samples));
    for(const endpoint of ['latest','chart']){
      const response=await fetch(base+'/api/sensor-data/'+endpoint,{headers});
      assert.equal(response.status,200);
      assert.equal(Object.hasOwn(await response.json(),'co2'),false);
    }
    for(const file of ['sensor-data.html','js/sensor-data.js','random-sensors.html','js/random-sensors.js','css/random-sensors.css']){
      const response=await fetch(base+'/'+file,{cache:'no-store'});
      assert.equal(response.headers.get('cache-control'),'no-store');
      assert.equal(await response.text(),fs.readFileSync('frontend/'+file,'utf8'),'Running server serves current '+file);
    }
    console.log('LIVE API: CO2 search returns zero; CO2 filter rejected; latest/chart exclude CO2; served assets match workspace and use no-store.');
    console.log('Unmodified registry/history:',JSON.stringify(counts));
  }catch(err){console.error('LIVE check failed:',err.message);process.exitCode=1;}
  finally{await pool.end();}
})();
