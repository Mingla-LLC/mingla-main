import { DeviceCta } from '@/components/cutout/device-cta'
import type { BlogPlaceFacts } from '@/lib/blog/data'
import { PlacePhoto } from './place-card'

// #4137 — "The whole plan": 2–6 stops as stored-thumbnail tiles plus a
// numbered list. Missing or closed stops are skipped; under two, no card.
// "Save it to Mingla" opens or installs the app (Seth OQ-2: no plan import).
export function PlanCard({ title, stops }: { readonly title: string; readonly stops: readonly (BlogPlaceFacts | undefined)[] }) {
  const live = stops.filter((stop): stop is BlogPlaceFacts => Boolean(stop && stop.open))
  if (live.length < 2) return null
  return (
    <div className="blog-plan" data-blog-block="plan">
      <div className="blog-plan-head">
        <div>
          <div className="blog-eyebrow">The whole plan</div>
          <h3>{title} · {live.length} stops</h3>
        </div>
        <DeviceCta surface="explorer" location="blog_plan_card" label="Save it to Mingla" variant="primary" size="md" />
      </div>
      <div className="blog-plan-tiles" style={{ gridTemplateColumns: `repeat(${Math.min(live.length, 3)}, minmax(0, 1fr))` }}>
        {live.map((stop, index) => <PlacePhoto key={`${stop.name}-${index}`} place={stop} />)}
      </div>
      <ol className="blog-plan-stops">
        {live.map((stop, index) => <li key={`${stop.name}-${index}`}>{stop.name}</li>)}
      </ol>
    </div>
  )
}
