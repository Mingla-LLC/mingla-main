import { chromium } from 'playwright';
const IOS_UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const out=[];const rec=(n,p,d)=>{out.push({n,p,d});console.log(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`)};
const b=await chromium.launch();
const c=await b.newContext({userAgent:IOS_UA,viewport:{width:430,height:900}});
const p=await c.newPage();

// --- SC-6: submit gating ---
await p.goto('http://localhost:3216',{waitUntil:'networkidle'});
const cookie=p.locator('div[role="dialog"][aria-label="Cookie consent"]');
if(await cookie.count()){try{await cookie.getByRole('button').first().click({timeout:1500});}catch{}}
await p.getByRole('button',{name:'Get the app',exact:true}).first().click();
const d=p.locator('div[role="dialog"][aria-modal="true"]');
await d.waitFor({state:'visible'});
// Next disabled until a chip picked
const nextDisabled0=await d.getByRole('button',{name:'Next'}).isDisabled();
rec('SC-2: Next disabled before chip pick', nextDisabled0, '');
await d.getByRole('radio',{name:'Events'}).focus();await p.keyboard.press('Enter');
const nextEnabled=await d.getByRole('button',{name:'Next'}).isEnabled();
rec('SC-2: Next enabled after chip pick', nextEnabled, '');
await d.getByRole('button',{name:'Next'}).click();
await d.getByLabel('Your name').waitFor({state:'visible'});
// Submit disabled with empty fields
const sub=()=>d.getByRole('button',{name:'Get the app'});
rec('SC-6: submit disabled (empty fields)', await sub().isDisabled(), '');
await d.getByLabel('Your name').fill('Ada');
await d.getByLabel('Email',{exact:true}).fill('bad-email');
await d.getByLabel('City',{exact:true}).fill('Lagos');
rec('SC-6: submit disabled (invalid email)', await sub().isDisabled(), '');
await d.getByLabel('Email',{exact:true}).fill('ada@example.com');
rec('SC-6: submit disabled (consent unchecked)', await sub().isDisabled(), '');
await d.getByRole('checkbox').check();
rec('SC-6: submit ENABLED (all valid + consent)', await sub().isEnabled(), '');

// --- T-13: organiser page mounts BetaAccessModal, not GetTheAppModal ---
await p.goto('http://localhost:3216/organisers',{waitUntil:'networkidle'});
if(await cookie.count()){try{await cookie.getByRole('button').first().click({timeout:1500});}catch{}}
const getAppBtn=await p.getByRole('button',{name:'Get the app',exact:true}).count();
const betaBtn=await p.getByRole('button',{name:'Get Beta Access',exact:true}).count();
rec('T-13: organiser shows "Get Beta Access" CTA, not "Get the app"', betaBtn>0 && getAppBtn===0, `beta=${betaBtn} getapp=${getAppBtn}`);
// open beta modal, assert NO testflight token anywhere even on its success-less open
if(betaBtn>0){
  await p.getByRole('button',{name:'Get Beta Access',exact:true}).first().click();
  await p.waitForTimeout(400);
  const tf=await p.evaluate(()=>document.documentElement.outerHTML.includes('testflight.apple.com'));
  rec('T-13: organiser BetaAccessModal carries NO TestFlight token', !tf, `tf=${tf}`);
}
await b.close();
const f=out.filter(x=>!x.p);console.log(`\n===== GATE/REGRESSION: ${out.length-f.length}/${out.length} PASS =====`);
if(f.length)process.exit(1);
