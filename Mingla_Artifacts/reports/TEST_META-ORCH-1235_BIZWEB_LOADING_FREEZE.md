# TEST — META-ORCH-1235 — business web loading-screen freeze fix

**Verdict: PASS**

**Branch:** `orch-1235-bizweb-loading-freeze` · commit `e20660ba9` · worktree `orch-1235-[bizweb-loading-freeze]`.
**Method:** real Chromium (Playwright 1.60) driving the worktree web build (`expo start --web`, port 8081), authed via a real `reviewer-signin` session (`appreview@usemingla.com`) injected into `localStorage["sb-gqnoajqerqhnvulmnyvv-auth-token"]`. Hung read simulated by intercepting `**/rest/v1/brands**` and never fulfilling. Brand: "Smoke & Rhythm" `1ce63bf4-1a33-4309-ab0b-ec23343e3569`.
**Honesty note:** the control (OLD-code freeze) was run on the SAME server by overlaying `origin/main`'s versions of the 4 fix files (`brandsService.ts`, `BrandProfileView.tsx`, `brand/[id]/index.tsx`, `queryClient.ts`) — confirmed `withTimeout` count 0 in the overlay — then `git checkout` restored the fix and the NEW-code runs were re-verified. Two full node_modules trees were not needed.

---

## Side-by-side — the headline proof

| | hung `**/rest/v1/brands**` (never settles) |
|---|---|
| **OLD code (origin/main overlay)** | Orange `ActivityIndicator` (`testID=brand-profile-loading`) pinned at EVERY sample 0s→**35s**. Retry NEVER appeared. **Infinite freeze.** (`shot_old_frozen.png`) |
| **NEW code (fix branch)** | Spinner shown at 855ms, then REPLACED at **48954ms (~49s)** by "Couldn't load this brand / Check your connection and try again." + an orange **Retry** button (`testID=brand-profile-retry`); `brand-profile-loading` gone. **Bounded.** (`shot_new_bounded_error.png`) |

The ~49s = the bounded worst case the spec predicts: `retry:2` ⇒ 1+2 attempts, each capped by `DATA_FETCH_TIMEOUT_MS` 15s + capped retry backoff (≤4s) ≈ 3×(15+~1) ≈ 49s. Well under the spec's ≤60s ceiling. This is INTENTIONAL bounded-failure, not a regression — a single attempt bounds at 15s; the user sees a spinner that is *guaranteed to end*, then a recoverable error. (Note: a deployment could tighten perceived time by lowering `retry`, but the spec explicitly forbids changing `retry` to avoid a refetch-storm — current behavior is per contract.)

---

## Per-item evidence

**1. OLD code freezes (control) — PASS.** origin/main overlay, hung route: `brand-profile-loading` present at samples 0/1/2/5/10/15/20/25/30/35s; `retryEverAppeared:false`; `spinnerStillUpAt35s:true`. Screenshot `shot_old_frozen.png` = centered orange spinner, no error. Matches the captured runtime-repro freeze.

**2. NEW code degrades — PASS.** Fix branch, same hung route: spinner at 855ms → at 48954ms replaced by error + Retry; `loadingGoneWhenRetry:true`; body text "Couldn't load this brand … Retry". No infinite spinner. `shot_new_bounded_error.png`.

**3. Retry recovers WITHOUT reload — PASS.** With the route un-hung, clicking `brand-profile-retry` rendered the full "Smoke & Rhythm" profile (hero, About Us, EVENTS:2, Edit brand / View public page) in **513ms**, no `page.reload()`. `shot_retry_recovered.png`.

**4. Healthy load still fast — PASS.** No interception: `/brand/<id>` rendered the profile in **1531ms** (<2s). The `withTimeout` race adds no latency to a healthy read.

**5. online-flap no longer sticks — PASS.**
- queryClient `networkMode:"always"` asserted at runtime by unit test `queryClient.metaOrch1235.test.ts` (`getDefaultOptions().queries.networkMode === "always"`, `retry===2`, `retryDelay(10)≤4000`) — PASS.
- Browser flap: booted `/hub/experiences` fully online, dispatched a `navigator.onLine` offline→online flap via JS events while the SPA was live; the screen rendered content (6 `rest/v1/events` requests fired, settled in 23ms) and never sat on a bare spinner with no resolution. `shot_flap4.png`. (Note: CDP `setOffline(true)` at nav time blocks Metro from serving the JS bundle, so the JS-event flap on an already-booted SPA is the faithful simulation — documented.)

**6. Regressions — PASS.** All logged-OUT (no session):
- `/b/smokerhythm` → public brand page rendered 1408ms, NOT gated to sign-in. `shot_public_brand.png`.
- `/e/smokerhythm/fifa-grill-night` → public event page rendered 1676ms ("FIFA Grill Night", date, vibes), not gated. `shot_public_event2.png`.
- `/checkout/<eventId>` → guest checkout funnel ("Get tickets · 1 of 3 · Select your tickets · $10.00") rendered 4613ms, not gated. `shot_checkout.png`.
- Boot path: logged-out `/` resolved to BusinessWelcomeScreen ("Continue with Apple/Google/Email") in **992ms** — no whole-app freeze. `shot_boot.png`.
- `i-proposed-1232-f-public-paths-ungated` (PUBLIC-SAFETY, CLOSE-blocking) → PASS · violations=0. Public-path allowlist not weakened.

**7. Adversarial regression test — PASS + fails-on-revert proven.**
- File: `mingla-business/src/services/__tests__/brandsService.metaOrch1235.tester.test.ts` (NEW; carries `[TEST-MOD-APPROVED META-ORCH-1235]`).
- **Different angle than the implementor:** the implementor's `brandsService.metaOrch1235.test.ts` asserts `getBrand()` rejects in isolation. THIS test drives `getBrand` THROUGH a real `@tanstack/query-core` `QueryClient` configured with the PRODUCTION defaults (`networkMode:"always"`, `retry:2`, capped `retryDelay`) and proves the END-TO-END gate: (a) a never-settling brand read makes the query reach `status:"error"` in bounded time (observed `errorUpdateCount:1`, `fetchFailureCount:3`, `error.isTimeout:true`), and (b) `isBrandRouteResolving(...)` — the exact predicate `brand/[id]/index.tsx` uses to gate the full-screen spinner — flips `false`, so BrandProfileView's `brand===null && isError` Retry branch is the one that renders (the spinner is provably released).
- **Fails-on-revert:** stripped the `withTimeout(...,"getBrand:read")` wrap from `getBrand` → `getBrand` hangs → query never reaches `error` within the deadline → test FAILED (5003ms assertion timeout). Restored the wrap → PASS. (`git checkout` restored the file; tree clean.)

---

## Gates / suites (all GREEN)

- Strict-grep `I-PROPOSED-1235-A/B/C`: run PASS · violations=0; `--self-test` OK for all three.
- `i-proposed-1232-f` (public-safety): PASS · violations=0.
- `metaOrch1235` jest suites: **18/18 pass** (17 implementor + 1 adversarial-tester), incl. `withTimeout`, `queryClient`, `authReadiness`, `BrandProfileView`, both `brandsService` settle-guarantee tests.
- New tester test typechecks clean; worktree clean (only the new test file added; `.env` is gitignored and was restored).

## Residual notes (non-blocking)
- Worst-case bounded time on a fully-hung read is ~49s (3 attempts). Per spec this is the intended bounded-failure profile (retry count is contractually fixed). A single-attempt timeout bounds at 15s. Not a regression — the prior behavior was infinite.
- Stripe Connect SDK-init hang is explicitly out of scope (separate follow-up), per spec §2.4 — not tested here.
- Healthy console emitted 3 benign errors (unrelated to the fix path); profile rendered correctly.

**VERDICT: PASS** — OLD code freezes forever (spinner up at 35s, no retry), NEW code bounds out to an error+Retry (spinner gone, retry present), Retry recovers in 513ms without reload, healthy load 1531ms, public pages + boot unaffected, 1232-f green, adversarial test passes and fails-on-revert.
