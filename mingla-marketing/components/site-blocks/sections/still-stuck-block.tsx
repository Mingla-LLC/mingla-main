// #4636 block `stillStuck` — Help's "Still stuck?" card with the support email
// and Book a call (→ /schedule), moved as-is (R1) from app/help/page.tsx.
import { ActionButton, Em, type BlockAction, type BlockProps } from './shared'

export interface StillStuckContent {
  heading: string
  lead: string
  primary: BlockAction
  secondary: BlockAction
}

export function StillStuckBlock({ content, blockId }: BlockProps<StillStuckContent>) {
  return (
    <section className="pb-100" aria-labelledby={blockId}>
      <div className="wrap">
        <div className="card pad stuck reveal">
          <div>
            <h2 className="h2" id={blockId}>
              <Em text={content.heading} />
            </h2>
            <p className="lead">{content.lead}</p>
          </div>
          <div className="row">
            <ActionButton action={content.primary} className="btn ink" location="help" icon={content.primary.to.startsWith('mailto:') ? 'mail' : undefined} />
            <ActionButton action={content.secondary} className="btn soft" location="help" />
          </div>
        </div>
      </div>
    </section>
  )
}
