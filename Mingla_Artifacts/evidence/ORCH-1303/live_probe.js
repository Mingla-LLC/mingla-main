const { chromium, devices } = require('playwright');
const EV = "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1303-[rsvp-page-interactionmanager-starvation]/Mingla_Artifacts/evidence/ORCH-1303";
const URL = "https://business.usemingla.com/e/smokerhythm/july-4th-bbq-pool-party";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => console.log('goto:', e.message));
  await page.waitForTimeout(3500);

  // (1) event-loop liveness on the live page
  const loop = await page.evaluate(() => new Promise(res => {
    let st = false, raf = false;
    setTimeout(() => { st = true; }, 50);
    requestAnimationFrame(() => { raf = true; });
    setTimeout(() => res({ setTimeout: st, requestAnimationFrame: raf }), 400);
  }));

  // (2) is the momentum/decision surface mounted on this deploy?
  const surface = await page.evaluate(() => {
    const txt = document.body.innerText || "";
    const hit = (re) => re.test(txt);
    return {
      bodyLen: txt.length,
      going: hit(/going/i),
      maybe: hit(/maybe/i),
      cantGo: hit(/can'?t go|can't/i),
      spotsOrGuests: hit(/spot|guest|going/i),
    };
  });

  await page.screenshot({ path: `${EV}/live-01-rsvp-page-chromium-iphone13.png`, fullPage: false });
  console.log(JSON.stringify({ url: URL, loop, surface }, null, 2));
  await browser.close();
})();
