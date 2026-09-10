// Run a PVR mock on port 8399, optionally with STRIVO_E2E_ASSETS_DIR set to
// the release build's out/assets directory, then run this from repository root.
import { chromium } from '../../../crates/strivo-web/e2e/node_modules/playwright/index.mjs';
const browser = await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('strivo-tour-done','1'));
  await page.route('**/assets/spa.js',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text())+'\nwindow.audit={API,paintRecordings,get recordings(){return recCache;}};',contentType:'application/javascript'});
  });
  await page.goto('http://localhost:8399/app#/recordings');
  await page.locator('#rec-body tr[data-rec-row]').first().waitFor();
  const measure=()=>page.evaluate(()=>{
    const full=[],dirty=[];
    for(let i=0;i<10;i++){
      const t=performance.now();audit.paintRecordings();full.push(performance.now()-t);
    }
    const record=audit.recordings.find(r=>r.state==='Recording') || audit.recordings[0];
    for(let i=0;i<10;i++){
      record.bytes_written+=1000;
      const t=performance.now();audit.paintRecordings(new Set([String(record.id)]));
      document.querySelector('#rec-body').getBoundingClientRect();dirty.push(performance.now()-t);
    }
    return {fullRepaintJsMs:full,singleProgressJsAndLayoutMs:dirty};
  });
  const results={source:'Compiled PVR release assets / mock API / Chromium',errors,normal:await measure()};
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  results.cpu4=await measure();
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  await page.evaluate(()=>{audit.API.invalidate();});
  const started=Date.now(),requests=[];
  await page.route('**/api/v1/**',async route=>{
    requests.push({path:new URL(route.request().url()).pathname,startMs:Date.now()-started});
    await new Promise(resolve=>setTimeout(resolve,150));await route.continue();
  });
  await page.evaluate(()=>{location.hash='#/library';});
  await page.locator('#dash').waitFor();
  results.home={injectedLatencyMs:150,untilDashboardMs:Date.now()-started,requests};
  console.log(JSON.stringify(results,null,2));
} finally { await browser.close(); }
