import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildNativeContentCardSnapshot, assertNativeSourceIdentity, assertSavedCuratedStopsServable, nativeCuratedStopFromPlaceRow } from '../../supabase/functions/_shared/contentShare.ts';
import { createNativeContentCardSessionCache, nativeContentCardCacheKey, validateNativeContentCardDescriptorV1 } from '../../packages/sharing/index.js';

const read=(path)=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
const migration=read('supabase/migrations/20270301001719_issue_1719_native_content_card_snapshots.sql');
const message=read('app-mobile/src/components/MessageInterface.tsx');
const bubble=read('app-mobile/src/components/chat/MessageBubble.tsx');
const visual=read('app-mobile/src/components/chat/PlaceCuratedChatCard.tsx');
const saved=read('app-mobile/src/services/savedCardsService.ts');
const cache=read('app-mobile/src/services/nativeContentCardSnapshotService.ts');

const stop=(n)=>({stopNumber:n,stopLabel:n===1?'Start Here':'Then',placeId:`g-${n}`,placeName:`Stop ${n}`,placeType:'Cafe',address:`${n} Main`,rating:4.7,reviewCount:12,
  imageUrl:`https://usemingla.com/${n}.jpg`,imageUrls:[`https://usemingla.com/${n}.jpg`,`https://usemingla.com/${n}-2.jpg`],priceLevelLabel:'$$',priceTier:'comfy',priceMin:12,priceMax:30,
  openingHours:{weekdayDescriptions:['Monday: 9 AM–5 PM']},utcOffsetMinutes:-240,isOpenNow:false,website:'https://usemingla.com/',lat:35+n/100,lng:-78,
  aiDescription:`Authored ${n}`,estimatedDurationMinutes:45,optional:false,dismissible:true,role:'meal',phone:'+19195550123',countryCode:'US',comboCategory:'coffee',rankSignal:'relaxed',
  distanceFromUserKm:99,travelTimeFromUserMin:88,travelTimeFromPreviousStopMin:77,travelModeFromPreviousStop:'drive'});

test('place snapshot preserves canonical recipient fields and removes every sender-relative field',()=>{
  const input={id:'g-a',placeId:'g-a',title:'Cafe',category:'Coffee',categoryIcon:'cafe',description:'d',fullDescription:'full',image:'https://usemingla.com/a.jpg',images:['https://usemingla.com/a.jpg'],rating:4.6,reviewCount:20,
    priceRange:'$$',priceRangeStatus:'active',sourceMinMinor:1000,sourceMaxMinor:2000,sourceCurrencyCode:'USD',sourceMinorUnitExponent:2,priceIsApproximate:false,
    address:'1 Main',openingHours:{weekdayDescriptions:['Monday: 9 AM–5 PM']},utcOffsetMinutes:-240,phone:'+1',countryCode:'US',website:'https://usemingla.com/',
    highlights:['quiet'],tags:['coffee'],socialStats:{views:1,likes:2,saves:3,shares:4},lat:35,lng:-78,matchScore:99,distance:'1 mi',travelTime:'2 min'};
  const out=buildNativeContentCardSnapshot('place',input);
  for(const key of ['categoryIcon','utcOffsetMinutes','countryCode','highlights','tags','priceRangeStatus','sourceMinMinor','sourceCurrencyCode']) assert.deepEqual(out[key],input[key]);
  assert.equal(out.matchScore,undefined);assert.equal(out.distance,undefined);assert.equal(out.travelTime,undefined);
});

test('complete curated order and every allowlisted stop field survive without truncation',()=>{
  const stops=Array.from({length:30},(_,i)=>stop(i+1));
  const out=buildNativeContentCardSnapshot('curated',{card_data:{id:'plan',cardType:'curated',title:'All stops',category:'Plan',stops,totalPriceMin:12,totalPriceMax:90,estimatedDurationMinutes:240,matchScore:100}});
  assert.equal(out.stops.length,30);
  for(let i=0;i<stops.length;i++) for(const key of ['stopNumber','stopLabel','placeId','placeName','placeType','address','rating','reviewCount','imageUrl','imageUrls','priceLevelLabel','priceTier','priceMin','priceMax','openingHours','utcOffsetMinutes','isOpenNow','website','lat','lng','aiDescription','estimatedDurationMinutes','optional','dismissible','role','phone','countryCode','comboCategory','rankSignal']) assert.deepEqual(out.stops[i][key],stops[i][key],`${i}:${key}`);
  assert.equal(JSON.stringify(out).includes('distanceFrom'),false);assert.equal(JSON.stringify(out).includes('travelTime'),false);assert.equal(out.matchScore,undefined);
});

test('malformed or excessive fidelity is rejected, never clipped or filtered',()=>{
  assert.throws(()=>buildNativeContentCardSnapshot('curated',{card_data:{id:'p',cardType:'curated',title:'Plan',stops:[{...stop(1),placeName:''}]}}),/invalid_native_snapshot/);
  assert.throws(()=>buildNativeContentCardSnapshot('place',{id:'x',title:'x'.repeat(161)}),/invalid_native_snapshot/);
  assert.throws(()=>buildNativeContentCardSnapshot('place',{id:'x',title:'x',images:['https://evil.invalid/x.jpg']}),/invalid_native_snapshot/);
  assert.throws(()=>buildNativeContentCardSnapshot('place',{id:'x',title:'x',website:`https://usemingla.com/${'x'.repeat(2048)}`}),/invalid_native_snapshot/);
});

test('saved source kind and requested place identity fail closed for solo and collaboration rows',()=>{
  for(const row of [{experience_id:'g-a',card_data:{id:'g-a',title:'A'}},{saved_experience_id:'g-a',card_data:{id:'g-a',title:'A'}}]) {
    assert.doesNotThrow(()=>assertNativeSourceIdentity('place',row,{id:'pool-a',google_place_id:'g-a'}));
    assert.throws(()=>assertNativeSourceIdentity('place',row,{id:'pool-b',google_place_id:'g-b'}),/validation/);
    assert.throws(()=>assertNativeSourceIdentity('curated',row),/validation/);
  }
  assert.throws(()=>assertNativeSourceIdentity('place',{card_data:{id:'plan',cardType:'curated',stops:[stop(1)]}}),/validation/);
});

test('private cache identity changes across accounts and auth transitions clear storage',()=>{
  assert.notEqual(nativeContentCardCacheKey('user-a','message-1'),nativeContentCardCacheKey('user-b','message-1'));
  const local=createNativeContentCardSessionCache();local.set('user-a','message-1','a'.repeat(64),{title:'offline'});
  assert.deepEqual(local.get('user-a','message-1','a'.repeat(64)),{title:'offline'});assert.equal(local.get('user-b','message-1','a'.repeat(64)),null);
  local.clear();assert.equal(local.get('user-a','message-1','a'.repeat(64)),null);
  assert.match(cache,/onAuthStateChange[\s\S]+cache\.clear\(\)/);
  assert.match(cache,/getSession\(\)/);assert.doesNotMatch(cache,/getUser\(\)/);
  assert.match(cache,/expectedFingerprints[\s\S]+native_snapshot_fingerprint_mismatch/);
});

test('descriptor requires immutable fingerprint and migration enforces current-read plus all-kind envelope',()=>{
  const valid={contract:'native_content_card_v1',version:1,kind:'place',snapshotRef:'Aa0Bb1Cc2Dd3Ee4F:v1',snapshotFingerprint:'a'.repeat(64),preview:{title:'Cafe'}};
  assert.deepEqual(validateNativeContentCardDescriptorV1(valid),valid);assert.equal(validateNativeContentCardDescriptorV1({...valid,snapshotFingerprint:'bad'}),null);
  assert.match(migration,/m\.deleted_at IS NULL/);assert.match(migration,/c\.is_enabled IS TRUE/);assert.match(migration,/conversation_participants cp[\s\S]+blocked_users/);
  assert.match(migration,/NEW\.card_payload := NEW\.card_payload - 'publicDetails'/);assert.match(migration,/content_share_message_envelope_too_large/);
});

test('Chat More converges, reports failure, and clears only confirmed successful operation',()=>{
  assert.match(message,/handleSelectCardToShare[\s\S]+prepareContentShare[\s\S]+sendContentShareToRecipients/);
  assert.match(message,/if \(result\.sent !== 1\)[\s\S]+clearContentShareOperationId\(prepared\.shortCode, prepared\.version\)[\s\S]+catch/);
  assert.match(message,/nativeContentCardSnapshotService\.resolve[\s\S]+snapshotFingerprint/);
});

test('new and legacy cards use an exact extracted legacy visual contract',()=>{
  assert.ok((bubble.match(/<PlaceCuratedChatCard/g)||[]).length>=2);
  for(const token of ["width:SCREEN_WIDTH*0.6","borderRadius:12","aspectRatio:16/10","padding:10","fontSize:14","backgroundColor:'hsl(28, 80%, 45%)'"]) assert.ok(visual.replace(/\s/g,'').includes(token.replace(/\s/g,'')),token);
  assert.match(visual,/isMe\?styles\.textSent:styles\.textReceived/);
});

test('provenance stays separate from card identity',()=>{
  assert.match(saved,/sourceScope: "solo"[\s\S]+sourceRecordId: record\.id/);
  assert.match(saved,/sourceScope: "collaboration"[\s\S]+sourceRecordId: record\.id/);
});

test('unsaved curated composition maps authoritative rows into exact canonical stop keys',()=>{
  const row={google_place_id:'g-1',name:'Cafe',primary_type_display_name:'Coffee shop',address:'1 Main',rating:4.6,review_count:22,
    stored_photo_urls:['https://usemingla.com/a.jpg','https://usemingla.com/b.jpg'],price_level:'PRICE_LEVEL_MODERATE',price_min:10,price_max:30,
    opening_hours:{openNow:true,periods:[],weekdayDescriptions:['Monday: 9 AM–5 PM']},utc_offset_minutes:-240,website:'https://usemingla.com/',lat:35,lng:-78,
    editorial_summary:'Authored',national_phone_number:'+1',country_code:'US'};
  const mapped=nativeCuratedStopFromPlaceRow(row,0,1);const out=buildNativeContentCardSnapshot('curated',{card_data:{id:'p',cardType:'curated',title:'Plan',stops:[mapped]}});
  for(const key of ['stopNumber','stopLabel','placeId','placeName','placeType','address','rating','reviewCount','imageUrl','imageUrls','priceLevelLabel','priceMin','priceMax','openingHours','utcOffsetMinutes','isOpenNow','website','lat','lng','aiDescription','phone','countryCode'])assert.deepEqual(out.stops[0][key],mapped[key],key);
});

test('saved curated stop authority rejects duplicate missing inactive and unservable identities without rewriting order',()=>{
  const saved=[{placeId:'a'},{placeId:'b'}];const rows=[{google_place_id:'b',is_active:true,is_servable:true},{google_place_id:'a',is_active:true,is_servable:true}];
  assert.doesNotThrow(()=>assertSavedCuratedStopsServable(saved,rows));
  assert.throws(()=>assertSavedCuratedStopsServable([{placeId:'a'},{placeId:'a'}],rows),/validation/);
  assert.throws(()=>assertSavedCuratedStopsServable(saved,rows.slice(0,1)),/validation/);
  assert.throws(()=>assertSavedCuratedStopsServable(saved,[rows[0],{...rows[1],is_active:false}]),/validation/);
  assert.throws(()=>assertSavedCuratedStopsServable(saved,[rows[0],{...rows[1],is_servable:false}]),/validation/);
});

test('hours and social stats accept only explicit public schemas',()=>{
  const base={id:'x',title:'Cafe',openingHours:{openNow:true,periods:[{open:{day:1,hour:9,minute:0},close:{day:1,hour:17,minute:0}}],weekdayDescriptions:['Monday: 9 AM–5 PM']},socialStats:{views:1,likes:2,saves:3,shares:4}};
  assert.deepEqual(buildNativeContentCardSnapshot('place',base).socialStats,base.socialStats);
  assert.throws(()=>buildNativeContentCardSnapshot('place',{...base,openingHours:{openNow:true,privateProviderKey:'secret'}}),/invalid_native_snapshot/);
  assert.throws(()=>buildNativeContentCardSnapshot('place',{...base,socialStats:{views:1,privateViewerIds:['x']}}),/invalid_native_snapshot/);
});

test('malformed additive descriptor degrades through top-level public contract',()=>{
  const messaging=read('app-mobile/src/services/messagingService.ts');
  assert.match(messaging,/return payload\.contract === 'content_share_card_v1'/);
  assert.match(bubble,/validateNativeContentCardDescriptorV1\(payload\.nativeCard\)/);
});
