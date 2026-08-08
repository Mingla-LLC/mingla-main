/**
 * #1615 implementor runtime proof for anonymous public creation.
 * FAILS-ON-REVERT: restoring bearer-only Business web creation makes H1/H2 fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createContentShareV1 } from '../../supabase/functions/_shared/contentShareService.ts';

const require = createRequire(import.meta.url);
const { createPublicContentShareHandler } = require('../../mingla-business/server/publicContentShareCreate.js');

const identities = {
  event:{brandSlug:'brand',eventSlug:'event'}, rsvp_event:{brandSlug:'brand',eventSlug:'rsvp'},
  trip:{brandSlug:'brand',eventSlug:'trip'}, experience:{brandSlug:'brand',eventSlug:'experience'},
  venue:{brandSlug:'brand',venueSlug:'venue'}, brand:{brandSlug:'brand'},
};

const responseRecorder = () => {
  const headers = {}; let body = '';
  return { headers, setHeader:(key,value)=>{headers[key]=value;}, end:(value)=>{body=value;}, get body(){return JSON.parse(body);} };
};

test('H1 anonymous same-origin API forwards all six public kinds with only the server-held proxy secret', async () => {
  const previous = { ...process.env };
  process.env.SUPABASE_URL='https://project.supabase.co';process.env.SUPABASE_ANON_KEY='anon';process.env.SHARED_CARD_PROXY_SECRET='server-only';
  try {
    for (const [kind,identity] of Object.entries(identities)) {
      let forwarded;
      const handler=createPublicContentShareHandler(async(url,options)=>{forwarded={url,options};return new Response(JSON.stringify({shortCode:'Aa0Bb1Cc2Dd3Ee4F',version:1,facts:{schemaVersion:1,kind,title:'Public'}}),{status:201,headers:{'content-type':'application/json'}})});
      const res=responseRecorder();await handler({method:'POST',body:{contract:'content_share_v1',kind,identity}},res);
      assert.equal(res.statusCode,201);assert.equal(forwarded.options.headers['x-mingla-shared-card-proxy'],'server-only');assert.match(forwarded.options.headers['x-mingla-public-share-actor'],/^[a-f0-9]{64}$/);assert.equal(forwarded.options.redirect,'manual');
      assert.equal(JSON.stringify(res.body).includes('server-only'),false);
    }
  } finally { process.env=previous; }
});

class Query {
  constructor(db,table){this.db=db;this.table=table;this.filters={};this.head=false;}
  select(_fields,options){this.head=options?.head===true;return this;} eq(key,value){this.filters[key]=value;return this;}
  in(){return this;} not(){return this;} is(){return this;} limit(){return this;} order(){return this;}
  async maybeSingle(){
    if(this.table==='events')return{data:{id:'event-id',title:this.db.title,description:'Public',slug:this.filters.slug||'event',location_text:'Durham',status:'scheduled',visibility:'public',published_at:'2026-01-01',deleted_at:null,timezone:'America/New_York',event_type:this.filters.event_type,brands:[{name:'Brand',slug:this.filters['brands.slug']||'brand',deleted_at:null}]}};
    if(this.table==='venue_public_view')return{data:{id:'venue-id',brand_slug:'brand',slug:'venue',name:this.db.title,city:'Durham',venue_category:'Bar'}};
    if(this.table==='brands')return{data:{id:'brand-id',name:this.db.title,slug:'brand',description:'Public'}};
    return{data:null};
  }
  then(resolve){
    if(this.table==='event_dates')return resolve({data:[{start_at:'2026-08-08T22:00:00Z',end_at:'2026-08-08T23:00:00Z',timezone:'America/New_York',is_master:true}]});
    if(this.table==='ticket_types')return resolve({data:[]});
    if(this.table==='events'&&this.head)return resolve({count:0,error:null});
    return resolve({data:[]});
  }
}
class FakeDb {
  constructor(){this.title='Public truth';this.links=new Map();this.rpcCalls=[];}
  from(table){return new Query(this,table);}
  async rpc(name,args){
    assert.equal(name,'upsert_content_share_version');this.rpcCalls.push(args);const key=args.p_source_key;const fingerprint=JSON.stringify([args.p_facts,args.p_media_identity,args.p_destination_manifest]);
    const prior=this.links.get(key);const next=prior?{...prior,version:prior.fingerprint===fingerprint?prior.version:prior.version+1,fingerprint}:{shortCode:'Aa0Bb1Cc2Dd3Ee4F',version:1,fingerprint};this.links.set(key,next);
    return{data:{shortCode:next.shortCode,version:next.version,versionCreated:!prior||prior.fingerprint!==fingerprint},error:null};
  }
}

test('H2 server-created lane rereads public truth, uses one global link, and advances only on material change', async () => {
  const db=new FakeDb();
  for(const [kind,identity] of Object.entries(identities)){
    const result=await createContentShareV1(db,null,{kind,identity},{serverCreated:true});assert.ok([200,201].includes(result.status),kind);
    const call=db.rpcCalls.at(-1);assert.equal(call.p_creator_principal,null);assert.equal(call.p_source_reference.serverCreated,true);
  }
  const request={kind:'event',identity:identities.event};const first=await createContentShareV1(db,null,request,{serverCreated:true});const same=await createContentShareV1(db,null,request,{serverCreated:true});
  db.title='Materially changed truth';const changed=await createContentShareV1(db,null,request,{serverCreated:true});
  assert.equal(first.body.shortCode,same.body.shortCode);assert.equal(same.body.shortCode,changed.body.shortCode);assert.equal(same.body.version,first.body.version);assert.equal(changed.body.version,first.body.version+1);
});
