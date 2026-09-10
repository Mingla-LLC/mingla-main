#!/usr/bin/env node
import fs from 'node:fs'
import { parseArgs, readJson, toCsv } from './lib.mjs'

const args = parseArgs(process.argv.slice(2))
const scope = readJson('scripts/search/fixtures/release-route-scope.json')
const rows = [
  ...scope.marketing.map((record) => ({ origin:scope.marketingOrigin,...record,sitemapEligible:record.lifecycle==='search_ready',syntheticCheckRequired:true })),
  ...scope.host.map((record) => ({ origin:scope.hostOrigin,...record,sitemapEligible:record.lifecycle==='search_ready',syntheticCheckRequired:true })),
]
const output = toCsv(['origin','path','lifecycle','sitemapEligible','syntheticCheckRequired'], rows)
if (typeof args.output === 'string') fs.writeFileSync(args.output, output)
else process.stdout.write(output)
