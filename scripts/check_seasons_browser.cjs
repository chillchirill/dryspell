// Run through .venv Python's subprocess with the installed Node/Chrome; no new packages.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const url=process.argv[2]||'http://127.0.0.1:8000/climate_map.html';
const out=path.resolve('output/spread/browser_checks');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'dryspell-browser-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions',
  '--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let socket;
(async()=>{
  let port;
  for(let n=0;n<100;n++) {try {port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch(e){await sleep(100);}}
  assert(port,'Chrome debugging endpoint did not start');
  const target=await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map(),errors=[];
  socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id&&pending.has(data.id)) {const {resolve,reject,timer}=pending.get(data.id);clearTimeout(timer);pending.delete(data.id);data.error?reject(new Error(JSON.stringify(data.error))):resolve(data.result);}
    if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(new Error('CDP timeout: '+method));},25000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await sleep(150);}throw new Error('Browser condition failed: '+expression);};
  await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url});

  await wait('typeof META !== "undefined" && typeof map !== "undefined" && D.lat.length > 0');
  assert.equal(await evaluate('D.B.length'),12);assert.equal(await evaluate('D.A.length'),12);
  console.log('Seasons loaded:',await evaluate('({cells:D.lat.length,recent:META.recent,before:META.before})'));
  for(const mode of ['season','year','month']) {
    await evaluate(`document.querySelector('[data-v="${mode}"]').click()`);
    await wait(`view === '${mode}'`);
  }
  await evaluate('document.getElementById("layer").value="change";document.getElementById("layer").dispatchEvent(new Event("change"))');
  await wait('state.layer === "change"');await sleep(400);
  await wait('document.getElementById("headline").textContent.includes("vs the year before")');
  const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'seasons_desktop.png'),Buffer.from(shot.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(500);
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
  assert.equal(errors.length,0,errors.join('\n'));
  const mobile=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'seasons_mobile.png'),Buffer.from(mobile.data,'base64'));
  console.log('Seasons month/season/year/change controls and mobile layout passed');
  await send('Browser.close');
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(()=>{if(socket)socket.close();chrome.kill();});
