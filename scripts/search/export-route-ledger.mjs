#!/usr/bin/env node
import fs from 'node:fs'
import { parseArgs, toCsv } from './lib.mjs'
import { buildWorkbookTabs, validateWorkbookTabs } from './workbook-contract.mjs'

const args = parseArgs(process.argv.slice(2))
const ledger = validateWorkbookTabs(buildWorkbookTabs())['00_ROUTE_LEDGER']
const output = toCsv(ledger.columns, ledger.rows)
if (typeof args.output === 'string') fs.writeFileSync(args.output, output)
else process.stdout.write(output)
