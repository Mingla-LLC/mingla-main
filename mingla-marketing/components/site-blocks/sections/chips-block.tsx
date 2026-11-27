// #4636 block `chips` — "Built for <kind> of every size." beside the chips of
// who it is for (host-type pages), moved as-is (R1) from icp-landing.tsx.
import { Em, secClass, type BlockProps } from './shared'

export interface ChipsContent {
  heading: string
  items: readonly string[]
}

export function ChipsBlock({ content, colour }: BlockProps<ChipsContent>) {
  return (
    <section className={secClass(colour)}>
      <div className="wrap">
        <div className="split reveal">
          <div>
            <h2 className="h2">
              <Em text={content.heading} />
            </h2>
          </div>
          <ul className="chips">
            {content.items.map((w) => (
              <li className="chip" key={w}>
                {w}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
