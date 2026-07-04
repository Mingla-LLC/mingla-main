# IMPLEMENTATION — ORCH-1295 [chip-in-post-payment-polish]

Phase: IMPLEMENT. Worktree: `~/Desktop/mingla-orchs/ORCH-1295-[chip-in-post-payment-polish]/` on branch `ORCH-1295-chip-in-post-payment-polish` (rebased on origin/main; carries the merged ORCH-1291 code).
Follows the two bugs Seth found live-testing the shipped ORCH-1291 RSVP chip-in. Author: mingla-implementor (Claude). Date: 2026-07-04.

---

## 1. Summary (plain English)

Two fixes to the just-shipped voluntary RSVP "chip-in":

- **BUG 1 (P1 — the important one):** after a guest paid a chip-in on the WEB, Stripe redirected them to a **dead URL** and they were stranded — no confirmation. Root cause: the edge function built the return URL as `/e/{eventSlug}` but the public event page lives at `/e/{brandSlug}/{eventSlug}` — the brand segment was missing. Now the return URL includes **both** segments, and the guest lands back on the real event page where a clear **gift-framed "Thanks for chipping in" banner** appears (and a neutral "Payment canceled" banner if they backed out). No more dead page.

- **BUG 2 (P2 — minor):** the guest RSVP phone field was a plain text box with no country code. It is now **country-code aware** on the buyer web page, reusing the exact country-picker phone input (`@mingla/phone-input`) already used on the checkout form — **no new dependency**. Native surfaces keep the existing plain field (zero regression).

The edge function's money math, the migration, the finalize RPC, the webhook routers, the publish gate, and the native deep-link return path were **not touched**.

---

## 2. SPEC / goal success-criteria coverage

This ORCH has no formal SPEC; the orchestrator dispatch `/goal` is the contract. All committed on `ORCH-1295-chip-in-post-payment-polish` (see §3 for the commit hash).

| Goal | Status | How |
|---|---|---|
| G-1 — web Checkout success_url/cancel_url include `/e/{brandSlug}/{eventSlug}` | ✓ | `returnUrls.ts` builder + `index.ts` web arm; brandSlug extracted from the existing `brands(slug,name)` embed |
| G-2 — a returning guest sees a clear gift success (and cancel) state, not a stranded page | ✓ | `PublicEventPage.tsx` reads `?contribution=paid\|cancel` → dismissible gift-framed banner; param stripped so refresh won't repeat |
| G-3 — the RSVP phone input is country-code aware | ✓ (buyer web) | `@mingla/phone-input` injected via a host-supplied render-prop; native falls back to the plain field |
| G-4 — a fails-on-revert regression test for the URL fix | ✓ | `__tests__/orch_1295_web_return_url.test.ts` — 3 Deno tests; **fails-on-revert verified** (see §6) |
| G-5 — committed + pushed on the branch | ✓ | see §3 |

---

## 3. Files changed

| File | Δ | What |
|---|---|---|
| `supabase/functions/rsvp-contribution-create/returnUrls.ts` | **NEW** (+50) | Pure `buildContributionWebReturnUrls(baseUrl, brandSlug, eventSlug)` — always `/e/{brand}/{event}`; null on missing slug (fail closed). Testable without importing the serve()-on-load `index.ts`. |
| `supabase/functions/rsvp-contribution-create/index.ts` | ~ (+30 / −3) | Import the helper; extract `brandSlug` (same object-or-array normalization as `brandName`); web arm uses the helper + fails closed (marks the pending row `failed`, returns `brand_slug_unavailable`) if brandSlug missing. NATIVE deep-link `else` branch untouched. |
| `supabase/functions/rsvp-contribution-create/__tests__/orch_1295_web_return_url.test.ts` | **NEW** (+55) | Regression guard (fails-on-revert). |
| `packages/offering-rendering/RsvpOfferingBody.tsx` | ~ (+70 / −11) | New exported types `RsvpPhoneFieldRenderArgs` / `RsvpPhoneFieldRenderer`; new optional props `renderPhoneField` + `defaultPhoneCountry`; lifted `phoneCountry` + `phoneLocalDigits` state (single owner → controlled across both contact-form mounts); contact form renders the injected field when present, else the existing plain `RsvpField`. |
| `packages/offering-rendering/index.ts` | ~ (+3) | Export the two new phone-field types. |
| `mingla-business/src/components/event/FoundationRsvpPreview.tsx` | ~ (+9) | Thread `renderPhoneField` + `defaultPhoneCountry` through to `useRsvpOfferingState`. |
| `mingla-business/src/components/event/PublicEventPage.tsx` | ~ (+170 / −1) | BUG 1 return banner (read `?contribution`, strip param, gift-framed dismissible banner + styles). BUG 2 build `renderPhoneField` (reuse `@mingla/phone-input` + `composeE164`, palette-derived theme, locale/currency-seeded default country) and pass it to `FoundationRsvpPreview`. |

**Isolation preserved:** `@mingla/offering-rendering` gained NO new imports — the phone widget is host-supplied (I-MOR-0827 upheld; package-isolation gate PASS).

---

## 4. The exact URL now emitted (BUG 1)

For `surface:'web'`, base `https://business.usemingla.com`, brand slug `acme-events`, event slug `july-4th-bbq-pool-party`:

```
success_url = https://business.usemingla.com/e/acme-events/july-4th-bbq-pool-party?contribution=paid
cancel_url  = https://business.usemingla.com/e/acme-events/july-4th-bbq-pool-party?contribution=cancel
```

(Before ORCH-1295: `…/e/july-4th-bbq-pool-party?contribution=paid` — brandSlug omitted → the router parsed the event slug as `brandSlug`, no `eventSlug` → dead page.)

If `brandSlug` is null/blank the web arm now **fails closed**: the pending contribution row is set to `failed` and the fn returns `{ error: "brand_slug_unavailable" }` (500) rather than emit a URL with a missing path segment. The `mobile-web` NATIVE deep-link (`mingla-business://checkout/return?...`) is **unchanged**.

---

## 5. How the success/cancel screen renders (BUG 1)

A fresh web return has **no live RSVP state** (the guest RSVP'd, redirected to Stripe, paid, came back to a fresh page load), so the shared chip-in panel's two mounts — the success-popup mount (needs `successDetails`) and the inline mount (needs `guestStatus === "going"`) — are **both hidden**. Passing `contributionState='paid'` alone therefore renders nothing. The robust fix is a **dedicated banner in the buyer-web adapter** driven purely by the URL param:

- `PublicEventPage` reads `?contribution` via `useLocalSearchParams`, seeds `returnBanner` state once, and (on web) strips the param via `window.history.replaceState` so a refresh/back doesn't re-fire it.
- `paid` → gift-framed card: **"Thanks for chipping in 💛 — Your gift to {host} came through — your RSVP's all set."**
- `cancel` → neutral card: **"Payment canceled — No charge was made. Your RSVP is still confirmed."**
- Absolutely-pinned top, above the parallax chrome (zIndex 20), dismissible (X). Palette-themed. No buy/ticket/tax/purchase/cart/price words (gift framing upheld).

---

## 6. Regression test — fails-on-revert PROOF

- **Path:** `supabase/functions/rsvp-contribution-create/__tests__/orch_1295_web_return_url.test.ts` (3 Deno tests).
- **Passing run** (`deno test --allow-read …`): `ok | 3 passed | 0 failed`.
- **Fails-on-revert (true line deletion, NOT comment-out):** deleted the brandSlug segment in `returnUrls.ts` (`/e/${brand}/${event}` → `/e/${event}`, reproducing the ORCH-1291 bug) → the exact-URL + `["e", brand, event]` path-segment assertions **FAILED** (`FAILED | 2 passed | 1 failed`). Restored the segment → `ok | 3 passed | 0 failed`.
- **fails-on-revert verified at commit `181acc5d9`** (the ORCH-1295 fix commit on this branch; the pre-fix parent is `b92c21d2d`).

The test asserts the success_url contains BOTH brandSlug AND eventSlug in `/e/{brand}/{event}` order (exact URL + structural path-segment check), and that a missing brand/event slug returns null (fail closed).

---

## 7. Old → New receipts

### supabase/functions/rsvp-contribution-create/index.ts
- **Before:** web arm built `${baseUrl}/e/${eventSlug}?contribution=paid|cancel` — brandSlug omitted → dead page.
- **Now:** extracts `brandSlug` from the existing `brands(slug,name)` embed and builds `${baseUrl}/e/${brandSlug}/${eventSlug}?contribution=paid|cancel` via the pure helper; fails closed if brandSlug missing (marks row `failed`, returns `brand_slug_unavailable`).
- **Why:** BUG 1 — the public event route is `/e/[brandSlug]/[eventSlug]`.
- **Lines:** ~30 changed.

### packages/offering-rendering/RsvpOfferingBody.tsx
- **Before:** the guest phone was a plain `RsvpField` text box; no country awareness; the hook owned only `guestPhone`.
- **Now:** optional `renderPhoneField` render-prop replaces the phone field when the surface supplies one; `phoneCountry` + `phoneLocalDigits` lifted into `useRsvpOfferingState` so the injected field is controlled across both contact-form mounts; absent prop → the original plain field (unchanged).
- **Why:** BUG 2, host-agnostic (the picker widget is host-supplied per its design + I-MOR-0827).
- **Lines:** ~70 changed.

### mingla-business/src/components/event/PublicEventPage.tsx
- **Before:** no read of `?contribution`; no post-return UI; passed no phone renderer.
- **Now:** reads `?contribution=paid|cancel` → gift-framed dismissible banner (param stripped on web); builds `renderPhoneField` from `@mingla/phone-input` + `composeE164` (palette-derived theme, locale/currency-seeded default country) and passes it + `defaultPhoneCountry` to `FoundationRsvpPreview`.
- **Why:** BUG 1 confirmation screen + BUG 2 country-code-aware field on buyer web.
- **Lines:** ~170 changed.

### mingla-business/src/components/event/FoundationRsvpPreview.tsx
- **Before:** did not forward a phone renderer.
- **Now:** accepts + forwards `renderPhoneField` + `defaultPhoneCountry` into `useRsvpOfferingState`.
- **Why:** BUG 2 plumbing.
- **Lines:** ~9 changed.

---

## 8. Cross-surface impact

| # | Surface | Affected | Behavior | Parity |
|---|---|---|---|---|
| 1 | Consumer iOS | NO | Native chip-in return is a deep link (unchanged); consumer RSVP phone keeps the plain field | n/a (no renderPhoneField passed) |
| 2 | Consumer Android | NO | Same as iOS | n/a |
| 3 | Buyer/anon Web (`/e/{brandSlug}/{eventSlug}`) | **YES** | Fixed return URL → lands on the real page; gift/cancel banner; country-code-aware phone field | AUTOMATIC (this is the fixed surface) |
| 4 | Business iOS | Partial | If the business app renders `PublicEventPage`, it inherits the country-picker phone field (native-tolerant) + banner; native chip-in return deep link unchanged | MANUAL (mingla-business code) |
| 5 | Business Android | Partial | Same as business iOS | MANUAL (same codebase → parity) |
| 6 | Admin Web | NO | Not touched | n/a |
| 7 | Business Web preview | Inherited | Renders the shared body; if the preview path supplies `renderPhoneField` it gets the picker, else the plain field | AUTOMATIC |

The **web** surface is where Seth found both bugs and is the primary fix target. Native RSVP phone remains the plain field (a country-picker for native RSVP is a clean follow-up — see §11).

---

## 9. Gates run (self-verify)

- `deno check supabase/functions/rsvp-contribution-create/index.ts` → **clean**.
- `deno test --allow-read …/__tests__/orch_1295_web_return_url.test.ts` → **3 passed**; fails-on-revert proven (§6).
- `packages/offering-rendering` `tsc -p tsconfig.json --noEmit` → **clean** (my files).
- `mingla-business` `tsc --noEmit` → my two files (`PublicEventPage.tsx`, `FoundationRsvpPreview.tsx`) **clean** (callback params explicitly typed — I introduced ZERO new implicit-any, going one better than the pre-existing buyer.tsx precedent). Pre-existing repo tsc noise (react-dom/server, @testing-library/react-native, and the untouched shared `packages/offering-rendering/PublicEventPage.tsx` "Cannot find module 'react'" cross-tsconfig artifact) is unrelated and pre-dates this ORCH.
- Strict-grep gates (the six that scan the edited files): `meta-orch-0827-package-isolation`, `orch-1167-shell-agnostic-body`, `orch-1167-canonical-9-section-order`, `orch-1292-taxonomy-label-parity`, `orch-1117-no-raw-white-on-palette-surface`, `meta-orch-0827-no-web-stripe-in-consumer` → **all PASS**.
- Existing RSVP shared-body Deno tests (`orch_1163_rsvp_shared_body`, `orch_1157_rsvp_momentum`) → **23 passed** (additive change, no regression).

**Runtime status: implemented, partially verified.** Static + unit + gate evidence complete. The buyer-web round-trip (real Stripe redirect → banner) and the country-picker interaction were NOT live-fired in this session — the tester must drive the web return + phone picker (see §11).

---

## 10. Operator action required (for the ORCHESTRATOR)

- **Redeploy the edge function `rsvp-contribution-create`** from MERGED `main` (the implementor does NOT deploy). Its `verify_jwt = false` must be **preserved** (anon-capable — unchanged). Verify with one curl of a chip-in-enabled RSVP event and confirm the returned/`success_url` now contains `/e/{brandSlug}/{eventSlug}`.
- **No migration.** No DB change in this ORCH.
- Web ships via Vercel on merge (the buyer-web fix); the native country-picker rides the next build (but native was intentionally left on the plain field here — see §11).

---

## 11. Known issues / deferred / discoveries for orchestrator

- **Native RSVP phone field remains the plain text box.** BUG 2 was fixed on buyer web (where Seth found it). Wiring the country picker on native RSVP would mean passing `renderPhoneField` from `app-mobile`'s `ConsumerEventDetailScreen` using app-mobile's own `PhoneInput` wrapper — a clean, low-risk follow-up if desired (the shared body already supports it via the same prop). Flagged, not done (scope: minor).
- **`contributionState='paid'` prop on the shared body is effectively dormant for web returns.** The ORCH-1291 wiring initializes the chip-in panel to `success` when `contributionState==='paid'`, but on a fresh web return the panel's mounts are gated off (no live RSVP status), so nothing shows. This ORCH routes the web confirmation through the adapter banner instead. The prop is harmless and still available for a future native/preview flow that keeps a live guest status. Not a bug — noted so a future reader doesn't expect the panel-success path to fire on web.
- **No secrets, no fabricated data, no `[TRANSITIONAL]` code.**
- **Comms ledger:** scanned on entry; no `BLOCK`/`OPEN` row targets implementor / ORCH-1295 / ORCH-1291 / ALL. No new cross-ORCH discovery to write.
