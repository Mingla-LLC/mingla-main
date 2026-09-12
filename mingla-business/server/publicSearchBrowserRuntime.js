// SHARE-SEMANTIC-ROLE:content-transport

const escapeJsonForHtml = (value) => JSON.stringify(value)
  .replace(/&/g, "\\u0026")
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

// #3214 — the Expo handoff. Comments live here rather than inside the template
// so they are not shipped on every public page.
//
// ORDER. Script-created scripts are async by default and ignore `defer`, so each
// chunk used to run the moment its download finished; a cold load routinely ran
// `index` (which ends by starting the app) before `__common` had defined the
// modules it requires ("Requiring unknown module"). `async = false` puts the
// injected scripts in the browser's ordered list: they execute in insertion
// order, which is the order index.html lists them.
//
// TAKEOVER. The first mutation of #root after which #root holds an element that
// is not the server-rendered shell (captured before any app code exists). Only
// React inserts into #root: its first successful commit clears the container
// and inserts the app's tree in one synchronous step, so this cannot be true
// while the bundle has not reached runApplication. "The shell is gone" alone is
// not a takeover: React also empties its container when it unmounts after an
// uncaught error. The MutationObserver callback runs as a microtask after the
// commit, before the browser renders, so the app's first frame already has its
// styles.
//
// TEARDOWN. Measured with __common missing (a lost race, or a failed download):
// the app commits a tree first, then hits "Requiring unknown module", and React
// 19 unmounts the root, leaving #root EMPTY. Before this handling that read as
// a successful boot and left a blank page under body{overflow:hidden}, with the
// failure message gone along with the shell it lived in. A live React root
// never empties its container, so an empty #root after takeover means the app
// has gone: the app styles are removed, the server document's style and shell
// are put back, the failure message shows, and `app_unmounted` is reported.
// Before takeover, an empty #root is left alone until a failure is recorded
// (error or deadline), and the shell is then put back the same way.
//
// STYLES. index.html's <head> styles (expo-reset: full-height html/body/#root and
// body{overflow:hidden}; the mobile no-blur rule) are applied at takeover and
// never earlier: applied to the plain page they would freeze its scrolling, and
// strand the visitor if boot then failed. The server document's own <style>
// (#mingla-public-document-style) is removed at the same moment; its markup is
// already gone because it lived inside #root.
//
// OUTCOME. Every failure path calls showBootstrapFailure(): a chunk that fails to
// load, an uncaught error or rejection whose source is an injected chunk before
// takeover, or no takeover within BOOT_MOUNT_DEADLINE_MS. Success and failure
// (with a reason) are sent to /api/public-boot-outcome only under the same
// consent grant the app itself reads (preboot choice first, then the stored
// record); anything unreadable counts as no grant.
//
// DEADLINE. The clock starts at the last chunk's `load` event (a classic script's
// `load` fires after it has executed), so download time, the only part that
// depends on the visitor's network, is never inside it. A slow download delays
// the clock instead of racing it. See #3214 for the measurements behind 20 s.
const BOOT_MOUNT_DEADLINE_MS = 20000;

// Content-agnostic browser transport for one already-prepared canonical URL.
// The returned script owns only DOM feedback, browser sharing/copying, and the
// existing Expo bootstrap. It does not know which public entity produced it.
const browserRuntimeScript = (canonicalUrl) => `(function(){
  var canonical=${escapeJsonForHtml(canonicalUrl)};
  var share=document.getElementById("mingla-share");
  var shareStatus=document.getElementById("mingla-share-status");
  var fallback=document.getElementById("mingla-share-fallback");
  var fallbackInput=document.getElementById("mingla-share-fallback-input");
  var runtimeStatus=document.getElementById("mingla-runtime-status");
  function setShareStatus(message,showFallback){
    if(shareStatus)shareStatus.textContent=message;
    if(fallback)fallback.hidden=!showFallback;
  }
  function finishShare(){
    if(!share)return;
    share.disabled=false;
    share.setAttribute("aria-busy","false");
  }
  function showBootstrapFailure(){
    if(runtimeStatus)runtimeStatus.textContent="Interactive features could not load. This page and its links still work.";
  }
  if(fallbackInput){
    var selectFallback=function(){if(typeof fallbackInput.select==="function")fallbackInput.select();};
    fallbackInput.addEventListener("focus",selectFallback);
    fallbackInput.addEventListener("click",selectFallback);
  }
  if(share){
    share.addEventListener("click",async function(){
      share.disabled=true;
      share.setAttribute("aria-busy","true");
      if(typeof navigator.share==="function"){
        setShareStatus("Opening sharing options…",false);
        try{
          // SHARE-CONTENT-CALL:transport
          await navigator.share({title:document.title,url:canonical});
          setShareStatus("Shared successfully.",false);
        }catch(error){
          if(error&&error.name==="AbortError")setShareStatus("Share cancelled. Select and copy the link below if you still want to share it.",true);
          else setShareStatus("Sharing failed. Select and copy the link below.",true);
        }finally{finishShare();}
        return;
      }
      if(navigator.clipboard&&typeof navigator.clipboard.writeText==="function"){
        setShareStatus("Copying link…",false);
        try{
          await navigator.clipboard.writeText(canonical);
          setShareStatus("Link copied.",false);
        }catch(error){
          setShareStatus("Could not copy automatically. Select and copy the link below.",true);
        }finally{finishShare();}
        return;
      }
      setShareStatus("Sharing is not available here. Select and copy the link below.",true);
      finishShare();
    });
  }
  var bootStartedAt=Date.now();
  var bootRoot=document.getElementById("root");
  var serverShell=bootRoot?bootRoot.firstElementChild:null;
  var serverStyle=document.getElementById("mingla-public-document-style");
  var bootChunks=[];
  var appStyles=[];
  var appliedStyles=[];
  var bootFailure="";
  var bootMounted=false;
  var appUnmounted=false;
  var mountTimer=null;
  var mountObserver=null;
  var bootLoadId=(Date.now().toString(36)+Math.random().toString(36).slice(2)).slice(0,24);
  var canonicalPath="";
  try{canonicalPath=new URL(canonical).pathname;}catch(error){canonicalPath="";}
  function serverShellGone(){
    if(!serverShell)return false;
    if(typeof serverShell.isConnected==="boolean")return !serverShell.isConnected;
    return !(document.documentElement&&document.documentElement.contains(serverShell));
  }
  function appTreePresent(){
    if(!bootRoot||!bootRoot.children)return false;
    for(var i=0;i<bootRoot.children.length;i++){if(bootRoot.children[i]!==serverShell)return true;}
    return false;
  }
  function restoreServerShell(){
    if(serverShell&&bootRoot&&serverShellGone()&&!appTreePresent())bootRoot.appendChild(serverShell);
  }
  function bootConsentGranted(){
    try{
      var preboot=window.__minglaPrebootConsentChoice;
      if(preboot==="granted"||preboot==="denied")return preboot==="granted";
      var stored=JSON.parse(window.localStorage.getItem("mingla_consent_v1")||"null");
      return !!stored&&stored.choice==="granted";
    }catch(error){return false;}
  }
  function reportBootOutcome(outcome,reason){
    if(typeof navigator==="undefined"||typeof navigator.sendBeacon!=="function"||!bootConsentGranted())return;
    try{
      navigator.sendBeacon("/api/public-boot-outcome",JSON.stringify({outcome:outcome,reason:reason,elapsed_ms:Math.max(0,Date.now()-bootStartedAt),path:canonicalPath,load_id:bootLoadId}));
    }catch(error){
      if(typeof console!=="undefined")console.warn("[mingla] public boot outcome was not sent",error);
    }
  }
  function applyAppStyles(){
    if(serverStyle&&serverStyle.parentNode)serverStyle.parentNode.removeChild(serverStyle);
    var head=document.head;
    if(!head)return;
    var anchor=head.firstChild;
    appStyles.forEach(function(source,index){
      var marker=source.id||("index-style-"+index);
      if(document.querySelector('style[data-mingla-expo-style="'+marker+'"]'))return;
      var style=document.createElement("style");
      if(source.id)style.id=source.id;
      if(source.media)style.media=source.media;
      style.setAttribute("data-mingla-expo-style",marker);
      style.textContent=source.css;
      head.insertBefore(style,anchor);
      appliedStyles.push(style);
    });
  }
  function removeAppStyles(){
    appliedStyles.forEach(function(style){if(style.parentNode)style.parentNode.removeChild(style);});
    appliedStyles=[];
    if(serverStyle&&!serverStyle.parentNode&&document.head)document.head.appendChild(serverStyle);
  }
  function failBoot(reason){
    if(bootMounted||bootFailure)return;
    bootFailure=reason;
    if(mountTimer!==null){clearTimeout(mountTimer);mountTimer=null;}
    restoreServerShell();
    showBootstrapFailure();
    reportBootOutcome("failure",reason);
  }
  function confirmMount(){
    if(bootMounted)return;
    if(!appTreePresent()){
      if(bootFailure)restoreServerShell();
      return;
    }
    bootMounted=true;
    if(mountTimer!==null){clearTimeout(mountTimer);mountTimer=null;}
    if(serverShell&&serverShell.parentNode)serverShell.parentNode.removeChild(serverShell);
    applyAppStyles();
    reportBootOutcome("success",bootFailure?"late_mount":"mounted");
  }
  function watchRoot(){
    if(appUnmounted)return;
    if(!bootMounted){confirmMount();return;}
    if(appTreePresent())return;
    appUnmounted=true;
    if(mountObserver)mountObserver.disconnect();
    removeAppStyles();
    restoreServerShell();
    showBootstrapFailure();
    reportBootOutcome("failure","app_unmounted");
  }
  function fromInjectedChunk(trace){
    if(typeof trace!=="string"||!trace)return false;
    for(var i=0;i<bootChunks.length;i++){if(trace.indexOf(bootChunks[i])!==-1)return true;}
    return false;
  }
  if(typeof window!=="undefined"&&typeof window.addEventListener==="function"){
    window.addEventListener("error",function(event){
      if(!bootMounted&&event&&fromInjectedChunk(event.filename))failBoot("chunk_execution_error");
    });
    window.addEventListener("unhandledrejection",function(event){
      var rejection=event&&event.reason;
      if(!bootMounted&&rejection&&fromInjectedChunk(rejection.stack))failBoot("chunk_rejection");
    });
  }
  if(bootRoot&&typeof MutationObserver==="function"){
    mountObserver=new MutationObserver(watchRoot);
    mountObserver.observe(bootRoot,{childList:true});
  }
  if(typeof fetch!=="function"){
    failBoot("bootstrap_unsupported");
    return;
  }
  fetch("/index.html",{credentials:"same-origin",headers:{"x-mingla-public-bootstrap":"1"}})
    .then(function(response){if(!response.ok)throw new Error("bootstrap_http");return response.text();})
    .then(function(html){
      if(!html)throw new Error("bootstrap_empty");
      var parsed=new DOMParser().parseFromString(html,"text/html");
      var scripts=parsed.querySelectorAll("script[src]");
      if(!scripts.length)throw new Error("bootstrap_scripts_missing");
      parsed.querySelectorAll("head style").forEach(function(source){
        appStyles.push({id:source.id||"",media:source.media||"",css:source.textContent||""});
      });
      var injected=[];
      scripts.forEach(function(source){
        if(document.querySelector('script[data-mingla-expo="'+source.src+'"]'))return;
        var script=document.createElement("script");
        script.src=source.src;
        script.type=source.type||"text/javascript";
        script.async=false;
        script.dataset.minglaExpo=source.src;
        injected.push(script);
      });
      var remaining=injected.length;
      injected.forEach(function(script){
        bootChunks.push(script.src);
        script.addEventListener("error",function(){failBoot("chunk_load_error");});
        script.addEventListener("load",function(){
          remaining-=1;
          if(remaining>0||bootFailure||bootMounted)return;
          mountTimer=setTimeout(function(){
            mountTimer=null;
            confirmMount();
            if(!bootMounted)failBoot("mount_timeout");
          },${BOOT_MOUNT_DEADLINE_MS});
        });
        document.body.appendChild(script);
      });
    }).catch(function(error){
      var message=error&&error.message;
      failBoot(message==="bootstrap_http"||message==="bootstrap_empty"||message==="bootstrap_scripts_missing"?message:"bootstrap_network");
    });
})();`;

module.exports = { BOOT_MOUNT_DEADLINE_MS, browserRuntimeScript };
