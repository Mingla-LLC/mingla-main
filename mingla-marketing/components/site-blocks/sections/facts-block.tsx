// #4636 block `facts` — Locals' two programme fact cards, moved as-is (R1).
// Renders inside the programme frame (pb-100 > wrap).
import type { BlockProps } from './shared'

export interface FactsContent {
  items: readonly { title: string; body: string }[]
}

export function FactsBlock({ content }: BlockProps<FactsContent>) {
  return (
    <div className="grid2 mt-24">
      {content.items.map((fact) => (
        <div className="card pad fact-card reveal" key={fact.title}>
          <h3 className="h3">{fact.title}</h3>
          <p>{fact.body}</p>
        </div>
      ))}
    </div>
  )
}
