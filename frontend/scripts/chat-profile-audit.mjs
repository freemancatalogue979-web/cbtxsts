#!/usr/bin/env node
/** Real browser regression; writes throwaway accounts to a TEST database only. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const base = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:5173';
const out = new URL('../test-results/chat-profile/', import.meta.url);
await mkdir(out, {recursive:true});
const options = {headless:true};
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (process.env.PLAYWRIGHT_CHROMIUM_ARGS) options.args = JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS);
const browser = await chromium.launch(options);
const errors = [];
async function api(path, account, body, method) {
  const response = await fetch(`${base}/api${path}`, {method:method || (body === undefined ? 'GET':'POST'), headers:{'content-type':'application/json',...(account?{authorization:`Bearer ${account.token}`}:{})}, ...(body === undefined?{}:{body:JSON.stringify(body)})});
  assert(response.ok, `${path}: ${response.status} ${!response.ok ? await response.text():''}`);
  return response.json();
}
async function account(i) {
  const suffix = `${Date.now().toString().slice(-8)}${i}`;
  return api('/auth/register', null, {username:`chat${suffix}`,phone:`08${suffix}`,password:'audit-chat-pass',display_name:`Chat Tester ${i}`});
}
async function pageFor(account, width=390, skin='day') {
  const page = await browser.newPage({viewport:{width,height:844},hasTouch:true,serviceWorkers:'block'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({account,skin})=>{
    for (const [key,value] of Object.entries({'arena.token':account.token,'arena.slot.student':account.token,'arena.role':'student','arena.mode':'normal','arena.skin':skin,'arena.music':'off','arena.sound':'off'})) localStorage.setItem(key,value);
  },{account,skin});
  return page;
}
async function hold(page, target) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+Math.min(box.width/2,80),y:box.y+box.height/2}]});
  await page.waitForTimeout(750);
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await client.detach();
  await page.getByRole('menu').waitFor();
}
async function contained(page) {
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+2),'page overflows phone width');
}
try {
  const host=await account(1), peer=await account(2);
  await api('/friends',host,{student_id:peer.profile.id});
  const group=await api('/groups',host,{name:'Chat parity audit'});
  await api(`/groups/join/${group.code}`,peer,{});
  const dm=await api('/chat',peer,{to:host.profile.id,body:'Incoming parity message'});
  const gm=await api(`/groups/${group.id}/messages`,peer,{body:'Incoming parity message'});
  const layouts=[];
  for (const mode of ['group','friends','messages']) {
    const page=await pageFor(host);
    const emoji = mode==='messages' ? '✅' : '🔥';
    console.log(`Testing ${mode} chat…`);
    if (mode==='group') await page.goto(`${base}/#/group/${group.id}/chat`);
    else if (mode==='friends') {
      await page.goto(`${base}/#/friends`);
      await page.getByRole('button').filter({has:page.getByText('Chat Tester 2',{exact:true})}).first().click();
    } else {
      await page.addInitScript(id=>sessionStorage.setItem('ag.msg.with',String(id)),peer.profile.id);
      await page.goto(`${base}/#/messages`);
    }
    const row=page.locator(`[data-chat-row][data-mid="${mode==='group'?gm.id:dm.id}"]`);
    await row.waitFor();
    const bubble=row.getByText('Incoming parity message',{exact:true});
    layouts.push(await bubble.evaluate(node=>{const s=getComputedStyle(node.closest('[data-chat-bubble]'));return {radius:s.borderRadius,font:s.fontSize,line:s.lineHeight,padding:s.padding};}));
    await hold(page,bubble);
    await page.getByRole('menuitem',{name:'React',exact:true}).click();
    await row.getByRole('button',{name:`React with ${emoji}`,exact:true}).click();
    await row.getByRole('button',{name:new RegExp(`Remove ${emoji} reaction`)}).waitFor();
    await hold(page,bubble);
    await page.getByRole('menuitem',{name:'Reply',exact:true}).click();
    const composer= mode==='messages' ? page.getByRole('textbox',{name:'Message',exact:true}) : page.getByPlaceholder(/^(Message|Reply to)/).last();
    await composer.fill(`Reply from ${mode}`);
    const sent=page.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith(mode==='group'?`/groups/${group.id}/messages`:'/chat'));
    if (mode==='messages') await page.getByRole('button',{name:'Send',exact:true}).click();
    else await composer.press('Enter');
    const own=await (await sent).json();
    const ownRow=page.locator(`[data-chat-row][data-mid="${own.id}"]`);
    await ownRow.getByText(`Reply from ${mode}`,{exact:true}).waitFor();
    await hold(page,ownRow.getByText(`Reply from ${mode}`,{exact:true}));
    await page.getByRole('menuitem',{name:'Edit',exact:true}).click();
    const editor=mode==='group'?ownRow.getByRole('textbox'):mode==='friends'?page.getByPlaceholder('Update your message…'):page.getByRole('textbox',{name:'Edit message',exact:true});
    await editor.fill(`Edited ${mode} reply`);
    const edited=page.waitForResponse(r=>r.request().method()==='PATCH' && r.url().endsWith(mode==='group'?`/messages/${own.id}`:`/chat/${own.id}`));
    if (mode==='messages') await page.getByRole('button',{name:'Save edit',exact:true}).click();
    else await editor.press('Enter');
    await edited;
    await ownRow.getByText(`Edited ${mode} reply`,{exact:true}).waitFor();
    for (const width of [320,390,768]) {
      await page.setViewportSize({width,height:844});
      for (const skin of ['day','night']) {
        await page.evaluate(skin=>document.documentElement.dataset.skin=skin,skin);
        await contained(page);
        await page.screenshot({path:fileURLToPath(new URL(`${mode}-${width}-${skin}.png`,out))});
      }
    }
    await page.screenshot({path:fileURLToPath(new URL(`${mode}-reply.png`,out))});
    await page.close();
  }
  assert.deepEqual(layouts[0],layouts[1],'Friends bubble differs from Study Groups');
  assert.deepEqual(layouts[0],layouts[2],'Teacher Messages bubble differs from Study Groups');
  console.log('Shared chat layouts, real touch holds, reactions, replies and edits passed in all three renderers.');

  const profilePage=await pageFor(peer);
  await profilePage.goto(`${base}/#/profile`);
  const backdrop=profilePage.getByRole('region',{name:'Profile backdrop customization'});
  await backdrop.getByRole('button',{name:'Living forest',exact:true}).click();
  await profilePage.waitForFunction(()=>document.querySelector('[aria-label="Profile scenes"] button[aria-pressed="true"]')?.textContent.includes('Living forest'));
  const savedMotion=profilePage.waitForResponse(r=>r.url().endsWith('/api/me') && r.request().method()==='PATCH');
  await backdrop.getByLabel('Animate scenery').uncheck();
  await savedMotion;
  await profilePage.reload();
  await profilePage.getByRole('button',{name:'Living forest',exact:true}).waitFor();
  assert.equal(await profilePage.getByRole('button',{name:'Living forest',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await profilePage.getByLabel('Animate scenery').isChecked(),false);
  const png=await profilePage.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='#19466a';ctx.fillRect(0,0,100,100);return c.toDataURL('image/png').split(',')[1];});
  await profilePage.locator('section[aria-label="Profile backdrop customization"] input[type="file"]').setInputFiles({name:'banner.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await profilePage.getByRole('button',{name:'Remove banner',exact:true}).waitFor();
  const visitor=await pageFor(host);
  await visitor.goto(base,{waitUntil:'networkidle'});
  await visitor.evaluate(id=>window.dispatchEvent(new CustomEvent('ag:player',{detail:{id}})),peer.profile.id);
  await visitor.locator('.profile-showcase .profile-backdrop-image').waitFor();
  assert.equal(await visitor.locator('.profile-showcase .profile-scenery').getAttribute('data-motion'),'off');
  await contained(visitor);
  await visitor.screenshot({path:fileURLToPath(new URL('public-uploaded-banner.png',out))});
  const unauthorized=await fetch(`${base}/api/players/${peer.profile.id}/banner`);
  assert.equal(unauthorized.status,401);
  await profilePage.getByRole('button',{name:'Remove banner',exact:true}).click();
  await profilePage.getByRole('button',{name:'Remove banner',exact:true}).waitFor({state:'hidden'});
  const saved=await api('/me',peer);
  assert.equal(saved.has_banner,false);
  assert.equal(saved.profile_banner,'forest');
  assert.equal(saved.profile_motion,false);
  // Replacing an existing avatar must invalidate both the object-URL cache
  // and any previous HTTP response, not only the first upload's has-photo flag.
  const photoInput=profilePage.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').first();
  const firstUpload=profilePage.waitForResponse(r=>r.url().endsWith('/api/me/photo') && r.request().method()==='POST');
  await photoInput.setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await firstUpload;
  const avatar=profilePage.getByRole('button',{name:'Upload a profile photo',exact:true}).locator('..').locator('img');
  await avatar.waitFor();
  const oldPhoto=await avatar.getAttribute('src');
  const red=await profilePage.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=40;const ctx=c.getContext('2d');ctx.fillStyle='#ee2222';ctx.fillRect(0,0,40,40);return c.toDataURL('image/png').split(',')[1];});
  const secondUpload=profilePage.waitForResponse(r=>r.url().endsWith('/api/me/photo') && r.request().method()==='POST');
  await photoInput.setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:Buffer.from(red,'base64')});
  await secondUpload;
  await profilePage.waitForFunction(old=>{const img=document.querySelector('[aria-label="Upload a profile photo"]').parentElement.querySelector('img');return img?.complete && img.src!==old;},oldPhoto);
  const pixel=await avatar.evaluate(img=>{const c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(img,0,0,1,1);return [...c.getContext('2d').getImageData(0,0,1,1).data];});
  assert(pixel[0]>200 && pixel[2]<100, 'replacement photo still displays stale pixels');
  await profilePage.close();await visitor.close();
  assert.deepEqual(errors,[]);
  console.log('Profile scenes/motion persistence, image upload/removal and authenticated public backdrop and photo replacement passed.');
} finally {await browser.close();}
