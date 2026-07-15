// ---------------------------------------------------------------
// ORCH-1382 [links-src-tracking-getapp-stack] — HAPPY-PATH regression test (T-6).
//
// Pins the EXPLORER decision helper: ios/android resolve to the Explorer OneLink
// (attributed), desktop resolves to NOTHING so the caller can route to the /download
// QR page — never a dead or hidden install button.
//
// Like T-1, this IMPORTS THE REAL helper rather than grepping source: a source grep
// passes when a token merely exists in a comment or a dead branch.
//
// Run from mingla-marketing/:
//   npx tsc lib/__tests__/explorer-app-target.test.ts --outDir /tmp/o \
//     --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/__tests__/explorer-app-target.test.js
// ---------------------------------------------------------------

import { resolveExplorerAppTarget } from '../explorer-app-target'
import { linksAttribution } from '../links-src'
import { BUSINESS_ONELINK_URL, EXPLORER_ONELINK_URL } from '../store-links'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const ATTR = linksAttribution('youtube', 'explorer_bio')

const cases: ReadonlyArray<[string, () => void]> = [
  // ── T-6 phones resolve to the ATTRIBUTED Explorer OneLink ───────────────────
  [
    'T-6: ios and android resolve to the Explorer OneLink, carrying attribution',
    () => {
      for (const platform of ['ios', 'android'] as const) {
        const t = resolveExplorerAppTarget(platform, ATTR)
        assert(t.canInstall === true, `${platform} canInstall is not true`)
        assert(t.installHref !== null, `${platform} installHref is null — the install action is missing`)
        assert(
          (t.installHref as string).startsWith(`${EXPLORER_ONELINK_URL}?`),
          `${platform} installHref does not start at the Explorer OneLink: ${t.installHref}`,
        )
        // Attribution must actually be attached — a bare OneLink attributes to the
        // template default and is indistinguishable from organic.
        assert(
          (t.installHref as string).includes('pid=bio_youtube'),
          `${platform} installHref lost its pid: ${t.installHref}`,
        )
        assert(
          (t.installHref as string).includes('c=explorer_bio'),
          `${platform} installHref lost its campaign: ${t.installHref}`,
        )
      }
    },
  ],
  // ── T-6 the analytics label stays platform-derived ──────────────────────────
  [
    'T-6: installStore stays platform-derived (the label, not the destination)',
    () => {
      assert(
        resolveExplorerAppTarget('ios', ATTR).installStore === 'app_store',
        `ios installStore = ${resolveExplorerAppTarget('ios', ATTR).installStore}`,
      )
      assert(
        resolveExplorerAppTarget('android', ATTR).installStore === 'play',
        `android installStore = ${resolveExplorerAppTarget('android', ATTR).installStore}`,
      )
      // The hrefs are shared, but the LABELS must still differ — otherwise the
      // `platform ===` branching on every surface has quietly become decorative.
      assert(
        resolveExplorerAppTarget('ios', ATTR).installStore !==
          resolveExplorerAppTarget('android', ATTR).installStore,
        'ios and android report the SAME installStore — the analytics label stopped being device-derived, so "which store did this install come from" is now unanswerable',
      )
    },
  ],
  // ── T-6 ⭐ desktop must NOT grow a dead install button ───────────────────────
  [
    "T-6: 'other' (desktop/unknown/bot) has NO install action — the caller routes to /download",
    () => {
      const t = resolveExplorerAppTarget('other', ATTR)
      assert(t.installHref === null, `desktop installHref is "${t.installHref}", expected null (no dead install button)`)
      assert(t.installStore === null, `desktop installStore is "${t.installStore}", expected null`)
      assert(t.canInstall === false, 'desktop canInstall is not false — desktop has nothing to install')
    },
  ],
  // ── T-6 NEVER CROSSED (H-2) — the highest-damage bug available here ─────────
  [
    'T-6: the explorer target can NEVER resolve to the BUSINESS OneLink',
    () => {
      for (const platform of ['ios', 'android', 'other'] as const) {
        const href = resolveExplorerAppTarget(platform, ATTR).installHref ?? ''
        assert(
          !href.includes('biz.usemingla.com'),
          `${platform}: the EXPLORER target resolves to the BUSINESS branded domain — consumers would install the business app: ${href}`,
        )
        assert(
          !href.startsWith(BUSINESS_ONELINK_URL),
          `${platform}: the EXPLORER target IS the business OneLink: ${href}`,
        )
        assert(
          !/onelink\.me/.test(href),
          `${platform}: the explorer target uses a RAW *.onelink.me domain — branded domains only (ORCH-1346): ${href}`,
        )
      }
    },
  ],
  // ── T-6 purity — one module instance serves many concurrent requests ────────
  [
    'T-6: the decision is pure — call order cannot poison a later answer',
    () => {
      const first = resolveExplorerAppTarget('android', ATTR)
      resolveExplorerAppTarget('ios', ATTR)
      resolveExplorerAppTarget('other', ATTR)
      const again = resolveExplorerAppTarget('android', ATTR)
      assert(
        first.installHref === again.installHref && first.installStore === again.installStore,
        `IMPURE — android resolved differently after interleaved calls: ${JSON.stringify(first)} vs ${JSON.stringify(again)}`,
      )
      // Different attribution must produce a different href — otherwise the pid is
      // being ignored and every install is anonymous again.
      const other = resolveExplorerAppTarget('android', linksAttribution('linkedin', 'explorer_bio'))
      assert(
        other.installHref !== first.installHref,
        'a DIFFERENT src produced the SAME href — the attribution argument is being ignored, so every install is anonymous',
      )
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1382 explorer app target (happy-path)', () => {
    for (const [name, fn] of cases) it(name, fn)
  })
} else {
  let failures = 0
  for (const [name, fn] of cases) {
    try {
      fn()
      // eslint-disable-next-line no-console
      console.log(`PASS  ${name}`)
    } catch (err) {
      failures += 1
      // eslint-disable-next-line no-console
      console.error(`FAIL  ${name}: ${(err as Error).message}`)
    }
  }
  if (failures > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failures} test(s) failed`)
    process.exit(1)
  }
  // eslint-disable-next-line no-console
  console.log(`\nAll ${cases.length} explorer-app-target tests passed`)
}
