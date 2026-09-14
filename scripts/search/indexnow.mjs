#!/usr/bin/env node
import crypto from 'node:crypto'
import { cleanCanonicalUrl, parseArgs } from './lib.mjs'

const args = parseArgs(process.argv.slice(2))
const endpoint = String(process.env.SUPABASE_URL ?? '').replace(/\/$/, '')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const indexNowKey = process.env.INDEXNOW_KEY ?? ''
if (!endpoint || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')

async function rpc(name, body) {
  const response = await fetch(`${endpoint}/rest/v1/rpc/${name}`, {
    method:'POST', headers:{ apikey:serviceKey, authorization:`Bearer ${serviceKey}`, 'content-type':'application/json' },
    body:JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`rpc_${name}_${response.status}`)
  return response.status===204 ? null : response.json()
}

const rows = await rpc('list_search_indexnow_batch', { p_limit:1000 })
const valid = Array.isArray(rows) ? rows.filter((row) => cleanCanonicalUrl(row.canonical_url)!==null) : []
const urls = [...new Set(valid.map((row) => row.canonical_url))]
const plan = { dryRun:!args.send, urlCount:urls.length, bodySha256:crypto.createHash('sha256').update(JSON.stringify(urls)).digest('hex'), operations:[...new Set(valid.map((row)=>row.operation))].sort() }
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
if (!args.send) process.exit(0)
if (args.confirm !== plan.bodySha256) throw new Error('Refusing delivery: pass --confirm=<bodySha256> from a fresh dry run')
if (!/^[A-Za-z0-9-]{8,128}$/.test(indexNowKey)) throw new Error('INDEXNOW_KEY is missing or invalid')
if (urls.length===0) process.exit(0)
const response = await fetch('https://api.indexnow.org/indexnow', {
  method:'POST', headers:{'content-type':'application/json'},
  body:JSON.stringify({ host:'host.usemingla.com', key:indexNowKey, keyLocation:'https://host.usemingla.com/api/indexnow-key', urlList:urls }),
})
const ids = valid.map((row) => row.id)
if (response.ok) {
  await rpc('record_search_indexnow_delivery', { p_ids:ids, p_delivered:true, p_error_code:null })
  process.stdout.write(`${JSON.stringify({ delivered:true, status:response.status, urlCount:urls.length })}\n`)
} else {
  await rpc('record_search_indexnow_delivery', { p_ids:ids, p_delivered:false, p_error_code:`indexnow_http_${response.status}` })
  throw new Error(`indexnow_delivery_${response.status}`)
}
