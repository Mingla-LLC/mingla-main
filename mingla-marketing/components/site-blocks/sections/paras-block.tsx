// #4636 block `paras` — a heading beside a few paragraphs (About "Good plans
// shouldn't be hard to find."), moved as-is (R1).
import { Em, secClass, type BlockProps } from './shared'

export interface ParasContent {
  heading: string
  paragraphs: readonly string[]
}

export function ParasBlock({ content, colour, blockId }: BlockProps<ParasContent>) {
  return (
    <section className={secClass(colour)} aria-labelledby={blockId}>
      <div className="wrap split about-split">
        <h2 className="h2 reveal" id={blockId}>
          <Em text={content.heading} />
        </h2>
        <div className="about-copy reveal">
          {content.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </div>
    </section>
  )
}
