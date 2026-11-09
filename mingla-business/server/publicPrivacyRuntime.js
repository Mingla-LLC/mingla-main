// #2331 — the one privacy reader every server-rendered buyer page inlines.
//
// I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF: analytics and ads are each on unless
// this visitor turned it off. The saved choice is `mingla_privacy_v2`
// ({ analytics, ads, ts }); the legacy `mingla_consent_v1` record is read as
// denied → both off, granted → both on. A same-document choice
// (`window.__minglaPrebootPrivacy`) wins. Global Privacy Control starts ads
// off until the visitor saves ads on. Anything unreadable counts as "not
// chosen" (both on, ads off under GPC) — never as a turn-off of its own.
//
// `__minglaPrivacy()` returns the saved choice or null;
// `__minglaPrivacyOn("analytics" | "ads")` returns the live state.

const PRIVACY_STORAGE_KEY = "mingla_privacy_v2";
const LEGACY_CONSENT_STORAGE_KEY = "mingla_consent_v1";

const privacyReaderSource = () => [
  "function __minglaPrivacyValid(v){return!!v&&typeof v===\"object\"&&typeof v.analytics===\"boolean\"&&typeof v.ads===\"boolean\";}",
  "function __minglaPrivacy(){try{var w=typeof window!==\"undefined\"?window:{},p=w.__minglaPrebootPrivacy;if(__minglaPrivacyValid(p))return p;",
  `var g=typeof globalThis!=="undefined"?globalThis:null,ls=typeof localStorage!=="undefined"?localStorage:null;`,
  `var st=w!==g&&w.localStorage?w.localStorage:(ls||w.localStorage);`,
  "if(!st||typeof st.getItem!==\"function\")return null;",
  `var r=st.getItem(${JSON.stringify(PRIVACY_STORAGE_KEY)});if(r!==null){var v=JSON.parse(r);if(__minglaPrivacyValid(v))return v;}`,
  `var l=st.getItem(${JSON.stringify(LEGACY_CONSENT_STORAGE_KEY)});if(l!==null){var c=l;try{var o=JSON.parse(l);c=o&&typeof o==="object"?(o.choice||o.value):o;}catch(_){}`,
  "if(c===\"granted\"||c===\"denied\")return{analytics:c===\"granted\",ads:c===\"granted\",ts:0};}}catch(_){}return null;}",
  "function __minglaPrivacyOn(kind){var s=__minglaPrivacy();if(s!==null)return kind===\"ads\"?s.ads===true:s.analytics===true;",
  "if(kind===\"ads\")return!(typeof navigator!==\"undefined\"&&navigator.globalPrivacyControl===true);return true;}",
].join("");

// The strip's (and sheet's) stylesheet. Byte-for-byte the same rules as the
// React owner (src/analytics/ConsentBanner.web.tsx BAR_CSS);
// src/analytics/__tests__/privacyBarCssParity.issue2331.test.ts pins it.
const PRIVACY_BAR_CSS_LINES = [
  ":root{--mingla-privacy-inset:calc(28px + env(safe-area-inset-bottom,0px))}",
  "#root{box-sizing:border-box;height:calc(100% - var(--mingla-privacy-inset,0px))}",
  "html[data-mingla-privacy-bar=\"shown\"] #root{overflow-y:auto;overscroll-behavior:contain}",
  ".mps{position:fixed;left:0;right:0;bottom:0;z-index:9000;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:calc(28px + env(safe-area-inset-bottom,0px));margin:0;padding:0 12px env(safe-area-inset-bottom,0px);border:0;border-radius:0;background:#15171c;color:rgba(255,255,255,.9);font:600 12px/1 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;-webkit-font-smoothing:antialiased}",
  ".mps svg{display:block;flex:none;width:14px;height:14px}",
  ".mps:focus{outline:none}",
  ".mps:focus-visible{outline:2px solid #eb7825;outline-offset:-3px}",
  ".mps-saved{color:#8fd3a8}",
  ".mpb-scrim{position:fixed;left:0;right:0;top:0;bottom:var(--mingla-privacy-inset,0px);z-index:9001;background:rgba(0,0,0,.45)}",
  ".mpb{position:fixed;left:0;right:0;bottom:var(--mingla-privacy-inset,0px);z-index:9002;box-sizing:border-box;margin:0;background:#15171c;color:#fff;border-radius:18px 18px 0 0;padding:16px max(16px,env(safe-area-inset-right,0px)) 12px max(16px,env(safe-area-inset-left,0px));max-height:80vh;max-height:80dvh;overflow-y:auto;overscroll-behavior:contain;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;animation:mpb-in .2s ease-out}",
  ".mpb *{box-sizing:border-box}",
  ".mpb[hidden],.mpb [hidden],.mpb-scrim[hidden]{display:none!important}",
  ".mpb-panel{max-width:640px;margin:0 auto;display:flex;flex-direction:column}",
  ".mpb-title{margin:0 0 4px;font-size:15px;line-height:20px;font-weight:700;color:#fff}",
  ".mpb-switch-row{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 0;border-top:1px solid rgba(255,255,255,.1);cursor:pointer}",
  ".mpb-switch-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
  ".mpb-switch-title{font-size:14px;font-weight:700;color:#fff}",
  ".mpb-switch-desc{font-size:13px;line-height:18px;color:rgba(255,255,255,.72)}",
  ".mpb-switch{appearance:none;-webkit-appearance:none;flex-shrink:0;position:relative;width:44px;height:26px;margin:9px 0;border-radius:999px;background:rgba(255,255,255,.24);border:0;cursor:pointer;transition:background .2s ease}",
  ".mpb-switch::after{content:\"\";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s ease}",
  ".mpb-switch:checked{background:#eb7825}",
  ".mpb-switch:checked::after{transform:translateX(18px)}",
  ".mpb-switch:focus-visible{outline:2px solid #eb7825;outline-offset:2px}",
  ".mpb-actions{display:flex;align-items:center;gap:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,.1)}",
  ".mpb-hit{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 2px;margin:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}",
  ".mpb-hit:focus{outline:none}",
  ".mpb-hit:focus-visible .mpb-pill{outline:2px solid #eb7825;outline-offset:2px}",
  ".mpb-pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 16px;border-radius:999px;font-size:13px;font-weight:700;line-height:1;white-space:nowrap}",
  ".mpb-primary{background:#eb7825;color:#111}",
  ".mpb-policy{margin-left:auto;display:inline-flex;align-items:center;min-height:44px;padding:0 4px;font-size:13px;color:rgba(255,255,255,.72);text-decoration:underline}",
  ".mpb-policy:focus-visible{outline:2px solid #eb7825;outline-offset:2px}",
  "@keyframes mpb-in{from{transform:translateY(12px)}to{transform:none}}",
  "@media (prefers-reduced-motion:reduce){.mpb{animation:none}.mpb-switch,.mpb-switch::after{transition:none}}",
];

const privacyBarCss = () => PRIVACY_BAR_CSS_LINES.join("\n");

// #4318 — the strip's rules in their own <style>, under the id the app's strip
// (ConsentBanner.web.tsx STYLE_ID) looks for. The public boot hand-off drops
// the page's own stylesheet the moment the app mounts; kept apart, an open
// sheet keeps its layout through that hand-off and the app reuses this sheet
// instead of adding a second copy.
const PRIVACY_BAR_STYLE_ID = "mingla-privacy-bar-style";
const privacyBarStyleElement = () => `<style id="${PRIVACY_BAR_STYLE_ID}">\n${privacyBarCss()}\n</style>`;

const PRIVACY_POLICY_URL = "https://usemingla.com/privacy-policy";
const PRIVACY_STRIP_LABEL = "Privacy & ad choices";

const SLIDERS_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 4h7M12 4h2M2 12h2M7 12h7"/><circle cx="10.5" cy="4" r="1.5"/><circle cx="5.5" cy="12" r="1.5"/></svg>';

// #4318 — the strip: one thin full-width "Privacy & ad choices" button, shown
// from the first paint (no first-visit banner, no OK prompt).
const privacyStripMarkup = () =>
  '<button type="button" class="mps ph-no-capture" data-testid="privacy-strip" data-mingla-ssr-privacy-strip aria-haspopup="dialog" aria-expanded="false">'
  + `${SLIDERS_ICON}<span aria-live="polite" data-mps-label>Privacy &amp; ad choices</span></button>`;

// The strip plus its (hidden) choices sheet, so a server-rendered page offers
// the same choices before the app takes over (the app removes this copy).
const privacyBarMarkup = () => [
  '<div class="mpb-scrim" data-testid="privacy-scrim" data-mingla-ssr-privacy-scrim hidden></div>',
  '<section class="mpb ph-no-capture" role="dialog" aria-modal="true" aria-labelledby="mingla-privacy-title" id="mingla-privacy-panel" data-testid="privacy-sheet" data-mingla-ssr-privacy-bar hidden>',
  '<div class="mpb-panel" data-testid="privacy-panel"><h2 class="mpb-title" id="mingla-privacy-title">Privacy &amp; ad choices</h2>',
  '<label class="mpb-switch-row"><span class="mpb-switch-copy"><span class="mpb-switch-title">Analytics</span><span class="mpb-switch-desc">Helps us see which pages work and fix what doesn&#39;t.</span></span><input type="checkbox" role="switch" class="mpb-switch" aria-label="Analytics" data-testid="privacy-switch-analytics" data-mpb-switch="analytics"></label>',
  '<label class="mpb-switch-row"><span class="mpb-switch-copy"><span class="mpb-switch-title">Ads measurement</span><span class="mpb-switch-desc">Lets Meta, TikTok, Snapchat and Reddit measure our ads.</span></span><input type="checkbox" role="switch" class="mpb-switch" aria-label="Ads measurement" data-testid="privacy-switch-ads" data-mpb-switch="ads"></label>',
  '<div class="mpb-actions"><button type="button" class="mpb-hit" data-mpb-act="save" data-testid="privacy-bar-save"><span class="mpb-pill mpb-primary">Save</span></button>',
  `<a class="mpb-policy" href="${PRIVACY_POLICY_URL}" target="_blank" rel="noopener noreferrer">Privacy policy</a></div>`,
  "</div></section>",
  privacyStripMarkup(),
].join("");

/**
 * Binds the server-rendered strip and sheet. Requires privacyReaderSource() in
 * the same script. The strip (or `mingla:privacy-choices`) opens the sheet;
 * it traps focus, closes on Escape and returns focus to the strip. Save writes
 * `mingla_privacy_v2`, hands the choice to the app (`__minglaPrebootPrivacy`),
 * dispatches `mingla:privacy-saved` with the choice as `detail` (the page
 * starts or stops vendors) and shows "Saved" on the strip for 1.8s.
 */
const privacyBarRuntimeSource = () => [
  "function __minglaPrivacyBar(){var strip=document.querySelector(\"[data-mingla-ssr-privacy-strip]\"),bar=document.querySelector(\"[data-mingla-ssr-privacy-bar]\"),scrim=document.querySelector(\"[data-mingla-ssr-privacy-scrim]\");if(!strip||!bar)return;",
  "var label=strip.querySelector(\"[data-mps-label]\"),timer=0;",
  "function sw(k){return bar.querySelector('[data-mpb-switch=\"'+k+'\"]');}",
  "function inset(){var h=strip.isConnected?Math.round(strip.getBoundingClientRect().height):0,d=document.documentElement;d.style.setProperty(\"--mingla-privacy-inset\",h+\"px\");if(typeof d.setAttribute===\"function\"){if(h>0)d.setAttribute(\"data-mingla-privacy-bar\",\"shown\");else d.removeAttribute(\"data-mingla-privacy-bar\");}}",
  "function items(){return Array.prototype.slice.call(bar.querySelectorAll(\"input,button,a[href]\"));}",
  "function open(){if(!bar.isConnected)return;sw(\"analytics\").checked=__minglaPrivacyOn(\"analytics\");sw(\"ads\").checked=__minglaPrivacyOn(\"ads\");bar.hidden=false;if(scrim)scrim.hidden=false;strip.setAttribute(\"aria-expanded\",\"true\");var f=items()[0];if(f)f.focus();}",
  "function close(){bar.hidden=true;if(scrim)scrim.hidden=true;strip.setAttribute(\"aria-expanded\",\"false\");strip.focus();}",
  "function flash(){label.textContent=\"Saved\";label.className=\"mps-saved\";if(timer)clearTimeout(timer);timer=setTimeout(function(){label.textContent=\"Privacy & ad choices\";label.className=\"\";},1800);}",
  "function save(a,d){var c={analytics:a,ads:d,ts:Date.now()};window.__minglaPrebootPrivacy=c;try{window.localStorage.setItem(\"mingla_privacy_v2\",JSON.stringify(c));window.localStorage.removeItem(\"mingla_consent_v1\");}catch(_){}",
  "close();flash();window.dispatchEvent(new CustomEvent(\"mingla:privacy-saved\",{detail:c}));}",
  "strip.addEventListener(\"click\",function(){if(bar.hidden)open();else close();});",
  "if(scrim)scrim.addEventListener(\"click\",close);",
  "bar.querySelector('[data-mpb-act=\"save\"]').addEventListener(\"click\",function(){save(sw(\"analytics\").checked,sw(\"ads\").checked);});",
  "document.addEventListener(\"keydown\",function(e){if(bar.hidden||!bar.isConnected)return;if(e.key===\"Escape\"){close();return;}if(e.key!==\"Tab\")return;var l=items(),a=document.activeElement,first=l[0],last=l[l.length-1];if(!first)return;if(e.shiftKey&&(a===first||!bar.contains(a))){e.preventDefault();last.focus();}else if(!e.shiftKey&&(a===last||!bar.contains(a))){e.preventDefault();first.focus();}});",
  "window.addEventListener(\"mingla:privacy-choices\",open);",
  "if(typeof ResizeObserver===\"function\")new ResizeObserver(inset).observe(strip);inset();}",
].join("");

// ---------------------------------------------------------------------------
// #2331 → #4318 — the lean strip for the #922 invite critical shell. That
// shell has a hard byte budget (20,000 raw / 6,000 gzip), so it carries only
// the strip: the same words, the same look, the same inset. Tapping it hands
// off to the app (`window.__minglaPrivacyOpenExpanded`) and boots it; the
// React strip then opens its choices sheet straight away.

const COLLAPSED_ONLY_INCLUDED = /^(?::root|#root|html\[|\.mps)/;

const privacyBarCollapsedCss = () =>
  PRIVACY_BAR_CSS_LINES.filter((line) => COLLAPSED_ONLY_INCLUDED.test(line)).join("\n");

const privacyBarCollapsedMarkup = () => privacyStripMarkup();

/**
 * Binds the lean strip. Requires privacyReaderSource() in the same script.
 * The strip sets the open hand-off and dispatches `mingla:privacy-options`.
 */
const privacyBarCollapsedRuntimeSource = () => [
  "function __minglaPrivacyBar(){var strip=document.querySelector(\"[data-mingla-ssr-privacy-strip]\");if(!strip)return;",
  "function inset(){var h=strip.isConnected?Math.round(strip.getBoundingClientRect().height):0,d=document.documentElement;d.style.setProperty(\"--mingla-privacy-inset\",h+\"px\");if(h>0)d.setAttribute(\"data-mingla-privacy-bar\",\"shown\");else d.removeAttribute(\"data-mingla-privacy-bar\");}",
  "strip.addEventListener(\"click\",function(){window.__minglaPrivacyOpenExpanded=true;window.dispatchEvent(new Event(\"mingla:privacy-options\"));});",
  "if(typeof ResizeObserver===\"function\")new ResizeObserver(inset).observe(strip);inset();}",
].join("");

module.exports = {
  LEGACY_CONSENT_STORAGE_KEY,
  PRIVACY_BAR_STYLE_ID,
  PRIVACY_POLICY_URL,
  PRIVACY_STORAGE_KEY,
  PRIVACY_STRIP_LABEL,
  privacyBarCollapsedCss,
  privacyBarCollapsedMarkup,
  privacyBarCollapsedRuntimeSource,
  privacyBarCss,
  privacyBarMarkup,
  privacyBarRuntimeSource,
  privacyBarStyleElement,
  privacyReaderSource,
  privacyStripMarkup,
};
