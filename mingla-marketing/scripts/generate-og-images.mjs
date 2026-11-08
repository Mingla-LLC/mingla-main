// #4339 round B — the social share images (og:image / twitter:image), 1200×630,
// one per Host landing page, one per city, and the site default. Each is a
// frame of the page's own hero clip (the poster JPEGs are 640×360, too small)
// with a soft bottom shade and the white Mingla wordmark. Run once when a hero
// clip changes, then commit public/og/*.jpg:
//
//   node scripts/generate-og-images.mjs        (needs ffmpeg on PATH; sharp is a dependency)
//
// The list of images is the OG_IMAGES table in lib/search/og-images.ts.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const table = fs.readFileSync(path.join(ROOT, 'lib/search/og-images.ts'), 'utf8')
const entries = [...table.matchAll(/^\s+'?([a-z0-9-]+)'?: '([a-z0-9-]+)',/gm)].map((m) => [m[1], m[2]])
if (entries.length === 0) throw new Error('no OG_IMAGES entries found')
const wordmark = fs.readFileSync(path.join(ROOT, 'public/brand/mingla-wordmark.svg'), 'utf8').replace(/fill="[^"]*"/g, 'fill="#ffffff"')
const mark = await sharp(Buffer.from(wordmark), { density: 300 }).resize({ height: 54 }).png().toBuffer()
const shade = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#111110" stop-opacity="0"/><stop offset="1" stop-color="#111110" stop-opacity="0.72"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/></svg>')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'og-'))
fs.mkdirSync(path.join(ROOT, 'public/og'), { recursive: true })
for (const [name, clip] of entries) {
  const src = path.join(ROOT, 'public/marketing/site/m', `${clip}.mp4`)
  const frame = path.join(tmp, `${name}.png`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.2', '-i', src, '-frames:v', '1', frame])
  const out = path.join(ROOT, 'public/og', `${name}.jpg`)
  await sharp(frame)
    .resize(1200, 630, { fit: 'cover', position: 'attention' })
    .composite([{ input: shade }, { input: mark, left: 64, top: 630 - 64 - 54 }])
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(out)
  process.stdout.write(`${name} ← ${clip}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB\n`)
}
fs.rmSync(tmp, { recursive: true, force: true })
