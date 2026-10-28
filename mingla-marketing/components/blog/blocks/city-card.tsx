import Link from 'next/link'
import { cityHubEffectiveLifecycle, cityHubForSlug, cityHubPath } from '@/content/cities/registry'

// #4137 — a link to a live usemingla.com city page. Unknown or not-yet-live
// cities render nothing. No photo: Google place photos are not used here.
export function CityCard({ citySlug }: { readonly citySlug: string }) {
  const record = cityHubForSlug(citySlug)
  if (!record || cityHubEffectiveLifecycle(record) !== 'search_ready') return null
  return (
    <Link href={cityHubPath(record)} className="blog-embed blog-embed-text blog-embed-card focus-ring" data-blog-block="city">
      <div className="blog-city">
        <div>
          <div className="blog-eyebrow">City page</div>
          <h3>Things to do in {record.city}</h3>
        </div>
        <span className="cut-btn cut-btn-light h-[2.625rem] px-5 text-[0.9375rem]">See what’s on in {record.city}</span>
      </div>
    </Link>
  )
}
