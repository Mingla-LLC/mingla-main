const ALLOWED_ORIGINS=new Set(["https://usemingla.com","https://www.usemingla.com","https://host.usemingla.com"]);
const EVENTS=new Set(["share_public_page_viewed","share_install_cta_opened","share_destination_action"]);
const KINDS=new Set(["place","curated","event","rsvp_event","trip","experience","venue","brand"]);
const ACTIONS=new Set(["buy_tickets","rsvp","book_trip","book_experience","view_event","view_rsvp_event","view_trip","view_experience","view_venue","view_brand","directions","website","call","view_offering"]);
const PUBLIC_PAGE_FAMILIES=new Set(["opaque-share","content-share"]);
const PUBLIC_PAGE_KEYS=new Set(["event","surface","page_family","entity_id","entity_kind","route_kind","initial_state","auth_state"]);
const SAFE_ENTITY_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const readBody=async(req)=>{
  if(req.body&&typeof req.body==="object")return req.body;
  let text="";for await(const chunk of req){text+=chunk;if(text.length>512)throw new Error("too_large");}
  return JSON.parse(text||"null");
};

const isPublicPageViewed=(body)=>body?.event==="public_page_viewed"
  &&body.surface==="buyer-web"
  &&PUBLIC_PAGE_FAMILIES.has(body.page_family)
  &&body.entity_kind===body.page_family
  &&body.route_kind===body.page_family
  &&typeof body.entity_id==="string"&&SAFE_ENTITY_ID.test(body.entity_id)
  &&body.initial_state==="populated"
  &&body.auth_state==="unknown"
  &&Object.keys(body).length===PUBLIC_PAGE_KEYS.size
  &&Object.keys(body).every((key)=>PUBLIC_PAGE_KEYS.has(key));

const isLegacyShareEvent=(body)=>{
  const actionRequired=body?.event==="share_destination_action";
  const allowedKeys=["event","code","version","kind",...(actionRequired?["action"]:[])];
  return !!body&&typeof body==="object"&&!Array.isArray(body)&&EVENTS.has(body.event)&&KINDS.has(body.kind)
    &&typeof body.code==="string"&&/^[0-9A-Za-z]{16}$/.test(body.code)&&Number.isSafeInteger(body.version)&&body.version>=1
    &&(actionRequired?ACTIONS.has(body.action):body.action===undefined)
    &&Object.keys(body).every((key)=>allowedKeys.includes(key));
};

const createContentShareAnalyticsHandler=(send=fetch)=>async(req,res)=>{
  res.setHeader("cache-control","private, no-store, max-age=0");
  if(req.method!=="POST"){res.statusCode=405;return res.end();}
  const origin=String(req.headers?.origin||"");
  if(!ALLOWED_ORIGINS.has(origin)){res.statusCode=404;return res.end();}
  let body;try{body=await readBody(req);}catch{res.statusCode=400;return res.end();}
  const commonEvent=isPublicPageViewed(body);
  if(!commonEvent&&!isLegacyShareEvent(body)){res.statusCode=400;return res.end();}
  const key=process.env.EXPO_PUBLIC_POSTHOG_KEY||"";
  if(/^phc_[A-Za-z0-9_-]+$/.test(key)){
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),2000);
    const properties=commonEvent
      ?{distinct_id:`public-page:${body.entity_id}`,surface:body.surface,page_family:body.page_family,entity_id:body.entity_id,entity_kind:body.entity_kind,route_kind:body.route_kind,initial_state:body.initial_state,auth_state:body.auth_state}
      :{distinct_id:`content-share:${body.code}`,short_code:body.code,version:body.version,content_kind:body.kind,...(body.event==="share_destination_action"?{action:body.action}:{})};
    try{await send("https://us.i.posthog.com/capture/",{method:"POST",redirect:"error",signal:controller.signal,headers:{"content-type":"application/json"},body:JSON.stringify({api_key:key,event:body.event,properties})});}catch{}finally{clearTimeout(timeout);}
  }
  res.statusCode=204;return res.end();
};

module.exports=createContentShareAnalyticsHandler();
module.exports.createContentShareAnalyticsHandler=createContentShareAnalyticsHandler;
