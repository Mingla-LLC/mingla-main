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
  "function __minglaPrivacy(){try{var p=window.__minglaPrebootPrivacy;if(__minglaPrivacyValid(p))return p;",
  `var r=window.localStorage.getItem(${JSON.stringify(PRIVACY_STORAGE_KEY)});if(r!==null){var v=JSON.parse(r);if(__minglaPrivacyValid(v))return v;}`,
  `var l=window.localStorage.getItem(${JSON.stringify(LEGACY_CONSENT_STORAGE_KEY)});if(l!==null){var c=l;try{var o=JSON.parse(l);c=o&&typeof o==="object"?(o.choice||o.value):o;}catch(_){}`,
  "if(c===\"granted\"||c===\"denied\")return{analytics:c===\"granted\",ads:c===\"granted\",ts:0};}}catch(_){}return null;}",
  "function __minglaPrivacyOn(kind){var s=__minglaPrivacy();if(s!==null)return kind===\"ads\"?s.ads===true:s.analytics===true;",
  "if(kind===\"ads\")return!(typeof navigator!==\"undefined\"&&navigator.globalPrivacyControl===true);return true;}",
].join("");

// The bar's stylesheet. Byte-for-byte the same rules as the React owner
// (src/analytics/ConsentBanner.web.tsx BAR_CSS);
// src/analytics/__tests__/privacyBarCssParity.issue2331.test.ts pins it.
const PRIVACY_BAR_CSS_LINES = [
  "#root{box-sizing:border-box;height:calc(100% - var(--mingla-privacy-inset,0px))}",
  "html[data-mingla-privacy-bar=\"shown\"] #root{overflow-y:auto;overscroll-behavior:contain}",
  "html[data-mingla-privacy-bar=\"shown\"] #root>*{flex-shrink:0;min-height:calc(100vh - 53px - env(safe-area-inset-bottom,0px));min-height:calc(100dvh - 53px - env(safe-area-inset-bottom,0px))}",
  ".mpb{position:fixed;left:0;right:0;bottom:0;z-index:9000;box-sizing:border-box;margin:0;background:#171a20;color:#fff;border-top:1px solid rgba(255,255,255,.14);padding:4px max(12px,env(safe-area-inset-right,0px)) calc(4px + env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px));max-height:60vh;max-height:60dvh;overflow-y:auto;overscroll-behavior:contain;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}",
  ".mpb *{box-sizing:border-box}",
  ".mpb[hidden],.mpb [hidden]{display:none!important}",
  ".mpb-row{max-width:1200px;height:44px;margin:0 auto;display:flex;align-items:center;gap:4px}",
  ".mpb-text{flex:1;min-width:0;margin:0 4px 0 0;font-size:13px;line-height:18px;color:rgba(255,255,255,.78);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".mpb-text b{color:#fff;font-weight:700}",
  ".mpb-short{display:none}",
  "@media (max-width:399.98px){.mpb-long{display:none}.mpb-short{display:inline}}",
  ".mpb-hit{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 2px;margin:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}",
  ".mpb-hit:focus{outline:none}",
  ".mpb-hit:focus-visible .mpb-pill{outline:2px solid #eb7825;outline-offset:2px}",
  ".mpb-pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:999px;font-size:13px;font-weight:700;line-height:1;white-space:nowrap}",
  ".mpb-primary{background:#eb7825;color:#111}",
  ".mpb-ghost{color:#fff;border:1px solid rgba(255,255,255,.32)}",
  ".mpb-chev{width:7px;height:7px;border-right:2px solid currentColor;border-top:2px solid currentColor;transform:translateY(2px) rotate(-45deg);transition:transform .2s ease}",
  ".mpb-chev-up{transform:translateY(-2px) rotate(135deg)}",
  "@media (max-width:359.98px){.mpb-options-label{display:none}.mpb-options .mpb-pill{padding:0 11px}}",
  ".mpb-panel{max-width:1200px;margin:0 auto;padding:2px 0 6px;display:grid;grid-template-columns:1fr;column-gap:24px;animation:mpb-in .2s ease-out}",
  "@media (min-width:600px){.mpb-panel{grid-template-columns:1fr 1fr}}",
  ".mpb-switch-row{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 0;border-top:1px solid rgba(255,255,255,.1);cursor:pointer}",
  ".mpb-switch-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
  ".mpb-switch-title{font-size:14px;font-weight:700;color:#fff}",
  ".mpb-switch-desc{font-size:13px;line-height:18px;color:rgba(255,255,255,.72)}",
  ".mpb-switch{appearance:none;-webkit-appearance:none;flex-shrink:0;position:relative;width:44px;height:26px;margin:9px 0;border-radius:999px;background:rgba(255,255,255,.24);border:0;cursor:pointer;transition:background .2s ease}",
  ".mpb-switch::after{content:\"\";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s ease}",
  ".mpb-switch:checked{background:#eb7825}",
  ".mpb-switch:checked::after{transform:translateX(18px)}",
  ".mpb-switch:focus-visible{outline:2px solid #eb7825;outline-offset:2px}",
  ".mpb-actions{grid-column:1/-1;display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding-top:4px}",
  ".mpb-policy{margin-left:auto;display:inline-flex;align-items:center;min-height:44px;padding:0 4px;font-size:13px;color:rgba(255,255,255,.72);text-decoration:underline}",
  ".mpb-policy:focus-visible{outline:2px solid #eb7825;outline-offset:2px}",
  ".mpb-toast{position:fixed;z-index:9001;left:50%;transform:translateX(-50%);bottom:calc(16px + var(--mingla-privacy-inset,0px));max-width:calc(100vw - 32px);padding:10px 16px;border-radius:999px;background:#171a20;color:#fff;border:1px solid rgba(255,255,255,.14);font:600 13px/18px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;pointer-events:none;white-space:nowrap}",
  "@keyframes mpb-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}",
  "@media (prefers-reduced-motion:reduce){.mpb-panel{animation:none}.mpb-chev,.mpb-switch,.mpb-switch::after{transition:none}}",
];

const privacyBarCss = () => PRIVACY_BAR_CSS_LINES.join("\n");

const PRIVACY_POLICY_URL = "https://usemingla.com/privacy-policy";

// Collapsed markup identical to the React bar, plus the (hidden) expanded
// panel so a server-rendered page can offer the same choices before the app
// takes over. `hidden` until the runtime decides the visitor has not chosen.
const privacyBarMarkup = () => [
  '<section class="mpb ph-no-capture" role="region" aria-label="Privacy choices" data-testid="privacy-bar" data-expanded="false" data-mingla-ssr-privacy-bar hidden>',
  '<div class="mpb-panel" id="mingla-privacy-panel" data-testid="privacy-panel" hidden>',
  '<label class="mpb-switch-row"><span class="mpb-switch-copy"><span class="mpb-switch-title">Analytics</span><span class="mpb-switch-desc">Helps us see which pages work and fix what doesn&#39;t.</span></span><input type="checkbox" role="switch" class="mpb-switch" aria-label="Analytics" data-testid="privacy-switch-analytics" data-mpb-switch="analytics"></label>',
  '<label class="mpb-switch-row"><span class="mpb-switch-copy"><span class="mpb-switch-title">Ads</span><span class="mpb-switch-desc">Lets Meta, TikTok, Snapchat and Reddit measure our ads.</span></span><input type="checkbox" role="switch" class="mpb-switch" aria-label="Ads" data-testid="privacy-switch-ads" data-mpb-switch="ads"></label>',
  '<div class="mpb-actions"><button type="button" class="mpb-hit" data-mpb-act="save" data-testid="privacy-bar-save"><span class="mpb-pill mpb-primary">Save</span></button><button type="button" class="mpb-hit" data-mpb-act="off" data-testid="privacy-bar-off-all"><span class="mpb-pill mpb-ghost">Turn off all</span></button>',
  `<a class="mpb-policy" href="${PRIVACY_POLICY_URL}" target="_blank" rel="noopener noreferrer">Privacy policy</a></div>`,
  "</div>",
  '<div class="mpb-row"><p class="mpb-text"><span data-mpb-collapsed><span class="mpb-long">Mingla uses cookies for analytics and ads.</span><span class="mpb-short">Cookies for analytics and ads.</span></span><b data-mpb-expanded hidden>Your privacy choices</b></p>',
  '<button type="button" class="mpb-hit" data-mpb-act="ok" data-testid="privacy-bar-ok"><span class="mpb-pill mpb-primary">OK</span></button>',
  '<button type="button" class="mpb-hit mpb-options" data-mpb-act="toggle" data-testid="privacy-bar-options" aria-expanded="false" aria-controls="mingla-privacy-panel" aria-label="Privacy options"><span class="mpb-pill mpb-ghost"><span class="mpb-options-label" data-mpb-label>Options</span><span class="mpb-chev mpb-chev-up" data-mpb-chev aria-hidden="true"></span></span></button>',
  "</div></section>",
].join("");

/**
 * Binds the server-rendered bar. Requires privacyReaderSource() in the same
 * script. Saving writes `mingla_privacy_v2`, hands the choice to the app
 * (`__minglaPrebootPrivacy`) and dispatches `mingla:privacy-saved` with the
 * choice as `detail`, so the page can start or stop vendors. "Your privacy
 * choices" (`mingla:privacy-choices`) reopens it, expanded.
 */
const privacyBarRuntimeSource = () => [
  "function __minglaPrivacyBar(){var bar=document.querySelector(\"[data-mingla-ssr-privacy-bar]\");if(!bar)return;",
  "var panel=bar.querySelector(\".mpb-panel\"),toggle=bar.querySelector('[data-mpb-act=\"toggle\"]'),ok=bar.querySelector('[data-mpb-act=\"ok\"]'),label=bar.querySelector(\"[data-mpb-label]\"),chev=bar.querySelector(\"[data-mpb-chev]\"),collapsedText=bar.querySelector(\"[data-mpb-collapsed]\"),expandedText=bar.querySelector(\"[data-mpb-expanded]\"),reopened=false;",
  "function sw(k){return bar.querySelector('[data-mpb-switch=\"'+k+'\"]');}",
  "function inset(){var h=bar.isConnected&&!bar.hidden?Math.round(bar.getBoundingClientRect().height):0,d=document.documentElement;d.style.setProperty(\"--mingla-privacy-inset\",h+\"px\");if(typeof d.setAttribute===\"function\"){if(h>0)d.setAttribute(\"data-mingla-privacy-bar\",\"shown\");else d.removeAttribute(\"data-mingla-privacy-bar\");}}",
  "function expand(open){bar.setAttribute(\"data-expanded\",String(open));panel.hidden=!open;ok.hidden=open;collapsedText.hidden=open;expandedText.hidden=!open;toggle.setAttribute(\"aria-expanded\",String(open));toggle.setAttribute(\"aria-label\",open?\"Close privacy choices\":\"Privacy options\");label.textContent=open?\"Close\":\"Options\";label.className=open?\"\":\"mpb-options-label\";chev.className=open?\"mpb-chev\":\"mpb-chev mpb-chev-up\";",
  "if(open){sw(\"analytics\").checked=__minglaPrivacyOn(\"analytics\");sw(\"ads\").checked=__minglaPrivacyOn(\"ads\");}inset();}",
  "function show(on){bar.hidden=!on;if(!on)expand(false);inset();}",
  "function toast(m){var t=document.createElement(\"div\");t.className=\"mpb-toast\";t.setAttribute(\"role\",\"status\");t.setAttribute(\"aria-live\",\"polite\");t.setAttribute(\"data-testid\",\"privacy-toast\");t.textContent=m;document.body.appendChild(t);setTimeout(function(){t.remove();},1800);}",
  "function save(a,d){var c={analytics:a,ads:d,ts:Date.now()};window.__minglaPrebootPrivacy=c;try{window.localStorage.setItem(\"mingla_privacy_v2\",JSON.stringify(c));window.localStorage.removeItem(\"mingla_consent_v1\");}catch(_){}",
  "reopened=false;show(false);toast(a&&d?\"Saved\":!a&&!d?\"Analytics and ads are off\":a?\"Ads are off\":\"Analytics is off\");window.dispatchEvent(new CustomEvent(\"mingla:privacy-saved\",{detail:c}));}",
  "ok.addEventListener(\"click\",function(){save(__minglaPrivacyOn(\"analytics\"),__minglaPrivacyOn(\"ads\"));});",
  "toggle.addEventListener(\"click\",function(){var open=bar.getAttribute(\"data-expanded\")!==\"true\";if(!open&&reopened){reopened=false;show(false);return;}expand(open);});",
  "bar.querySelector('[data-mpb-act=\"save\"]').addEventListener(\"click\",function(){save(sw(\"analytics\").checked,sw(\"ads\").checked);});",
  "bar.querySelector('[data-mpb-act=\"off\"]').addEventListener(\"click\",function(){save(false,false);});",
  "document.addEventListener(\"keydown\",function(e){if(e.key===\"Escape\"&&bar.getAttribute(\"data-expanded\")===\"true\"){if(reopened){reopened=false;show(false);}else{expand(false);toggle.focus();}}});",
  "window.addEventListener(\"mingla:privacy-choices\",function(){if(!bar.isConnected)return;reopened=true;show(true);expand(true);});",
  "document.querySelectorAll(\"[data-mingla-privacy-choices]\").forEach(function(el){el.addEventListener(\"click\",function(){window.dispatchEvent(new Event(\"mingla:privacy-choices\"));});});",
  "if(typeof ResizeObserver===\"function\")new ResizeObserver(inset).observe(bar);show(__minglaPrivacy()===null);}",
].join("");

module.exports = {
  LEGACY_CONSENT_STORAGE_KEY,
  PRIVACY_POLICY_URL,
  PRIVACY_STORAGE_KEY,
  privacyBarCss,
  privacyBarMarkup,
  privacyBarRuntimeSource,
  privacyReaderSource,
};
