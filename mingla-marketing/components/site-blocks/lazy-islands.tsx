'use client'

// #4636 build 2 — the interactive islands of the blocks no converted page
// shows (the booking calendar, the city weekend and top-places carousels, the
// city action links, the help browser) load as their own chunks. Every
// converted page can render ANY block once staff publish a block list, so the
// block renderer is in its module graph; without this split each converted
// page would carry these islands in its first-load JavaScript and break the
// #4339 budget. Server-rendered HTML is unchanged (next/dynamic renders on the
// server too); only the script arrives after first load, as #4452's lazy.tsx.
import dynamic from 'next/dynamic'

export const LazyScheduleClient = dynamic(() => import('@/app/schedule/ScheduleClient').then((m) => m.ScheduleClient))
export const LazyCityThisWeekend = dynamic(() => import('@/components/cities/city-this-weekend').then((m) => m.CityThisWeekend))
export const LazyCityWeekend = dynamic(() => import('@/components/cities/city-weekend').then((m) => m.CityWeekend))
export const LazyCityTrackedLink = dynamic(() => import('@/components/cities/city-actions').then((m) => m.CityTrackedLink))
export const LazyHelpBrowser = dynamic(() => import('@/components/help/help-browser').then((m) => m.HelpBrowser))
// The islands of blocks only some converted pages show (the reel carousel and
// rotating phrase, the website prompt demo, the filter grid, the app toggle,
// the blog "load more"), for the same reason.
export const LazyReelStage = dynamic(() => import('@/components/site/reel-stage').then((m) => m.ReelStage))
export const LazyRotatingPhrase = dynamic(() => import('@/components/site/rotating-phrase').then((m) => m.RotatingPhrase))
export const LazySitePromptDemo = dynamic(() => import('@/components/site/site-prompt-demo').then((m) => m.SitePromptDemo))
export const LazyFilterGrid = dynamic(() => import('@/components/site/filter-row').then((m) => m.FilterGrid))
export const LazyDownloadToggle = dynamic(() => import('@/components/site/download-toggle').then((m) => m.DownloadToggle))
export const LazyBlogLoadMore = dynamic(() => import('@/components/blog/blog-load-more').then((m) => m.BlogLoadMore))
