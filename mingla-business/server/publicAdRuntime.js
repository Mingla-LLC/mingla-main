const { SUPABASE_ANON_KEY, SUPABASE_URL } = require("./supabaseRpc");
const {
  privacyBarCss,
  privacyBarMarkup,
  privacyBarRuntimeSource,
  privacyReaderSource,
} = require("./publicPrivacyRuntime");

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

// #2331 — the same slim privacy bar the app renders, server-side, so the
// choice is offered before the app takes over (the app removes this copy).
const publicAdPrivacyMarkup = () => privacyBarMarkup();

const publicAdPrivacyStyle = () => privacyBarCss();

// I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF: pixels boot on arrival in every
// country unless this visitor turned ads off (GPC starts ads off). There is
// no region mode.
const publicAdRuntimeScript = ({ facts }) => {
  const brandId = facts.kind === "brand" ? facts.id : facts.brandId;
  const entityId = facts.kind === "brand" ? null : facts.id;
  const config = {
    pixels: pixelConfig(),
    brandId,
    entityType: facts.kind,
    entityId,
    contentId: facts.id,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  };
  return `(function(){
var c=${safeJson(config)};
${privacyReaderSource()}
function id(){return globalThis.crypto&&typeof globalThis.crypto.randomUUID==="function"?globalThis.crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(v){var r=Math.floor(Math.random()*16);return(v==="x"?r:(r&3)|8).toString(16);});}
function script(key,src){if(document.querySelector('script[data-mingla-pixel="'+key+'"]'))return;var s=document.createElement("script");s.async=true;s.src=src;s.setAttribute("data-mingla-pixel",key);document.head.appendChild(s);}
function boot(){if(!__minglaPrivacyOn("ads")||window.__minglaAdPixelsBootstrapped)return;window.__minglaAdPixelsBootstrapped=true;var eid=id(),pageKey=location.href.split("#",1)[0];window.__minglaAdPageViewKeys=window.__minglaAdPageViewKeys||{};window.__minglaAdPageViewKeys[pageKey]=true;window.__minglaAdViewContentKeys=window.__minglaAdViewContentKeys||{};window.__minglaAdViewContentKeys[c.contentId]=true;
if(c.pixels.meta){!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=true;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=true;t.src=v;t.setAttribute("data-mingla-pixel","meta");s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");fbq("init",c.pixels.meta);fbq("track","PageView",{brand_id:c.brandId},{eventID:eid});fbq("track","ViewContent",{content_type:"product",content_ids:[c.contentId],brand_id:c.brandId},{eventID:eid});}
if(c.pixels.tiktok){!function(w,d,t){w.TiktokAnalyticsObject=t;var q=w[t]=w[t]||[];q.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"];q.setAndDefer=function(o,m){o[m]=function(){o.push([m].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<q.methods.length;i++)q.setAndDefer(q,q.methods[i]);q.load=function(code){var s=d.createElement("script");s.async=true;s.src="https://analytics.tiktok.com/i18n/pixel/events.js?sdkid="+encodeURIComponent(code)+"&lib="+t;s.setAttribute("data-mingla-pixel","tiktok");d.head.appendChild(s)};q.load(c.pixels.tiktok);q.page();q.track("ViewContent",{content_type:"product",content_id:c.contentId,brand_id:c.brandId},{event_id:eid});}(window,document,"ttq");}
if(c.pixels.snap){!function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[];var s=t.createElement("script");s.async=true;s.src="https://sc-static.net/scevent.min.js";s.setAttribute("data-mingla-pixel","snap");var r=t.getElementsByTagName("script")[0];r.parentNode.insertBefore(s,r)}(window,document);snaptr("init",c.pixels.snap);snaptr("track","PAGE_VIEW",{brand_id:c.brandId,client_dedup_id:eid});snaptr("track","VIEW_CONTENT",{item_ids:[c.contentId],brand_id:c.brandId,client_dedup_id:eid,transaction_id:eid});}}
function stop(){try{window.fbq&&window.fbq("consent","revoke");window.ttq&&typeof window.ttq.revokeConsent==="function"&&window.ttq.revokeConsent();}catch(_){}document.querySelectorAll('script[data-mingla-pixel]').forEach(function(s){s.remove();});["_fbp","_fbc","_ttp","_scid","_rdt_uuid"].forEach(function(n){document.cookie=n+"=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax";document.cookie=n+"=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.usemingla.com; SameSite=Lax";});window.fbq=undefined;window._fbq=undefined;window.ttq=undefined;window.snaptr=undefined;window.rdt=undefined;window.__minglaAdPixelsBootstrapped=false;}
function capture(){if(!c.brandId||!c.entityType)return;var scope={brandId:c.brandId,entityType:c.entityType,entityId:c.entityId},eventId=id(),body={eventId:eventId,brandId:c.brandId,entityType:c.entityType,entityId:c.entityId,eventType:"page_view",ctaType:null,checkoutSessionId:null,surface:"buyer_web",pageUrl:location.href,referrer:document.referrer||null};try{var completed=fetch(c.supabaseUrl+"/functions/v1/offering-engagement-capture",{method:"POST",headers:{"content-type":"application/json",apikey:c.supabaseAnonKey,Authorization:"Bearer "+c.supabaseAnonKey},body:JSON.stringify(body),keepalive:true}).then(function(r){return r.ok;}).catch(function(){return false;});window.__minglaEarlyEngagementCapture={scope:scope,eventId:eventId,completed:completed};}catch(_){}}
${privacyBarRuntimeSource()}
window.addEventListener("mingla:privacy-saved",function(e){var v=e&&e.detail;if(v&&v.ads===true)boot();else stop();});
capture();boot();if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",__minglaPrivacyBar,{once:true});else __minglaPrivacyBar();
})();`;
};

module.exports = {
  publicAdPrivacyMarkup,
  publicAdPrivacyStyle,
  publicAdRuntimeScript,
};
