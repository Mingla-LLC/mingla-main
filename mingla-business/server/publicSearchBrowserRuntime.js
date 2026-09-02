// SHARE-SEMANTIC-ROLE:content-transport

const escapeJsonForHtml = (value) => JSON.stringify(value)
  .replace(/&/g, "\\u0026")
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

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
  if(typeof fetch!=="function"){
    showBootstrapFailure();
    return;
  }
  fetch("/index.html",{credentials:"same-origin",headers:{"x-mingla-public-bootstrap":"1"}})
    .then(function(response){if(!response.ok)throw new Error("bootstrap_http");return response.text();})
    .then(function(html){
      if(!html)throw new Error("bootstrap_empty");
      var parsed=new DOMParser().parseFromString(html,"text/html");
      var scripts=parsed.querySelectorAll("script[src]");
      if(!scripts.length)throw new Error("bootstrap_scripts_missing");
      scripts.forEach(function(source){
        if(document.querySelector('script[data-mingla-expo="'+source.src+'"]'))return;
        var script=document.createElement("script");
        script.src=source.src;
        script.type=source.type||"text/javascript";
        script.defer=true;
        script.dataset.minglaExpo=source.src;
        document.body.appendChild(script);
      });
    }).catch(function(){showBootstrapFailure();});
})();`;

module.exports = { browserRuntimeScript };
