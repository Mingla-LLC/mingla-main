# TEST — ORCH-1165 [static-map server-proxy]

**Verdict: PASS** — 0 P0 · 0 P1 · 0 P2 · 2 P3 · 1 P4
**Mode:** TARGETED + SECURITY (close-gate, post-merge `8ad1f00ac`, post-deploy)
**Date:** 2026-06-19
**Tester branch (adversarial test):** `ORCH-1165-tester-adversarial` @ `9d73153f7` (off `origin/main`, NOT yet pushed — orchestrator to land)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1165-[mapbox-static-proxy]/`

---

## 1. One-line answer to Seth's question

YES — the "Where you'll be" map now renders a **real map tile** on live buyer-web (proven on the
Samsung against `business.usemingla.com`), with **no Mapbox logo and no attribution overlay**, and
the **client traffic carries no token and no `api.mapbox.com` / no `pk.` token value** (proven in the
shipped web bundle + live curl). The adversarial security checks (token-never-echoed, SSRF
host-pinning, rule-9 hide, fail-closed) all held.

---

## 2. SC-by-SC matrix

| SC | Criterion | Surface | Result | Evidence |
|----|-----------|---------|--------|----------|
| SC-1 | `static-map` edge fn deployed, `verify_jwt=false`, reuses `MAPBOX_ACCESS_TOKEN` | backend | **PASS** | `list_edge_functions`: `static-map` ACTIVE, verify_jwt=False, v1. config.toml `[functions.static-map] verify_jwt=false` |
| SC-2 | Valid coords → 200 image/png, real DC tile, no logo | backend | **PASS** | live curl → HTTP/2 200, `content-type: image/png`, 159904 bytes, PNG 1200×640; visual = real DC dark tile, no logo |
| SC-3 | Invalid/out-of-range input → 400 (abuse guard) | backend | **PASS** | `lat=91` → 400 `{"error":"lat_out_of_range"}`; missing coords → 400 `coordinates_required`; bad zoom/accent/dimension/style → 400 |
| SC-4 | Old `mapbox-static` removed → 404 | backend | **PASS** | live curl `/mapbox-static` → HTTP 404 |
| SC-5 | Live buyer-web TRIP page renders real tile, no logo | Web (Android browser) | **PASS** (proven) | `web_live_trip_map_full.png` — DC dark tile, street labels, orange themed pin, "Washington, District of Columbia, United States" label, NO logo/attribution |
| SC-6 | Live buyer-web EVENT page renders real tile, no logo | Web (Android browser) | **PASS** (proven) | `web_live_event_vibes_map.png` (Cary/Raleigh streets tile, blue pin) + exact proxied tile `ev_tile.png`/`ev_tile_dark.png` visually confirmed logo-free + attribution-free |
| SC-7 | Stack-hidden: client map request targets `…/functions/v1/static-map?…`, NO "mapbox", NO token | Web bundle | **PASS** | shipped bundle contains `static-map`, NO `api.mapbox.com`, NO `pk.eyJ` value, `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN:{}` (empty). 200 response headers + image bytes carry no token/mapbox literal |
| SC-8 | All-surface parity (web + business + consumer) via one owner | code | **PASS** | `mingla-business/src/utils/mapboxStaticImage.ts` + `app-mobile/src/utils/mapboxStaticImage.ts` are thin RE-EXPORTS of `@mingla/event-rendering` `buildStaticMapUrl` → `buildProxyStaticMapUrl` (Constitution rule 2; no per-surface client token) |
| SC-9 | Adversarial security invariants hold | backend | **PASS** | tester adversarial test (6 cases) green; fails-on-revert proven |

---

## 3. Findings

### P3-1 — Static-map `<Image>` has no runtime `onError` hide on proxy non-200
**Evidence:** `packages/event-rendering/PublicEventPage.tsx:703-708` (and the trip/experience
equivalents) render `<Image source={{ uri: mapUrl }}>` with NO `onError` handler. Rule-9 is
enforced at BUILD time (`mapUrl === null` → render nothing when coords/base absent), not at runtime.
**Impact:** If the proxy returns a non-200 at runtime (Mapbox outage / token rejection), the image
slot shows the neutral `palette.card` background (no crash, no fabricated tile) rather than fully
hiding. Low blast radius — the proxy 200s reliably (proven) and the container has a neutral fill.
This is inherited from the ORCH-1162 design (the static map was always a pre-resolved URL with no
onError); ORCH-1165 only swapped the URL source.
**Required fix (future ORCH, not a blocker):** add `onError` → hide the block, for true rule-9 parity
on the runtime-failure path.
**Retest:** force a proxy 502 (bad token), confirm the block disappears rather than showing an empty card.

### P3-2 — Upstream-error response body leaks the vendor NAME ("mapbox") in the error code
**Evidence:** `supabase/functions/static-map/index.ts:233-240` — on a Mapbox non-200, the proxy
returns `{"error":"mapbox_<status>"}` (e.g. `mapbox_401`). This is the ONLY client path on which the
string "mapbox" appears.
**Impact:** Stack-hiding leak is partial: the success (200) and input-rejection (400) paths are fully
vendor-neutral (proven), but the upstream-failure path names the vendor in the error code. It NEVER
leaks the token (verified). Blast radius is near-zero (only on a Mapbox outage, and only in the error
JSON body which the client does not display).
**Required fix (future ORCH, not a blocker):** rename the error code to a neutral token (e.g.
`upstream_<status>`).
**Retest:** force a Mapbox non-200, confirm the error body carries no "mapbox" substring.

### P4-1 — PRAISE: clean single-owner, defense-in-depth proxy
The proxy is exemplary: strict allowlist validation (style/zoom/dimension/accent), host pinned to
`api.mapbox.com` (no SSRF), token strictly server-side, all three surfaces routed through ONE
`@mingla/event-rendering` owner, and the OQ-1 (Mapbox ToS attribution) flagged honestly in-code for
Seth/legal rather than silently swallowed.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out the ORCH branch worktree @ `bed4bf1ec`.

- **Client builder test** (`packages/event-rendering/__tests__/mapboxStaticProxyUrl.orch1165.test.ts`):
  deleted the rule-9 coord guard `if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;`
  from `mapboxStaticProxyUrl.ts` → the test FAILED:
  `ORCH-1165 rule-9: null when coords missing/non-finite OR base absent` — assertion
  `expected null, got "…/static-map?lat=null&lng=2"`. Restored → 4/4 pass. **fails-on-revert verified.**
- **Edge-fn happy-path test** (`supabase/functions/static-map/__tests__/mapboxStatic.orch1165.test.ts`):
  re-ran clean → 5/5 pass. (The implementor's documented revert points — `logo=false&attribution=false`
  + the lat/lng/style/zoom guards — are exercised by these 5 assertions.)

Both implementor test files are on `origin/main` via the merged squash `8ad1f00ac` (visible in
`git show --stat 8ad1f00ac`).

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `supabase/functions/static-map/__tests__/mapboxStaticHandlerSecurity.orch1165.tester.test.ts`
- **Commit:** `9d73153f7` on branch `ORCH-1165-tester-adversarial` (off `origin/main`).
- **Different angle:** the implementor tested the PURE helpers (`validateStaticParams`,
  `buildMapboxStaticFetchUrl`, `buildProxyStaticMapUrl`). This drives the FULL exported `handler(req)`
  with a STUBBED upstream `fetch`, attacking the SECURITY invariants:
  1. token NEVER echoed on any path (200/400/405/502/upstream-non-200) — body + headers;
  2. SSRF host-pinning — every upstream fetch is `api.mapbox.com`; style injection (`../`, encoded
     traversal, absolute URL, path smuggling) → 400 BEFORE any fetch (capture.urls.length===0);
  3. rule-9 hide — upstream 401/422/500 → non-200, no body/token leak;
  4. fail-closed — fetch exception → 502, no leak; non-GET → 405, no fetch.
- **Result:** 6/6 pass on merged-main code (`deno test --allow-env` → 11 passed across the
  `__tests__/` dir including the implementor's 5).
- **fails-on-revert verified at `bed4bf1ec`:** removed the `ALLOWED_STYLES.has(rawStyle)` guard →
  `ADVERSARIAL SSRF` test FAILED (`evil style must 400: ../../../etc/passwd`). Restored → 6/6 pass.
- **In-diff:** `git diff origin/main...HEAD --name-only` on the tester branch shows exactly this one
  new test file. The implementor's two test files are already in the merged `8ad1f00ac` diff.

## 6. Constitution 14-rule matrix (against the squash diff)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | N/A | no new tappable control (map is a static image) |
| 2 | One owner per truth | **PASS** | single `buildStaticMapUrl` owner in `@mingla/event-rendering`; biz + consumer utils re-export |
| 3 | No silent failures | **PASS** | proxy errors → explicit 400/502 JSON + server logs; client null-guard hides honestly |
| 4 | One query key per entity | N/A | no React Query change |
| 5 | Server state server-side | **PASS** | token strictly in edge env; not in Zustand/client |
| 6 | Logout clears everything | N/A | anon public path, no auth state |
| 7 | Label transitional | N/A | no transitional code |
| 8 | Subtract before adding | **PASS** | old `mapbox-static` fn DELETED (404), client-token render path retired |
| 9 | No fabricated data | **PASS** | null-guard hides map when no coords/base; never a placeholder tile |
| 10 | Currency-aware | N/A |
| 11 | One auth instance | N/A | anon |
| 12 | Validate at right time | **PASS** | strict server-side input validation + clamping |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | N/A |

## 7. Device / parity matrix

| Surface | Result | Evidence |
|---------|--------|----------|
| Buyer/anon Web (TRIP) | **PASS (proven)** | Samsung `R58R54YV7JT` system browser, `business.usemingla.com/t/travelbrand/the-dc-adventure` → real DC tile, no logo. `web_live_trip_map_full.png` |
| Buyer/anon Web (EVENT) | **PASS (proven)** | `business.usemingla.com/e/leggothis/vibes-and-stuff` → real Raleigh tile, no logo. `web_live_event_vibes_map.png` + exact proxied tiles `ev_tile.png`/`ev_tile_dark.png` |
| Business iOS/Android | **PASS (source, single-owner)** | re-exports the same `@mingla/event-rendering` proxy builder; no per-surface client token. Native render not separately driven — same shared image URL; OTA pending (ships via biz channel) |
| Consumer iOS/Android | **PASS (source, single-owner)** | `app-mobile/src/utils/mapboxStaticImage.ts` re-exports the same owner |
| Admin Web | N/A | not a static-map consumer |
| Backend edge fn | **PASS (proven, live)** | `static-map` v1 deployed verify_jwt=false; 200/400/404 + adversarial all live-proven |

**Physical iPhone HITL:** not required — the close-gate proof Seth requested was the live buyer-web
render, proven on the connected Samsung. Native business/consumer surfaces are covered by the
single-owner re-export + the live proxy proof; OTA to those channels is a separate close step.

## 8. Discoveries for Orchestrator

- **Chrome "Uncaught (in promise, id: N) LoadBundle…" toast** appears on both live buyer-web pages
  (trip + event) on the Samsung. The page renders fully (hero, details, map, checkout) — this is a
  pre-existing web chunk/bundle-load artifact UNRELATED to ORCH-1165 (it predates this change and the
  map renders correctly above it). Worth a separate investigation (possible lazy-chunk 404 / code-split
  hiccup on the SPA), but it is NOT an ORCH-1165 defect.
- **P3-1 / P3-2** above are candidate follow-on hardening items (runtime onError hide + vendor-neutral
  error code) — low priority, near-zero blast radius.
- **OQ-1 (Mapbox ToS attribution):** the implementor flagged in-code that `attribution=false` may
  require a discreet text credit on a legal/about page to stay ToS-compliant while keeping the map
  surface clean. Unresolved — for Seth/legal.

## 9. Accepted conditions

None required — PASS with no P0/P1. The two P3 items are non-blocking observations, not accepted
conditions.

---

## Comms ledger

Read on entry. No BLOCK/OPEN entry targets `mingla-tester`, ORCH-1165, or `ALL` requiring action.
COMMS-0040 / COMMS-0041 (RSVP + experience public-page standardization) are WARN/ALL and do not touch
the static-map proxy path — factored, no edit conflict. No new cross-ORCH discovery warranting a
COMMS entry (the LoadBundle toast is pre-existing and routed as a Discovery above).
