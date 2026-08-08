/**
 * #1615 tester runtime proof for the anonymous boundary.
 * FAILS-ON-REVERT: weakening kind/identity/auth checks makes A1–A3 fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { constantTimeEqualSecret, contentShareCreateRateLimitArgs } from '../../supabase/functions/_shared/contentShareProxyAuth.ts';
import { createContentShareV1 } from '../../supabase/functions/_shared/contentShareService.ts';
const require=createRequire(import.meta.url);
const {validatePublicCreateBody}=require('../../mingla-business/server/publicContentShareCreate.js');

test('A1 public endpoint rejects private/curated kinds and malformed or over-broad identities',()=>{
  for(const body of [
    {contract:'content_share_v1',kind:'curated',identity:{savedCardId:'private'}},
    {contract:'content_share_v1',kind:'place',identity:{googlePlaceId:'place'}},
    {contract:'content_share_v1',kind:'event',identity:{eventId:'private-id'}},
    {contract:'content_share_v1',kind:'event',identity:{brandSlug:'brand',eventSlug:'event',savedCardId:'smuggled'}},
    {contract:'content_share_v1',kind:'brand',identity:{brandSlug:' padded '}},
  ])assert.equal(validatePublicCreateBody(body),false);
});

test('A2 direct bypass, empty secret, and spoofed secret fail constant-time trust',async()=>{
  assert.equal(await constantTimeEqualSecret('','expected'),false);assert.equal(await constantTimeEqualSecret('spoofed','expected'),false);assert.equal(await constantTimeEqualSecret('expected','expected'),true);
  const edge=fs.readFileSync(new URL('../../supabase/functions/shared-card/index.ts',import.meta.url),'utf8');
  assert.match(edge,/if \(!serverCreated && !user\) return json\(\{ error: "unauthorized" \}, 401\)/);
  assert.deepEqual(contentShareCreateRateLimitArgs('actor-hash',true),{p_actor_hash:'actor-hash',p_action:'create',p_limit:30,p_window_seconds:3600});
  assert.match(edge,/contentShareCreateRateLimitArgs\(hash, serverCreated\)/);
  assert.match(edge,/trusted-business-public-create-proxy:\$\{publicActor\}/);
});

test('A4 public event-family reads pin published visibility, exact type, and a non-deleted parent brand',()=>{
  const loader=fs.readFileSync(new URL('../../supabase/functions/_shared/contentShare.ts',import.meta.url),'utf8');
  // [TEST-MOD-APPROVED #1615] Current `/s` must distinguish withdrawal (404)
  // from deletion (410), so the source row is read privately then checked
  // explicitly. The old query-filter assertion erased that distinction.
  assert.match(loader,/\.eq\("event_type", expectedType\)\.limit\(1\)/);
  assert.match(loader,/if \(rowError\) throw new Error\("db_error"\)/);
  assert.match(loader,/if \(!row \|\| row\.deleted_at[\s\S]*?throw new Error\("gone"\)/);
  assert.match(loader,/!\["public", "discover"\]\.includes\(row\.visibility\)[\s\S]*?!row\.published_at[\s\S]*?throw new Error\("not_public"\)/);
});

test('A3 server marker cannot authorize curated or a malformed public identity before any database read',async()=>{
  const throwingDb={from(){throw new Error('database must not be reached')},rpc(){throw new Error('rpc must not be reached')}};
  for(const request of [
    {kind:'curated',identity:{savedCardId:'private'}},
    {kind:'event',identity:{brandSlug:'brand'}},
    {kind:'brand',identity:{brandSlug:'brand',ownerId:'private'}},
  ]){const result=await createContentShareV1(throwingDb,null,request,{serverCreated:true});assert.equal(result.status,400);}
});
