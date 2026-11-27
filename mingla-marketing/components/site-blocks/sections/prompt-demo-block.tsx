// #4636 block `promptDemo` — "Prompt your website into existence" with the
// visual demo (For hosts), moved as-is (R1). The section keeps id="site" (the
// in-page anchor) and the `data-focus-gen` button the demo listens for.
import { ArrowRight } from 'lucide-react'
import { LazySitePromptDemo as SitePromptDemo } from '../lazy-islands'  // #4636: own chunk (first-load budget)
import { Em, secClass, type BlockProps } from './shared'

export interface PromptDemoContent {
  heading: string
  lead: string
  button: string
}

export function PromptDemoBlock({ content, colour, blockId }: BlockProps<PromptDemoContent>) {
  return (
    <section className={secClass(colour, 'cream')} id="site" aria-labelledby={blockId}>
      <div className="wrap split split-center">
        <div className="reveal">
          <h2 className="h2" id={blockId}>
            <Em text={content.heading} />
          </h2>
          <p className="lead">{content.lead}</p>
          <div className="row" style={{ marginTop: 28 }}>
            <button className="btn ink" type="button" data-focus-gen="">
              {content.button} <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </div>
        <SitePromptDemo />
      </div>
    </section>
  )
}
