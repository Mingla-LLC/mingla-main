import assert from 'node:assert/strict'
import { SEARCH_EVENT_NAMES, sanitizeSearchMeasurement } from '../src/index.ts'

const samples={
  page_view:{audience:'neutral',page_family:'brand_core',page_location:'https://usemingla.com/about',source_kind:'direct'},
  explorer_install_click:{audience:'explorer',page_family:'explorer_pillar',destination_kind:'explorer_onelink',source_kind:'hero',action_state:'opened'},
  host_start_click:{audience:'host',page_family:'host_pillar',destination_kind:'host_web',source_kind:'hero',action_state:'opened'},
  select_content:{audience:'explorer',page_family:'city_hub',content_kind:'place',source_kind:'city_card'},
  sign_up:{audience:'host',page_family:'host_pillar',action_state:'succeeded'},
  plan_created:{audience:'explorer',page_family:'explorer_pillar',action_state:'succeeded'},
  rsvp_complete:{audience:'explorer',page_family:'public_inventory',action_state:'succeeded'},
  listing_published:{audience:'host',page_family:'host_pillar',icp:'event_promoter',action_state:'succeeded'},
  generate_lead:{audience:'host',page_family:'public_inventory',icp:'venue',action_state:'succeeded'},
  share:{audience:'explorer',page_family:'public_inventory',action_state:'verified'},
  paired_page_switch:{audience:'neutral',page_family:'brand_core',source_kind:'navigation'},
  correction_start:{audience:'neutral',page_family:'editorial',source_kind:'footer'},
  tool_interaction:{audience:'host',page_family:'tools',icp:'trip_operator',action_state:'succeeded'},
}

assert.deepEqual(Object.keys(samples),[...SEARCH_EVENT_NAMES])
for(const [event,properties] of Object.entries(samples)) {
  const value=sanitizeSearchMeasurement(event,properties)
  assert(value,`${event} valid sample rejected`)
  assert.equal(value.event,event)
  assert(Object.values(value.properties).every((item)=>typeof item==='string'))
}

for(const [label,event,properties] of [
  ['unknown event','customer_email',samples.page_view],
  ['unknown property','page_view',{...samples.page_view,email:'private@example.test'}],
  ['query leakage','page_view',{...samples.page_view,page_location:'https://usemingla.com/about?email=private'}],
  ['fragment leakage','page_view',{...samples.page_view,page_location:'https://usemingla.com/about#person'}],
  ['private ID','listing_published',{...samples.listing_published,brand_id:'private-id'}],
  ['coordinate','page_view',{...samples.page_view,latitude:'35.77'}],
  ['unknown city','page_view',{...samples.page_view,city_slug:'atlanta'}],
  ['wrong destination','host_start_click',{...samples.host_start_click,destination_kind:'explorer_onelink'}],
  ['free text enum','listing_published',{...samples.listing_published,icp:'My restaurant on Main Street'}],
  ['missing required','rsvp_complete',{audience:'explorer',page_family:'public_inventory'}],
  ['too many properties','page_view',{...samples.page_view,icp:'venue',city_slug:'lagos',publication_state:'search_ready',destination_kind:'external_source',action_state:'opened',content_kind:'place',page_referrer_origin:'https://example.com'}],
]) assert.equal(sanitizeSearchMeasurement(event,properties),null,label)

process.stdout.write('PASS search-measurement accepted and adversarial contract\n')
