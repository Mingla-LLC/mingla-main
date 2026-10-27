// #4137 wave 2 — the ONE seam between the side menu and the blog.
//
// The menu shows a Blog row and a "Latest story" card only when this value says
// the blog has at least one published post. Until then both stay hidden, so the
// menu never links to an empty page (Constitution #9: missing is hidden, never
// faked).
//
// #4137 wave 3 — the value is now produced at BUILD time from the public blog
// index by scripts/generate-blog-menu-entry.mjs, which writes
// menu-entry.generated.json (committed as the hidden value). Every marketing
// route stays static and no client component fetches per request (wave 2
// contract). No database at build (CI), or any read error: hidden.
//
// Plain TypeScript with no server-only import: AudienceMenuContent is a client
// component and bundles this constant.
//
// {"invariant":"I-4137-MENU-BLOG-GATED","enforced_by":["scripts/issue-4137-menu-blog-seam.implementor.happy.test.mjs"]}

import generated from './menu-entry.generated.json'
import { parseBlogMenuEntry } from './menu-entry-derive'

export interface MenuLatestStory {
  readonly href: `/blog/${string}`
  readonly title: string
  readonly coverSrc: string
  readonly coverWidth: number
  readonly coverHeight: number
}

export interface BlogMenuEntry {
  readonly blogVisible: boolean
  readonly showNewBadge: boolean
  readonly latest: MenuLatestStory | null
}

export const BLOG_MENU_ENTRY: BlogMenuEntry = parseBlogMenuEntry(generated)
