// #4339 round B (speed) — keep an AV1 copy only where it is really lighter
// (under 90% of its H.264 twin) and record which clips have one, for
// lib/clip-sources.ts. Run after scripts/encode-site-clips.mjs.
//
//   node scripts/clip-copies-manifest.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'public/marketing/site/m')
const size = (f) => fs.statSync(path.join(DIR, f)).size
const out = { full: [], small: [] }
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.mp4') && !f.endsWith('-sm.mp4')).sort()) {
  const name = file.slice(0, -4)
  for (const [kind, webm, twin] of [['full', `${name}.webm`, file], ['small', `${name}-sm.webm`, `${name}-sm.mp4`]]) {
    if (!fs.existsSync(path.join(DIR, webm))) continue
    if (fs.existsSync(path.join(DIR, twin)) && size(webm) < size(twin) * 0.9) out[kind].push(name)
    else fs.rmSync(path.join(DIR, webm))
  }
}
fs.writeFileSync(path.join(ROOT, 'lib/clip-av1.generated.json'), `${JSON.stringify(out, null, 2)}\n`)
process.stdout.write(`AV1 kept: ${out.full.length} full, ${out.small.length} phone-size\n`)
