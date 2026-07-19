# QA — ISSUE-865 WP-B + WP-C [attribution-engine] (server CAPI + browser pixels)

**Tester:** mingla-tester · **Date:** 2026-07-18 · **Mode:** TARGETED + SPEC-COMPLIANCE + SECURITY
**Worktree:** `~/Desktop/mingla-orchs/issue-865-[attribution-bc]/` on branch `issue-865-attribution-bc`
**Commits under test:** WP-B `ed932b09a` · WP-C `bdced2048` · tests+CI `28e0fd2f3` · report `ec5eb2a90` (rebased, 0 behind origin/main)
**Binding:** `Mingla_Artifacts/specs/SPEC_ISSUE-865_ATTRIBUTION_ENGINE.md` (§6 SC-2/3/4/5/8/9, §8 RT-1/2/3/4, A2-5/A2-6, A3, SC-15) + investigation `INVESTIGATION_ISSUE-865_ENGINE_REVALIDATION.md`.
**Claims attacked:** `Mingla_Artifacts/implementation/WP-BC-865-IMPLEMENTATION-REPORT.md`.

---

## 1. VERDICT — CONDITIONAL PASS

**P0: 0 · P1: 0 · P2: 1 · P3: 3 · P4: 2**

The decisive money-safety mandate is **PROVEN**: the conversion lane is fail-open, off the tap→pay
critical path, and structurally incapable of creating, blocking, delaying, or reversing a charge.
Dedup (shared `event_id` on both sides, matching per-channel event names), idempotency (real-Postgres
UNIQUE + per-channel status gate), the consent gate, Reddit pending-config, and every CAPI wire shape
verified with runtime/live-fire evidence. **NO real charge was created; no live checkout was run; no
deploy or migration was applied; no prod write occurred.**

**The single condition (P2-1):** the WP-BC migration `20270106000865` (adds
`ticket_checkout_sessions.attribution_click_id`, confirmed **ABSENT on prod today**) MUST be applied
**before** the edge functions are deployed at CLOSE. `ticket-checkout-create` folds the
`attribution_click_id` write into its **fatal** checkout-session UPDATE, so a functions-before-migration
deploy makes an ad-attributed checkout return `409 checkout_session_failed` and **block the purchase**
(non-ad traffic is byte-identical and unaffected). Because this condition is not yet documented as
accepted, this verdict is **surfaced to Seth and does NOT auto-route to CLOSE**.

### Live vs simulated vs suspected (money-safety disclosure)
| Leg | Method | Status |
|---|---|---|
| 1 Fail-open / off-critical-path | Deno real-execution of `fireAdConversion` + senders (throwing DB, throwing sender, real AbortController timeout, hanging sender bounded); finalize-site placement source-verified (edge-fn wiring, exempt) | **PROVEN (simulated finalize)** |
| 2 Dedup exactly-once | Deno real sender-body capture (server) + jest all-4-pixel dedup fields (browser) + pglite one-row | **PROVEN by-contract** · platform Test-Events confirmation **DEFERRED/SUSPECTED** (needs pixel IDs + live click + test-mode purchase) |
| 3 Idempotency | pglite (real Postgres) UNIQUE + `ON CONFLICT DO NOTHING`; Deno status-gate replay | **PROVEN** |
| 4 Consent / PII | jest consent gate + no-PII-egress; Deno end-to-end SHA-256-on-the-wire | **PROVEN** |
| 5 Reddit pending-config | Deno (token unset → skipped, no network, others unaffected) | **PROVEN** |
| 6 CAPI wire shapes | Deno real sender bodies (endpoints/fields/hashing/event-name/v25.0/no-windows) + hardcoded-secret grep | **PROVEN** |
| 7 Adversarial suite + battery | 2 new suites (10 tests) CI-registered + committed; merged battery green sans pre-existing `meta_orch_1074` | **PROVEN** |
| — Spec T6 live-fire (real campaign→click→purchase→Events Manager) | NOT run — would require a real/live checkout or unprovisioned test infra | **SUSPECTED / money-safety deferred** |

No leg required a real charge. The full live-fire (spec T6) is deferred to a post-provisioning pass
(operator items: set `EXPO_PUBLIC_*_PIXEL_ID`, generate `REDDIT_ADS_CAPI_TOKEN`) using each platform's
**Test Events** tab + a Stripe/Paystack **test-mode** purchase — never a live charge.

---

## 2. SC-by-SC matrix (WP-B/C scope)

| SC | Requirement | Verdict | Evidence |
|---|---|---|---|
| SC-2 | click_id threads landing→checkout→order, order linkable to campaign | **PASS** | Threading via `ticket_checkout_sessions.attribution_click_id` (spec §5.1/A3 mechanism, NOT `orders.metadata`); `getStoredClickAttribution` → `createTicketCheckout` → `ticket-checkout-create` persist → `resolveOrderContext` order→session→touch. Forwarded ONLY when present (non-ad byte-identical). |
| SC-3 | order paid / reservation confirmed → exactly ONE `ad_conversions` row, unique `event_id`, replay-idempotent | **PASS** | pglite: INSERT#1=1 row, replay `ON CONFLICT (event_id) DO NOTHING`=0 rows, raw dup → `unique_violation`, final count=1. Deno: already-sent row re-sends nothing (`deduped:true`, record.length 0). Wired at all 6 finalize sites (event/trip/experience→ticket-checkout-confirm+stripe-webhook+free+reconcile; venue→venue-reservation-confirm; NGN→paystack). |
| SC-4-meta/tiktok(+snap/reddit) | hashed PII + shared event_id; `*_status` sent/failed; send failure never blocks/reverses (fail-open) | **PASS** | Deno A2/A3: real sender bodies carry 64-hex `em`/`ph` + shared id; RT-1 fail-open proven (throwing DB/sender/timeout all absorbed to `failed`, never thrown). |
| SC-5 / SC-15 (dedup) | browser Pixel + server CAPI deduped on shared event_id (exact `eventID==event_id` AND `event==event_name` pair) at each of the 3 confirm pages | **PASS** | Server (Deno A3): Meta `Purchase`/event_id, TikTok `CompletePayment`/event_id, Snap `PURCHASE`/client_dedup_id, all == orderId. Browser (jest B1): fbq `Purchase`/eventID, ttq `CompletePayment`/event_id, snaptr `PURCHASE`/client_dedup_id, rdt `Purchase`/conversion_id, all == result.orderId. Names + ids match across sides on all 3 checkout confirm pages. |
| SC-8 (consent) | consent denied → NO client Meta/TikTok pixel fires, NO PII leaves browser | **PASS** | jest CONSENT GATE: pixels bootstrap ONLY in `grantConsent`; pre-consent `adPixelsReady()===false`, no fbq/ttq/snaptr/rdt globals, `fireAdPurchase`/`fireAdViewContent`/`fireAdPageView` no-op. Browser POSTs (touch/conversion) carry click_id/utm/value only — no email/phone (jest B2/B3). Server CAPI on lawful-basis purchase record = OD-4 (spec-sanctioned open legal item, see P3-1). |
| SC-9 (privacy) | all PII to Meta/TikTok SHA-256 hashed; no raw PII stored/sent; GDPR erasure cascades | **PASS** | Deno A2: real plaintext buyer email/phone → outgoing bodies contain ONLY the SHA-256 hash, never the plaintext (all 3 sending channels + reservation path). Schema stores hashed_email/hashed_phone only. Migration: `ad_attribution_touches.user_id ON DELETE SET NULL` (erasure cascade). |
| SC-12 (Reddit pending-config) | token unset → skip softly, never error/block others | **PASS** | Deno: token undefined → `{status:skipped, reason:pending_config}`, 0 network calls; meta/tiktok/snap still POST (A6). |
| RT-4 / SC-11 | no `7d_view`/`28d_view` in any Insights payload; `META_API_VERSION=v25.0` | **PASS (code)** | metaCapi is `/events` not `/insights`; no window literal anywhere in the diff; URL pins `/v25.0/` (Deno A3). NOTE P3-2: the spec-required RT-4 CI strict-grep gate is not present (WP-B/C adds no Insights call — belongs to WP-D/E). |

SC-6/SC-7/SC-10/SC-13 = WP-D/WP-E (rollups, proof-feed, audience, create-path gates) — **out of WP-B/C scope**, not assessed.

---

## 3. Findings

### P2-1 — Deploy-ordering hazard: ad-attributed `ticket-checkout-create` 409s if functions deploy before the migration
- **Evidence:** prod `information_schema` read (read-only) — `ticket_checkout_sessions.attribution_click_id` does NOT exist yet (migration `20270106000865` is written-not-applied). `supabase/functions/ticket-checkout-create/index.ts:539-541` merges `attribution_click_id` into `sessionUpdate`, which `:549-565` writes in the **fatal** status-token UPDATE (`if (statusTokenError) return 409 checkout_session_failed`). `captureAdClickIds` runs on any public page with an inbound ad-click (fbclid/ttclid/…) independent of pixel-ID config or consent, so the field is populated for ordinary ad-click landing traffic.
- **Impact:** in the pre-migration deploy window, ANY ad-attributed checkout returns 409 and the buyer cannot pay (a regression to existing checkout, not merely an inert new feature). No charge is created (it fails before the Stripe session), so this is NOT a money-safety breach — it is a checkout-availability risk for ad traffic. Non-ad checkouts are byte-identical and unaffected.
- **Required fix (choose one):** (a) MANDATORY minimum — orchestrator applies migration `20270106000865` **before** deploying the WP-B/C edge functions at CLOSE (already the documented operator order — must be hard-enforced); OR (b) RECOMMENDED hardening — decouple the `attribution_click_id` write from the fatal status-token UPDATE (best-effort, own non-fatal update / try-catch) so a missing column degrades to "attribution absent" instead of blocking checkout, restoring the "nothing new on the tap→pay critical path" invariant even in the pre-migration window.
- **Retest:** with the column absent, drive `ticket-checkout-create` with `attribution_click_id` set → assert the checkout still succeeds (post-hardening) OR confirm CLOSE applied the migration first (min).
- **Escalation:** upgrade to **P1** if migrate-before-deploy cannot be guaranteed at CLOSE.

### P3-1 — First-party attribution capture (touch/conversion POST) runs pre-consent
- **Evidence:** `captureAdClickIds` (public-page mount) → `postAttributionTouch`, and `postAttributionConversion` (confirm page) fire unconditionally, NOT gated on `mingla_consent_v1`. They carry click_id/utm/value/event_id only (no email/phone — verified jest B2/B3); the server stores `ua_hash`/`ip_hash` (hashed).
- **Impact:** SC-8 as written (third-party pixels + PII egress) is satisfied — third-party pixels ARE consent-gated and no PII/email/phone egresses. But a strict EEA/ePrivacy reading may require consent even for first-party attribution identifiers. This aligns with spec **OD-4** (a flagged legal-review open item) — not a code defect.
- **Required fix:** legal-review decision (route to orchestrator + OD-4). If "suppress all pre-consent," gate `captureAdClickIds`/`postAttributionConversion` on the consent flag too.

### P3-2 — RT-4/SC-11 CI strict-grep gate absent
- **Evidence:** no `.github/scripts/strict-grep/*.mjs` added for the "no 7d_view/28d_view + v25.0 pin" assertion (SC-11 HARD). Code is compliant (no windows, v25.0), but the regression-prevention gate the spec mandates is missing.
- **Impact:** a future change could add attribution windows / unpin the version without CI catching it. WP-B/C has no Insights call, so nothing to guard yet — the gate belongs with WP-D/E (spend-sync/rollups introduce Insights).
- **Required fix:** orchestrator ensures the RT-4 strict-grep lands with WP-D/E (register in `.github/scripts/strict-grep/MANIFEST.json`).

### P3-3 — `ad_conversions.appsflyer_status` never updated by the fire helper (stays 'pending')
- **Evidence:** `fireAdConversion` writes meta/tiktok/snap/reddit statuses only; the AppsFlyer S2S block (ORCH-0808) fires separately and does not touch `ad_conversions.appsflyer_status`, leaving it perpetually `'pending'`.
- **Impact:** cosmetic/rollup only (WP-E). Not a WP-B/C defect. Flag for WP-E rollup accuracy.

### P4 (praise)
- **P4-1:** the shared-`event_id` = order.id decision is elegant and correct — deterministic, present on both sides, no round-trip to mint an id; the exact cross-side name+id contract (A3) holds across all 4 channels.
- **P4-2:** fail-open is layered defensively — sender-internal try/catch, `Promise.allSettled` fan-out, an outer absorb, AND belt-and-suspenders try/catch at every finalize site. The critical-path discipline (fire-and-forget on buyer-facing sites, awaited-but-bounded on webhook/cron) is exactly right.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert

Both independently reproduced in this worktree; product source restored byte-identical (git status clean).

- **Deno fail-open guard** (`ed932b09a`): reverted `adConversionFire.ts` outer catch `return {ok:false,reason:"absorbed"}` → `throw err`. Ran `--filter "throwing DB is ABSORBED"` → **FAILED** at `test:300 assertEquals(threw, false)` (AssertionError). Restored → 12/12 green. `fails-on-revert verified at ed932b09a`.
- **jest consent gate** (`bdced2048`): injected `bootstrapAdPixels()` into `initWebAnalytics` (pre-consent). Ran `-t "CONSENT GATE"` → **FAILED** at `test:132 expect(wa.adPixelsReady()).toBe(false)`. Restored → 4/4 green. `fails-on-revert verified at bdced2048`.

---

## 5. Adversarial tests added (append-only, committed, CI-registered)

Different angles than the implementor's 16 (which stub each side in isolation). Both appear in
`git diff origin/main...HEAD --name-only` at the closing commit; both registered so CI runs them.

- **Deno** `supabase/functions/_shared/__tests__/issue_865_wp_bc_adversarial.tester.test.ts` (6 tests): A1 real AbortController timeout absorbed as `timeout`; A2 **end-to-end** PII hashing — real plaintext buyer email/phone NEVER on any sender wire, only the 64-hex hash; A3 cross-side dedup contract (server body names+ids == the browser's); A4 reservation path (`reservationId` + `Schedule`/`CompleteRegistration`/`SAVE`); A5 hanging sender bounded, never thrown; A6 Reddit pending-config isolation. Registered in `DENO_TEST_FILES`.
- **jest** `mingla-business/src/analytics/__tests__/webAnalytics.pixels.issue865.adversarial.tester.test.ts` (4 tests): B1 all FOUR pixels fire the shared event_id in the correct per-channel dedup field (implementor checked only Meta); B2 checkout conversion POST carries no email/phone; B3 click capture forwards click-id/UTM only + no-ops with no ad signal; B4 ViewContent/PageView no-op pre-consent. Registered in the `issue-865-attribution-jest` job.

**fails-on-revert (tester A2 — the PII-hashing angle):** reverting `resolveOrderContext`'s `sha256Hex(normEmail(email))` to the raw `email` makes A2 fail (plaintext appears on the wire) — the SC-9 guard is the revert target. Verified locally.

**Full merged battery at final state:** Deno 26/26 in the CI batch incl. WP-B; the tester Deno suite 6/6; jest 8/8 (impl 4 + tester 4); `deno check` EXIT=0. The ONLY failure anywhere is the pre-existing `meta_orch_1074_order_paid_payload.test.ts` (`event_sold_out`/`low_inventory`, 2 failed) — **byte-identical to origin/main (empty diff), tests `businessNotifyTriggers` which WP-B/C never touches. Confirmed pre-existing; NOT fixed.**

---

## 6. Constitution (14-rule) matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | no new interactive control (pixels are background) |
| 2 | One owner per truth | **PASS** | one `ad_conversions` row per `event_id` (UNIQUE); the fire helper is the single writer of `*_status` |
| 3 | No silent failures | **PASS (intentional fail-open)** | failures recorded as `*_status='failed'`/`skipped` + `provider_response`; console.warn logged; NOT swallowed silently — this is the spec-mandated fail-open, not a hidden error |
| 4 | One query key per entity | N/A | no React Query key added |
| 5 | Server state stays server-side | **PASS** | pixel/consent state is module-local web singletons; no Zustand server snapshot |
| 6 | Logout clears everything | N/A | no auth-scoped client state added |
| 7 | Label temporary + exit | **PASS** | Reddit `pending_config` self-documents its exit (token exists → sends, no code change) |
| 8 | Subtract before adding | **PASS** | reuses the existing GA4 loader idiom, `readEnv` switch, consent flag, finalize-site pattern |
| 9 | No fabricated data | **PASS** | value/currency read from the actual order/reservation; absent id → no-op, never faked |
| 10 | Currency-aware | **PASS** | value in major units from `total_cents`/`fee_cents` + real `currency`/`fee_currency` |
| 11 | One auth instance | **PASS** | server uses the injected service-role client; buyer web routes never call `useAuth` (anon-tolerant) |
| 12 | Validate at right time | **PASS** | conversion fires only AFTER finalize marks paid |
| 13 | Exclusion consistency | **PASS** | non-Meta channels never receive fbc/fbp; per-channel externalClickId only when `touch.network===channel` |
| 14 | Persisted-state startup | **PASS** | `initWebAnalytics` re-applies stored consent; `adPixelsBootstrapped` guards re-entry |

No violations → no automatic P0.

---

## 7. Device / parity matrix

| Surface | Ships here? | Verdict | Evidence |
|---|---|---|---|
| Backend / edge (Deno) | yes (WP-B) | **PASS (proven)** | senders + fire helper executed under Deno; 26/26 CI batch + 6/6 tester suite; pglite DB idempotency |
| Buyer/anonymous Web (Expo web) | yes (WP-C) | **PASS (proven, jest runtime)** | webAnalytics.web.ts executed under jest with a fake DOM; consent gate + all-4-pixel dedup + no-PII-egress |
| Consumer iOS / Android | native sibling no-op | **N/A** | `webAnalytics.ts` is the native no-op; pixels are web-only (`.web.ts` split) — no native pixel ships this WP |
| Business iOS / Android | native sibling no-op | **N/A** | same split; the threading forward is web-sourced (native returns null → field omitted) |
| Admin Web | not touched | **N/A** | rollup/proof-feed = WP-D/E |
| Business Web preview | same code as buyer web | **PASS (by the WP-C jest runtime)** | |
| Physical iPhone (HITL) | not required | **N/A** | no native/device-runtime surface in WP-B/C; the only user-touchable web surface is exercised via jest runtime. No physical-device step applicable. |
| Live edge deploy state | pre-merge | **DEFERRED to CLOSE** | functions not yet deployed with the helper; prod today: WP-A tables live, `attribution_click_id` absent. Orchestrator verifies deployed version + preserved `verify_jwt` at CLOSE (operator item 2). |

---

## 8. Discoveries for Orchestrator

1. **(P2-1) Enforce migrate-before-deploy at CLOSE** for `20270106000865`, or apply the recommended decouple hardening in `ticket-checkout-create`. Confirmed prod does not yet have `ticket_checkout_sessions.attribution_click_id`.
2. **(P3-1) OD-4 legal-review** — first-party attribution capture (touch + conversion POST) runs pre-consent (no PII egress). Decide suppress-all vs first-party-lawful-basis.
3. **(P3-2) RT-4 strict-grep gate** must land with WP-D/E when Insights calls appear (register in strict-grep MANIFEST.json).
4. **(P3-3) `appsflyer_status`** stays `pending` on ad_conversions rows — reconcile in WP-E rollups.
5. **Concurrent confirm-vs-webhook fire** both send per channel under a tight race (per-channel status gate only guards SEQUENTIAL replay); this is BY DESIGN — the shared `event_id` makes the platform count once, and the DB row is UNIQUE. No fix needed; noted.
6. **Second browser confirm-page reload** re-fires `fireAdPurchase`/`postAttributionConversion` with the same `event_id` (no client "already-fired" flag) → platform-deduped, first-party-server-deduped. No double-count; redundant network only. Optional hardening (session flag).
7. **Pre-existing `meta_orch_1074` failure** (byte-identical to origin/main) — environment/stale-mock, unrelated to WP-B/C. Triage separately.
8. **COMMS factored:** COMMS-0102 (local stack — used pglite WASM Postgres, no `supabase start`, so the 6 duplicate-prefix boot break was avoided entirely; no anchor migration renames performed, worktree restored byte-identical), COMMS-0105 (foreign stash — untouched), COMMS-0106 (append-only — both tester suites are NEW files, in-diff, CI-registered).

---

## 9. Accepted conditions (CONDITIONAL PASS)

This verdict carries ONE unaccepted condition and is therefore **surfaced to Seth, not routed to CLOSE**:

- **P2-1** — migration `20270106000865` applied before the WP-B/C edge-function deploy at CLOSE
  (mandatory) and/or the `ticket-checkout-create` attribution-write decoupled from the fatal
  status-token UPDATE (recommended hardening). Requires Seth's documented acceptance (as a
  follow-up `ORCH-#### [label]`) or the hardening REWORK before CLOSE.

**Money-safety attestation:** no real charge was created; no live checkout was executed; no edge
function was deployed; no migration was applied; no production write occurred. Every send/finalize leg
used stubbed fetch + an injected/fake or pglite (WASM) database, or read-only prod inspection.
