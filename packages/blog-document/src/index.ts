// #4137 — the Mingla blog's block document: ONE shared contract.
//
// Pure TypeScript with no dependencies and only erasable syntax, so the
// marketing site (Next), Mingla Admin (Vite), Deno tests and plain
// `node --experimental-strip-types` scripts all import the same file.
//
// A post body is `{ version: 1, blocks: Block[] }`. The marketing site renders
// it, the admin editor writes it, and the database's save RPC re-checks its
// structure so a hand-crafted call cannot store an unknown block.
//
// Rich text (paragraph, list item, quote, callout) is a tiny inline HTML
// subset: strong, em, u, a, br. It is never trusted as stored. See
// `sanitizeBlogRichText` below for why it tokenises instead of rewriting.

export const BLOG_DOCUMENT_VERSION = 1
export const BLOG_MAX_BLOCKS = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const BLOCK_ID = /^[A-Za-z0-9_-]{6,40}$/
const CITY_SLUG = /^[a-z0-9-]{2,40}$/
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/
const PAGE_PATH = /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/

export type BlogEmbedProvider = 'spotify' | 'youtube' | 'vimeo' | 'instagram' | 'tiktok' | 'x'

/** Hosts each embed provider may point at. Anything else is refused. */
export const BLOG_EMBED_HOSTS: Readonly<Record<BlogEmbedProvider, readonly string[]>> = {
  spotify: ['open.spotify.com'],
  youtube: ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'],
  vimeo: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
  instagram: ['www.instagram.com', 'instagram.com'],
  tiktok: ['www.tiktok.com', 'tiktok.com', 'vm.tiktok.com'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
}

export type BlogTarget =
  | { readonly kind: 'url'; readonly href: string; readonly newTab?: boolean }
  | { readonly kind: 'page'; readonly path: string }
  | { readonly kind: 'place'; readonly placeId: string }
  | { readonly kind: 'offering'; readonly eventId: string }

interface BlockBase { readonly id: string }

export interface ParagraphBlock extends BlockBase { readonly type: 'paragraph'; readonly html: string }
export interface HeadingBlock extends BlockBase { readonly type: 'heading'; readonly level: 2 | 3; readonly text: string }
export interface ListBlock extends BlockBase { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
export interface QuoteBlock extends BlockBase { readonly type: 'quote'; readonly html: string; readonly cite?: string }
export interface CalloutBlock extends BlockBase { readonly type: 'callout'; readonly html: string; readonly tone: 'note' | 'tip' }
export interface ImageBlock extends BlockBase { readonly type: 'image'; readonly mediaId: string; readonly alt: string; readonly caption?: string }
export interface GalleryItem { readonly mediaId: string; readonly alt: string; readonly caption?: string }
export interface GalleryBlock extends BlockBase { readonly type: 'gallery'; readonly items: readonly GalleryItem[]; readonly layout: 'pair' | 'grid' }
export interface VideoBlock extends BlockBase { readonly type: 'video'; readonly provider: 'youtube' | 'vimeo'; readonly videoId: string; readonly title: string }
export interface EmbedBlock extends BlockBase { readonly type: 'embed'; readonly provider: BlogEmbedProvider; readonly url: string }
export interface DividerBlock extends BlockBase { readonly type: 'divider' }
export interface ButtonBlock extends BlockBase { readonly type: 'button'; readonly label: string; readonly target: BlogTarget }
export interface PlaceBlock extends BlockBase { readonly type: 'place'; readonly placeId: string; readonly style: 'card' | 'compact'; readonly note?: string }
export interface OfferingBlock extends BlockBase {
  readonly type: 'offering'
  readonly eventId: string
  /** Written by the editor. Never the host's own event title or brand name. */
  readonly displayTitle: string
  readonly eyebrowCity?: string
  readonly moodMediaId?: string
  readonly moodAlt?: string
}
export interface PlanBlock extends BlockBase { readonly type: 'plan'; readonly title: string; readonly stops: readonly string[] }
export interface CityBlock extends BlockBase { readonly type: 'city'; readonly citySlug: string }

export type BlogBlock =
  | ParagraphBlock | HeadingBlock | ListBlock | QuoteBlock | CalloutBlock
  | ImageBlock | GalleryBlock | VideoBlock | EmbedBlock | DividerBlock
  | ButtonBlock | PlaceBlock | OfferingBlock | PlanBlock | CityBlock

export type BlogBlockType = BlogBlock['type']

export const BLOG_BLOCK_TYPES: readonly BlogBlockType[] = [
  'paragraph', 'heading', 'list', 'quote', 'callout', 'image', 'gallery', 'video',
  'embed', 'divider', 'button', 'place', 'offering', 'plan', 'city',
]

export interface BlogDocument { readonly version: 1; readonly blocks: readonly BlogBlock[] }

export type BlogDocumentResult =
  | { readonly ok: true; readonly document: BlogDocument }
  | { readonly ok: false; readonly errors: readonly string[] }

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function str(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}
function optStr(value: unknown, max: number): boolean {
  return value === undefined || str(value, 0, max)
}
function trimmedStr(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** https only; no whitespace or control characters anywhere. */
export function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false
  if (!/^https:\/\/[^\s/?#]+/i.test(value)) return false
  // deno-lint-ignore no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.hostname.length > 0
  } catch {
    return false
  }
}

export function isBlogPagePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && PAGE_PATH.test(value)
}

export function embedHostAllowed(provider: BlogEmbedProvider, url: string): boolean {
  if (!isSafeHttpsUrl(url)) return false
  const host = new URL(url).hostname.toLowerCase()
  return BLOG_EMBED_HOSTS[provider].includes(host)
}

function validateTarget(target: unknown, path: string, errors: string[]): void {
  if (!isObject(target)) { errors.push(`${path}:target_invalid`); return }
  switch (target.kind) {
    case 'url':
      if (!isSafeHttpsUrl(target.href)) errors.push(`${path}:target_url_invalid`)
      if (target.newTab !== undefined && typeof target.newTab !== 'boolean') errors.push(`${path}:target_new_tab_invalid`)
      return
    case 'page':
      if (!isBlogPagePath(target.path)) errors.push(`${path}:target_page_invalid`)
      return
    case 'place':
      if (!isUuid(target.placeId)) errors.push(`${path}:target_place_invalid`)
      return
    case 'offering':
      if (!isUuid(target.eventId)) errors.push(`${path}:target_offering_invalid`)
      return
    default:
      errors.push(`${path}:target_kind_invalid`)
  }
}

function validateBlock(block: unknown, index: number, errors: string[]): void {
  const at = `block_${index}`
  if (!isObject(block)) { errors.push(`${at}:not_object`); return }
  if (typeof block.id !== 'string' || !BLOCK_ID.test(block.id)) errors.push(`${at}:id_invalid`)
  switch (block.type) {
    case 'paragraph':
      if (!str(block.html, 0, 20000)) errors.push(`${at}:html_invalid`)
      return
    case 'heading':
      if (block.level !== 2 && block.level !== 3) errors.push(`${at}:level_invalid`)
      if (!trimmedStr(block.text, 1, 200)) errors.push(`${at}:text_invalid`)
      return
    case 'list':
      if (typeof block.ordered !== 'boolean') errors.push(`${at}:ordered_invalid`)
      if (!Array.isArray(block.items) || block.items.length < 1 || block.items.length > 100 ||
        !block.items.every((item) => str(item, 0, 20000))) errors.push(`${at}:items_invalid`)
      return
    case 'quote':
      if (!str(block.html, 1, 20000)) errors.push(`${at}:html_invalid`)
      if (!optStr(block.cite, 120)) errors.push(`${at}:cite_invalid`)
      return
    case 'callout':
      if (!str(block.html, 1, 20000)) errors.push(`${at}:html_invalid`)
      if (block.tone !== 'note' && block.tone !== 'tip') errors.push(`${at}:tone_invalid`)
      return
    case 'image':
      if (!isUuid(block.mediaId)) errors.push(`${at}:media_invalid`)
      if (!trimmedStr(block.alt, 1, 500)) errors.push(`${at}:alt_required`)
      if (!optStr(block.caption, 200)) errors.push(`${at}:caption_invalid`)
      return
    case 'gallery':
      if (block.layout !== 'pair' && block.layout !== 'grid') errors.push(`${at}:layout_invalid`)
      if (!Array.isArray(block.items) || block.items.length < 2 || block.items.length > 12) {
        errors.push(`${at}:items_invalid`)
        return
      }
      block.items.forEach((item, itemIndex) => {
        if (!isObject(item)) { errors.push(`${at}:item_${itemIndex}:not_object`); return }
        if (!isUuid(item.mediaId)) errors.push(`${at}:item_${itemIndex}:media_invalid`)
        if (!trimmedStr(item.alt, 1, 500)) errors.push(`${at}:item_${itemIndex}:alt_required`)
        if (!optStr(item.caption, 200)) errors.push(`${at}:item_${itemIndex}:caption_invalid`)
      })
      return
    case 'video':
      if (block.provider !== 'youtube' && block.provider !== 'vimeo') errors.push(`${at}:provider_invalid`)
      if (typeof block.videoId !== 'string' || !VIDEO_ID.test(block.videoId)) errors.push(`${at}:video_id_invalid`)
      if (!trimmedStr(block.title, 1, 200)) errors.push(`${at}:title_required`)
      return
    case 'embed': {
      const provider = block.provider as BlogEmbedProvider
      if (!Object.hasOwn(BLOG_EMBED_HOSTS, provider)) { errors.push(`${at}:provider_invalid`); return }
      if (typeof block.url !== 'string' || !embedHostAllowed(provider, block.url)) errors.push(`${at}:url_invalid`)
      return
    }
    case 'divider':
      return
    case 'button':
      if (!trimmedStr(block.label, 1, 40)) errors.push(`${at}:label_invalid`)
      validateTarget(block.target, at, errors)
      return
    case 'place':
      if (!isUuid(block.placeId)) errors.push(`${at}:place_invalid`)
      if (block.style !== 'card' && block.style !== 'compact') errors.push(`${at}:style_invalid`)
      if (!optStr(block.note, 200)) errors.push(`${at}:note_invalid`)
      return
    case 'offering':
      if (!isUuid(block.eventId)) errors.push(`${at}:event_invalid`)
      if (!trimmedStr(block.displayTitle, 1, 90)) errors.push(`${at}:display_title_invalid`)
      if (!optStr(block.eyebrowCity, 40)) errors.push(`${at}:eyebrow_city_invalid`)
      if (block.moodMediaId !== undefined) {
        if (!isUuid(block.moodMediaId)) errors.push(`${at}:mood_media_invalid`)
        if (!trimmedStr(block.moodAlt, 1, 500)) errors.push(`${at}:mood_alt_required`)
      }
      return
    case 'plan':
      if (!trimmedStr(block.title, 1, 80)) errors.push(`${at}:title_invalid`)
      if (!Array.isArray(block.stops) || block.stops.length < 2 || block.stops.length > 6 ||
        !block.stops.every(isUuid)) errors.push(`${at}:stops_invalid`)
      return
    case 'city':
      if (typeof block.citySlug !== 'string' || !CITY_SLUG.test(block.citySlug)) errors.push(`${at}:city_invalid`)
      return
    default:
      errors.push(`${at}:type_unsupported`)
  }
}

/** Structural validation. Never throws; returns every problem found. */
export function validateBlogDocument(doc: unknown): BlogDocumentResult {
  const errors: string[] = []
  if (!isObject(doc)) return { ok: false, errors: ['document:not_object'] }
  if (doc.version !== BLOG_DOCUMENT_VERSION) errors.push('document:version_invalid')
  if (!Array.isArray(doc.blocks)) return { ok: false, errors: [...errors, 'document:blocks_invalid'] }
  if (doc.blocks.length > BLOG_MAX_BLOCKS) errors.push('document:too_many_blocks')
  const ids = new Set<string>()
  doc.blocks.forEach((block, index) => {
    validateBlock(block, index, errors)
    if (isObject(block) && typeof block.id === 'string') {
      if (ids.has(block.id)) errors.push(`block_${index}:id_duplicate`)
      ids.add(block.id)
    }
  })
  return errors.length === 0
    ? { ok: true, document: doc as unknown as BlogDocument }
    : { ok: false, errors }
}

// ---------------------------------------------------------------------------
// Rich text: tokenise, rebuild, escape.
//
// WHY THIS TOKENISES (#4137, F-SEC-1). The email composer's sanitisers rewrite
// only COMPLETE tags matching a regex. A fragment with no closing `>` such as
// `<img src=x onerror=alert(1)` followed by a later `</p>` is left as raw
// text, and the browser then parses it together with the next emitted tag into
// a live element with an event handler. This sanitiser never passes input
// through: one scanner splits the input into tags and text, every allowed tag
// is rebuilt from scratch with only its allowed attributes, every other tag is
// dropped, and every `<`, `>`, `&` and `"` in text is escaped. The output can
// hold no `<` that does not begin a tag this module emitted.
// ---------------------------------------------------------------------------

export type BlogAppTarget = { readonly kind: 'place' | 'offering'; readonly id: string }

export type BlogRichNode =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'br' }
  | { readonly type: 'strong' | 'em' | 'u'; readonly children: readonly BlogRichNode[] }
  | { readonly type: 'link'; readonly href: string; readonly newTab: boolean; readonly children: readonly BlogRichNode[] }
  | { readonly type: 'app_link'; readonly target: BlogAppTarget; readonly children: readonly BlogRichNode[] }

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', middot: '\u00b7',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', eacute: '\u00e9', pound: '\u00a3', euro: '\u20ac',
}

function decodeEntities(value: string): string {
  return value.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd'
      return String.fromCodePoint(code)
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole
  })
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Elements whose content is never shown: skipped with their content. */
const RAW_CONTENT_TAGS = new Set([
  'script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript',
  'plaintext', 'template', 'object', 'svg', 'math', 'select', 'head',
])

interface RawTag {
  readonly name: string
  readonly closing: boolean
  readonly attrs: ReadonlyMap<string, string>
  readonly end: number
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f'
}

/**
 * Parses one complete tag starting at `start` (which holds `<`). Returns null
 * for anything that is not a complete, well-formed tag; the caller then treats
 * the `<` as text, which is escaped. Linear: no backtracking.
 */
function parseTagAt(input: string, start: number): RawTag | null {
  let i = start + 1
  let closing = false
  if (input[i] === '/') { closing = true; i += 1 }
  const nameStart = i
  if (!/[A-Za-z]/.test(input[i] ?? '')) return null
  while (i < input.length && /[A-Za-z0-9]/.test(input[i])) i += 1
  const name = input.slice(nameStart, i).toLowerCase()
  const attrs = new Map<string, string>()
  for (;;) {
    while (i < input.length && isSpace(input[i])) i += 1
    if (i >= input.length) return null
    const ch = input[i]
    if (ch === '>') return { name, closing, attrs, end: i + 1 }
    if (ch === '/') {
      if (input[i + 1] === '>') return { name, closing, attrs, end: i + 2 }
      i += 1
      continue
    }
    const attrStart = i
    while (i < input.length && !isSpace(input[i]) && !'"\'>/=<'.includes(input[i])) i += 1
    if (i === attrStart) return null
    const attrName = input.slice(attrStart, i).toLowerCase()
    while (i < input.length && isSpace(input[i])) i += 1
    let value = ''
    if (input[i] === '=') {
      i += 1
      while (i < input.length && isSpace(input[i])) i += 1
      const quote = input[i]
      if (quote === '"' || quote === "'") {
        const close = input.indexOf(quote, i + 1)
        if (close === -1) return null
        value = input.slice(i + 1, close)
        i = close + 1
      } else {
        const valueStart = i
        while (i < input.length && !isSpace(input[i]) && input[i] !== '>') i += 1
        if (i === valueStart) return null
        value = input.slice(valueStart, i)
      }
    }
    if (!attrs.has(attrName)) attrs.set(attrName, decodeEntities(value))
  }
}

const APP_TARGET = /^(place|offering):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

function safeInlineHref(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const value: string = raw.trim()
  if (isSafeHttpsUrl(value as unknown)) return value
  if (/^mailto:[^\s<>"'\\]+@[^\s<>"'\\]+$/i.test(value) && value.length <= 320) return value
  if (/^\/(?!\/)[A-Za-z0-9\-._~/%?=&#]*$/.test(value) && value.length <= 500 && !value.includes('\\')) return value
  return null
}

type OpenFrame =
  | { readonly kind: 'root'; readonly children: BlogRichNode[] }
  | { readonly kind: 'strong' | 'em' | 'u'; readonly children: BlogRichNode[] }
  | { readonly kind: 'a'; readonly children: BlogRichNode[]; readonly link: { href: string; newTab: boolean } | null; readonly app: BlogAppTarget | null }

const INLINE_ALIASES: Readonly<Record<string, 'strong' | 'em' | 'u'>> = { strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'u' }

function frameToNode(frame: OpenFrame): BlogRichNode | null {
  if (frame.kind === 'root') return null
  if (frame.kind === 'a') {
    if (frame.app) return { type: 'app_link', target: frame.app, children: frame.children }
    if (frame.link) return { type: 'link', href: frame.link.href, newTab: frame.link.newTab, children: frame.children }
    return null
  }
  return { type: frame.kind, children: frame.children }
}

function closeTop(stack: OpenFrame[]): void {
  const frame = stack.pop()
  if (!frame) return
  const parent = stack[stack.length - 1]
  const node = frameToNode(frame)
  if (node) {
    if (node.type !== 'text' && node.type !== 'br' && node.children.length === 0) return
    parent.children.push(node)
  } else {
    // An <a> with no usable destination keeps its text, unlinked.
    parent.children.push(...frame.children)
  }
}

function pushText(stack: OpenFrame[], text: string): void {
  if (!text) return
  const children = stack[stack.length - 1].children
  const last = children[children.length - 1]
  if (last && last.type === 'text') children[children.length - 1] = { type: 'text', text: last.text + text }
  else children.push({ type: 'text', text })
}

/** Parses untrusted inline HTML into the allow-listed node tree. */
export function parseBlogRichText(input: string): readonly BlogRichNode[] {
  const root: OpenFrame = { kind: 'root', children: [] }
  const stack: OpenFrame[] = [root]
  const source = typeof input === 'string' ? input : ''
  let i = 0
  let textStart = 0
  const flushText = (end: number) => {
    if (end > textStart) pushText(stack, decodeEntities(source.slice(textStart, end)))
  }
  while (i < source.length) {
    if (source[i] !== '<') { i += 1; continue }
    // Comments, doctypes and processing instructions: dropped with content.
    if (source.startsWith('<!--', i)) {
      flushText(i)
      const close = source.indexOf('-->', i + 4)
      i = close === -1 ? source.length : close + 3
      textStart = i
      continue
    }
    if (source[i + 1] === '!' || source[i + 1] === '?') {
      flushText(i)
      const close = source.indexOf('>', i + 2)
      i = close === -1 ? source.length : close + 1
      textStart = i
      continue
    }
    const tag = parseTagAt(source, i)
    if (!tag) { i += 1; continue } // a lone `<` stays in the text and is escaped
    flushText(i)
    i = tag.end
    textStart = i
    if (!tag.closing && RAW_CONTENT_TAGS.has(tag.name)) {
      const closeAt = new RegExp(`</${tag.name}(?=[\\s/>])`, 'i')
      const rest = source.slice(i)
      const match = closeAt.exec(rest)
      if (!match) { i = source.length; textStart = i; break }
      const gt = source.indexOf('>', i + match.index)
      i = gt === -1 ? source.length : gt + 1
      textStart = i
      continue
    }
    if (tag.name === 'br') {
      if (!tag.closing) stack[stack.length - 1].children.push({ type: 'br' })
      continue
    }
    const alias: 'strong' | 'em' | 'u' | undefined = Object.hasOwn(INLINE_ALIASES, tag.name) ? INLINE_ALIASES[tag.name] : undefined
    if (alias || tag.name === 'a') {
      const kind: 'strong' | 'em' | 'u' | 'a' = alias ?? 'a'
      if (tag.closing) {
        const at = stack.map((frame) => frame.kind).lastIndexOf(kind)
        if (at > 0) while (stack.length > at) closeTop(stack)
        continue
      }
      if (kind === 'a') {
        if (stack.some((frame) => frame.kind === 'a')) continue // no nested links
        const appMatch = APP_TARGET.exec(tag.attrs.get('data-mingla-target') ?? '')
        const app = appMatch ? { kind: appMatch[1] as 'place' | 'offering', id: appMatch[2] } : null
        const href = app ? null : safeInlineHref(tag.attrs.get('href'))
        const newTab = href !== null && href.startsWith('https://') && tag.attrs.get('target') === '_blank'
        stack.push({ kind: 'a', children: [], link: href ? { href, newTab } : null, app })
        continue
      }
      stack.push({ kind, children: [] } as OpenFrame)
      continue
    }
    // Every other tag is dropped; its text content (if any) is kept as text.
  }
  flushText(source.length)
  while (stack.length > 1) closeTop(stack)
  return root.children
}

function serialize(nodes: readonly BlogRichNode[]): string {
  let out = ''
  for (const node of nodes) {
    switch (node.type) {
      case 'text': out += escapeText(node.text); break
      case 'br': out += '<br>'; break
      case 'strong': case 'em': case 'u':
        out += `<${node.type}>${serialize(node.children)}</${node.type}>`
        break
      case 'link':
        out += `<a href="${escapeText(node.href)}"${node.newTab ? ' target="_blank" rel="noopener noreferrer"' : ''}>${serialize(node.children)}</a>`
        break
      case 'app_link':
        out += `<a data-mingla-target="${node.target.kind}:${node.target.id}">${serialize(node.children)}</a>`
        break
    }
  }
  return out
}

/**
 * The canonical stored form of a rich-text field. Idempotent:
 * sanitizeBlogRichText(sanitizeBlogRichText(x)) === sanitizeBlogRichText(x).
 */
export function sanitizeBlogRichText(html: string): string {
  return serialize(parseBlogRichText(html))
}

export function blogRichTextPlain(nodes: readonly BlogRichNode[]): string {
  return nodes.map((node) => node.type === 'text' ? node.text : node.type === 'br' ? ' ' : blogRichTextPlain(node.children)).join('')
}

// ---------------------------------------------------------------------------
// Derived facts
// ---------------------------------------------------------------------------

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
}

/** Words a reader reads: text blocks only (cards are scanned, not read). */
export function blogDocumentWordCount(doc: BlogDocument): number {
  let words = 0
  for (const block of doc.blocks) {
    switch (block.type) {
      case 'paragraph': case 'quote': case 'callout':
        words += countWords(blogRichTextPlain(parseBlogRichText(block.html)))
        if (block.type === 'quote' && block.cite) words += countWords(block.cite)
        break
      case 'heading': words += countWords(block.text); break
      case 'list':
        for (const item of block.items) words += countWords(blogRichTextPlain(parseBlogRichText(item)))
        break
      default: break
    }
  }
  return words
}

/** 230 words a minute, at least one minute. */
export function blogReadMinutes(doc: BlogDocument): number {
  return Math.max(1, Math.ceil(blogDocumentWordCount(doc) / 230))
}

export interface BlogDocumentReferences {
  readonly placeIds: readonly string[]
  readonly eventIds: readonly string[]
  readonly mediaIds: readonly string[]
  readonly citySlugs: readonly string[]
  /** https links: url targets, inline https links and embed URLs. */
  readonly urls: readonly string[]
  /** usemingla.com paths: page targets and inline `/…` links. */
  readonly pagePaths: readonly string[]
}

function collectInline(nodes: readonly BlogRichNode[], out: { places: Set<string>; events: Set<string>; urls: Set<string>; paths: Set<string> }): void {
  for (const node of nodes) {
    if (node.type === 'app_link') (node.target.kind === 'place' ? out.places : out.events).add(node.target.id)
    if (node.type === 'link') {
      if (node.href.startsWith('https://')) out.urls.add(node.href)
      else if (node.href.startsWith('/')) out.paths.add(node.href)
    }
    if (node.type !== 'text' && node.type !== 'br') collectInline(node.children, out)
  }
}

export function blogDocumentReferences(doc: BlogDocument): BlogDocumentReferences {
  const places = new Set<string>()
  const events = new Set<string>()
  const media = new Set<string>()
  const cities = new Set<string>()
  const urls = new Set<string>()
  const paths = new Set<string>()
  const inline = { places, events, urls, paths }
  const target = (value: BlogTarget) => {
    if (value.kind === 'url') urls.add(value.href)
    else if (value.kind === 'page') paths.add(value.path)
    else if (value.kind === 'place') places.add(value.placeId)
    else events.add(value.eventId)
  }
  for (const block of doc.blocks) {
    switch (block.type) {
      case 'paragraph': case 'quote': case 'callout':
        collectInline(parseBlogRichText(block.html), inline)
        break
      case 'list':
        for (const item of block.items) collectInline(parseBlogRichText(item), inline)
        break
      case 'image': media.add(block.mediaId); break
      case 'gallery': for (const item of block.items) media.add(item.mediaId); break
      case 'embed': urls.add(block.url); break
      case 'button': target(block.target); break
      case 'place': places.add(block.placeId); break
      case 'offering':
        events.add(block.eventId)
        if (block.moodMediaId) media.add(block.moodMediaId)
        break
      case 'plan': for (const stop of block.stops) places.add(stop); break
      case 'city': cities.add(block.citySlug); break
      default: break
    }
  }
  return {
    placeIds: [...places], eventIds: [...events], mediaIds: [...media],
    citySlugs: [...cities], urls: [...urls], pagePaths: [...paths],
  }
}

// ---------------------------------------------------------------------------
// Embeds
// ---------------------------------------------------------------------------

/** The click-to-load iframe URL for an embed, or null when it renders as a link card. */
export function blogEmbedFrameSrc(block: EmbedBlock): string | null {
  if (!embedHostAllowed(block.provider, block.url)) return null
  const url = new URL(block.url)
  const parts = url.pathname.split('/').filter(Boolean)
  if (block.provider === 'spotify') {
    const [kind, id] = parts
    if (['track', 'album', 'playlist', 'episode', 'show'].includes(kind) && /^[A-Za-z0-9]{10,40}$/.test(id ?? '')) {
      return `https://open.spotify.com/embed/${kind}/${id}`
    }
    return null
  }
  if (block.provider === 'youtube') {
    const id = url.hostname === 'youtu.be'
      ? parts[0]
      : parts[0] === 'watch' ? url.searchParams.get('v') ?? ''
      : parts[0] === 'shorts' || parts[0] === 'embed' ? parts[1] ?? '' : ''
    return id && VIDEO_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
  }
  if (block.provider === 'vimeo') {
    const id = parts.find((part) => /^[0-9]{6,12}$/.test(part))
    return id ? `https://player.vimeo.com/video/${id}` : null
  }
  return null
}

export function blogVideoFrameSrc(block: VideoBlock): string {
  return block.provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${block.videoId}?autoplay=1`
    : `https://player.vimeo.com/video/${block.videoId}?autoplay=1`
}

export const BLOG_EMBED_PROVIDER_LABELS: Readonly<Record<BlogEmbedProvider, string>> = {
  spotify: 'Spotify', youtube: 'YouTube', vimeo: 'Vimeo', instagram: 'Instagram', tiktok: 'TikTok', x: 'X',
}

// ---------------------------------------------------------------------------
// Readiness: one list, two enforcers (admin live, publish RPC on the server).
// ---------------------------------------------------------------------------

export interface BlogReadinessCheck {
  readonly id: string
  readonly label: string
  readonly serverEnforced: boolean
  readonly warningOnly: boolean
}

export const BLOG_READINESS_CHECKS: readonly BlogReadinessCheck[] = [
  { id: 'title', label: 'Has a title', serverEnforced: true, warningOnly: false },
  { id: 'category', label: 'Has a category', serverEnforced: true, warningOnly: false },
  { id: 'slug', label: 'Web address is valid and free', serverEnforced: true, warningOnly: false },
  { id: 'cover_present', label: 'Has a cover photo with alt text', serverEnforced: true, warningOnly: false },
  { id: 'cover_size', label: 'Cover is wide enough for the featured slot', serverEnforced: true, warningOnly: false },
  { id: 'image_alt', label: 'Every image has alt text', serverEnforced: true, warningOnly: false },
  { id: 'image_source', label: 'Every photo has a recorded source', serverEnforced: true, warningOnly: false },
  { id: 'links_live', label: 'All links open a live page', serverEnforced: true, warningOnly: false },
  { id: 'places_live', label: 'Every place card is a live place', serverEnforced: true, warningOnly: false },
  { id: 'offerings_public', label: 'Event cards open in the Mingla app, no host names shown', serverEnforced: true, warningOnly: false },
  { id: 'city_links', label: 'City cards point to a live city page', serverEnforced: false, warningOnly: false },
  { id: 'seo_lengths', label: 'Search title and description fit in results', serverEnforced: false, warningOnly: true },
]

/** Cover rule shared with the publish RPC: ≥1600×900, width/height between 1.5 and 2.4. */
export function blogCoverIsFeatureSize(width: number, height: number): boolean {
  if (!(width >= 1600 && height >= 900)) return false
  const ratio = width / height
  return ratio >= 1.5 && ratio <= 2.4
}
