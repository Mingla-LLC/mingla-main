#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildWorkbookTabs, validateWorkbookTabs, WORKBOOK_TAB_NAMES } from './workbook-contract.mjs'
import { toCsv } from './lib.mjs'

const tabs = validateWorkbookTabs(buildWorkbookTabs())
const first = WORKBOOK_TAB_NAMES.map((name) => toCsv(tabs[name].columns, tabs[name].rows))
const second = WORKBOOK_TAB_NAMES.map((name) => toCsv(buildWorkbookTabs()[name].columns, buildWorkbookTabs()[name].rows))
if (crypto.createHash('sha256').update(first.join('\0')).digest('hex') !== crypto.createHash('sha256').update(second.join('\0')).digest('hex')) {
  throw new Error('Workbook export is not deterministic')
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-workbook-contract-'))
try {
  for (let index = 0; index < WORKBOOK_TAB_NAMES.length; index += 1) fs.writeFileSync(path.join(directory, `${WORKBOOK_TAB_NAMES[index]}.csv`), first[index])
  const names = fs.readdirSync(directory).sort()
  const expected = WORKBOOK_TAB_NAMES.map((name) => `${name}.csv`).sort()
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Workbook filenames do not match the #3001 contract')
} finally {
  fs.rmSync(directory, { recursive: true, force: true })
}

process.stdout.write(`PASS #3001 workbook contract: ${WORKBOOK_TAB_NAMES.join(', ')}; 145 benchmark definitions\n`)
