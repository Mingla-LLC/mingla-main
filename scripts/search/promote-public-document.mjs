#!/usr/bin/env node
import fs from 'node:fs'
import crypto from 'node:crypto'
import { parseArgs } from './lib.mjs'

const args = parseArgs(process.argv.slice(2))
if (typeof args.input !== 'string') throw new Error('--input=<reviewed-document.json> is required')
const input = JSON.parse(fs.readFileSync(args.input, 'utf8'))
for (const key of ['canonical_path','entity_id','entity_kind','lifecycle_state','validation_checks','source_updated_at','reviewed_at','reviewer','change_reason','change_source']) {
  if (input[key]===null || input[key]===undefined || input[key]==='') throw new Error(`missing ${key}`)
}
if (input.lifecycle_state==='search_ready' && input.independent_review_approved !== true) throw new Error('search_ready requires independent_review_approved=true')
const digest = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')
process.stdout.write(`${JSON.stringify({ dryRun:!args.apply, canonicalPath:input.canonical_path, lifecycle:input.lifecycle_state, inputSha256:digest }, null, 2)}\n`)
if (!args.apply) process.exit(0)
if (args.confirm!==digest) throw new Error('Refusing mutation: pass --confirm=<inputSha256> from a fresh dry run')
const endpoint=String(process.env.SUPABASE_URL ?? '').replace(/\/$/,''); const key=process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!endpoint || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
const payload={...input}; delete payload.independent_review_approved
const response=await fetch(`${endpoint}/rest/v1/rpc/upsert_public_search_document`,{method:'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(Object.entries(payload).map(([k,v])=>[`p_${k}`,v])) )})
if (!response.ok) throw new Error(`promotion_rpc_${response.status}`)
process.stdout.write(`${JSON.stringify({ applied:true, canonicalPath:input.canonical_path })}\n`)
