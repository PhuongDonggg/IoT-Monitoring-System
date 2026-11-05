// Read-only browser regression check. Requires Node 22+ and a dedicated headless
// Edge/Chrome started with --remote-debugging-port=9231 (or CDP_PORT).
// The temporary server injects a test login only into its own HTML response.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const {Server}=require('socket.io');
const {pool}=require('../src/db');
const {requireAuth,signToken,verifyToken}=require('../src/auth');
const routes=require('../src/routes/sensors');
const {port}=require('../src/config');
const live=process.argv.includes('--live');

(async()=>{
  let server,io,ws;
  const pending=new Map();
  let sequence=0;
  let targetId;
  const exceptions=[];
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++sequence;
    const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},10000);
    pending.set(id,{resolve,reject,timeout});
    ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  try {
    const version=await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT||9231}/json/version`)).json();
    ws=new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    ws.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.method==='Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
      const request=pending.get(message.id);
      if(!request)return;
      pending.delete(message.id);clearTimeout(request.timeout);
      if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result);
    });
    const app=express();
    const token=signToken({id:1,username:'layout-check'});
    let base=`http://127.0.0.1:${port}`;
    if(!live){
    app.get('/random-sensors.html',(req,res)=>{
      const html=fs.readFileSync(path.join(__dirname,'../frontend/random-sensors.html'),'utf8');
      res.type('html').send(html.replace('<head>',`<head><script>sessionStorage.setItem('iotToken',${JSON.stringify(token)})</script>`));
    });
    app.use('/api/sensor-data',requireAuth,routes);
    app.get('/api/system/status',requireAuth,(req,res)=>res.json({mqttConnected:false,sensorOnline:false}));
    app.use(express.static(path.join(__dirname,'../frontend')));
    server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    io=new Server(server);
    io.use((socket,next)=>{try{verifyToken(socket.handshake.auth?.token);next();}catch{next(new Error('Unauthorized'));}});
    base=`http://127.0.0.1:${server.address().port}`;
    }
    ({targetId}=await send('Target.createTarget',{url:'about:blank'}));
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const evaluate=async expression=>{
      const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
      return result.result.value;
    };
    await send('Runtime.enable',{},sessionId);
    await send('Page.enable',{},sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`sessionStorage.setItem('iotToken',${JSON.stringify(token)})`},sessionId);
    await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false},sessionId);
    await send('Page.navigate',{url:base+'/random-sensors.html'},sessionId);
    let ready=false;
    for(let attempt=0;attempt<100;attempt++){
      ready=await evaluate('typeof randomMakeChart==="function" && typeof randomChart!=="undefined" && randomChart!==null && typeof randomChart.update==="function"');
      if(ready)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ready,'Chart.js must load in the actual browser');
    assert.equal(await evaluate('document.body.textContent.includes("No saved data for Sensor 4") || document.body.textContent.includes("Stale after 10s") || document.querySelector("#randomChartNote")!==null'),false,'Removed text and its empty container stay absent');
    assert.equal(await evaluate('document.querySelector("#randomReload,#randomLimit")!==null'),false,'Only Live updates remains in the chart header');
    if(live){
      const saved=await evaluate('(async()=>{const data=await iotApi.request("/api/sensor-data/chart?limit=20");return Object.fromEntries(randomDefinitions.map(s=>[s.key,(data[s.key]||[]).length]));})()');
      let loaded=false;
      for(let attempt=0;attempt<50;attempt++){
        const lengths=await evaluate('Object.fromEntries(randomDefinitions.map(s=>[s.key,randomSeries[s.key].length]))');
        loaded=Object.entries(saved).every(([key,count])=>lengths[key]>=count&&lengths[key]<=20);
        if(loaded)break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.ok(loaded,'Initial MySQL history loads automatically without a button');
      console.log('LIVE automatic history OK:',JSON.stringify(saved));
    }
    // UI-only fixtures exercise long values, timestamps and warning styles.
    // They never go through MQTT or write to MySQL.
    await evaluate(`randomApplyCurrent({sensor4:11,sensor5:50,sensor6:1001,recordedAt:new Date().toISOString()});
      randomDefinitions.forEach(s=>randomMergePoints(s.key,Array.from({length:20},(_,i)=>({value:s.max,recordedAt:new Date(Date.now()-(19-i)*2000).toISOString()}))));randomDrawChart();`);
    for(const [width,height,desktop] of [[1366,768,true],[1920,1080,true],[1366,768,true],[390,844,false],[1366,600,false]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
      await new Promise(resolve=>setTimeout(resolve,250));
      const metrics=await evaluate(`(() => {
        const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,
          cards:[...document.querySelectorAll('.random-card')].map(el=>({top:el.getBoundingClientRect().top,clipped:el.scrollHeight>el.clientHeight+1})),
          canvas:rect('#randomChart'),chartWidth:randomChart.width,chartHeight:randomChart.height,
          labelsFit:randomChart.legend.bottom<=randomChart.height && randomChart.scales.x.bottom<=randomChart.height && randomChart.scales.y.left>=0,
          controlsFit:[...document.querySelectorAll('main select,main button,.random-state,.random-updated')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}),
          cssRules:[...document.styleSheets].filter(s=>s.href&&s.href.includes('random-sensors.css')).reduce((n,s)=>n+s.cssRules.length,0)};
      })()`);
      assert.ok(metrics.scrollWidth<=width,'No horizontal overflow: '+width+'x'+height);
      assert.ok(metrics.canvas.width>100&&metrics.canvas.height>120,'Chart remains readable');
      assert.ok(metrics.labelsFit,'Chart axes and legend must remain inside canvas');
      assert.ok(metrics.cards.every(c=>!c.clipped),'No clipped sensor cards');
      assert.ok(metrics.cssRules>20,'Stylesheet parsed by browser');
      if(desktop){
        assert.equal(metrics.scrollHeight,height,'No vertical overflow: '+width+'x'+height);
        assert.ok(metrics.cards.every(c=>Math.abs(c.top-metrics.cards[0].top)<1),'Three cards in one row');
        assert.ok(metrics.controlsFit,'Important content remains inside viewport');
        assert.ok(metrics.canvas.bottom<=height,'Canvas fully visible');
      }else assert.ok(metrics.scrollHeight>height,'Small screens scroll instead of clipping');
      console.log('OK layout:',JSON.stringify({viewport:`${width}x${height}`,scroll:`${metrics.scrollWidth}x${metrics.scrollHeight}`,chart:`${metrics.chartWidth}x${metrics.chartHeight}`,labelsFit:metrics.labelsFit}));
    }
    await send('Page.navigate',{url:base+'/sensor-data.html'},sessionId);
    let tableReady=false;
    for(let attempt=0;attempt<50;attempt++){
      tableReady=await evaluate('document.getElementById("sensorRecords")?.textContent.startsWith("Showing ")===true');
      if(tableReady)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(tableReady,'Actual Sensor Data page must load its API');
    const table=await evaluate(`(async()=>{
      const data=await iotApi.request('/api/sensor-data/history?type=All%20Sensors&page=1&size=10');
      return {options:[...document.querySelectorAll('#sensorType option')].map(o=>o.value),types:[...document.querySelectorAll('#sensorRows tr:not(.empty-row) td:nth-child(2)')].map(td=>td.textContent),records:document.getElementById('sensorRecords').textContent,total:data.totalElements,pages:data.totalPages};
    })()`);
    assert.equal(table.options.includes('CO2'),false);
    assert.equal(table.types.includes('CO2'),false);
    assert.ok(table.records.includes('of '+table.total+' records'));
    assert.equal(table.pages,Math.ceil(table.total/10));
    console.log(live?'LIVE browser Sensor Data OK:':'Browser Sensor Data OK:',JSON.stringify(table));
    assert.deepEqual(exceptions,[],'No browser JavaScript exceptions');
  }catch(err){console.error('Layout check failed:',err.message);process.exitCode=1;}
  finally{
    if(ws?.readyState===WebSocket.OPEN){
      if(targetId)await send('Target.closeTarget',{targetId}).catch(()=>{});
      ws.close();
    }
    if(io)await new Promise(resolve=>io.close(resolve));
    else if(server)await new Promise(resolve=>server.close(resolve));
    await pool.end();
  }
})();
