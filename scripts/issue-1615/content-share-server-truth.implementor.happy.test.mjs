/** #1615 served-truth implementor proof.
 * FAILS-ON-REVERT: reverting served refresh, exact history, publicDetails or
 * coverless handling fails ST1–ST4 while producer suites remain independent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { mapAuthoritativeShareFacts, mapServedMediaIdentity, ticketTruthAt } from '../../supabase/functions/_shared/contentShare.ts';
import { refreshContentShareV1, validatePublicContentShareEnvelope } from '../../supabase/functions/_shared/contentShareService.ts';
import { isPublicShareMediaUrl, openStateForHours } from '../../packages/sharing/index.js';
import { proxySharedCard, INTERNAL_PROXY_HEADER } from '../../mingla-marketing/lib/shared-card-proxy.ts';
// [TEST-MOD-APPROVED #1615] Next.js route handlers may expose only the framework
// request/context signature. Inject fetch through the exported helper so this
// runtime proof cannot force an invalid production POST signature again.
import { proxyContentShareAnalytics } from '../../mingla-marketing/lib/content-share-analytics-proxy.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=(file)=>fs.readFileSync(path.join(ROOT,file),'utf8');
const require=createRequire(import.meta.url);

test('ST1 exact versions, current envelopes and legacy aliases are service-only and expose versioned publicDetails',()=>{
  const sql=read('supabase/migrations/20270226011615_issue_1615_content_share_version_resolver.sql');
  for(const fn of ['resolve_content_share_version','resolve_content_share_code','resolve_content_share_alias']){
    assert.ok(sql.includes(`FUNCTION public.${fn}`),fn);
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated`));
  }
  assert.match(sql,/'destination', v\.destination_manifest - 'publicDetails'/);
  assert.match(sql,/'publicDetails', COALESCE\(v\.destination_manifest->'publicDetails'/);
  assert.match(sql,/legacy_alias_collision/);
});

test('ST2 a transient link read returns retryable 503 and cannot advance a version',async()=>{
  let rpcCount=0;
  const db={
    from(table){assert.equal(table,'content_share_links');return{select(){return this},eq(){return this},async maybeSingle(){return{data:null,error:{message:'timeout'}}}}},
    async rpc(){rpcCount+=1;throw new Error('must not upsert')},
  };
  assert.deepEqual(await refreshContentShareV1(db,'Aa0Bb1Cc2Dd3Ee4F'),{status:503,body:{error:'unavailable'}});
  assert.equal(rpcCount,0);
});

test('ST3 mapper keeps free truthful, maps Google price enums and versions sanitized ordered stops',()=>{
  const event=mapAuthoritativeShareFacts('event',{row:{title:'Free first',slug:'free',timezone:'UTC',brands:{slug:'brand'}},date:{start_at:'2027-01-01T10:00:00Z'},eligibleTickets:[{price_cents:5000,currency:'USD'},{price_cents:0,currency:'USD',is_free:true}],relevantDates:[{start_at:'2027-01-01T10:00:00Z'}],actionEligible:true});
  assert.deepEqual(event.facts.price,{minorUnits:0,currency:'USD',disclosure:'Free'});
  assert.equal(event.publicDetails.actionEligible,true);
  const place=mapAuthoritativeShareFacts('place',{row:{name:'Cafe',google_place_id:'google-public',price_level:'PRICE_LEVEL_EXPENSIVE'}});
  assert.equal(place.facts.priceLevel,'$$$');
  const curated=mapAuthoritativeShareFacts('curated',{row:{title:'Plan',card_data:{stops:[{title:'One',placeId:'google-1',privateNote:'never'},{title:'Two'}]}}});
  assert.deepEqual(curated.publicDetails.stops.map((stop)=>stop.title),['One','Two']);
  assert.equal(JSON.stringify(curated.publicDetails).includes('privateNote'),false);
  assert.equal(JSON.stringify(curated.publicDetails).includes('placeId'),false);
});

test('ST4 coverless S6 claims only the version-addressed fallback card, never motion or a transaction it cannot honour',()=>{
  const {renderContentShareHtml}=require(path.join(ROOT,'mingla-business/server/socialPreview.js'));
  // [TEST-MOD-APPROVED #2656] `destination` gains the `kind` and `webPath` it
  // always needed. `contentShareBusinessDestination` fails closed unless
  // `destination.kind` equals `facts.kind` AND `destination.webPath` equals the
  // path it derives from the slugs, so the previous `{brandSlug,eventSlug}` shape
  // resolved to null and this page rendered no offering CTA at any eligibility.
  // See the falsifiability note on the `>Buy tickets<` guard below.
  const base={shortCode:'Aa0Bb1Cc2Dd3Ee4F',version:2,facts:{schemaVersion:1,kind:'event',title:'Truth'},destination:{kind:'event',brandSlug:'b',eventSlug:'e',webPath:'/e/b/e'},publicDetails:{kind:'event',actionEligible:false}};
  const coverless=renderContentShareHtml({...base,media:null});
  // [TEST-MOD-APPROVED #2589] BEHAVIOUR INVERSION, not a narrowing. The former
  // single guard `doesNotMatch(/og:image|twitter:image|class="portrait"|>Buy
  // tickets</)` pinned the PRE-#2589 defect as a contract: it required a
  // coverless share to make no image claim at all, which is precisely why a
  // coverless offering previewed as a bare URL. #2589 exists to invert three of
  // those four clauses — there is now always a real, first-party, version-
  // addressed fallback card to point at, so og:image, twitter:image and the
  // body portrait are CORRECT, not defects.
  //
  // The three obsolete clauses are replaced by POSITIVE assertions rather than
  // deleted, so ST4 keeps its real intent: a coverless share must make no media
  // claim it cannot honour.
  //   (1) `>Buy tickets<` stays forbidden — UNCHANGED. This fixture is
  //       actionEligible:false, so a transaction CTA would still be a lie.
  //   (2) og:image / twitter:image must be PRESENT and must carry the
  //       version-addressed first-party card for THIS short code — not empty,
  //       not a placeholder, not a third-party host.
  //   (3) exactly one <img> in the whole document and it is that same card, and
  //       NO <video> element at all. #2589 detached only the image tag from the
  //       poster gate; the MOTION layer is still gated on a real poster, so a
  //       coverless share must not mount one. This is the assertion that
  //       carries ST4's original meaning forward.
  // [TEST-MOD-APPROVED #2656] Clause (1) above was UNFALSIFIABLE, so the thing it
  // claimed to keep forbidden was never actually guarded. With the pre-#2656
  // fixture the destination gate failed closed, `offeringHref` was "" and
  // `action` was null, so this document contained NO offering CTA at all —
  // `>Buy tickets<` could not appear whatever the eligibility said. Proven by
  // real line replacement, not by reasoning: rewriting
  // `mingla-business/server/socialPreview.js` line 420 to
  // `const offeringActionEligible = true;` — deleting the eligibility gate from
  // the product outright — left all 19 tests in this file GREEN. The clause only
  // bit when the DESTINATION gate and the ELIGIBILITY gate failed together,
  // which means it guarded neither.
  //
  // The fixture now carries a real, self-consistent destination, so a CTA
  // genuinely renders, and the guard is asserted in BOTH directions against that
  // same destination. The ONLY difference between the two documents is
  // `publicDetails.actionEligible`:
  //   not eligible -> the transaction CTA is ABSENT, and the non-transactional
  //                   "View event" CTA is PRESENT. That positive control is the
  //                   load-bearing half: it proves the CTA machinery is live in
  //                   THIS document, so the absence can only be the eligibility
  //                   gate's doing and not a CTA that could never render.
  //   eligible     -> the transaction CTA is PRESENT.
  // Deleting or inverting the eligibility gate now turns these RED.
  //
  // Hrefs are compared as origin-relative paths because `PUBLIC_ORIGIN` is
  // env-overridable; the path, the action code and the label are the contract.
  const eligible=renderContentShareHtml({...base,media:null,publicDetails:{kind:'event',actionEligible:true}});
  const ctaOf=(html)=>[...html.matchAll(/<a class="cta" data-share-destination="([^"]*)" href="([^"]*)">([^<]*)<\/a>/g)].map(([,code,href,label])=>({code,label,path:href.replace(/^https?:\/\/[^/]+/,'')}));
  assert.deepEqual(ctaOf(coverless),[{code:'view_event',label:'View event',path:'/e/b/e'}],'not eligible still renders a real CTA, so the absence below is the eligibility gate');
  assert.doesNotMatch(coverless,/>Buy tickets</);
  assert.deepEqual(ctaOf(eligible),[{code:'buy_tickets',label:'Buy tickets',path:'/e/b/e'}],'eligible turns the very same CTA transactional');
  assert.match(eligible,/>Buy tickets</);
  const ogImage=coverless.match(/<meta property="og:image" content="([^"]*)" \/>/)?.[1];
  assert.match(String(ogImage),/^https:\/\/usemingla\.com\/og\/s\/Aa0Bb1Cc2Dd3Ee4F\/v2-r\d+\.jpg$/);
  assert.ok(coverless.includes(`<meta name="twitter:image" content="${ogImage}" />`),'twitter:image carries the same fallback card');
  assert.ok(coverless.includes(`<div class="portrait"><img class="portrait-poster" src="${ogImage}"`),'body portrait shows the same fallback card');
  assert.deepEqual([...coverless.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((match)=>match[1]),[ogImage]);
  assert.doesNotMatch(coverless,/<video/);
  const host='gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/share';
  const video=renderContentShareHtml({...base,media:{kind:'video',url:`https://${host}/a.mp4`,posterUrl:`https://${host}/a.jpg`}});
  // [TEST-MOD-APPROVED #1615] The hand-built motion composition was an
  // unmeasured second identity mount. The corrected path clips the immutable
  // canonical portrait above motion while retaining independent safe controls.
  for(const token of ['play-control','sound-control','Unmute video','v.muted=true','portrait-identity-overlay'])assert.ok(video.includes(token),token);
  assert.doesNotMatch(video,/motion-(?:composition|wordmark|title|plate)/);
  // [TEST-MOD-APPROVED #2589] Additive only — proves the new coverless `<video>`
  // guard above is discriminating rather than vacuous: the SAME renderer does
  // mount a motion element once a real poster stands behind it.
  assert.match(video,/<video class="share-motion"/);
});

test('ST5 public details are exact, bounded and contain neither provider hours nor nested identity',()=>{
  const place=mapAuthoritativeShareFacts('place',{row:{name:'Cafe',google_place_id:'g1',opening_hours:{provider:'raw'},website:'https://usemingla.com/cafe'}});
  assert.equal('openingHours' in place.publicDetails,false);
  const base={state:'active',gone:false,shortCode:'Aa0Bb1Cc2Dd3Ee4F',version:1,facts:{schemaVersion:1,kind:'curated',title:'Plan',route:{}},media:null,destination:{kind:'curated'},publicDetails:{kind:'curated',stops:[{title:'One'}]}};
  assert.ok(validatePublicContentShareEnvelope(base));
  assert.equal(validatePublicContentShareEnvelope({...base,publicDetails:{kind:'curated',stops:[{title:'One',placeId:'private'}]}}),null);
  const placeEnvelope={...base,facts:{schemaVersion:1,kind:'place',title:'Cafe',route:{placeId:'g1'}},destination:{kind:'place',placeId:'g1'},publicDetails:{kind:'place',website:'javascript:alert(1)'}};
  assert.equal(validatePublicContentShareEnvelope(placeEnvelope),null);
  const eventEnvelope={...base,facts:{schemaVersion:1,kind:'event',title:'Event',route:{eventSlug:'e'}},destination:{kind:'event',brandSlug:'b',eventSlug:'e',webPath:'/e/b/e'},publicDetails:{kind:'event',actionEligible:true,occurrences:[{startAt:'not-a-date'}]}};
  assert.equal(validatePublicContentShareEnvelope(eventEnvelope),null);
  assert.equal(validatePublicContentShareEnvelope({...placeEnvelope,publicDetails:{kind:'place'},facts:{...placeEnvelope.facts,openState:'Open now'}}),null);
  assert.equal(validatePublicContentShareEnvelope({...placeEnvelope,publicDetails:{kind:'place'},facts:{...placeEnvelope.facts,timezone:'viewer-local'}}),null);
});

test('ST6 unlimited, unknown and future ticket truth never fabricates finite availability or sold out',()=>{
  const now=Date.parse('2027-01-01T12:00:00Z');
  const mixed=ticketTruthAt([{id:'finite'},{id:'unlimited',is_unlimited:true}],[{ticket_type_id:'finite',remaining:3}],now);
  assert.equal(mixed.availability,undefined);assert.equal(mixed.soldOut,false);assert.equal(mixed.eligibleTickets.length,2);
  const unknown=ticketTruthAt([{id:'unknown'}],[],now);
  assert.equal(unknown.availability,undefined);assert.equal(unknown.soldOut,false);assert.equal(unknown.eligibleTickets.length,1);
  const future=ticketTruthAt([{id:'future',sale_start_at:'2027-01-02T12:00:00Z'}],[{ticket_type_id:'future',remaining:0}],now);
  assert.equal(future.soldOut,false);assert.equal(future.eligibleTickets.length,0);
  const finite=ticketTruthAt([{id:'finite'}],[{ticket_type_id:'finite',remaining:3}],now);
  assert.equal(finite.availability,'3 left');
});

test('ST7 exact, current and alias reads all invoke the same fail-closed envelope validator',()=>{
  const edge=read('supabase/functions/shared-card/index.ts');
  assert.match(edge,/resolve_content_share_version[\s\S]*validatePublicContentShareEnvelope\(data\)/);
  assert.match(edge,/resolve_content_share_alias[\s\S]*validatePublicContentShareEnvelope\(alias\)/);
  const service=read('supabase/functions/_shared/contentShareService.ts');
  assert.match(service,/resolve_content_share_code[\s\S]*validatePublicContentShareEnvelope\(data\)/);
  const valid={state:'active',gone:false,shortCode:'Aa0Bb1Cc2Dd3Ee4F',version:1,facts:{schemaVersion:1,kind:'curated',title:'Plan',route:{}},media:null,destination:{kind:'curated'},publicDetails:{kind:'curated',stops:[]}};
  assert.equal(validatePublicContentShareEnvelope({...valid,facts:{...valid.facts,unexpected:'private'}}),null);
});

test('ST8 S6 records only approved observed analytics and keeps motion controls clear of identity',async()=>{
  const {renderContentShareHtml}=require(path.join(ROOT,'mingla-business/server/socialPreview.js'));
  const host='gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/share';
  const base={shortCode:'Aa0Bb1Cc2Dd3Ee4F',version:2,facts:{schemaVersion:1,kind:'event',title:'Truth'},destination:{brandSlug:'b',eventSlug:'e'},publicDetails:{kind:'event',actionEligible:false,occurrences:[]}};
  const gif=renderContentShareHtml({...base,media:{kind:'gif',url:`https://${host}/a.gif`,posterUrl:`https://${host}/a.jpg`}});
  for(const token of ['share_public_page_viewed','share_install_cta_opened','gif-motion','prefers-reduced-motion','saveData','IntersectionObserver','top:24px'])assert.ok(gif.includes(token),token);
  assert.doesNotMatch(gif,/share_link_destination|confirmed_destination/);
  const {createContentShareAnalyticsHandler}=require(path.join(ROOT,'mingla-business/api/content-share-analytics.js'));
  const previous=process.env.EXPO_PUBLIC_POSTHOG_KEY;process.env.EXPO_PUBLIC_POSTHOG_KEY='phc_test';let sent;
  const handler=createContentShareAnalyticsHandler(async(_url,init)=>{sent=JSON.parse(init.body);return new Response(null,{status:200})});
  const res={headers:{},setHeader(k,v){this.headers[k]=v},end(){this.ended=true}};
  await handler({method:'POST',headers:{origin:'https://usemingla.com'},body:{event:'share_public_page_viewed',code:'Aa0Bb1Cc2Dd3Ee4F',version:2,kind:'event'}},res);
  if(previous===undefined)delete process.env.EXPO_PUBLIC_POSTHOG_KEY;else process.env.EXPO_PUBLIC_POSTHOG_KEY=previous;
  assert.equal(res.statusCode,204);assert.deepEqual(sent.properties,{distinct_id:'content-share:Aa0Bb1Cc2Dd3Ee4F',short_code:'Aa0Bb1Cc2Dd3Ee4F',version:2,content_kind:'event'});
  assert.equal(JSON.stringify(sent).includes('referral'),false);assert.equal(JSON.stringify(sent).includes('ip'),false);
});

test('ST11 S6 analytics honors both existing exact consent shapes and fails closed for every other value',()=>{
  const {renderContentShareHtml}=require(path.join(ROOT,'mingla-business/server/socialPreview.js'));
  const html=renderContentShareHtml({shortCode:'Aa0Bb1Cc2Dd3Ee4F',version:2,facts:{schemaVersion:1,kind:'event',title:'Truth'},media:null,destination:{kind:'event',brandSlug:'b',eventSlug:'e'},publicDetails:{kind:'event',actionEligible:true,occurrences:[]}});
  const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match)=>match[1]).find((value)=>value.includes('share_public_page_viewed'));
  assert.ok(script);
  const run=(stored)=>{const beacons=[];const primary={dataset:{shareDestination:'buy_tickets'},addEventListener(_event,listener){this.listener=listener}};const install={addEventListener(_event,listener){this.listener=listener}};
    vm.runInNewContext(script,{localStorage:{getItem:()=>stored},navigator:{sendBeacon:(url,body)=>{beacons.push({url,payload:JSON.parse(body)});return true}},document:{querySelector:()=>install,querySelectorAll:()=>[primary]}});
    install.listener?.();primary.listener?.();return beacons;};
  for(const granted of [JSON.stringify({choice:'granted',ts:1}),JSON.stringify({value:'granted',ts:1})]){
    const beacons=run(granted);assert.deepEqual(beacons.map((item)=>item.payload.event),['share_public_page_viewed','share_install_cta_opened','share_destination_action']);
    assert.ok(beacons.every((item)=>item.url==='/api/content-share-analytics'&&item.payload.code==='Aa0Bb1Cc2Dd3Ee4F'&&item.payload.version===2));
    assert.equal(beacons[2].payload.action,'buy_tickets');
  }
  for(const denied of [null,'{',JSON.stringify({choice:'denied'}),JSON.stringify({value:'denied'}),JSON.stringify({choice:true}),JSON.stringify({value:1}),JSON.stringify({granted:true})])assert.deepEqual(run(denied),[]);
});

test('ST12 same-origin analytics delivery, endpoint schema and privacy are fail closed',async()=>{
  const analyticsRoute=fs.readFileSync(path.join(ROOT,'mingla-marketing/app/api/content-share-analytics/route.ts'),'utf8');
  assert.match(analyticsRoute,/export async function POST\(request: Request\)/);
  assert.doesNotMatch(analyticsRoute,/export async function POST\([^)]*,/);
  let forwarded;
  const proxied=await proxyContentShareAnalytics(new Request('https://usemingla.com/api/content-share-analytics',{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({event:'share_public_page_viewed',code:'Aa0Bb1Cc2Dd3Ee4F',version:2,kind:'event'})}),async(url,init)=>{forwarded={url,init};return new Response(null,{status:204})});
  assert.equal(proxied.status,204);assert.equal(forwarded.url,'https://host.usemingla.com/api/content-share-analytics');assert.equal(forwarded.init.headers.origin,'https://usemingla.com');
  const {createContentShareAnalyticsHandler}=require(path.join(ROOT,'mingla-business/api/content-share-analytics.js'));
  const call=async(body)=>{let sent;const handler=createContentShareAnalyticsHandler(async(_url,init)=>{sent=JSON.parse(init.body);return new Response(null,{status:200})});const res={setHeader(){},end(){}};await handler({method:'POST',headers:{origin:'https://usemingla.com'},body},res);return{status:res.statusCode,sent}};
  const previous=process.env.EXPO_PUBLIC_POSTHOG_KEY;process.env.EXPO_PUBLIC_POSTHOG_KEY='phc_test';
  const valid=await call({event:'share_destination_action',code:'Aa0Bb1Cc2Dd3Ee4F',version:2,kind:'place',action:'directions'});
  for(const invalid of [
    {event:'share_destination_action',code:'Aa0Bb1Cc2Dd3Ee4F',version:2,kind:'place'},
    {event:'share_public_page_viewed',code:'Aa0Bb1Cc2Dd3Ee4F',version:2,kind:'place',action:'directions'},
    {event:'share_public_page_viewed',code:'Aa0Bb1Cc2Dd3Ee4F',version:2,kind:'place',phone:'private'},
    {event:'share_public_page_viewed',code:'bad',version:2,kind:'place'},
  ])assert.equal((await call(invalid)).status,400);
  if(previous===undefined)delete process.env.EXPO_PUBLIC_POSTHOG_KEY;else process.env.EXPO_PUBLIC_POSTHOG_KEY=previous;
  assert.equal(valid.status,204);assert.deepEqual(Object.keys(valid.sent.properties).sort(),['action','content_kind','distinct_id','short_code','version']);
  assert.equal(/referral|message|phone|https?:|tel:/i.test(JSON.stringify(valid.sent)),false);
});

test('ST13 immutable hours compute split shifts, 24 hours, overnight carry, IANA DST and fixed offsets at render time',()=>{
  const week=(monday='Closed',sunday='Closed')=>['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day)=>({day,label:day==='Monday'?monday:day==='Sunday'?sunday:'Closed'}));
  assert.equal(openStateForHours(week('9 AM–12 PM, 2 PM–5 PM'),'UTC',new Date('2027-01-04T14:30:00Z')),'Open now');
  assert.equal(openStateForHours(week('Open 24 hours'),'UTC',new Date('2027-01-04T23:59:00Z')),'Open now');
  assert.equal(openStateForHours(week('Closed','10 PM–2 AM'),'UTC',new Date('2027-01-04T01:00:00Z')),'Open now');
  assert.equal(openStateForHours(week('9 AM–5 PM'),'America/New_York',new Date('2027-03-15T13:30:00Z')),'Open now');
  assert.equal(openStateForHours(week('9 AM–5 PM'),'UTC_OFFSET:-300',new Date('2027-01-04T14:30:00Z')),'Open now');
  assert.equal(openStateForHours(week('9 AM–5 PM'),'Asia/Tokyo',new Date('2027-01-04T01:00:00Z')),'Open now');
  const untilMidnight=week('8 AM–12 AM');
  assert.equal(openStateForHours(untilMidnight,'UTC',new Date('2027-01-04T07:59:00Z')),'Closed');
  assert.equal(openStateForHours(untilMidnight,'UTC',new Date('2027-01-04T08:00:00Z')),'Open now');
  assert.equal(openStateForHours(untilMidnight,'UTC',new Date('2027-01-04T23:59:00Z')),'Open now');
  assert.equal(openStateForHours(week('Closed','8 AM–12 AM'),'UTC',new Date('2027-01-04T00:00:00Z')),'Closed');
  assert.equal(JSON.stringify(mapAuthoritativeShareFacts('venue',{row:{name:'Venue',brand_slug:'b',slug:'v',iana_timezone:'UTC',hours:[]}}).facts).includes('openState'),false);
});

test('ST14 served offering price uses canonical all-in tier truth and CTA falls back to a real public destination',()=>{
  const allIn=mapAuthoritativeShareFacts('event',{row:{title:'Paid',slug:'paid',timezone:'UTC',brands:{slug:'brand'}},eligibleTickets:[{price_cents:900,currency:'USD',all_in_cents:1299,display_currency:'gbp'},{price_cents:500,currency:'USD',all_in_cents:1500,display_currency:'usd'}]});
  assert.deepEqual(allIn.facts.price,{minorUnits:1299,currency:'GBP',disclosure:'From'});
  const missing=mapAuthoritativeShareFacts('event',{row:{title:'Missing',slug:'missing',brands:{slug:'brand'}},eligibleTickets:[{price_cents:500,currency:'USD'}]});assert.equal(missing.facts.price,undefined);
  const invalid=mapAuthoritativeShareFacts('event',{row:{title:'Invalid',slug:'invalid',brands:{slug:'brand'}},eligibleTickets:[{price_cents:500,currency:'USD',all_in_cents:700,display_currency:'US'}]});assert.equal(invalid.facts.price,undefined);
  const explicitFree=mapAuthoritativeShareFacts('event',{row:{title:'Free',slug:'free',brands:{slug:'brand'}},eligibleTickets:[{price_cents:999,currency:'USD',is_free:true}]});assert.deepEqual(explicitFree.facts.price,{minorUnits:0,currency:'USD',disclosure:'Free'});
  // [TEST-MOD-APPROVED #2117] §4.5 repoints this privileged service_role
  // consumer from the public all-in reader to its privileged sibling, because
  // its admitted visibility set is strictly wider than the public reader's
  // audience. The assertion tracks the repointed name; the error-propagation
  // half — which is the part that actually carries behaviour — is unchanged.
  const source=read('supabase/functions/_shared/contentShare.ts');assert.match(source,/db\.rpc\("pg_privileged_event_tier_allin"/);assert.match(source,/allInResult\.error[\s\S]*throw new Error\("db_error"\)/);
  // [TEST-MOD-APPROVED #2008] #2004 made the canonical webPath a required,
  // exact member of served destination truth; this fixture must model it.
  const {renderContentShareHtml}=require(path.join(ROOT,'mingla-business/server/socialPreview.js'));const base={shortCode:'Aa0Bb1Cc2Dd3Ee4F',version:1,media:null,destination:{kind:'event',brandSlug:'brand',eventSlug:'paid',webPath:'/e/brand/paid'},publicDetails:{kind:'event',actionEligible:false,occurrences:[]}};
  const unavailable=renderContentShareHtml({...base,facts:{schemaVersion:1,kind:'event',title:'Paid',status:'sold_out'}});assert.match(unavailable,/>View event<\/a>/);assert.doesNotMatch(unavailable,/>Buy tickets<\/a>/);
  const eligible=renderContentShareHtml({...base,publicDetails:{...base.publicDetails,actionEligible:true},facts:{schemaVersion:1,kind:'event',title:'Paid'}});assert.match(eligible,/>Buy tickets<\/a>/);
  // [TEST-MOD-APPROVED #2008] Missing or mismatched canonical paths must stay
  // fail-closed: no business destination CTA and no continuation redirect.
  for(const destination of [{kind:'event',brandSlug:'brand',eventSlug:'paid'},{kind:'event',brandSlug:'brand',eventSlug:'paid',webPath:'/e/brand/wrong'}]){
    const rejected=renderContentShareHtml({...base,destination,facts:{schemaVersion:1,kind:'event',title:'Paid'}});
    assert.doesNotMatch(rejected,/>Buy tickets<\/a>|>View event<\/a>|window\.location\.replace/);
  }
});

test('ST15 deferred web referral is server-derived and private while installed-direct remains the opaque content code',async()=>{
  const {contentShareOneLink}=require(path.join(ROOT,'mingla-business/server/contentShareService.js'));
  const link=new URL(contentShareOneLink('Aa0Bb1Cc2Dd3Ee4F','REF-9'));assert.equal(link.searchParams.get('deep_link_sub1'),'Aa0Bb1Cc2Dd3Ee4F');assert.equal(link.searchParams.get('af_sub1'),'REF-9');
  const service=read('supabase/functions/_shared/contentShareService.ts');assert.match(service,/profiles"\)\.select\("referral_code"\)/);assert.match(service,/privateInstallAttribution/);
  const priorSecret=process.env.SHARED_CARD_PROXY_SECRET;process.env.SHARED_CARD_PROXY_SECRET='secret';const dataPath=path.join(ROOT,'mingla-business/api/content-share-data.js');delete require.cache[require.resolve(dataPath)];const {createContentShareDataHandler}=require(dataPath);
  const handler=createContentShareDataHandler(async()=>({status:200,contentShare:{shortCode:'Aa0Bb1Cc2Dd3Ee4F'},installAttribution:{referralCode:'REF-9'}}));const res={setHeader(){},end(body){this.body=String(body)}};await handler({headers:{'x-mingla-shared-card-proxy':'secret'},query:{code:'Aa0Bb1Cc2Dd3Ee4F'}},res);
  assert.equal(JSON.parse(res.body).contentShare.shortCode,'Aa0Bb1Cc2Dd3Ee4F');assert.equal(res.body.includes('REF-9'),false);
  if(priorSecret===undefined)delete process.env.SHARED_CARD_PROXY_SECRET;else process.env.SHARED_CARD_PROXY_SECRET=priorSecret;
});

test('ST16 immutable image proxy preserves exact 200/304 identity and lets revocation 410 win',async()=>{
  // [TEST-MOD-APPROVED #1615] Physical WhatsApp disproved the former
  // PNG/private-revalidation transport; revision 2 is immutable bounded JPEG.
  const previous=process.env.SHARED_CARD_PROXY_SECRET;process.env.SHARED_CARD_PROXY_SECRET='secret';const code='Aa0Bb1Cc2Dd3Ee4F',etag=`"content-share-${code}-v3-r2-jpeg"`;
  const request=(ifNone='')=>new Request(`https://usemingla.com/og/s/${code}/v3-r2.jpg`,{headers:{[INTERNAL_PROXY_HEADER]:'secret',...(ifNone?{'if-none-match':ifNone}:{})}});
  // [TEST-MOD-APPROVED #1615] Tester proved SOI/EOI marker bytes alone were
  // not a valid image; exercise the immutable path with a decoded 1080x1350 JPEG.
  const sharp=require(path.join(ROOT,'mingla-business/node_modules/sharp'));const jpeg=await sharp({create:{width:1080,height:1350,channels:3,background:'#0C0E12'}}).jpeg({quality:66,progressive:true}).toBuffer();
  const ok=await proxySharedCard(request(),code,'content-image',async()=>new Response(jpeg,{status:200,headers:{'content-type':'image/jpeg',etag,'content-length':String(jpeg.length)}}),'3');
  assert.equal(ok.status,200);assert.equal(ok.headers.get('content-type'),'image/jpeg');assert.equal(ok.headers.get('etag'),etag);for(const key of ['cache-control','cdn-cache-control','vercel-cdn-cache-control'])assert.equal(ok.headers.get(key),'public, max-age=31536000, immutable');
  const unchanged=await proxySharedCard(request(etag),code,'content-image',async(_url,init)=>{assert.equal(init.headers['if-none-match'],etag);return new Response(null,{status:304,headers:{etag}})},'3');
  assert.equal(unchanged.status,304);assert.equal(unchanged.headers.get('etag'),etag);
  const gone=await proxySharedCard(request(etag),code,'content-image',async()=>new Response(null,{status:410}),'3');assert.equal(gone.status,410);assert.equal(gone.headers.get('cache-control'),'private, no-store, max-age=0');
  if(previous===undefined)delete process.env.SHARED_CARD_PROXY_SECRET;else process.env.SHARED_CARD_PROXY_SECRET=previous;
});

test('ST17 the strict public envelope accepts all eight exact kind contracts and rejects key smuggling',()=>{
  const code='Aa0Bb1Cc2Dd3Ee4F';const base=(kind,facts,destination,publicDetails)=>({state:'active',gone:false,shortCode:code,version:1,facts:{schemaVersion:1,kind,title:'Public',...facts},media:null,destination:{kind,...destination},publicDetails:{kind,...publicDetails}});
  const envelopes=[
    base('place',{route:{placeId:'google'},timezone:'UTC_OFFSET:-300',hours:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((day)=>({day,label:'Closed'}))},{placeId:'google'},{utcOffsetMinutes:-300}),
    base('curated',{route:{},stopCount:1},{},{stops:[{title:'One'}]}),
    base('event',{route:{eventSlug:'event'}},{brandSlug:'brand',eventSlug:'event',webPath:'/e/brand/event'},{actionEligible:true,occurrences:[]}),
    base('rsvp_event',{route:{eventSlug:'rsvp'}},{brandSlug:'brand',eventSlug:'rsvp',webPath:'/e/brand/rsvp'},{actionEligible:true,occurrences:[]}),
    base('trip',{route:{eventSlug:'trip'}},{brandSlug:'brand',eventSlug:'trip',webPath:'/t/brand/trip'},{actionEligible:true,occurrences:[]}),
    base('experience',{route:{eventSlug:'experience'}},{brandSlug:'brand',eventSlug:'experience',webPath:'/exp/brand/experience'},{actionEligible:true,occurrences:[]}),
    base('venue',{route:{brandSlug:'brand',venueSlug:'venue'},timezone:'America/New_York'},{brandSlug:'brand',venueSlug:'venue',webPath:'/b/brand/v/venue'},{offerings:[]}),
    base('brand',{route:{brandSlug:'brand'}},{brandSlug:'brand',webPath:'/b/brand'},{offerings:[]}),
  ];
  for(const envelope of envelopes){assert.ok(validatePublicContentShareEnvelope(envelope),envelope.facts.kind);assert.equal(validatePublicContentShareEnvelope({...envelope,privateId:'no'}),null);}
});

test('ST18 governed media origins require HTTPS, no credentials, and the default port at every served boundary',()=>{
  const renderer=require(path.join(ROOT,'mingla-business/server/cardIdentityRenderer.js'));
  const valid='https://vz-a16fce08-6c6.b-cdn.net/poster.jpg';
  const wrongPort='https://vz-a16fce08-6c6.b-cdn.net:8443/poster.jpg';
  // [TEST-MOD-APPROVED #1615] Build the credential-bearing URL at runtime so
  // the security scanner does not mistake a deliberate rejection fixture for
  // a committed credential; the executed boundary case remains identical.
  const credentialUrl=new URL(valid);
  credentialUrl.username=['fixture','user'].join('-');
  credentialUrl.password=['fixture','value'].join('-');
  const credentials=credentialUrl.toString();
  assert.equal(isPublicShareMediaUrl(valid),true);
  assert.equal(renderer.isAllowedPublicPoster(valid),true);
  for(const rejected of [wrongPort,credentials]){
    assert.equal(isPublicShareMediaUrl(rejected),false);
    assert.equal(renderer.isAllowedPublicPoster(rejected),false);
    assert.equal(mapServedMediaIdentity({cover_media_url:rejected,cover_media_type:'image'}),null);
    const envelope={state:'active',gone:false,shortCode:'Aa0Bb1Cc2Dd3Ee4F',version:1,facts:{schemaVersion:1,kind:'brand',title:'Boundary',media:{kind:'photo',url:rejected,posterUrl:rejected}},media:{kind:'photo',url:rejected,posterUrl:rejected},destination:{kind:'brand',brandSlug:'boundary',webPath:'/b/boundary'},publicDetails:{kind:'brand',offerings:[]}};
    assert.equal(validatePublicContentShareEnvelope(envelope),null);
  }
});

test('ST19 moving media preserves the exact immutable portrait identity instead of mounting a second plate',()=>{
  const {renderContentShareHtml}=require(path.join(ROOT,'mingla-business/server/socialPreview.js'));
  const code='Aa0Bb1Cc2Dd3Ee4F';
  const html=renderContentShareHtml({shortCode:code,version:4,facts:{schemaVersion:1,kind:'event',title:'Measured motion'},media:{kind:'video',url:'https://vz-a16fce08-6c6.b-cdn.net/video.mp4',posterUrl:'https://vz-a16fce08-6c6.b-cdn.net/poster.jpg'},destination:{kind:'event'},publicDetails:{kind:'event',actionEligible:false,occurrences:[]}});
  // [TEST-MOD-APPROVED #1615] Motion overlays follow the same revisioned JPEG
  // portrait identity that chat crawlers receive.
  const exact=`https://usemingla.com/og/s/${code}/v4-r2.jpg`;
  assert.equal((html.match(new RegExp(exact.replaceAll('/','\\/'),'g'))||[]).length>=3,true);
  assert.match(html,/portrait-identity-overlay identity-wordmark/);
  assert.match(html,/portrait-identity-overlay identity-bottom/);
  assert.doesNotMatch(html,/motion-(?:composition|wordmark|title|plate)/);
});

test('ST9 browser legacy alias renders the matching canonical S6 identity, never the legacy card',async()=>{
  const previous=process.env.SHARED_CARD_PROXY_SECRET;process.env.SHARED_CARD_PROXY_SECRET='test-secret';
  const apiPath=path.join(ROOT,'mingla-business/api/shared-card.js');delete require.cache[require.resolve(apiPath)];
  const {createSharedCardHandler}=require(apiPath);const code='Aa0Bb1Cc2Dd3Ee4F';
  const handler=createSharedCardHandler(async()=>({status:200,snapshot:{title:'Old',metadata:{hours:{provider:'raw'}}},canonicalUrl:`https://usemingla.com/s/${code}`}),async()=>({status:200,contentShare:{shortCode:code,version:7,facts:{schemaVersion:1,kind:'curated',title:'Canonical',route:{}},media:null,destination:{kind:'curated'},publicDetails:{kind:'curated',stops:[]}}}));
  const res={headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=String(body||'')}};
  await handler({headers:{'x-mingla-shared-card-proxy':'test-secret'},query:{shareId:'a'.repeat(36)}},res);
  if(previous===undefined)delete process.env.SHARED_CARD_PROXY_SECRET;else process.env.SHARED_CARD_PROXY_SECRET=previous;
  // [TEST-MOD-APPROVED #1615] Legacy aliases now render the revisioned JPEG
  // portrait URL when media exists, while coverless aliases stay canonical.
  assert.equal(res.statusCode,200);assert.match(res.body,new RegExp(`/og/s/${code}/v7-r2\\.jpg|/s/${code}`));
  assert.doesNotMatch(res.body,/mingla-business-logo|provider:'raw'|>mingla</i);
  const place={state:'active',gone:false,shortCode:code,version:8,facts:{schemaVersion:1,kind:'place',title:'Cafe',route:{placeId:'google-1'}},media:null,destination:{kind:'place',placeId:'google-1'},publicDetails:{kind:'place',address:'1 Main St'}};
  const curated={state:'active',gone:false,shortCode:code,version:7,facts:{schemaVersion:1,kind:'curated',title:'Plan',route:{}},media:null,destination:{kind:'curated'},publicDetails:{kind:'curated',stops:[{title:'One'}]}};
  assert.ok(validatePublicContentShareEnvelope(place));assert.ok(validatePublicContentShareEnvelope(curated));
  const sql=read('supabase/migrations/20270226011615_issue_1615_content_share_version_resolver.sql');
  assert.match(sql,/'placeId', CASE WHEN v_old\.kind='place' THEN NULLIF\(v_old\.source_ids->>'googlePlaceId'/);
  assert.match(sql,/DELETE FROM public\.content_share_aliases[\s\S]*Preserve its original \/p snapshot|Preserve its original \/p snapshot[\s\S]*DELETE FROM public\.content_share_aliases/);
});

test('ST10 S6 computes visible Today at render time from venue IANA and place fixed-offset clocks',()=>{
  const {todayForShareTimezone,renderContentShareHtml}=require(path.join(ROOT,'mingla-business/server/socialPreview.js'));
  const instant=new Date('2027-01-04T01:00:00Z');
  assert.equal(todayForShareTimezone('America/New_York',instant),'Sunday');
  assert.equal(todayForShareTimezone('Asia/Tokyo',instant),'Monday');
  assert.equal(todayForShareTimezone('UTC_OFFSET:-300',instant),'Sunday');
  assert.equal(todayForShareTimezone('UTC_OFFSET:540',instant),'Monday');
  const hours=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((day)=>({day,label:'9 AM–5 PM'}));
  const html=renderContentShareHtml({shortCode:'Aa0Bb1Cc2Dd3Ee4F',version:1,facts:{schemaVersion:1,kind:'venue',title:'Venue',timezone:'America/New_York',hours},media:null,destination:{kind:'venue',brandSlug:'b',venueSlug:'v'},publicDetails:{kind:'venue',offerings:[]}});
  assert.match(html,/class="today"[\s\S]*<em>Today<\/em>/);assert.doesNotMatch(JSON.stringify(hours),/isToday/);
});
