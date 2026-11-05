#!/usr/bin/env node
/** Test DB only: country persistence, real touch profile access and World Map UI. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const base=process.env.VISUAL_BASE_URL || 'http://127.0.0.1:5173';
const out=new URL('../test-results/country-world/',import.meta.url);await mkdir(out,{recursive:true});
const opts={headless:true};
if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)opts.executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if(process.env.PLAYWRIGHT_CHROMIUM_ARGS)opts.args=JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS);
const browser=await chromium.launch(opts), errors=[];
async function request(path,account,body,method){const r=await fetch(`${base}/api${path}`,{method:method||(body===undefined?'GET':'POST'),headers:{'content-type':'application/json',...(account?{authorization:`Bearer ${account.token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(r.ok,`${path}: ${r.status}`);return r.json();}
async function account(i){const x=`${Date.now().toString().slice(-8)}${i}`;return request('/auth/register',null,{username:`world${x}`,phone:`08${x}`,password:'audit-world-pass',display_name:`Country Player ${i}`});}
async function pageFor(a){const p=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(a=>{for(const[k,v]of Object.entries({'arena.token':a.token,'arena.role':'student','arena.slot.student':a.token,'arena.mode':'normal','arena.skin':'day','arena.music':'off','arena.sound':'off'}))localStorage.setItem(k,v);},a);return p;}
try{
 const owner=await account(1),viewer=await account(2);
 const p=await pageFor(owner);await p.goto(`${base}/#/profile`);
 const picker=p.getByRole('button',{name:'Country flag',exact:true});await picker.waitFor();
 await picker.click();assert.equal(await p.getByRole('option').count(),250);
 await p.getByRole('textbox',{name:'Search options'}).fill('Nigeria');
 await p.getByRole('option',{name:'Nigeria',exact:true}).click();
 const saving=p.waitForResponse(r=>r.url().endsWith('/api/me')&&r.request().method()==='PATCH');
 await p.getByRole('button',{name:'Save card',exact:true}).click();await saving;
 await p.reload();await picker.waitFor();assert((await picker.textContent()).includes('Nigeria'));
 const flag=p.locator('img[src="/flags/ng.svg"]').first();await flag.scrollIntoViewIfNeeded();await flag.evaluate(img=>img.decode());
 const invalid=await fetch(`${base}/api/me`,{method:'PATCH',headers:{'content-type':'application/json',authorization:`Bearer ${owner.token}`},body:JSON.stringify({country:'ZZ'})});assert.equal(invalid.status,422);assert.equal((await request('/me',owner)).country,'NG');
 for(const code of ['ng','us','gb','jp','br','za']){const r=await fetch(`${base}/flags/${code}.svg`);assert(r.ok);assert((await r.text()).includes('<svg'));}
 await request('/friends',viewer,{student_id:owner.profile.id});
 const v=await pageFor(viewer);await v.goto(`${base}/#/friends`);
 // Real touch taps on a button nested in a hold surface must not be retargeted.
 await v.getByRole('button',{name:"View Country Player 1's profile",exact:true}).tap();
 const dialog=v.getByRole('dialog',{name:/Public profile/});await dialog.waitFor();
 await dialog.getByRole('img',{name:'Nigeria flag',exact:true}).evaluate(img=>img.decode());
 await dialog.getByRole('navigation',{name:'Player profile sections'}).getByRole('button',{name:'Highlights',exact:true}).click();
 await v.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Recent public history');
 await v.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 await v.getByRole('button').filter({has:v.getByText('Country Player 1',{exact:true})}).first().tap();
 await v.getByPlaceholder('Message Country…').waitFor();
 await v.getByRole('button').filter({has:v.getByText('Country Player 1',{exact:true})}).first().tap();await dialog.waitFor();
 await v.screenshot({path:fileURLToPath(new URL('friend-dossier-country.png',out))});
 await v.keyboard.press('Escape');
 const group=await request('/groups',owner,{name:'Country dossier group'});await request(`/groups/join/${group.code}`,viewer,{});
 await v.goto(`${base}/#/group/${group.id}/members`);
 await v.getByRole('button').filter({has:v.getByText('Country Player 1',{exact:true})}).first().tap();
 await v.getByRole('button',{name:'View full player profile',exact:true}).tap();await dialog.waitFor();
 await dialog.getByRole('img',{name:'Nigeria flag',exact:true}).evaluate(img=>img.decode());
 await p.goto(`${base}/#/map`);await p.getByRole('heading',{name:'World map',exact:true}).waitFor();
 assert(await p.evaluate(()=>scrollY<3),'direct hash navigation kept the previous page scroll offset');
 const worlds=await request('/arena/world-map',owner);
 const biomeButtons=p.locator('button.wm-biome');assert.equal(await biomeButtons.count(),worlds.worlds.length);
 for(let i=0;i<worlds.worlds.length;i++){
   await biomeButtons.nth(i).click();assert.equal(await biomeButtons.nth(i).getAttribute('aria-pressed'),'true');
   await p.locator('.wm-hero .profile-scene-art').evaluate(img=>img.decode());
   assert.equal(await p.locator('.wm-path-panel h2').textContent(),worlds.worlds[i].title);
 }
 for(const width of [320,390,768,1280]){
   await p.setViewportSize({width,height:844});await p.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
   for(const skin of ['day','night']){await p.evaluate(skin=>document.documentElement.dataset.skin=skin,skin);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),`map overflow at ${width}`);await p.screenshot({path:fileURLToPath(new URL(`map-${width}-${skin}.png`,out))});}
 }
 await p.locator('button.wm-node').first().click();await p.getByRole('dialog').waitFor();await p.getByRole('dialog').getByText('Questions',{exact:true}).waitFor();
 await p.keyboard.press('Escape');
 assert.deepEqual(errors,[]);console.log('249-country selection, real SVG flags, persistence/validation, touch profile/chat access, dossier navigation and World Map biomes/locations/layouts passed.');
}catch(error){for(const context of browser.contexts())for(const page of context.pages()){if(page.url().includes('#/map')){console.log('Map debug:',(await page.locator('body').innerText()).slice(0,1800));console.log('Browser errors:',errors);await page.screenshot({path:fileURLToPath(new URL('map-error.png',out))});}}throw error;}finally{await browser.close();}
