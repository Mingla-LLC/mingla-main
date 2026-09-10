#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, toCsv } from './lib.mjs'
import { buildWorkbookTabs, validateWorkbookTabs } from './workbook-contract.mjs'

const args=parseArgs(process.argv.slice(2)); if(typeof args.output!=='string') throw new Error('--output=<directory> is required')
const tabs=validateWorkbookTabs(buildWorkbookTabs())
fs.mkdirSync(args.output,{recursive:true})
for(const [name,{columns,rows}] of Object.entries(tabs)) fs.writeFileSync(path.join(args.output,`${name}.csv`),toCsv(columns,rows))
process.stdout.write(`WROTE ${Object.keys(tabs).length} deterministic workbook tabs\n`)
