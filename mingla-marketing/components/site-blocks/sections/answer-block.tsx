// #4636 block `answer` — one question and its plain answer, visible, the text
// search and answer engines quote (#4339 round B SEO audits). Moved as-is (R1)
// from About and Going out, where it reads the page's own record.
import type { BlockProps } from './shared'

export interface AnswerContent {
  question: string
  answer: string
}

export function AnswerBlock({ content, blockId }: BlockProps<AnswerContent>) {
  return (
    <section className="answer-sec" aria-labelledby={blockId}>
      <div className="wrap answer-block">
        <h2 className="h2" id={blockId}>
          {content.question}
        </h2>
        <p className="lead">{content.answer}</p>
      </div>
    </section>
  )
}
