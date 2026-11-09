// #4339 round B (speed) — the lighter copies of every site clip, made from
// the committed H.264 masters in public/marketing/site/m/<name>.mp4:
//
//   <name>.webm       AV1 (SVT-AV1), same size — chosen first by browsers that play it
//   <name>-sm.mp4     H.264, phone size (long edge 640) — phones on browsers without AV1
//   <name>-sm.webm    AV1, phone size — phones that play AV1
//   <name>.webp       the poster as WebP (the LCP image on clip-led pages)
//
// LandingMedia (components/landing/landing-media.tsx) picks among them at run
// time (lib/clip-sources.ts). Run after adding or replacing a clip (needs
// ffmpeg with libsvtav1 and libx264, and sharp):
//
//   node scripts/encode-site-clips.mjs            every clip missing a copy
//   node scripts/encode-site-clips.mjs --force    rebuild them all
//
// It also holds every master under 700 KB (re-encoding a larger one in place).

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/marketing/site/m')
const FORCE = process.argv.includes('--force')
const MASTER_LIMIT = 700 * 1024
const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args])
const size = (f) => fs.statSync(f).size
const probe = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number)

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.mp4') && !f.endsWith('-sm.mp4')).sort()) {
  const name = file.slice(0, -4)
  const master = path.join(DIR, file)
  // 1. masters over the limit are re-encoded in place (same size, higher CRF).
  for (let crf = 26; size(master) > MASTER_LIMIT && crf <= 38; crf += 2) {
    const tmp = path.join(DIR, `${name}.tmp.mp4`)
    ff(['-i', master, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp])
    if (size(tmp) < size(master)) fs.renameSync(tmp, master)
    else fs.rmSync(tmp)
  }
  const [w, h] = probe(master)
  const small = w >= h ? 'scale=640:-2' : 'scale=-2:640'
  const jobs = [
    [`${name}.webm`, ['-i', master, '-an', '-c:v', 'libsvtav1', '-preset', '8', '-crf', '40', '-pix_fmt', 'yuv420p']],
    [`${name}-sm.mp4`, ['-i', master, '-an', '-vf', small, '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']],
    [`${name}-sm.webm`, ['-i', master, '-an', '-vf', small, '-c:v', 'libsvtav1', '-preset', '8', '-crf', '44', '-pix_fmt', 'yuv420p']],
  ]
  for (const [out, args] of jobs) {
    const target = path.join(DIR, out)
    if (!FORCE && fs.existsSync(target)) continue
    ff([...args, target])
  }
  const posterJpg = path.join(DIR, `${name}.jpg`)
  const posterWebp = path.join(DIR, `${name}.webp`)
  if (fs.existsSync(posterJpg) && (FORCE || !fs.existsSync(posterWebp))) {
    await sharp(posterJpg).webp({ quality: 62, effort: 6 }).toFile(posterWebp)
  }
  const kb = (f) => (fs.existsSync(path.join(DIR, f)) ? `${Math.round(size(path.join(DIR, f)) / 1024)}` : '-')
  process.stdout.write(`${name}: mp4 ${kb(file)} KB, webm ${kb(`${name}.webm`)}, sm.mp4 ${kb(`${name}-sm.mp4`)}, sm.webm ${kb(`${name}-sm.webm`)}, poster jpg ${kb(`${name}.jpg`)} → webp ${kb(`${name}.webp`)}\n`)
}
