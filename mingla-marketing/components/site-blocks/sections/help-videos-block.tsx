// #4636 live block `helpVideos` — the help centre's search, intent chips and
// video cards (the registry in content/help/registry.ts stays the source, R7).
// Moved as-is (R1) from app/help/page.tsx. The cards render on the server; the
// browser island only filters them (no registry in the payload, #4339 speed).
import { LazyHelpBrowser as HelpBrowser } from '../lazy-islands'  // #4636: own chunk (first-load budget)
import { HelpChapters } from '@/components/help/help-video-grid'
import { HELP_INTENTS, HELP_VIDEOS } from '@/content/help/registry'

export type HelpVideosContent = Record<string, never>

export function HelpVideosBlock() {
  return (
    <section className="pb-100" aria-label="Help centre">
      <div className="wrap">
        <HelpBrowser intents={HELP_INTENTS}>
          <HelpChapters videos={HELP_VIDEOS} />
        </HelpBrowser>
      </div>
    </section>
  )
}
