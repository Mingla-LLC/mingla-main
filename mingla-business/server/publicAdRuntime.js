const { SUPABASE_ANON_KEY, SUPABASE_URL } = require("./supabaseRpc");

const safeJson = (value) => JSON.stringify(value)
  .replace(/&/g, "\\u0026")
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const pixelConfig = () => ({
  meta: process.env.EXPO_PUBLIC_META_PIXEL_ID || null,
  tiktok: process.env.EXPO_PUBLIC_TIKTOK_PIXEL_CODE || null,
  snap: process.env.EXPO_PUBLIC_SNAP_PIXEL_ID || null,
});

const publicAdPrivacyMarkup = () => `
<aside id="mingla-ad-privacy-banner" class="mingla-ad-privacy" role="region" aria-label="Advertising privacy choices" hidden>
  <p>We use cookies and advertising tools from Meta, Snapchat and TikTok to measure and improve our ads.</p>
  <div class="mingla-ad-privacy-actions">
    <button type="button" id="mingla-ad-privacy-ok">OK</button>
    <button type="button" id="mingla-ad-privacy-opt-out">Opt out of ad tracking</button>
    <a href="https://usemingla.com/privacy-policy">Privacy policy</a>
  </div>
</aside>`;

const publicAdPrivacyStyle = () => `
.mingla-ad-privacy{position:fixed;z-index:10000;left:max(16px,env(safe-area-inset-left));right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));max-width:720px;margin:auto;padding:18px;border:1px solid rgba(255,255,255,.2);border-radius:18px;background:#121014;color:#fff8f1;box-shadow:0 18px 60px rgba(0,0,0,.55)}
.mingla-ad-privacy p{margin:0 0 14px;line-height:1.5}.mingla-ad-privacy-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.mingla-ad-privacy button,.mingla-ad-privacy a{min-height:44px;padding:0 16px;border-radius:999px;font:inherit;font-weight:800}.mingla-ad-privacy button{border:1px solid rgba(255,255,255,.24);cursor:pointer}.mingla-ad-privacy button:first-child{border-color:#f47c20;background:#f47c20;color:#090807}.mingla-ad-privacy button:nth-child(2){background:transparent;color:#fff8f1}.mingla-ad-privacy a{display:inline-flex;align-items:center;color:#ff9a4d}.mingla-ad-privacy button:focus-visible,.mingla-ad-privacy a:focus-visible,.mingla-ad-privacy-choice:focus-visible{outline:3px solid #fff;outline-offset:3px}.mingla-ad-privacy-choice{border:0;background:transparent;color:#ffb77f;text-decoration:underline;cursor:pointer;font:inherit}`;

const publicAdRuntimeScript = ({ facts, consentMode = "on_arrival" }) => {
  const brandId = facts.kind === "brand" ? facts.id : facts.brandId;
  const entityId = facts.kind === "brand" ? null : facts.id;
  const config = {
    consentMode: consentMode === "opt_in" ? "opt_in" : "on_arrival",
    pixels: pixelConfig(),
    brandId,
    entityType: facts.kind,
    entityId,
    contentId: facts.id,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  };
  return `(function(){
var c=${safeJson(config)},k="mingla_consent_v1";
window.__minglaAdPixelConsentMode=c.consentMode;
function id(){return globalThis.crypto&&typeof globalThis.crypto.randomUUID==="function"?globalThis.crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(v){var r=Math.floor(Math.random()*16);return(v==="x"?r:(r&3)|8).toString(16);});}
function choice(){try{var v=localStorage.getItem(k),x=null;if(v==="granted"||v==="denied")x=v;else if(v!==null){var p=JSON.parse(v);if(p&&(p.choice==="granted"||p.choice==="denied"))x=p.choice;}if(x)window.__minglaPrebootConsentChoice=x;return x;}catch(_){return null;}}
function save(v){window.__minglaPrebootConsentChoice=v;try{localStorage.setItem(k,JSON.stringify({choice:v,ts:Date.now()}));}catch(_){}}
function script(key,src){if(document.querySelector('script[data-mingla-pixel="'+key+'"]'))return;var s=document.createElement("script");s.async=true;s.src=src;s.setAttribute("data-mingla-pixel",key);document.head.appendChild(s);}
function boot(){if(choice()==="denied"||window.__minglaAdPixelsBootstrapped)return;window.__minglaAdPixelsBootstrapped=true;var eid=id(),pageKey=location.href.split("#",1)[0];window.__minglaAdPageViewKeys=window.__minglaAdPageViewKeys||{};window.__minglaAdPageViewKeys[pageKey]=true;window.__minglaAdViewContentKeys=window.__minglaAdViewContentKeys||{};window.__minglaAdViewContentKeys[c.contentId]=true;
if(c.pixels.meta){!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=true;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=true;t.src=v;t.setAttribute("data-mingla-pixel","meta");s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");fbq("init",c.pixels.meta);fbq("track","PageView",{brand_id:c.brandId},{eventID:eid});fbq("track","ViewContent",{content_type:"product",content_ids:[c.contentId],brand_id:c.brandId},{eventID:eid});}
if(c.pixels.tiktok){!function(w,d,t){w.TiktokAnalyticsObject=t;var q=w[t]=w[t]||[];q.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"];q.setAndDefer=function(o,m){o[m]=function(){o.push([m].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<q.methods.length;i++)q.setAndDefer(q,q.methods[i]);q.load=function(code){var s=d.createElement("script");s.async=true;s.src="https://analytics.tiktok.com/i18n/pixel/events.js?sdkid="+encodeURIComponent(code)+"&lib="+t;s.setAttribute("data-mingla-pixel","tiktok");d.head.appendChild(s)};q.load(c.pixels.tiktok);q.page();q.track("ViewContent",{content_type:"product",content_id:c.contentId,brand_id:c.brandId},{event_id:eid});}(window,document,"ttq");}
if(c.pixels.snap){!function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[];var s=t.createElement("script");s.async=true;s.src="https://sc-static.net/scevent.min.js";s.setAttribute("data-mingla-pixel","snap");var r=t.getElementsByTagName("script")[0];r.parentNode.insertBefore(s,r)}(window,document);snaptr("init",c.pixels.snap);snaptr("track","PAGE_VIEW",{brand_id:c.brandId,client_dedup_id:eid});snaptr("track","VIEW_CONTENT",{item_ids:[c.contentId],brand_id:c.brandId,client_dedup_id:eid,transaction_id:eid});}}
function stop(){try{window.fbq&&window.fbq("consent","revoke");window.ttq&&typeof window.ttq.revokeConsent==="function"&&window.ttq.revokeConsent();}catch(_){}document.querySelectorAll('script[data-mingla-pixel]').forEach(function(s){s.remove();});["_fbp","_fbc","_ttp","_scid"].forEach(function(n){document.cookie=n+"=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax";document.cookie=n+"=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.usemingla.com; SameSite=Lax";});window.fbq=undefined;window._fbq=undefined;window.ttq=undefined;window.snaptr=undefined;window.__minglaAdPixelsBootstrapped=false;}
function capture(){if(!c.brandId||!c.entityType)return;var marker={brandId:c.brandId,entityType:c.entityType,entityId:c.entityId};window.__minglaEarlyEngagementCaptured=marker;var body={eventId:id(),brandId:c.brandId,entityType:c.entityType,entityId:c.entityId,eventType:"page_view",ctaType:null,checkoutSessionId:null,surface:"buyer_web",pageUrl:location.href,referrer:document.referrer||null};try{fetch(c.supabaseUrl+"/functions/v1/offering-engagement-capture",{method:"POST",headers:{"content-type":"application/json",apikey:c.supabaseAnonKey,Authorization:"Bearer "+c.supabaseAnonKey},body:JSON.stringify(body),keepalive:true}).catch(function(){});}catch(_){}}
function show(showing){var b=document.getElementById("mingla-ad-privacy-banner");if(b)b.hidden=!showing;}
function bind(){var unresolved=choice()===null;show(unresolved);var ok=document.getElementById("mingla-ad-privacy-ok"),out=document.getElementById("mingla-ad-privacy-opt-out");if(ok)ok.onclick=function(){save("granted");show(false);boot();};if(out)out.onclick=function(){save("denied");stop();show(false);};document.querySelectorAll("[data-mingla-ad-privacy-choice]").forEach(function(el){el.addEventListener("click",function(){show(true);});});window.addEventListener("mingla:ad-privacy-choices",function(){show(true);});}
capture();if(choice()!=="denied"&&(c.consentMode!=="opt_in"||choice()==="granted"))boot();if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind,{once:true});else bind();
})();`;
};

module.exports = {
  publicAdPrivacyMarkup,
  publicAdPrivacyStyle,
  publicAdRuntimeScript,
};
