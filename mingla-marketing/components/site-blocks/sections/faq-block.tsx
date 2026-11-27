// #4636 block `faq` — questions that open to their answers, moved as-is (R1):
//   icp   host-type pages ("The short answers.", Help centre button, the first
//         question open, `data-icp-faq` for the analytics listener);
//   city  city pages ("<City> questions, answered.", the FAQPage answers).
import Link from 'next/link'
import { ArrowRight, Plus } from 'lucide-react'
import { Em, secClass, type BlockAction, type BlockProps } from './shared'

export interface FaqContent {
  variant: 'icp' | 'city'
  heading: string
  action?: BlockAction
  items: readonly { question: string; answer: string }[]
}

export function FaqBlock({ content, colour, blockId }: BlockProps<FaqContent>) {
  if (content.variant === 'city') {
    if (!content.items.length) return null
    return (
      <section className={secClass(colour)} aria-labelledby={blockId}>
        <div className="wrap">
          <h2 className="h2 reveal" id={blockId}>
            <Em text={content.heading} />
          </h2>
          <div className="faq mt-40">
            {content.items.map((faq) => (
              <details key={faq.question}>
                <summary>
                  {faq.question}
                  <span className="pl" aria-hidden="true">
                    <Plus />
                  </span>
                </summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    )
  }
  return (
    <section className={secClass(colour)} style={{ paddingTop: 0 }}>
      <div className="wrap split" style={{ alignItems: 'start' }}>
        <div className="reveal">
          <h2 className="h2">
            <Em text={content.heading} />
          </h2>
          {content.action ? (
            <div className="row" style={{ marginTop: 28 }}>
              <Link className="btn soft" href={content.action.to}>
                {content.action.label} <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          ) : null}
        </div>
        <div className="faq reveal">
          {content.items.map(({ question, answer }, i) => (
            <details key={question} open={i === 0} data-icp-faq={i}>
              <summary>
                {question}
                <span className="pl" aria-hidden="true">
                  <Plus />
                </span>
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
