#!/usr/bin/env node
// #4452 §2.1 — writes public/site-manifest.json from lib/site-pages/registry.json at prebuild.
// Admin reads https://usemingla.com/site-manifest.json (no secrets in it).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/site-pages/registry.json'), 'utf8'))
const manifest = {
  buildId: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'local',
  generatedAt: new Date().toISOString(),
  pages: registry.pages,
}
fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'public/site-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`issue-4452 site manifest: ${manifest.pages.length} pages`)
