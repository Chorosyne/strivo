// Run from repository root while the e2e mock server runs on port 8299.
// Uses PVR source modules; the appended hooks exist only in intercepted responses.
import { chromium } from '../../../crates/strivo-web/e2e/node_modules/playwright/index.mjs';
import { readFile, readdir } from 'node:fs/promises';
const base = new URL('../../../crates/strivo-web/assets/', import.meta.url);
async function bundle(dir, suffix) {
  const names = (await readdir(new URL(dir, base))).filter(n => n.endsWith(suffix)).sort();
  return (await Promise.all(names.map(n => readFile(new URL(`${dir}${n}`, base), 'utf8')))).join('\n');
}
const js = await bundle('spa/', '-pvr.js');
const css = await bundle('spa-css/', '-pvr.css');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:900}});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('strivo-tour-done','1'));
await page.route('**/api/v1/settings', async r => {
  const response=await r.fetch();const body=await response.json();
  await r.fulfill({response,json:{...body,creator_enabled:false}});
});
// The mock does not give SVG assets their production MIME type.
await page.route('**/assets/**/*.svg', async r => {
  const response=await r.fetch();await r.fulfill({response,contentType:'image/svg+xml'});
});
await page.route('**/assets/spa.js*', r => r.fulfill({contentType:'application/javascript',body:js + '\nwindow.audit={API,events,paintRecordings,makeRecordingController};'}));
await page.route('**/assets/spa.css*', r => r.fulfill({contentType:'text/css',body:css}));
await page.goto('http://localhost:8299/app#/recordings');
await page.locator('#rec-body tr[data-rec-row]').first().waitFor();
const results = {source:'PVR source bundle / deterministic mock / Chromium',errors};
results.initial = await page.evaluate(() => ({rows:document.querySelectorAll('[data-rec-row]').length,railRows:document.querySelectorAll('.ch-row').length,count:document.querySelector('#rec-count').textContent}));
// Full-list repaint: focus and open menu continuity; synchronous work only.
await page.locator('[data-action=rec-menu-toggle]').first().click();
results.repaint = await page.evaluate(() => {
  const old = document.querySelector('[data-rec-row]');
  const button = old.querySelector('[data-action=rec-menu-toggle]'); button.focus();
  const samples=[];
  for(let i=0;i<10;i++){const t=performance.now();audit.paintRecordings();samples.push(performance.now()-t);}
  return {oldRowConnected:old.isConnected,focusedElement:document.activeElement.tagName,openMenus:document.querySelectorAll('.rec-row-menu-list:not([hidden])').length,synchronousMs:samples};
});
// A stale recordings response must not replace a newer settings route.
let release;
const gate = new Promise(resolve => release=resolve);
let enteredResolve;
const entered = new Promise(resolve => enteredResolve=resolve);
await page.evaluate(() => {location.hash='#/library';});
await page.locator('#dash').waitFor();
await page.evaluate(() => audit.API.invalidate());
await page.route('**/api/v1/recordings?*', async r => {enteredResolve(); await gate; await r.continue();});
await page.evaluate(() => {location.hash='#/recordings';});
await entered;
await page.evaluate(() => {location.hash='#/settings';});
await page.waitForFunction(() => document.querySelector('.page-title')?.textContent.includes('Settings'));
release();
await page.waitForFunction(() => !!document.querySelector('#rec-body'));
results.routeRace = await page.evaluate(() => ({hash:location.hash,title:document.querySelector('.page-title')?.textContent}));
await page.unroute('**/api/v1/recordings?*');
// Idle poster: preload=none should not be diagnosed as a corrupt file.
results.idlePlayer = await page.evaluate(async () => {
  const host=document.createElement('div');document.body.append(host);
  const ctl=audit.makeRecordingController({playing:false,src:'/api/v1/recordings/idle/download'});
  ctl.mount(host);
  await new Promise(resolve=>setTimeout(resolve,15500));
  const result={preload:ctl.root.preload,paused:ctl.root.paused,error:host.querySelector('.ms-media-error')?.textContent};
  ctl.destroy();host.remove();return result;
});
// Observe home navigation with 150 ms of injected latency per API request.
const requests=[];
await page.evaluate(() => audit.API.invalidate());
const navStart=Date.now();
await page.route('**/api/v1/**',async r=>{
  requests.push({path:new URL(r.request().url()).pathname,startMs:Date.now()-navStart});
  await new Promise(resolve=>setTimeout(resolve,150)); await r.fallback();
});
await page.evaluate(()=>{location.hash='#/library';});
await page.locator('#dash').waitFor();
results.delayedHome={injectedLatencyMs:150,untilDashboardMs:Date.now()-navStart,requests};
await page.unroute('**/api/v1/**');
await page.screenshot({path:new URL('library.png',import.meta.url).pathname});
await page.evaluate(()=>{location.hash='#/recordings';});
await page.locator('#rec-body').waitFor();
await page.locator('#rec-load-more').click();
await page.waitForFunction(()=>document.querySelector('#rec-count').textContent.includes('502 recordings'));
await page.evaluate(()=>{
  audit.API.invalidate();
  audit.events.listeners.forEach(fn=>fn({RecordingFinished:{job_id:'audit-finished'}}));
});
await page.waitForFunction(()=>document.querySelector('#rec-count').textContent.includes('500 recordings'));
results.lifecyclePagination={afterLoadMore:502,afterFinishedEvent:500};
// CPU throttle is a relative stress check, not a hardware benchmark.
const cdp=await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
results.throttledRepaint = await page.evaluate(()=>{
  const samples=[];for(let i=0;i<5;i++){const t=performance.now();audit.paintRecordings();document.querySelector('#rec-body').getBoundingClientRect();samples.push(performance.now()-t);}return {cpuRate:4,jsAndForcedLayoutMs:samples};
});
await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
await page.screenshot({path:new URL('recordings.png',import.meta.url).pathname});
console.log(JSON.stringify(results,null,2));
await browser.close();
