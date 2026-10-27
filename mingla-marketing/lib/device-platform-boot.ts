// #4137 F-7 — the pre-hydration device boot script.
//
// Before this, a phone saw the computer label ("Use Mingla Web" + arrow) and the
// computer href from first paint until React hydrated, and a tap in that window
// landed on the computer destination with no install attribution. This inline
// script runs in <head> before any paint:
//
//   1. It resolves the platform EXACTLY like `resolvePlatform` in
//      lib/device-platform.ts (classic iOS UA, iPadOS "MacIntel" with touch,
//      then Android) and writes it to <html data-platform>. Global CSS in
//      app/globals.css then shows the phone label and store mark from the very
//      first paint, so there is no flicker.
//   2. On a phone it listens in the CAPTURE phase for click, auxclick,
//      contextmenu and touchstart, and points any `a[data-cta-phone-href]` at its
//      phone href before the browser acts, so a pre-hydration tap (or long-press
//      "copy link") gets the attributed OneLink.
//   3. Everything is inside try/catch: on any failure the anchor keeps its
//      computer href, which is a safe destination on every device.
//
// Parity with resolvePlatform is pinned by the node:vm fixture table in
// scripts/issue-4137-cta-destinations.implementor.happy.test.mjs (AC-D9).

export const DEVICE_PLATFORM_BOOT_SCRIPT =
  "(function(){try{var n=navigator,u=n.userAgent||'',m=n.maxTouchPoints||0," +
  "p=/iPad|iPhone|iPod/.test(u)||(n.platform==='MacIntel'&&m>1)?'ios':/android/i.test(u)?'android':'other'," +
  "d=document;d.documentElement.setAttribute('data-platform',p);if(p==='other')return;" +
  "var f=function(e){try{var t=e.target,a=t&&t.closest?t.closest('a[data-cta-phone-href]'):null;" +
  "if(a)a.setAttribute('href',a.getAttribute('data-cta-phone-href'))}catch(x){}};" +
  "['click','auxclick','contextmenu','touchstart'].forEach(function(k){d.addEventListener(k,f,{capture:true,passive:true})})" +
  "}catch(e){}})()"
