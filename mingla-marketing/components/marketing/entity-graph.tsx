import { minglaEntityGraphJson } from '@/lib/search/entity-graph'

export function MinglaEntityGraph() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: minglaEntityGraphJson() }}
    />
  )
}
