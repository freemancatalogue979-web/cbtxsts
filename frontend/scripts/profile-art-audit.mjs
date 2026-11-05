#!/usr/bin/env node
/** 3D profile artwork regression. Disposable API DB only; creates two accounts. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
const base=process.env.VISUAL_BASE_URL || 'http://127.0.0.1:5173';
const out=new URL('../test-results/profile-art/',import.meta.url);
await mkdir(out,{recursive:true});
const launch={headless:true};
if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) launch.executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if(process.env.PLAYWRIGHT_CHROMIUM_ARGS) launch.args=JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS);
const browser=await chromium.launch(launch);
const errors=[];
async function account(i){
  const suffix=`${Date.now().toString().slice(-8)}${i}`;
  const res=await fetch(`${base}/api/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:`art${suffix}`,phone:`08${suffix}`,password:'art-audit-pass',display_name:`World Explorer ${i}`})});
  assert(res.ok);return res.json();
}
async function pageFor(account){
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.url().includes('/profile-scenes/')&&r.status()>=400) errors.push(`Failed artwork: ${r.url()}`);});
  await page.addInitScript(account=>{for(const[k,v]of Object.entries({'arena.token':account.token,'arena.slot.student':account.token,'arena.role':'student','arena.mode':'normal','arena.skin':'day','arena.music':'off','arena.sound':'off'}))localStorage.setItem(k,v);},account);
  return page;
}
try{
  const owner=await account(1), viewer=await account(2);
  const page=await pageFor(owner);
  await page.goto(`${base}/#/profile`);
  const hero=page.locator('.card:has(> .profile-scenery:not([data-preview]))');
  const scene=hero.locator('.profile-scenery');
  for(const[id,name]of [['space','Starlit space'],['volcano','Volcanic dusk'],['forest','Living forest'],['ocean','Ocean depths'],['academy','Royal academy'],['city','Neon city']]){
    await page.getByRole('button',{name,exact:true}).click();
    await page.waitForFunction(id=>document.querySelector('.profile-scenery:not([data-preview])')?.dataset.scene===id,id);
    const art=scene.locator('.profile-scene-art');
    await art.evaluate(img=>img.decode());
    assert((await art.getAttribute('src')).endsWith(`${id}.webp`));
    assert.equal(await scene.getAttribute('data-art'),'true');
    await hero.screenshot({path:fileURLToPath(new URL(`${id}-hero.png`,out))});
  }
  // Tiny selectors use separate low-bandwidth thumbnails, not six full wallpapers.
  for(const art of await page.locator('[data-preview] .profile-scene-art').all()){
    await art.scrollIntoViewIfNeeded();await art.evaluate(img=>img.decode());
    assert((await art.getAttribute('src')).endsWith('-thumb.webp'));
  }
  assert.notEqual(await scene.locator('.profile-scene-art').evaluate(n=>getComputedStyle(n).animationName),'none', 'enabled wallpaper does not animate');
  await page.getByRole('button',{name:'Starlit space',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.profile-scenery:not([data-preview])')?.dataset.scene==='space');
  const publicPage=await pageFor(viewer);
  await publicPage.goto(base,{waitUntil:'networkidle'});
  await publicPage.evaluate(id=>window.dispatchEvent(new CustomEvent('ag:player',{detail:{id}})),owner.profile.id);
  await publicPage.getByRole('dialog').waitFor();
  await publicPage.locator('.profile-showcase .profile-scene-art').evaluate(img=>img.decode());
  for(const width of [320,390,768,1280]){
    await publicPage.setViewportSize({width,height:844});
    for(const skin of ['day','night']){
      await publicPage.evaluate(skin=>document.documentElement.dataset.skin=skin,skin);
      assert(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'profile overflow');
      await publicPage.screenshot({path:fileURLToPath(new URL(`public-${width}-${skin}.png`,out))});
    }
  }
  await publicPage.emulateMedia({reducedMotion:'reduce'});
  const animations=await publicPage.locator('.profile-showcase .profile-scenery').evaluate(root=>[...root.querySelectorAll('*')].map(n=>getComputedStyle(n).animationName));
  assert(animations.every(name=>name==='none'),'OS reduced motion did not stop all wallpaper layers');
  const saving=page.waitForResponse(r=>r.url().endsWith('/api/me')&&r.request().method()==='PATCH');
  await page.getByLabel('Animate scenery').uncheck();await saving;
  await page.reload();await scene.waitFor();
  assert.equal(await scene.getAttribute('data-motion'),'off');
  assert.equal(await scene.locator('.profile-scene-art').evaluate(n=>getComputedStyle(n).animationName),'none');
  // Render all four legitimate lifetime tiers to inspect crest differentiation.
  // This fixture does not modify player progression or invent earned ranks.
  const fixture=new URL('rank-fixture.mjs',out);
  await build({stdin:{contents:`export {OverallRankPlate} from './src/components/ProfileScenery.tsx';`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'tsx'},outfile:fileURLToPath(fixture),bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom','lucide-react']});
  const{OverallRankPlate}=await import(fixture.href);
  const markup=renderToStaticMarkup(createElement('div',{style:{display:'grid',gap:16}},...['bronze','silver','gold','platinum'].map((tier,i)=>createElement(OverallRankPlate,{key:tier,tier,level:[1,20,40,60][i]}))));
  const styles=await publicPage.locator('link[rel="stylesheet"]').evaluateAll(nodes=>nodes.map(n=>n.outerHTML).join(''));
  await publicPage.setContent(`<!doctype html><html data-skin="day"><head>${styles}</head><body style="padding:16px"><main style="display:grid;gap:16px;max-width:450px;margin:auto">${markup}</main></body></html>`);
  const ids=await publicPage.locator('svg [id]').evaluateAll(nodes=>nodes.map(n=>n.id));
  assert.equal(new Set(ids).size,ids.length,'crest gradient IDs collide');
  assert.equal(await publicPage.locator('.rank-crest').count(),4);
  await publicPage.setViewportSize({width:390,height:844});
  await publicPage.screenshot({path:fileURLToPath(new URL('rank-metals-day.png',out))});
  await publicPage.evaluate(()=>document.documentElement.dataset.skin='night');
  await publicPage.screenshot({path:fileURLToPath(new URL('rank-metals-night.png',out))});
  assert.deepEqual(errors,[]);
  console.log('Six local 3D scenes, thumbnail loading, public/mobile/day-night layouts, motion preferences and four crest metals passed.');
}finally{await browser.close();}
