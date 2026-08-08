const ALLOWED_ORIGINS=new Set(["https://usemingla.com","https://www.usemingla.com","https://business.usemingla.com"]);
const EVENTS=new Set(["share_public_page_viewed","share_install_cta_opened","share_destination_action"]);
const KINDS=new Set(["place","curated","event","rsvp_event","trip","experience","venue","brand"]);
const ACTIONS=new Set(["buy_tickets","rsvp","book_trip","book_experience","view_event","view_rsvp_event","view_trip","view_experience","view_venue","view_brand","directions","website","call","view_offering"]);

const readBody=async(req)=>{
  if(req.body&&typeof req.body==="object")return req.body;
  let text="";for await(const chunk of req){text+=chunk;if(text.length>512)throw new Error("too_large");}
  return JSON.parse(text||"null");
};

const createContentShareAnalyticsHandler=(send=fetch)=>async(req,res)=>{
  res.setHeader("cache-control","private, no-store, max-age=0");
  if(req.method!=="POST"){res.statusCode=405;return res.end();}
  const origin=String(req.headers?.origin||"");
  if(!ALLOWED_ORIGINS.has(origin)){res.statusCode=404;return res.end();}
  let body;try{body=await readBody(req);}catch{res.statusCode=400;return res.end();}
  const actionRequired=body?.event==="share_destination_action";
  if(!body||typeof body!=="object"||Array.isArray(body)||!EVENTS.has(body.event)||!KINDS.has(body.kind)
    ||typeof body.code!=="string"||!/^[0-9A-Za-z]{16}$/.test(body.code)||!Number.isSafeInteger(body.version)||body.version<1
    ||(actionRequired?!ACTIONS.has(body.action):body.action!==undefined)
    ||Object.keys(body).some((key)=>!["event","code","version","kind",...(actionRequired?["action"]:[])].includes(key))){res.statusCode=400;return res.end();}
  const key=process.env.EXPO_PUBLIC_POSTHOG_KEY||"";
  if(/^phc_[A-Za-z0-9_-]+$/.test(key)){
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),2000);
    try{await send("https://us.i.posthog.com/capture/",{method:"POST",redirect:"error",signal:controller.signal,headers:{"content-type":"application/json"},body:JSON.stringify({api_key:key,event:body.event,properties:{distinct_id:`content-share:${body.code}`,short_code:body.code,version:body.version,content_kind:body.kind,...(actionRequired?{action:body.action}:{})}})});}catch{}finally{clearTimeout(timeout);}
  }
  res.statusCode=204;return res.end();
};

module.exports=createContentShareAnalyticsHandler();
module.exports.createContentShareAnalyticsHandler=createContentShareAnalyticsHandler;
