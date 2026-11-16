// #4452 §7.4 — the photo side of a pop-up (design visHTML): the chosen photo
// under a brand backdrop, the headline with its italic ending and the three
// reasons with ticks, placed on the 3 x 3 grid with fixed breathing room
// (32 px desktop, 20 px phone) and the chosen line alignment and colours.
import type { CSSProperties } from 'react'
import { type FormDesign, TICK_HEX, scrimCss } from '@/lib/forms/design'

const JUSTIFY = { top: 'flex-start', centre: 'center', bottom: 'flex-end' } as const
const ALIGN = { left: 'flex-start', centre: 'center', right: 'flex-end' } as const
const TEXT = { left: 'left', centre: 'center', right: 'right' } as const

export function FormLook({ design, compact = false }: { design: FormDesign; compact?: boolean }) {
  const style: CSSProperties = {
    backgroundImage: design.photo_url ? `url(${design.photo_url})` : undefined,
  }
  const wash: CSSProperties = {
    background: scrimCss(design.backdrop),
    padding: compact ? 20 : 32,
    justifyContent: JUSTIFY[design.row],
    alignItems: ALIGN[design.col],
    textAlign: TEXT[design.align],
    color: design.text_color,
  }
  const reasons = design.reasons.filter((r) => r.trim() !== '')
  return (
    <div className="pu-photo fl-look" style={style} aria-hidden="true" data-look-pos={`${design.row}-${design.col}`}>
      <div className="fl-wash" style={wash}>
        <div className="fl-text">
          <p className="fl-head">{design.head} {design.em ? <em>{design.em}</em> : null}</p>
          {reasons.length ? (
            <ul className="fl-reasons">
              {reasons.map((r) => (
                <li key={r}><span className="fl-tick" style={{ color: TICK_HEX[design.tick] }}>✓</span> {r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  )
}
