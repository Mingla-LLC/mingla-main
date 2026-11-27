// #4636 — THE block registry for usemingla.com pages (one owner).
//
// A block is one of the site's existing sections, moved into a prop-driven
// component (components/site-blocks/sections/) that its original page also
// renders (spec addendum 1, R1). This file says, per block key: its version,
// a plain-English name and description, its category, the text fields (with
// limits), media slots, list fields (with item counts), the brand colours the
// section already has a working style for, and the wrapper it needs. It holds
// NO layout, spacing or type settings (R2, R3).
//
// Consumers:
//   - components/site-blocks/block-renderer.tsx renders a block list through it;
//   - lib/site-blocks/registry.json is this registry as plain JSON, written by
//     scripts/issue-4636-block-registry.mjs, for the database validator and the
//     Admin editor (the next phases). A test keeps the two identical.
//
// No imports: plain node tests load this file by stripping its types.
//
// Text markup: in a field with `em: true`, `*words*` is the italic half (the
// same convention as content/host-landing/icps.ts). No HTML anywhere.
// Media: `v:<name>` is a looping clip (public/marketing/site/m/<name>.mp4 with
// its poster), `p:<name>` a still (p/<name>.jpg); `m:<uuid>` is reserved for
// the media library (accepted by shape here, resolved by the next phase).
// Actions: `{ label?, to, track? }` where `to` is an internal path (`/x`), an
// https URL, a mailto: address, or `app:explorer` / `app:host` (the device-aware
// app hand-offs). `track` is the analytics label of an app hand-off (hidden).

export const REGISTRY_VERSION = 1

/** The brand fields a section can be painted in (R3). */
export const COLOURS = ['paper', 'cream', 'sand', 'moss', 'night', 'clay'] as const
export type Colour = (typeof COLOURS)[number]

export type BlockCategory = 'hero' | 'story' | 'media' | 'action' | 'live'

export type MediaKind = 'video' | 'photo'

/** Where an action may go: a page on this site, an https link, an email, or an app hand-off. */
export type ActionTarget = 'internal' | 'web' | 'mail' | 'explorer' | 'host'

export type FieldDef =
  | { key: string; kind: 'text'; label: string; max: number; required?: boolean; em?: boolean; hidden?: boolean }
  | { key: string; kind: 'media'; label: string; accept: readonly MediaKind[]; required?: boolean }
  | { key: string; kind: 'action'; label: string; required?: boolean; targets?: readonly ActionTarget[] }
  | { key: string; kind: 'enum'; label: string; options: readonly string[]; required?: boolean; hidden?: boolean }
  | { key: string; kind: 'city'; label: string; required?: boolean }
  | { key: string; kind: 'list'; label: string; min: number; max: number; item: readonly FieldDef[]; textItem?: { max: number; em?: boolean } }

export type BlockFrame = 'own' | 'programme'

export interface BlockDef {
  key: string
  version: number
  name: string
  description: string
  category: BlockCategory
  /** Live data stays live: the editor sets only headings and parameters (R7). */
  live: boolean
  /** Every block needs the landing root (LandingRoot, the font variables, landing.css + site.css + pages.css); city blocks also need the city wrapper. */
  wrapper: { landingRoot: true; city: boolean }
  /**
   * `own`: the block renders its own <section>. `programme`: it renders inside
   * the shared `<section className="pb-100"><div className="wrap">` frame of the
   * Creators / Locals / Careers pages; consecutive programme blocks share one frame.
   * Per variant when the variants differ (`*` = the rest).
   */
  frame: BlockFrame | Readonly<Record<string, BlockFrame>>
  /** At most this many on one page (the scroll behaviours bind to the first one). */
  maxPerPage?: number
  /**
   * Colours per variant (`*` = every variant). Only fields the section already
   * has a working style for today; the first is the default.
   */
  colours: Readonly<Record<string, readonly Colour[]>>
  fields: readonly FieldDef[]
}

const LANDING = { landingRoot: true, city: false } as const
const CITY = { landingRoot: true, city: true } as const

const text = (key: string, label: string, max: number, extra: { required?: boolean; em?: boolean; hidden?: boolean } = {}): FieldDef => ({
  key,
  kind: 'text',
  label,
  max,
  required: extra.required ?? true,
  ...(extra.em ? { em: true } : {}),
  ...(extra.hidden ? { hidden: true } : {}),
})
const optText = (key: string, label: string, max: number, em = false): FieldDef => text(key, label, max, { required: false, em })
const video = (key: string, label: string, required = true): FieldDef => ({ key, kind: 'media', label, accept: ['video', 'photo'], required })
const action = (key: string, label: string, required = true, targets?: readonly ActionTarget[]): FieldDef => ({
  key,
  kind: 'action',
  label,
  required,
  ...(targets ? { targets } : {}),
})
const INTERNAL: readonly ActionTarget[] = ['internal']
const variant = (options: readonly string[]): FieldDef => ({ key: 'variant', kind: 'enum', label: 'Format', options, required: true, hidden: true })
const city = (): FieldDef => ({ key: 'city', kind: 'city', label: 'City', required: true })

export const ICON_NAMES = ['ticket', 'users', 'mail', 'map', 'card', 'chat', 'calendar', 'tag', 'image', 'chart', 'sun'] as const
export const TOOL_NAMES = ['Venue Website Grader', 'Event Turnout Predictor', 'Quote Any Trip', 'The Undercharging Audit'] as const
export const TOOL_PATHS = ['/tools/venues', '/tools/events', '/tools/trips', '/tools/pricing'] as const

export const BLOCKS: readonly BlockDef[] = [
  // ------------------------------------------------------------------ heroes
  {
    key: 'reelHero',
    version: 1,
    name: 'Reel hero',
    description: 'The big headline with one button in a ring and the curved card carousel (Home, For hosts).',
    category: 'hero',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    maxPerPage: 1,
    colours: { '*': ['paper', 'night'] },
    fields: [
      { key: 'lines', kind: 'list', label: 'Headline lines', min: 1, max: 3, item: [], textItem: { max: 40, em: true } },
      { key: 'phrases', kind: 'list', label: 'Rotating phrases (shown after the first line)', min: 0, max: 8, item: [], textItem: { max: 30 } },
      optText('srTitle', 'Headline for screen readers (needed with rotating phrases)', 90),
      text('sub', 'Line under the headline', 220),
      action('cta', 'Button'),
      {
        key: 'cards',
        kind: 'list',
        label: 'Carousel cards',
        min: 4,
        max: 12,
        item: [video('media', 'Clip'), text('caption', 'Caption', 28)],
      },
    ],
  },
  {
    key: 'heroWords',
    version: 1,
    name: 'Programme hero',
    description: 'Headline, lead and two buttons (Creators, Locals).',
    category: 'hero',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    maxPerPage: 1,
    colours: { '*': ['paper'] },
    fields: [text('title', 'Headline', 70), optText('em', 'Italic end of the headline', 40), text('lead', 'Lead', 260), action('primary', 'Main button', true, ['internal', 'explorer']), action('secondary', 'Second button', true, INTERNAL)],
  },
  {
    key: 'pageHero',
    version: 1,
    name: 'Page headline',
    description: 'A large serif headline and a lead, with optional note and buttons (About, Going out, Cities, Help, Support, Careers, Free tools).',
    category: 'hero',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    maxPerPage: 1,
    colours: { '*': ['paper'] },
    fields: [
      variant(['plain', 'centred']),
      text('title', 'Headline', 90, { em: true }),
      optText('lead', 'Lead', 260),
      optText('note', 'Small note above the buttons', 160),
      { key: 'actions', kind: 'list', label: 'Buttons', min: 0, max: 2, item: [action('action', 'Button', true, ['internal', 'web', 'mail'])] },
    ],
  },
  {
    key: 'icpHero',
    version: 1,
    name: 'Full-screen video hero',
    description: 'Full-screen clip, two-line headline and the glass button bar (the host-type pages).',
    category: 'hero',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    maxPerPage: 1,
    colours: { '*': ['night'] },
    fields: [
      text('pillLead', 'Label pill, first word', 20),
      text('pill', 'Label pill', 40),
      text('line1', 'Headline line one', 40),
      text('line2', 'Headline line two (italic)', 40),
      text('sub', 'Line under the headline', 220),
      video('media', 'Background clip'),
      action('call', 'Call button', true, INTERNAL),
      action('app', 'App button', true, ['host']),
    ],
  },
  {
    key: 'cityHero',
    version: 1,
    name: 'City hero',
    description: 'The city clip with "Things to do in <City>" and the app button. Text follows the city.',
    category: 'hero',
    live: true,
    wrapper: CITY,
    frame: 'own',
    maxPerPage: 1,
    colours: { '*': ['night'] },
    fields: [city()],
  },
  // ------------------------------------------------------------------- story
  {
    key: 'steps',
    version: 1,
    name: 'Numbered steps',
    description: 'Three numbered steps (Home how it works, Creators, Locals, Careers values).',
    category: 'story',
    live: false,
    wrapper: LANDING,
    frame: { '*': 'programme', home: 'own' },
    colours: { home: ['paper'], creators: ['paper'], locals: ['paper'], values: ['paper'] },
    fields: [
      variant(['home', 'creators', 'locals', 'values']),
      optText('heading', 'Heading', 90, true),
      optText('lead', 'Lead', 260),
      {
        key: 'items',
        kind: 'list',
        label: 'Steps',
        min: 3,
        max: 3,
        item: [
          text('title', 'Step title', 60, { em: true }),
          text('body', 'Step text', 200),
          { key: 'visual', kind: 'enum', label: 'Picture', options: ['none', 'pills', 'saved', 'scheduled'], required: false, hidden: true },
          { key: 'words', kind: 'list', label: 'Picture words', min: 0, max: 3, item: [], textItem: { max: 24 } },
        ],
      },
    ],
  },
  {
    key: 'litAbout',
    version: 1,
    name: 'Intro with lit paragraph',
    description: 'Intro, two buttons, the wordmark and a large paragraph that lights up word by word on scroll.',
    category: 'story',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    maxPerPage: 1,
    colours: { '*': ['cream'] },
    fields: [
      text('intro', 'Intro', 320),
      action('call', 'Talk button', true, INTERNAL),
      text('insideLabel', '"See what\'s inside" label', 30),
      text('duoA', 'Before word', 20),
      text('duoB', 'After word', 20),
      text('big', 'Large paragraph', 420, { em: true }),
    ],
  },
  {
    key: 'icpFeatures',
    version: 1,
    name: 'Sticky features over video',
    description: 'A sticky left column with three section buttons beside three glass video cards, over a background clip.',
    category: 'story',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    maxPerPage: 1,
    colours: { '*': ['night'] },
    fields: [
      text('heading', 'Heading', 90, { em: true }),
      text('lead', 'Lead', 200),
      video('background', 'Background'),
      action('cta', 'Button', true, ['host']),
      {
        key: 'items',
        kind: 'list',
        label: 'Feature cards',
        min: 3,
        max: 3,
        item: [
          { key: 'icon', kind: 'enum', label: 'Icon', options: ICON_NAMES, required: true },
          text('title', 'Title', 40),
          video('media', 'Clip'),
          text('body', 'Text', 220),
          { key: 'tags', kind: 'list', label: 'Tags', min: 1, max: 6, item: [], textItem: { max: 24 } },
        ],
      },
    ],
  },
  {
    key: 'paras',
    version: 1,
    name: 'Heading with paragraphs',
    description: 'A heading beside a few paragraphs (About "why").',
    category: 'story',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [text('heading', 'Heading', 90, { em: true }), { key: 'paragraphs', kind: 'list', label: 'Paragraphs', min: 1, max: 5, item: [], textItem: { max: 400 } }],
  },
  {
    key: 'answer',
    version: 1,
    name: 'Direct answer',
    description: 'One question and its plain answer, the text search and answer engines quote (About, Going out).',
    category: 'story',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [text('question', 'Question', 120), text('answer', 'Answer', 600)],
  },
  {
    key: 'facts',
    version: 1,
    name: 'Fact cards',
    description: 'Two cards with a short title and a paragraph (Locals).',
    category: 'story',
    live: false,
    wrapper: LANDING,
    frame: 'programme',
    colours: { '*': ['paper'] },
    fields: [{ key: 'items', kind: 'list', label: 'Cards', min: 2, max: 2, item: [text('title', 'Title', 60), text('body', 'Text', 400)] }],
  },
  {
    key: 'toolkit',
    version: 1,
    name: 'Numbered link list',
    description: 'A heading over numbered rows, each opening a page or the Host app (For hosts toolkit).',
    category: 'story',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [
      text('heading', 'Heading', 90, { em: true }),
      {
        key: 'items',
        kind: 'list',
        label: 'Rows',
        min: 2,
        max: 8,
        item: [text('title', 'Title', 40), text('line', 'Line', 140), action('action', 'Opens', true, ['internal', 'host'])],
      },
    ],
  },
  {
    key: 'chips',
    version: 1,
    name: 'Who it is for',
    description: 'A heading beside a set of chips (host-type pages).',
    category: 'story',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [text('heading', 'Heading', 90, { em: true }), { key: 'items', kind: 'list', label: 'Chips', min: 2, max: 12, item: [], textItem: { max: 32 } }],
  },
  {
    key: 'faq',
    version: 1,
    name: 'Questions',
    description: 'Questions that open to their answers (host-type pages, city pages).',
    category: 'story',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [
      variant(['icp', 'city']),
      optText('prefix', 'Words before the heading (the city name)', 40),
      text('heading', 'Heading', 90, { em: true }),
      action('action', 'Button under the heading', false, INTERNAL),
      { key: 'items', kind: 'list', label: 'Questions', min: 1, max: 12, item: [text('question', 'Question', 140), text('answer', 'Answer', 600)] },
    ],
  },
  {
    key: 'marquee',
    version: 1,
    name: 'Moving words',
    description: 'A decorative line of words that scrolls sideways (Home).',
    category: 'story',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [{ key: 'words', kind: 'list', label: 'Words', min: 3, max: 16, item: [], textItem: { max: 24 } }],
  },
  // ------------------------------------------------------------------- media
  {
    key: 'tiles',
    version: 1,
    name: 'Video tiles',
    description: 'A heading and lead over a grid of clip tiles that open pages (Home audiences, For hosts host types).',
    category: 'media',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper', 'night'] },
    fields: [
      text('heading', 'Heading', 90, { em: true }),
      optText('lead', 'Lead', 260),
      {
        key: 'items',
        kind: 'list',
        label: 'Tiles',
        min: 2,
        max: 12,
        item: [
          video('media', 'Clip'),
          text('title', 'Title', 40),
          text('line', 'Line', 120),
          optText('lineEnd', 'Line, second half', 120),
          action('action', 'Opens', true, INTERNAL),
          { key: 'look', kind: 'enum', label: 'Tile look', options: ['plain', 'tools'], required: false, hidden: true },
        ],
      },
    ],
  },
  {
    key: 'clipGrid',
    version: 1,
    name: 'Four clips',
    description: 'Four silent clips in a row (Creators).',
    category: 'media',
    live: false,
    wrapper: LANDING,
    frame: 'programme',
    colours: { '*': ['paper'] },
    fields: [{ key: 'items', kind: 'list', label: 'Clips', min: 4, max: 4, item: [video('media', 'Clip')] }],
  },
  {
    key: 'wideClip',
    version: 1,
    name: 'Wide clip',
    description: 'One wide ambient clip (About).',
    category: 'media',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [video('media', 'Clip')],
  },
  {
    key: 'vcards',
    version: 1,
    name: 'Video text cards',
    description: 'Clip cards with the wordmark and text over an ink wash (About app cards, For hosts Ari cards).',
    category: 'media',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { about: ['cream'], ari: ['night'] },
    fields: [
      variant(['about', 'ari']),
      optText('heading', 'Heading', 90, true),
      optText('lead', 'Lead', 260),
      {
        key: 'items',
        kind: 'list',
        label: 'Cards',
        min: 2,
        max: 4,
        item: [
          video('media', 'Clip'),
          optText('wordmark', 'Wordmark name (screen readers)', 30),
          text('title', 'Title', 60, { em: true }),
          text('line', 'Line', 140),
          action('action', 'Opens', false, ['internal', 'explorer']),
        ],
      },
    ],
  },
  {
    key: 'filterGrid',
    version: 1,
    name: 'Filtered guides',
    description: 'A row of filter chips, one wide tile and guide tiles the chips filter (Going out).',
    category: 'media',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [
      { key: 'chips', kind: 'list', label: 'Filter chips', min: 2, max: 8, item: [], textItem: { max: 24 } },
      video('wideMedia', 'Wide tile clip'),
      text('wideTitle', 'Wide tile title', 60, { em: true }),
      text('wideLine', 'Wide tile line', 120),
      action('wideAction', 'Wide tile opens', true, INTERNAL),
      optText('empty', 'Text when a chip has no guides', 60),
      {
        key: 'items',
        kind: 'list',
        label: 'Guides',
        min: 1,
        max: 12,
        item: [
          video('media', 'Clip'),
          text('title', 'Title', 40),
          text('line', 'Line', 120),
          { key: 'tags', kind: 'list', label: 'Chips it shows under', min: 1, max: 4, item: [], textItem: { max: 24 } },
          { key: 'city', kind: 'city', label: 'City (empty: all cities)', required: false },
        ],
      },
    ],
  },
  // ----------------------------------------------------------------- actions
  {
    key: 'videoBand',
    version: 1,
    name: 'Closing video band',
    description: 'A rounded clip band with a heading and buttons (the closing band of Home, For hosts, host types, Creators, Locals).',
    category: 'action',
    live: false,
    wrapper: LANDING,
    frame: { '*': 'own', creators: 'programme', locals: 'programme' },
    colours: { '*': ['night'] },
    fields: [
      variant(['plain', 'glass', 'icp', 'creators', 'locals']),
      video('media', 'Clip'),
      text('heading', 'Heading', 80, { em: true }),
      optText('body', 'Text', 260),
      optText('bring', 'Line beside the button', 60),
      action('primary', 'Button'),
      { key: 'secondary', kind: 'action', label: 'Second button', required: false },
    ],
  },
  {
    key: 'toolCard',
    version: 1,
    name: 'Free tool card',
    description: 'One free tool with its preview form (host-type pages).',
    category: 'action',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [
      { key: 'tool', kind: 'enum', label: 'Tool', options: TOOL_NAMES, required: true },
      text('body', 'Text', 260),
      text('cta', 'Button', 30),
      {
        key: 'fields',
        kind: 'list',
        label: 'Preview fields',
        min: 1,
        max: 6,
        item: [text('label', 'Label', 30), { key: 'input', kind: 'enum', label: 'Kind', options: ['text', 'select'], required: true, hidden: true }, text('example', 'Example', 40)],
      },
    ],
  },
  {
    key: 'toolCards',
    version: 1,
    name: 'Free tool cards',
    description: 'A card per free tool with its clip (Free tools).',
    category: 'action',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [
      {
        key: 'items',
        kind: 'list',
        label: 'Tools',
        min: 1,
        max: 4,
        item: [
          { key: 'tool', kind: 'enum', label: 'Tool page', options: TOOL_PATHS, required: true },
          text('title', 'Title', 40),
          text('body', 'Text', 220),
          text('forWho', 'Who it is for', 60),
          text('cta', 'Button', 30),
          video('media', 'Clip'),
        ],
      },
    ],
  },
  {
    key: 'promptDemo',
    version: 1,
    name: 'Website prompt demo',
    description: 'Heading, lead and button beside the "prompt your website" demo (For hosts).',
    category: 'action',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    maxPerPage: 1,
    colours: { '*': ['cream'] },
    fields: [text('heading', 'Heading', 90, { em: true }), text('lead', 'Lead', 260), text('button', 'Button', 30)],
  },
  {
    key: 'getApp',
    version: 1,
    name: 'Get the app',
    description: 'The Mingla / Mingla Host toggle with QR codes and store buttons (Download).',
    category: 'action',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    maxPerPage: 1,
    colours: { '*': ['paper'] },
    fields: [
      text('explorerTitle', 'Mingla headline', 40, { em: true }),
      text('explorerLead', 'Mingla lead', 160),
      text('hostTitle', 'Mingla Host headline', 40, { em: true }),
      text('hostLead', 'Mingla Host lead', 160),
      video('media', 'Phone clip'),
    ],
  },
  {
    key: 'quickLinks',
    version: 1,
    name: 'Quick links',
    description: 'A row of link cards and a note (Support).',
    category: 'action',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [
      text('heading', 'Heading (screen readers)', 60),
      { key: 'items', kind: 'list', label: 'Links', min: 1, max: 8, item: [action('action', 'Link', true, INTERNAL)] },
      optText('note', 'Note', 200),
    ],
  },
  {
    key: 'stillStuck',
    version: 1,
    name: 'Contact card',
    description: 'A card with a heading, a line and two buttons (Help "Still stuck?").',
    category: 'action',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [text('heading', 'Heading', 60, { em: true }), text('lead', 'Lead', 200), action('primary', 'Main button', true, ['internal', 'web', 'mail']), action('secondary', 'Second button', true, ['internal', 'web', 'mail'])],
  },
  {
    key: 'finePrint',
    version: 1,
    name: 'Fine print',
    description: 'One small line with a link (Creators, Locals agreement line).',
    category: 'action',
    live: false,
    wrapper: LANDING,
    frame: 'programme',
    colours: { '*': ['paper'] },
    fields: [text('before', 'Text before the link', 120), action('link', 'Link', true, INTERNAL), text('after', 'Text after the link', 120)],
  },
  {
    key: 'form',
    version: 1,
    name: 'Form',
    description: 'A published form from Forms (#4452).',
    category: 'action',
    live: true,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [text('formId', 'Form', 64), optText('heading', 'Heading', 60), optText('em', 'Italic end of the heading', 40), optText('sub', 'Line under the heading', 160)],
  },
  {
    key: 'buttons',
    version: 1,
    name: 'Buttons',
    description: 'One or two buttons in a row (#4452).',
    category: 'action',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [{ key: 'items', kind: 'list', label: 'Buttons', min: 1, max: 2, item: [action('action', 'Button')] }],
  },
  {
    key: 'banner',
    version: 1,
    name: 'Banner',
    description: 'A one-line banner with a button, optionally until a date (#4452).',
    category: 'action',
    live: false,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [text('text', 'Text', 140), text('button', 'Button', 30), action('action', 'Opens'), optText('showUntil', 'Show until (YYYY-MM-DD)', 10)],
  },
  // -------------------------------------------------------------------- live
  {
    key: 'citiesRow',
    version: 1,
    name: 'Live cities',
    description: 'Every live Mingla city as a clip tile, A to Z (Home row, Cities page). The list stays live.',
    category: 'live',
    live: true,
    wrapper: LANDING,
    frame: 'own',
    colours: { home: ['paper'], index: ['paper'] },
    fields: [variant(['home', 'index']), optText('heading', 'Heading', 90, true), action('action', 'Button', false, INTERNAL)],
  },
  {
    key: 'cityLinks',
    version: 1,
    name: 'City links',
    description: 'One "Things to do in <City>" link per live city (Going out).',
    category: 'live',
    live: true,
    wrapper: LANDING,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [text('heading', 'Heading', 90, { em: true }), text('prefix', 'Link text before the city name', 40)],
  },
  {
    key: 'cityWeekend',
    version: 1,
    name: 'This weekend',
    description: 'The city\'s live weekend plans with Events / Experiences / Places chips.',
    category: 'live',
    live: true,
    wrapper: CITY,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [city()],
  },
  {
    key: 'topPlaces',
    version: 1,
    name: 'Top places',
    description: 'The city\'s ranked places with their detail sheet.',
    category: 'live',
    live: true,
    wrapper: CITY,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [city()],
  },
  {
    key: 'cityPlans',
    version: 1,
    name: 'City plans',
    description: 'The moss "More than one mode." band with the city\'s ready-made plans.',
    category: 'live',
    live: true,
    wrapper: CITY,
    frame: 'own',
    colours: { '*': ['moss'] },
    fields: [city(), text('heading', 'Heading', 90, { em: true })],
  },
  {
    key: 'cityHostBand',
    version: 1,
    name: 'City host band',
    description: '"Run a place in <City>?" with the Mingla Host button.',
    category: 'live',
    live: true,
    wrapper: CITY,
    frame: 'own',
    colours: { '*': ['paper'] },
    fields: [city()],
  },
  {
    key: 'blogStories',
    version: 1,
    name: 'Blog stories',
    description: 'The latest blog stories with category tabs and load more. The stories stay live.',
    category: 'live',
    live: true,
    wrapper: LANDING,
    frame: 'own',
    maxPerPage: 1,
    colours: { '*': ['paper'] },
    fields: [text('title', 'Headline', 60, { em: true }), text('lede', 'Lead', 200)],
  },
  {
    key: 'helpVideos',
    version: 1,
    name: 'Help videos',
    description: 'The help centre search, chips and video cards. The videos stay live.',
    category: 'live',
    live: true,
    wrapper: LANDING,
    frame: 'own',
    maxPerPage: 1,
    colours: { '*': ['paper'] },
    fields: [],
  },
  {
    key: 'openRoles',
    version: 1,
    name: 'Open roles',
    description: 'The live open roles, or "No open roles right now." (Careers).',
    category: 'live',
    live: true,
    wrapper: LANDING,
    frame: 'programme',
    maxPerPage: 1,
    colours: { '*': ['paper'] },
    fields: [],
  },
  {
    key: 'scheduler',
    version: 1,
    name: 'Book a call',
    description: 'The live booking calendar (Schedule).',
    category: 'live',
    live: true,
    wrapper: LANDING,
    frame: 'own',
    maxPerPage: 1,
    colours: { '*': ['night'] },
    fields: [],
  },
]

export const BLOCK_KEYS: readonly string[] = BLOCKS.map((b) => b.key)

/** The frame a block renders in (its variant decides when the variants differ). */
export function blockFrame(def: BlockDef, content?: Record<string, unknown>): BlockFrame {
  if (typeof def.frame === 'string') return def.frame
  const variantName = typeof content?.variant === 'string' ? content.variant : '*'
  return def.frame[variantName] ?? def.frame['*'] ?? 'own'
}

export function blockDef(key: string): BlockDef | null {
  return BLOCKS.find((b) => b.key === key) ?? null
}

/** The colours a block (in this variant) may be painted in; the first is its default. */
export function allowedColours(def: BlockDef, variantName?: string): readonly Colour[] {
  return (variantName !== undefined ? def.colours[variantName] : undefined) ?? def.colours['*'] ?? Object.values(def.colours)[0] ?? []
}

// ------------------------------------------------------------- validation

/** One block of a page: what the database stores and the renderer reads. */
export interface PageBlock {
  type: string
  version: number
  content: Record<string, unknown>
  colour?: string
  hidden?: boolean
  /** #4636: an optional stable id the editor keeps across moves. */
  id?: string
}

export type BlockCheck = { ok: true } | { ok: false; errors: string[] }

const MEDIA_RE = /^(v|p):[a-z0-9][a-z0-9-]{0,60}$|^m:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CITY_RE = /^[a-z0-9][a-z0-9-]{0,40}$/
const TRACK_RE = /^[a-z0-9_]{1,40}$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A text value: plain words, no HTML; `*em*` only where allowed and balanced. */
function checkText(value: unknown, max: number, em: boolean, at: string, errors: string[]): void {
  if (typeof value !== 'string') {
    errors.push(`${at}: must be text`)
    return
  }
  if (value.trim() === '') errors.push(`${at}: is empty`)
  if (value.length > max) errors.push(`${at}: longer than ${max} characters`)
  if (/[<>]/.test(value)) errors.push(`${at}: contains < or >`)
  const stars = (value.match(/\*/g) ?? []).length
  if (!em && stars > 0) errors.push(`${at}: italic markup is not allowed here`)
  if (em && stars % 2 !== 0) errors.push(`${at}: unbalanced *italic* markup`)
}

/** A destination: internal path, https URL, mailto:, or an app hand-off. */
export function isActionTarget(to: unknown): boolean {
  if (typeof to !== 'string' || to.length > 300) return false
  if (to === 'app:explorer' || to === 'app:host') return true
  if (/^\/(?!\/)[A-Za-z0-9\-._~/?=&%#]*$/.test(to)) return !to.includes('..')
  if (/^https:\/\/[A-Za-z0-9.-]+(\/[^\s<>"']*)?$/.test(to)) return true
  if (/^mailto:[^\s<>"'@]+@[^\s<>"'@]+$/.test(to)) return true
  return false
}

/** Which kind of destination an action goes to (null: not a valid destination). */
export function actionTargetKind(to: unknown): ActionTarget | null {
  if (!isActionTarget(to)) return null
  const t = to as string
  if (t === 'app:explorer') return 'explorer'
  if (t === 'app:host') return 'host'
  if (t.startsWith('/')) return 'internal'
  if (t.startsWith('mailto:')) return 'mail'
  return 'web'
}

function checkAction(value: unknown, at: string, errors: string[], targets?: readonly ActionTarget[]): void {
  if (!isRecord(value)) {
    errors.push(`${at}: must be { label, to }`)
    return
  }
  for (const k of Object.keys(value)) if (!['label', 'to', 'track'].includes(k)) errors.push(`${at}.${k}: unknown`)
  const kind = actionTargetKind(value.to)
  if (kind === null) errors.push(`${at}.to: not an internal path, https link, email or app`)
  else if (targets && !targets.includes(kind)) errors.push(`${at}.to: a ${kind} destination is not allowed here (${targets.join(', ')})`)
  if (value.label !== undefined) checkText(value.label, 40, false, `${at}.label`, errors)
  if (value.label === undefined && value.to !== 'app:explorer' && value.to !== 'app:host') errors.push(`${at}.label: needed for a link`)
  if (value.track !== undefined && (typeof value.track !== 'string' || !TRACK_RE.test(value.track))) errors.push(`${at}.track: invalid`)
}

function checkField(field: FieldDef, value: unknown, at: string, errors: string[]): void {
  const required = field.kind === 'list' ? field.min > 0 : field.required !== false
  if (value === undefined || value === null) {
    if (required) errors.push(`${at}: missing`)
    return
  }
  switch (field.kind) {
    case 'text':
      checkText(value, field.max, field.em === true, at, errors)
      return
    case 'media':
      if (typeof value !== 'string' || !MEDIA_RE.test(value)) {
        errors.push(`${at}: not a media reference`)
        return
      }
      if (value.startsWith('v:') && !field.accept.includes('video')) errors.push(`${at}: a clip is not allowed here`)
      if (value.startsWith('p:') && !field.accept.includes('photo')) errors.push(`${at}: a photo is not allowed here`)
      return
    case 'action':
      checkAction(value, at, errors, field.targets)
      return
    case 'enum':
      if (typeof value !== 'string' || !field.options.includes(value)) errors.push(`${at}: not one of ${field.options.join(', ')}`)
      return
    case 'city':
      if (typeof value !== 'string' || !CITY_RE.test(value)) errors.push(`${at}: not a city`)
      return
    case 'list': {
      if (!Array.isArray(value)) {
        errors.push(`${at}: must be a list`)
        return
      }
      if (value.length < field.min) errors.push(`${at}: needs at least ${field.min}`)
      if (value.length > field.max) errors.push(`${at}: at most ${field.max}`)
      value.forEach((item, i) => {
        if (field.textItem) {
          checkText(item, field.textItem.max, field.textItem.em === true, `${at}[${i}]`, errors)
          return
        }
        if (!isRecord(item)) {
          errors.push(`${at}[${i}]: must be an object`)
          return
        }
        checkObject(field.item, item, `${at}[${i}]`, errors)
      })
      return
    }
    default: {
      const never: never = field
      errors.push(`${at}: unknown field kind ${String(never)}`)
    }
  }
}

function checkObject(fields: readonly FieldDef[], value: Record<string, unknown>, at: string, errors: string[]): void {
  const known = new Set(fields.map((f) => f.key))
  for (const k of Object.keys(value)) if (!known.has(k)) errors.push(`${at}.${k}: unknown field`)
  for (const f of fields) checkField(f, value[f.key], `${at}.${f.key}`, errors)
}

/** Checks one block against the registry. Never throws. */
export function validateBlock(block: unknown): BlockCheck {
  const errors: string[] = []
  if (!isRecord(block)) return { ok: false, errors: ['block: must be an object'] }
  for (const k of Object.keys(block)) if (!['type', 'version', 'content', 'colour', 'hidden', 'id'].includes(k)) errors.push(`block.${k}: unknown`)
  const def = typeof block.type === 'string' ? blockDef(block.type) : null
  if (!def) return { ok: false, errors: [`block.type: unknown block "${String(block.type)}"`] }
  if (typeof block.version !== 'number' || !Number.isInteger(block.version) || block.version < 1) errors.push('block.version: must be a whole number')
  else if (block.version > def.version) errors.push(`block.version: ${block.version} is newer than this site knows (${def.version})`)
  if (block.hidden !== undefined && typeof block.hidden !== 'boolean') errors.push('block.hidden: must be true or false')
  // #4636: the same rule as the database (site_block_errors): a stable id for the editor, if any.
  if (block.id !== undefined && (typeof block.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(block.id))) errors.push('block.id: must be 1-64 letters, digits, - or _')
  if (!isRecord(block.content)) {
    errors.push('block.content: must be an object')
    return { ok: false, errors }
  }
  checkObject(def.fields, block.content, def.key, errors)
  if (block.colour !== undefined) {
    const variantName = typeof block.content.variant === 'string' ? block.content.variant : undefined
    const allowed = allowedColours(def, variantName)
    if (typeof block.colour !== 'string' || !(allowed as readonly string[]).includes(block.colour)) {
      errors.push(`block.colour: "${String(block.colour)}" is not available for ${def.key} (${allowed.join(', ')})`)
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}

/** Checks a whole page's block list: each block, at most 40, and the per-page limits. */
export function validatePage(blocks: unknown): { ok: boolean; results: BlockCheck[]; errors: string[] } {
  const errors: string[] = []
  if (!Array.isArray(blocks)) return { ok: false, results: [], errors: ['page: blocks must be a list'] }
  if (blocks.length > 40) errors.push('page: at most 40 blocks')
  const results = blocks.map(validateBlock)
  const counts = new Map<string, number>()
  for (const b of blocks) if (isRecord(b) && typeof b.type === 'string') counts.set(b.type, (counts.get(b.type) ?? 0) + 1)
  for (const [key, n] of counts) {
    const def = blockDef(key)
    if (def?.maxPerPage !== undefined && n > def.maxPerPage) errors.push(`page: ${key} at most ${def.maxPerPage} per page`)
  }
  return { ok: errors.length === 0 && results.every((r) => r.ok), results, errors }
}

/** The registry as plain JSON (what registry.json holds). */
export function registryJson(): { registry_version: number; colours: readonly Colour[]; blocks: readonly BlockDef[] } {
  return { registry_version: REGISTRY_VERSION, colours: COLOURS, blocks: BLOCKS }
}
