import { chromium } from 'playwright';
const IOS_UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const out=[];
const rec=(n,p,d)=>{out.push({n,p,d});console.log(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`)};
const b=await chromium.launch();

// reduced-motion context
const c=await b.newContext({userAgent:IOS_UA,viewport:{width:430,height:900},reducedMotion:'reduce'});
const p=await c.newPage();
await p.goto('http://localhost:3216',{waitUntil:'networkidle'});
const cookie=p.locator('div[role="dialog"][aria-label="Cookie consent"]');
if(await cookie.count()){try{await cookie.getByRole('button').first().click({timeout:1500});}catch{}}

// scroll-lock: body overflow before/after open
const beforeOverflow=await p.evaluate(()=>getComputedStyle(document.body).overflow);
await p.getByRole('button',{name:'Get the app',exact:true}).first().click();
const d=p.locator('div[role="dialog"][aria-modal="true"]');
await d.waitFor({state:'visible'});
const lockedOverflow=await p.evaluate(()=>document.body.style.overflow);
rec('scroll-lock applied while open', lockedOverflow==='hidden', `body.style.overflow="${lockedOverflow}"`);

// dialog a11y attributes
const attrs=await d.evaluate(el=>({modal:el.getAttribute('aria-modal'),labelled:el.getAttribute('aria-labelledby'),role:el.getAttribute('role')}));
rec('dialog has role=dialog aria-modal aria-labelledby', attrs.role==='dialog'&&attrs.modal==='true'&&!!attrs.labelled, JSON.stringify(attrs));

// progressbar present
const pb=await d.locator('[role="progressbar"]').count();
rec('progressbar present', pb>0, `count=${pb}`);

// radiogroup present on step 1
const rg=await d.locator('[role="radiogroup"]').count();
rec('radiogroup present (step 1)', rg>0, `count=${rg}`);

// focus trap: focus first focusable, Shift+Tab should wrap to last (stay in panel)
await p.keyboard.press('Tab');
let inside=await p.evaluate(()=>{const dlg=document.querySelector('div[role="dialog"][aria-modal="true"]');return dlg && dlg.contains(document.activeElement)});
rec('focus stays within panel after Tab', !!inside, '');
await p.keyboard.press('Shift+Tab');
await p.keyboard.press('Shift+Tab');
inside=await p.evaluate(()=>{const dlg=document.querySelector('div[role="dialog"][aria-modal="true"]');return dlg && dlg.contains(document.activeElement)});
rec('focus trapped on Shift+Tab wrap', !!inside, '');

// ESC closes
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
const open=await p.locator('div[role="dialog"][aria-modal="true"]').count();
rec('ESC closes the modal', open===0, `dialogCount=${open}`);

await b.close();
const f=out.filter(x=>!x.p);
console.log(`\n===== A11Y: ${out.length-f.length}/${out.length} PASS =====`);
if(f.length)process.exit(1);
