// #4339 — the one line under a blog button that says where it goes.
//
// Seth's report on the 1.2 launch posts (10 Nov 2026): the button at the end of
// each post gave the reader no idea what tapping it would do. A label alone
// ("Download Mingla Host") does not say that a phone lands in a store and a
// computer lands somewhere else, so every button now carries a short helper line.
//
// Pure (no React, no Next) so the regression test can import it directly.

type ButtonTarget =
  | { readonly kind: 'url'; readonly href: string; readonly newTab?: boolean }
  | { readonly kind: 'page'; readonly path: string }

const HOST_APP_PATHS = ['/host/get', '/host/download']
const EXPLORER_APP_PATHS = ['/download']

function pathOnly(path: string): string {
  const cut = path.search(/[?#]/)
  const bare = cut === -1 ? path : path.slice(0, cut)
  return bare.length > 1 ? bare.replace(/\/+$/, '') : bare
}

/** The helper line for a blog button, or null when the label already says it all. */
export function blogButtonHelper(target: ButtonTarget): string | null {
  if (target.kind === 'page') {
    const path = pathOnly(target.path)
    if (HOST_APP_PATHS.includes(path)) {
      return 'On a phone this opens the App Store or Google Play. On a computer it opens Mingla Host on the web.'
    }
    if (EXPLORER_APP_PATHS.includes(path)) {
      return 'On a phone this opens the App Store or Google Play. On a computer you get a code to scan with your phone.'
    }
    return null
  }
  let host: string
  try {
    host = new URL(target.href).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
  return target.newTab ? `Opens ${host} in a new tab.` : `Opens ${host}.`
}
