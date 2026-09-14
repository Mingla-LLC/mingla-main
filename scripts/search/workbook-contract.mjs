import { readJson, SEARCH_ORIGINS } from './lib.mjs'

export const WORKBOOK_TAB_NAMES = [
  '00_ROUTE_LEDGER',
  '01_GSC_SEARCH',
  '02_GSC_INDEX',
  '03_GSC_AI',
  '04_BING_SEARCH_AI',
  '05_GA4_OUTCOMES',
  '06_AUTHORITY',
  '07_BENCHMARK',
  '08_INCIDENTS',
  '09_COHORT_DECISIONS',
]

export const WORKBOOK_SCHEMAS = {
  '00_ROUTE_LEDGER': [
    'route_id','canonical_url','origin','path','audience','page_family','icp','city_slug','locale',
    'lifecycle','publish_sha','deployment_sha','deployment_time','content_reviewer','content_reviewed_at',
    'primary_source_reviewed_at','primary_source_expires_at','correction_owner',
    'expected_http_status','expected_robots','expected_canonical','expected_sitemap_membership',
    'expected_sitemap_lastmod','expected_schema_types','expected_schema_ids','expected_material_ssr',
    'expected_no_js','expected_internal_link_parents','observed_browser_status','observed_googlebot_status',
    'observed_bingbot_status','observed_robots','observed_canonical','observed_schema_types',
    'observed_schema_ids','observed_material_ssr','observed_no_js','observed_at','observed_first_verified_at',
    'observed_last_verified_at','probe_receipt','gsc_submitted_sitemap','gsc_discovery_source',
    'gsc_discovered_at','gsc_crawled_at','gsc_crawl_result','gsc_pages_result','gsc_exclusion_reason',
    'gsc_user_canonical','gsc_selected_canonical','gsc_inspected_at','gsc_next_eligible_inspection_at',
    'bing_discovery_result','bing_index_result','bing_cited_page','bing_ai_citation',
    'bing_grounding_query_ref','bing_observed_at','indexnow_change_type','indexnow_endpoint',
    'indexnow_submitted_at','indexnow_response_code','indexnow_retry_count','indexnow_final_receipt',
    'ga4_organic_landing_sessions','explorer_key_outcomes','host_key_outcomes',
    'illustrative_demo_interactions','benchmark_version','benchmark_run_ref','benchmark_cited_canonical',
    'benchmark_entity_accuracy','benchmark_city_accuracy','benchmark_capability_accuracy',
    'benchmark_stale_fact','severity','incident_id','owner','next_action','due_date','resolution_sha',
    'resolution_evidence','closed_at',
  ],
  '01_GSC_SEARCH': [
    'snapshot_id','observed_at','timezone','property','deployment_sha','deployment_sha_start','deployment_sha_end',
    'date_start','date_end','route_id','canonical_url','landing_page_group','audience','page_family',
    'city_slug','icp','country','device','query_cluster','brand_class','clicks','impressions','ctr',
    'position','source_receipt',
  ],
  '02_GSC_INDEX': [
    'snapshot_id','observed_at','property','deployment_sha','route_id','canonical_url','submitted_sitemap',
    'sitemap_submitted_at','sitemap_discovered_urls','discovery_source','discovered_at','last_crawl_at',
    'crawl_result','pages_result','exclusion_reason','user_canonical','google_selected_canonical',
    'inspection_at','next_eligible_inspection_at','source_receipt','owner','next_action','due_date',
  ],
  '03_GSC_AI': [
    'snapshot_id','observed_at','property','deployment_sha','date_start','date_end','route_id','canonical_url',
    'audience','page_family','city_slug','icp','country','device','clicks','impressions','source_receipt',
  ],
  '04_BING_SEARCH_AI': [
    'snapshot_id','observed_at','property','deployment_sha','date_start','date_end','route_id','canonical_url',
    'audience','page_family','city_slug','icp','country','device','clicks','impressions','position',
    'discovery_result','index_result','cited_page','ai_citation_total','grounding_query_ref',
    'source_receipt','owner','next_action','due_date',
  ],
  '05_GA4_OUTCOMES': [
    'snapshot_id','observed_at','property_id','stream_id','deployment_sha','date_start','date_end','route_id',
    'canonical_url','hostname','source','medium','campaign','audience','page_family','city_slug','icp',
    'event_name','action_state','event_count','organic_landing_sessions','qualified_action',
    'illustrative_demo_interaction','source_receipt',
  ],
  '06_AUTHORITY': [
    'record_id','observed_at','deployment_sha','route_id','canonical_url','source_url','source_name','evidence_kind',
    'relationship','earned','nofollow','correction_status','source_checked_at','source_expires_at',
    'owner','source_receipt','resolution_evidence',
  ],
  '07_BENCHMARK': [
    'benchmark_version','run_id','run_at','observed_at','deployment_sha','engine','scenario_id','prompt_kind','prompt','language',
    'location','audience','city_slug','icp','destination_route_id','destination_url','answer_receipt',
    'citation_urls','mingla_included','mingla_citation_rank','cited_canonical','entity_accuracy',
    'city_accuracy','capability_accuracy','factual_accuracy','stale_fact','source_receipt',
  ],
  '08_INCIDENTS': [
    'incident_id','opened_at','observed_at','deployment_sha','route_id','canonical_url','observation','severity',
    'affected_wave','owner','next_action','due_date','release_consequence','status','resolution_sha',
    'resolution_evidence','closed_at',
  ],
  '09_COHORT_DECISIONS': [
    'decision_id','cohort_id','checkpoint_day','decision_at','deployment_sha','audience','page_family',
    'city_slug','icp','route_count','indexed_count','search_visible_count','ai_cited_count',
    'qualified_action_count','critical_incident_count','decision','evidence','uncertainty','owner',
    'next_action','due_date','resolution_sha','resolution_evidence',
  ],
}

const CITY_LOCALES = {
  lagos: 'en-NG', 'durham-nc': 'en-US', 'cary-nc': 'en-US', 'raleigh-nc': 'en-US',
  'new-york-city': 'en-US', brussels: 'en-BE', paris: 'en-FR', london: 'en-GB',
  'fort-lauderdale': 'en-US', 'washington-dc': 'en-US',
}

function routeIdentity(origin, record) {
  const citySlug = record.path.startsWith('/cities/') ? record.path.slice('/cities/'.length) : ''
  const routeKey = record.path === '/' ? 'home' : record.path.slice(1).replaceAll('/', '-')
  const isHost = record.path === '/host'
  const isExplorer = record.path === '/explorer'
  const isTool = record.path === '/tools' || record.path.startsWith('/tools/')
  const isCity = citySlug.length > 0
  const pageFamily = isHost ? 'host_pillar' : isExplorer ? 'explorer_pillar' : isTool ? 'tools' : isCity ? 'city_hub' : 'brand_core'
  const audience = isHost ? 'host' : isExplorer || isCity ? 'explorer' : 'neutral'
  const icp = record.path === '/tools/events' ? 'event_promoter'
    : record.path === '/tools/venues' ? 'venue'
      : record.path === '/tools/trips' ? 'trip_operator' : ''
  const parent = isCity ? '/cities' : record.path.startsWith('/tools/') ? '/tools' : record.path === '/' ? '' : '/'
  const canonicalUrl = new URL(record.path, origin).toString()
  const searchReady = record.lifecycle === 'search_ready'
  return {
    route_id: `${new URL(origin).hostname}:${routeKey}`,
    canonical_url: canonicalUrl,
    origin,
    path: record.path,
    audience,
    page_family: pageFamily,
    icp,
    city_slug: citySlug,
    locale: CITY_LOCALES[citySlug] ?? 'en-US',
    lifecycle: record.lifecycle,
    expected_http_status: 200,
    expected_robots: searchReady ? 'index,follow' : 'noindex,follow',
    expected_canonical: searchReady ? canonicalUrl : '',
    expected_sitemap_membership: searchReady ? 'yes' : 'no',
    expected_schema_types: '[]',
    expected_schema_ids: '[]',
    expected_material_ssr: 'required',
    expected_no_js: 'required',
    expected_internal_link_parents: parent,
    benchmark_version: 'answer-engine-benchmark-v1',
  }
}

export function buildRouteLedgerRows() {
  const scope = readJson('scripts/search/fixtures/release-route-scope.json')
  return [
    ...scope.marketing.map((record) => routeIdentity(scope.marketingOrigin, record)),
    ...scope.host.map((record) => routeIdentity(scope.hostOrigin, record)),
  ]
}

export function buildWorkbookTabs() {
  const benchmark = readJson('scripts/search/fixtures/answer-engine-benchmark-v1.json')
  return {
    '00_ROUTE_LEDGER': { columns: WORKBOOK_SCHEMAS['00_ROUTE_LEDGER'], rows: buildRouteLedgerRows() },
    '01_GSC_SEARCH': { columns: WORKBOOK_SCHEMAS['01_GSC_SEARCH'], rows: [] },
    '02_GSC_INDEX': { columns: WORKBOOK_SCHEMAS['02_GSC_INDEX'], rows: [] },
    '03_GSC_AI': { columns: WORKBOOK_SCHEMAS['03_GSC_AI'], rows: [] },
    '04_BING_SEARCH_AI': { columns: WORKBOOK_SCHEMAS['04_BING_SEARCH_AI'], rows: [] },
    '05_GA4_OUTCOMES': { columns: WORKBOOK_SCHEMAS['05_GA4_OUTCOMES'], rows: [] },
    '06_AUTHORITY': { columns: WORKBOOK_SCHEMAS['06_AUTHORITY'], rows: [] },
    '07_BENCHMARK': {
      columns: WORKBOOK_SCHEMAS['07_BENCHMARK'],
      rows: benchmark.scenarios.map((scenario) => ({
        benchmark_version: benchmark.version,
        scenario_id: scenario.id,
        prompt_kind: scenario.kind,
        prompt: scenario.prompt,
        language: 'en',
        location: scenario.citySlug ?? '',
        audience: scenario.audience ?? '',
        city_slug: scenario.citySlug ?? '',
        icp: scenario.icp ?? '',
      })),
    },
    '08_INCIDENTS': { columns: WORKBOOK_SCHEMAS['08_INCIDENTS'], rows: [] },
    '09_COHORT_DECISIONS': { columns: WORKBOOK_SCHEMAS['09_COHORT_DECISIONS'], rows: [] },
  }
}

export function validateWorkbookTabs(tabs) {
  if (JSON.stringify(Object.keys(tabs)) !== JSON.stringify(WORKBOOK_TAB_NAMES)) {
    throw new Error('Workbook tab names/order do not match the #3001 contract')
  }
  for (const name of WORKBOOK_TAB_NAMES) {
    const tab = tabs[name]
    if (!tab || JSON.stringify(tab.columns) !== JSON.stringify(WORKBOOK_SCHEMAS[name]) || !Array.isArray(tab.rows)) {
      throw new Error(`${name} does not match its #3001 schema`)
    }
  }
  for (const name of WORKBOOK_TAB_NAMES.slice(1, 9)) {
    if (!tabs[name].columns.includes('deployment_sha') || !tabs[name].columns.includes('observed_at')) {
      throw new Error(`${name} must preserve the deployment observation identity`)
    }
  }
  const ledger = tabs['00_ROUTE_LEDGER'].rows
  if (ledger.length === 0 || new Set(ledger.map((row) => row.route_id)).size !== ledger.length) throw new Error('Route IDs must be populated and unique')
  if (new Set(ledger.map((row) => row.canonical_url)).size !== ledger.length) throw new Error('Canonical URLs must be populated and unique')
  for (const row of ledger) {
    const url = new URL(row.canonical_url)
    if (!SEARCH_ORIGINS.includes(url.origin) || url.search || url.hash || url.origin !== row.origin || url.pathname !== row.path) throw new Error(`Invalid route identity ${row.route_id}`)
    const searchReady = row.lifecycle === 'search_ready'
    if (row.expected_http_status !== 200 || row.expected_robots !== (searchReady ? 'index,follow' : 'noindex,follow')) throw new Error(`Invalid expected HTTP/robots for ${row.route_id}`)
    if (row.expected_sitemap_membership !== (searchReady ? 'yes' : 'no') || row.expected_canonical !== (searchReady ? row.canonical_url : '')) throw new Error(`Invalid expected discovery state for ${row.route_id}`)
  }
  if (tabs['07_BENCHMARK'].rows.length !== 145) throw new Error('The fixed benchmark tab must contain exactly 145 scenario definitions')
  return tabs
}
