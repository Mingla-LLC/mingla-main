// #4452 §7.4 Design tab, rendered on the site. The builder saves these choices
// in the form definition's `design`; the site (and the builder's live preview,
// which runs this same code) reads them through designOf, which checks every
// value and fills every default. Mirrors mingla-admin/src/lib/formsModel.js
// designOf (same keys, limits and defaults; parity is tested).

export type Layout = 'centre' | 'side' | 'inline' | 'page'
export type Row = 'top' | 'centre' | 'bottom'
export type Col = 'left' | 'centre' | 'right'
export type Backdrop = 'night' | 'ink' | 'moss' | 'clay' | 'paper'
export type Tick = 'orange' | 'white' | 'sand'

export interface FormDesign {
  layout: Layout
  photo_url: string | null
  row: Row
  col: Col
  align: Col
  text_color: string
  backdrop: Backdrop
  tick: Tick
  title: string
  head: string
  em: string
  reasons: string[]
  send: string
  dismiss: string
  small: string
  columns: 1 | 2
  phone_steps: boolean
}

export const DESIGN_LIMITS = { title: 40, head: 24, em: 20, reason: 44, send: 24, dismiss: 16, small: 60 } as const
export const SCRIM_RGBA: Record<Backdrop, [number, number, number, number]> = {
  night: [21, 23, 28, 0.72],
  ink: [17, 17, 16, 0.7],
  moss: [47, 58, 46, 0.74],
  clay: [140, 90, 60, 0.74],
  paper: [245, 244, 240, 0.86],
}
export const TICK_HEX: Record<Tick, string> = { orange: '#f0904a', white: '#ffffff', sand: '#d9cbb4' }

const DEFAULTS: FormDesign = {
  layout: 'centre',
  photo_url: null,
  row: 'centre',
  col: 'centre',
  align: 'left',
  text_color: '#ffffff',
  backdrop: 'night',
  tick: 'orange',
  title: 'Apply to make with Mingla',
  head: 'Make with',
  em: 'Mingla.',
  reasons: ['Paid gigs at places people love', 'Your name on the work', 'Lagos, Raleigh, London, Dublin, Helsinki'],
  send: 'Send application',
  dismiss: 'Not now',
  small: 'Takes 2 minutes · we reply in 3 days',
  columns: 1,
  phone_steps: false,
}

const ROWS: Row[] = ['top', 'centre', 'bottom']
const COLS: Col[] = ['left', 'centre', 'right']

/**
 * A photo is shown only from the site-media bucket (an uploaded or library
 * photo) on Supabase storage, as stored: never /render/image (#1643).
 */
export function safePhotoUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/site-media\/[A-Za-z0-9/_.%-]+\.(jpe?g|png|webp)$/i.test(v) ? v : null
}

export function designOf(raw: unknown): FormDesign {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const text = (k: keyof typeof DESIGN_LIMITS & keyof FormDesign, max: number): string =>
    typeof d[k] === 'string' ? (d[k] as string).slice(0, max) : (DEFAULTS[k] as string)
  const pos = typeof d.text_pos === 'string' ? (d.text_pos === 'centre' ? 'centre-centre' : d.text_pos) : 'centre-centre'
  const [row, col] = pos.split('-') as [Row, Col]
  const reasons = Array.isArray(d.reasons)
    ? [0, 1, 2].map((i) => {
        const r = (d.reasons as unknown[])[i]
        return typeof r === 'string' ? r.slice(0, DESIGN_LIMITS.reason) : ''
      })
    : DEFAULTS.reasons.slice()
  return {
    layout: (['centre', 'side', 'inline', 'page'] as const).includes(d.layout as Layout) ? (d.layout as Layout) : DEFAULTS.layout,
    photo_url: safePhotoUrl(d.photo_url),
    row: ROWS.includes(row) && COLS.includes(col) ? row : 'centre',
    col: ROWS.includes(row) && COLS.includes(col) ? col : 'centre',
    align: COLS.includes(d.align as Col) ? (d.align as Col) : DEFAULTS.align,
    text_color: typeof d.text_color === 'string' && /^#[0-9a-f]{6}$/i.test(d.text_color) ? d.text_color : DEFAULTS.text_color,
    backdrop: Object.hasOwn(SCRIM_RGBA, d.backdrop as string) ? (d.backdrop as Backdrop) : DEFAULTS.backdrop,
    tick: Object.hasOwn(TICK_HEX, d.tick as string) ? (d.tick as Tick) : DEFAULTS.tick,
    title: text('title', DESIGN_LIMITS.title),
    head: text('head', DESIGN_LIMITS.head),
    em: text('em', DESIGN_LIMITS.em),
    reasons,
    send: text('send', DESIGN_LIMITS.send),
    dismiss: text('dismiss', DESIGN_LIMITS.dismiss),
    small: text('small', DESIGN_LIMITS.small),
    columns: d.columns === 2 ? 2 : 1,
    phone_steps: d.phone_steps === true,
  }
}

export function scrimCss(b: Backdrop): string {
  const [r, g, bl, a] = SCRIM_RGBA[b]
  return `rgba(${r},${g},${bl},${a})`
}
