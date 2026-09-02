/**
 * apex-route-resolver — "does `usemingla.com{pathname}` reach anything?",
 * answered from the routing layers as they exist on disk.
 *
 * ─── PROVENANCE ─────────────────────────────────────────────────────────────
 *
 * This is issue #2240's resolver, EXTRACTED VERBATIM in behaviour from
 * `supabase/functions/_shared/email/__tests__/issue_2240_email_app_link.test.ts`
 * so that #2240 and #2272 share ONE model instead of two that can disagree.
 * #2240 built it because a test had pinned a URL's PRESENCE and called that
 * verification: a test can pin a URL exactly and still never ask whether it
 * resolves. #2272 needed the same question asked of four more path families,
 * and copying the resolver would have re-created exactly the drift it exists to
 * prevent.
 *
 * ─── THE ONE RULE ───────────────────────────────────────────────────────────
 *
 * Every layer this cannot model is a LOUD FAILURE, never a silent "resolved".
 * An under-modelling resolver is precisely the unfalsifiable check both issues
 * exist to avoid, so `assertVercelRewritesDoNotTouchApex` throws rather than
 * guesses, and both regex/block parsers throw when their source stops matching.
 *
 * ─── RUNTIME ────────────────────────────────────────────────────────────────
 *
 * Plain ESM over `node:fs` / `node:path` only, so the SAME file runs under
 * `node --test` (#2272's suites) and under `deno test --allow-read` (#2240's
 * suite). Do not add a dependency, and do not reach for a runtime global.
 *
 * NOT A PRODUCTION MODULE. Nothing in `mingla-marketing/` may import this; it
 * models the app, it is not part of it.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** The hosts this resolver is able to reason about. */
export const APEX_HOSTS = new Set(['usemingla.com', 'www.usemingla.com'])

/** Walk `mingla-marketing/app/**` into App-Router path patterns. */
function buildFilesystemRoutes(repoRoot) {
  const appDir = join(repoRoot, 'mingla-marketing', 'app')
  const patterns = []
  const sourceFiles = []

  const walk = (dirAbs, segments) => {
    for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
      const abs = join(dirAbs, entry.name)
      if (entry.isDirectory()) {
        // Route groups `(marketing)` contribute NO path segment; parallel
        // routes `@slot` and private folders `_x` are not routable segments.
        if (entry.name.startsWith('(') && entry.name.endsWith(')')) {
          walk(abs, segments)
        } else if (entry.name.startsWith('@') || entry.name.startsWith('_')) {
          continue
        } else {
          walk(abs, [...segments, entry.name])
        }
        continue
      }
      if (entry.name === 'page.tsx' || entry.name === 'page.ts' || entry.name === 'route.ts') {
        patterns.push(segments)
        sourceFiles.push(relative(repoRoot, abs))
      }
    }
  }
  walk(appDir, [])
  return { patterns, sourceFiles }
}

/** Does one App-Router pattern match a concrete pathname's segments? */
export function patternMatches(pattern, segments) {
  // Catch-all `[...x]` swallows one-or-more; optional `[[...x]]` zero-or-more.
  const last = pattern.at(-1)
  if (last !== undefined && last.startsWith('[[...') && last.endsWith(']]')) {
    return (
      segments.length >= pattern.length - 1 &&
      pattern.slice(0, -1).every((p, i) => segmentMatches(p, segments[i]))
    )
  }
  if (last !== undefined && last.startsWith('[...') && last.endsWith(']')) {
    return (
      segments.length >= pattern.length &&
      pattern.slice(0, -1).every((p, i) => segmentMatches(p, segments[i]))
    )
  }
  if (pattern.length !== segments.length) return false
  return pattern.every((p, i) => segmentMatches(p, segments[i]))
}

function segmentMatches(pattern, segment) {
  if (segment === undefined) return false
  if (pattern.startsWith('[') && pattern.endsWith(']')) return segment.length > 0
  return pattern === segment
}

/**
 * Lifecycle-registry redirect sources — a redirect IS a resolution.
 *
 * Issue #2981 moved redirect truth beside indexing lifecycle truth. Keep the
 * fail-loud model coupled to that single owner, while also proving Next still
 * consumes the projection rather than leaving registered redirects dark.
 */
function buildRedirectSources(repoRoot) {
  const nextConfig = readFileSync(join(repoRoot, 'mingla-marketing', 'next.config.ts'), 'utf8')
  if (!nextConfig.includes('nextRedirectsFromRegistry()')) {
    throw new Error(
      'next.config.ts no longer consumes nextRedirectsFromRegistry() — registered redirects would not be live',
    )
  }
  const registry = readFileSync(
    join(repoRoot, 'mingla-marketing', 'lib', 'search', 'route-registry.ts'),
    'utf8',
  )
  const block = /const REDIRECTED_ROUTES = \[([\s\S]*?)\] as const satisfies readonly RedirectedRouteContract\[\]/.exec(registry)
  if (block === null) {
    throw new Error(
      'could not locate REDIRECTED_ROUTES in the search lifecycle registry — the resolver is out of sync with the app and must not guess',
    )
  }
  const sources = [...block[1].matchAll(/source:\s*'([^']+)'/g)].map((m) => m[1])
  if (sources.length === 0) {
    throw new Error('the search lifecycle registry yielded zero redirect sources')
  }
  return sources
}

/**
 * `middleware.ts` decisions that apply on the APEX host. Parsed from source so
 * a change to the middleware cannot leave this resolver quietly stale.
 */
function buildMiddlewareApexRules(repoRoot) {
  const src = readFileSync(join(repoRoot, 'mingla-marketing', 'middleware.ts'), 'utf8')
  const shareLine = /const PUBLIC_SHARE_PATH = (\/\^.*\$\/)\n/.exec(src)
  if (shareLine === null) {
    throw new Error(
      'could not parse PUBLIC_SHARE_PATH out of middleware.ts — the resolver must not guess which paths the apex serves',
    )
  }
  const body = shareLine[1].slice(1, -1)
  const prefix = /const CAREERS_PREFIX = '([^']+)'/.exec(src)
  if (prefix === null) {
    throw new Error('could not parse CAREERS_PREFIX out of middleware.ts')
  }
  return { shareRe: new RegExp(body), careersPrefix: prefix[1] }
}

/**
 * FAIL-LOUD GUARD. `vercel.json` rewrites run BEFORE the Next app. Each one is
 * host-gated to a host that is not the apex; if that ever stops being true this
 * resolver can no longer reason about the apex, and it must say so rather than
 * return a confident answer built on a layer it did not read.
 *
 * Returns the number of rewrites inspected, so a caller can assert the file was
 * really read and this guard is not vacuously passing over an empty list.
 */
export function assertVercelRewritesDoNotTouchApex(repoRoot) {
  const cfg = JSON.parse(
    readFileSync(join(repoRoot, 'mingla-marketing', 'vercel.json'), 'utf8'),
  )
  const rewrites = cfg.rewrites ?? []
  for (const r of rewrites) {
    const hostGate = (r.has ?? []).find((h) => h.type === 'host')
    if (hostGate === undefined) {
      throw new Error(
        `vercel.json rewrite "${r.source}" has no host condition, so it applies on the apex. This resolver cannot model it — model it here rather than letting the resolver silently under-report.`,
      )
    }
    if (APEX_HOSTS.has(String(hostGate.value).toLowerCase())) {
      throw new Error(
        `vercel.json rewrite "${r.source}" is gated to the APEX host "${hostGate.value}". Model it in this resolver before shipping.`,
      )
    }
  }
  return rewrites.length
}

/**
 * Build a resolver bound to one checkout.
 *
 * @param {string} repoRoot absolute path to the repository root
 * @returns {{
 *   resolve: (pathname: string) => { resolved: boolean, via: string },
 *   routes: { patterns: string[][], sourceFiles: string[] },
 *   redirectSources: string[],
 *   middleware: { shareRe: RegExp, careersPrefix: string },
 *   vercelRewriteCount: number,
 * }}
 */
export function buildApexRouteResolver(repoRoot) {
  const routes = buildFilesystemRoutes(repoRoot)
  const redirectSources = buildRedirectSources(repoRoot)
  const middleware = buildMiddlewareApexRules(repoRoot)
  // Runs as part of construction, so every caller inherits the guard.
  const vercelRewriteCount = assertVercelRewritesDoNotTouchApex(repoRoot)

  /** Resolve a pathname as the apex host serves it. */
  const resolve = (pathname) => {
    const segments = pathname.split('/').filter((s) => s.length > 0)

    for (const source of redirectSources) {
      const pat = source
        .split('/')
        .filter((s) => s.length > 0)
        .map((s) => (s.startsWith(':') ? '[x]' : s))
      if (patternMatches(pat, segments)) {
        return { resolved: true, via: `next.config redirect ${source}` }
      }
    }

    // The apex guard 404s the careers segment — it is NOT served here.
    if (
      pathname === middleware.careersPrefix ||
      pathname.startsWith(`${middleware.careersPrefix}/`)
    ) {
      return { resolved: false, via: 'middleware apex guard → careers-not-found (404)' }
    }

    if (middleware.shareRe.test(pathname)) {
      return { resolved: true, via: 'middleware public-share rewrite' }
    }

    for (let i = 0; i < routes.patterns.length; i++) {
      if (patternMatches(routes.patterns[i], segments)) {
        return { resolved: true, via: routes.sourceFiles[i] }
      }
    }
    return { resolved: false, via: 'no route, no redirect, no rewrite — HTTP 404' }
  }

  return { resolve, routes, redirectSources, middleware, vercelRewriteCount }
}
