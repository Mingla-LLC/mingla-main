// #1086 [Standalone scheduler] — the /schedule shell.
//
// #4339 phase 3 — /schedule is redesigned: the page brings the site nav, its
// <main id="main"> and the canonical footer (components/site/site-page.tsx),
// so this layout adds no frame of its own. It stays as its own segment so the
// scheduler keeps the clean top-level /schedule URL any lead can share.
export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return children
}
