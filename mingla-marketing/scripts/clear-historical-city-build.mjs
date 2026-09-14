#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

if (process.env.MINGLA_HISTORICAL_2983_BUILD) {
  throw new Error('Refusing to clear the historical artifact while its build flag is active')
}
const cwd = process.cwd()
const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'))
if (packageJson.name !== 'mingla-marketing') {
  throw new Error('Historical city artifact cleanup must run from mingla-marketing')
}
fs.rmSync(path.join(cwd, '.next'), { recursive: true, force: true })
