#!/usr/bin/env node
// #4137 wave 3 — writes lib/blog/menu-entry.generated.json, the side menu's
// blog seam value, from the PUBLIC blog index (anon key, same RPC as /blog).
//
//   - No database configured (CI, local builds without .env.local): hidden.
//   - The read fails: hidden, and the build log says so loudly.
//   - At least one public post: Blog row on, "New" while the newest story is
//     under 14 days old, and a Latest story card for the newest post.
//
// Runs before `next build` (package.json "build"). Run it by hand before
// `npm run dev` to see the live value locally.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Load the pure derivation with the TypeScript compiler (a build dependency),
// so this works on any Node the build image runs, with or without type stripping.
const derive = (() => {
  const source = fs.readFileSync(path.join(ROOT, 'lib/blog/menu-entry-derive.ts'), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  Function('module', 'exports', js)(module, module.exports)
  return module.exports
})()
const { BLOG_MENU_HIDDEN, blogMenuEntryFromIndex } = derive
const OUT = path.join(ROOT, 'lib/blog/menu-entry.generated.json')
for (const file of ['.env.production.local', '.env.local', '.env.production', '.env']) {
  const full = path.join(ROOT, file)
  if (fs.existsSync(full) && typeof process.loadEnvFile === 'function') { try { process.loadEnvFile(full) } catch { /* unreadable env file: ignore */ } }
}

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

function write(value, reason) {
  const next = `${JSON.stringify(value, null, 2)}\n`
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  // The committed file is the hidden value; never rewrite it with the same value.
  if (JSON.stringify(JSON.parse(current || 'null')) !== JSON.stringify(value)) fs.writeFileSync(OUT, next)
  process.stdout.write(`#4137 blog menu seam: ${value.blogVisible ? `Blog on${value.showNewBadge ? ' + New' : ''}${value.latest ? `, latest ${value.latest.href}` : ''}` : 'hidden'} (${reason})\n`)
}

if (!url || !key) {
  write(BLOG_MENU_HIDDEN, 'no database configured')
} else {
  try {
    const response = await fetch(`${url}/rest/v1/rpc/blog_public_index`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_limit: 1 }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`blog_public_index ${response.status}`)
    const index = await response.json()
    const mediaUrl = (objectPath) => `${url}/storage/v1/object/public/blog-media/${objectPath.split('/').map(encodeURIComponent).join('/')}`
    write(blogMenuEntryFromIndex(index, mediaUrl, new Date()), 'from the public blog index')
  } catch (error) {
    process.stderr.write(`WARNING #4137 blog menu seam: could not read the blog index (${error instanceof Error ? error.message : error}); the Blog menu row stays hidden for this build.\n`)
    write(BLOG_MENU_HIDDEN, 'read failed')
  }
}
