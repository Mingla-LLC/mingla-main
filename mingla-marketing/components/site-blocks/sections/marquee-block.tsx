// #4636 block `marquee` — Home's decorative moving words, moved as-is (R1).
// Decorative: the same words are not content (aria-hidden).
import type { BlockProps } from './shared'

export interface MarqueeContent {
  words: readonly string[]
}

export function MarqueeBlock({ content }: BlockProps<MarqueeContent>) {
  return (
    <section className="marq-sec" aria-hidden="true">
      <div className="marq">
        {[0, 1].flatMap((copy) => content.words.map((word) => <span key={`${copy}-${word}`}>{word}</span>))}
      </div>
    </section>
  )
}
