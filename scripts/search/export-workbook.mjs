#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, readJson, toCsv } from './lib.mjs'

const args=parseArgs(process.argv.slice(2)); if(typeof args.output!=='string') throw new Error('--output=<directory> is required')
const scope=readJson('scripts/search/fixtures/release-route-scope.json')
const benchmark=readJson('scripts/search/fixtures/answer-engine-benchmark-v1.json')
const receipts=readJson('mingla-marketing/content/cities/catalogue-receipts.generated.json')
const routeRows=[...scope.marketing.map((row)=>({origin:scope.marketingOrigin,...row})),...scope.host.map((row)=>({origin:scope.hostOrigin,...row}))]
const tabs={
  route_ledger:{columns:['origin','path','lifecycle'],rows:routeRows},
  crawler_parity:{columns:['checked_at','origin','path','agent','synthetic','status','robots','canonical','parity'],rows:[]},
  indexnow_queue:{columns:['observed_at','operation','canonical_url','state','attempt_count','receipt'],rows:[]},
  benchmark:{columns:['version','id','kind','city_slug','icp','audience','prompt'],rows:benchmark.scenarios.map((row)=>({version:benchmark.version,id:row.id,kind:row.kind,city_slug:row.citySlug,icp:row.icp,audience:row.audience,prompt:row.prompt}))},
  benchmark_runs:{columns:['run_at','engine','scenario_id','cited_mingla','rank','notes'],rows:[]},
  search_outcomes:{columns:['date','event','audience','page_family','icp','city_slug','destination_kind','source_kind','action_state','count'],rows:[]},
  conversion_funnel:{columns:['period','audience','landing_page_group','stage','count','rate'],rows:[]},
  city_readiness:{columns:['city_slug','catalogue_count','boundary_source','boundary_sha256','media_current_count','jit_media_eligible_count','local_review','publication_state'],rows:Object.entries(receipts.cities).map(([city_slug,row])=>({city_slug,catalogue_count:row.placeCount,boundary_source:row.boundarySourceUrl,boundary_sha256:row.boundarySha256,media_current_count:row.mediaCurrentCount,jit_media_eligible_count:row.justInTimeMediaEligibleCount,local_review:'pending',publication_state:'public_noindex'}))},
  host_documents:{columns:['canonical_path','entity_kind','lifecycle','reviewed_at','source_updated_at','sitemap'],rows:[]},
  ops_schedule:{columns:['milestone','due_date','owner','status','decision'],rows:[{milestone:'T0 production baseline',due_date:'post-deploy',owner:'growth operations',status:'blocked_predeploy',decision:''},{milestone:'28-day review',due_date:'T0+28d',owner:'growth operations',status:'not_started',decision:''},{milestone:'56-day review',due_date:'T0+56d',owner:'growth operations',status:'not_started',decision:''},{milestone:'90-day review',due_date:'T0+90d',owner:'growth operations',status:'not_started',decision:''}]},
}
fs.mkdirSync(args.output,{recursive:true})
for(const [name,{columns,rows}] of Object.entries(tabs)) fs.writeFileSync(path.join(args.output,`${name}.csv`),toCsv(columns,rows))
process.stdout.write(`WROTE ${Object.keys(tabs).length} deterministic workbook tabs\n`)
