import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SEARCH_ORIGINS = ['https://usemingla.com', 'https://host.usemingla.com']
export const SYNTHETIC_CRAWLERS = {
  browser: 'Mozilla/5.0 MinglaSearchVerifier/1.0',
  google: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bing: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  openai: 'OAI-SearchBot/1.0; +https://openai.com/searchbot',
  anthropic: 'Claude-SearchBot/1.0; +https://anthropic.com/claude-search-bot',
  perplexity: 'PerplexityBot/1.0; +https://perplexity.ai/perplexitybot',
}

export function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8'))
}

export function parseArgs(argv) {
  const out = { _: [] }
  for (const arg of argv) {
    if (!arg.startsWith('--')) { out._.push(arg); continue }
    const [key, ...rest] = arg.slice(2).split('=')
    out[key] = rest.length ? rest.join('=') : true
  }
  return out
}

export function assertHttpsOrigin(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`origin must be HTTPS: ${value}`)
  }
  return url.origin
}

export function cleanCanonicalUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.search || url.hash || !SEARCH_ORIGINS.includes(url.origin)) return null
  return url.toString()
}

export function csvCell(value) {
  const string = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string
}

export function toCsv(columns, rows) {
  return `${columns.map(csvCell).join(',')}\n${rows.map((row) => columns.map((key) => csvCell(row[key])).join(',')).join('\n')}${rows.length ? '\n' : ''}`
}
