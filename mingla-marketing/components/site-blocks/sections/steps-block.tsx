// #4636 block `steps` — three numbered steps, moved as-is (R1) from:
//   home     Home "How it works" (components/site/home-page.tsx), own section;
//   creators /creators steps (programme frame);
//   locals   /locals heading + steps (programme frame);
//   values   /careers values (programme frame).
// The variant is the page format the steps came from, never an editor control.
import { Bookmark, Calendar } from 'lucide-react'
import { Em, secClass, type BlockProps } from './shared'

export interface StepItem {
  title: string
  body: string
  /** The home step's small picture under the text. */
  visual?: 'none' | 'pills' | 'saved' | 'scheduled'
  words?: readonly string[]
}

export interface StepsContent {
  variant: 'home' | 'creators' | 'locals' | 'values'
  heading?: string
  lead?: string
  items: readonly StepItem[]
}

function StepVisual({ item }: { item: StepItem }) {
  const words = item.words ?? []
  if (item.visual === 'pills') {
    return (
      <div className="vis" aria-hidden="true">
        {words.map((w, i) => (
          <span className={i === 0 ? 'pill ink' : 'pill paper'} key={w}>
            {w}
          </span>
        ))}
      </div>
    )
  }
  if (item.visual === 'saved' || item.visual === 'scheduled') {
    return (
      <div className="vis" aria-hidden="true">
        <div className="mini">
          {item.visual === 'saved' ? <Bookmark /> : <Calendar />} {words[0]}
        </div>
      </div>
    )
  }
  return null
}

const nn = (index: number): string => String(index + 1).padStart(2, '0')

export function StepsBlock({ content, colour, blockId }: BlockProps<StepsContent>) {
  if (content.variant === 'home') {
    return (
      <section className={secClass(colour)} aria-labelledby={blockId}>
        <div className="wrap">
          <div className="split reveal">
            <h2 className="h2" id={blockId}>
              <Em text={content.heading ?? ''} />
            </h2>
            <p className="lead">{content.lead}</p>
          </div>
          <div className="grid3 mt-56">
            {content.items.map((item, index) => (
              <div className="step reveal" key={item.title}>
                <span className="n">{nn(index)}</span>
                <h3>
                  <Em text={item.title} />
                </h3>
                <p className="muted">{item.body}</p>
                <StepVisual item={item} />
              </div>
            ))}
          </div>
        </div>
      </section>
    )
  }
  if (content.variant === 'locals') {
    return (
      <>
        <h2 className="h2 reveal" id={blockId}>
          <Em text={content.heading ?? ''} />
        </h2>
        <ol className="grid3 mt-40 steps-list">
          {content.items.map((step, index) => (
            <li key={step.title} className="step reveal">
              <span className="n">{nn(index)}</span>
              <h3>{step.title}</h3>
              <p className="muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </>
    )
  }
  const values = content.variant === 'values'
  return (
    <ol className={values ? 'grid3 steps-list' : 'grid3 mt-24 steps-list'}>
      {content.items.map((step, index) => (
        <li key={step.title} className={values ? 'step reveal values' : 'step reveal'}>
          <span className="n">{nn(index)}</span>
          <h2 className="step-title">{step.title}</h2>
          <p className="muted">{step.body}</p>
        </li>
      ))}
    </ol>
  )
}
