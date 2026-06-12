# SPEC — ORCH-1116 [Cover picker GIF tab shows "This source is taking a break"]

**Skill:** mingla-forensics · **Phase:** SPEC · **Date:** 2026-06-11
**Upstream investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1116_GIF_COVER_PICKER.md` (root cause PROVEN at build-config layer).
**Type:** config + observability fix. NOT a CoverPicker redesign.

---

## 1. Executive summary

The GIF tab in the business-app cover picker shows "This source is taking a break." because the public **GIPHY key is provisioned in the EAS `production` environment ONLY** — it is absent from the `development` and `preview` EAS environments and from local `.env`. GIPHY is client-direct (ToS forbids proxying), so dev/preview builds and local Metro have no key, `publicGiphyKey()` returns `null`, and both the trending and search paths fail-close to `not_configured`. Pexels works because it is edge-proxied (server-side key, build-independent). Production builds already work.

This SPEC delivers three things, exactly per Seth's asks: **(Fix)** propagate the GIPHY key to the dev/preview environments + document it in `.env.example`, with the rebuild-vs-OTA implication spelled out so the fix actually reaches devices; **(Prevent)** a config-eval fail-loud guard for required public keys (modeled on the existing `pk_live` guard in `app.config.ts`) plus a strict-grep CI gate, both staged as DRAFT invariants; **(Detect)** route the `not_configured` CONFIG error to engineering telemetry (Sentry breadcrumb/event via the existing `reportNonFatal`) while keeping transient `provider_unavailable`/`rate_limited` user-facing-only — so a mis-provisioned build is no longer a silent failure.

---

## 2. Scope & non-goals

**In scope:**
1. Provision `EXPO_PUBLIC_GIPHY_API_KEY` for the EAS `development` and `preview` environments (operator action — see §4 Build-config), and add `EXPO_PUBLIC_GIPHY_API_KEY=` to `.env.example` with a comment pointing at the GIPHY dashboard.
2. A config-eval fail-loud guard in `mingla-business/app.config.ts` for the GIPHY public key, scoped so it fails the BUILD (not the user) when a key is required but absent.
3. A strict-grep CI gate asserting the GIPHY key wiring is present and the fail-loud guard is not removed.
4. Telemetry: emit a Sentry event/breadcrumb (via existing `reportNonFatal`) when a provider error is `not_configured`, so engineers are alerted; leave `provider_unavailable`/`rate_limited`/`invalid_response` as user-facing-only (no engineer alert).

**Non-goals (explicitly OUT):**
- Any change to the CoverPicker UI/UX, copy, layout, or the error-state component beyond the single telemetry call-site. The friendly copy stays.
- Any change to the Pexels edge path or its key handling.
- Any change to the GIPHY service network logic, normalization, clamping, or the existing fail-close guards (they are correct).
- Re-architecting GIPHY to be edge-proxied (forbidden by GIPHY ToS — `coverProviderBrowseService.ts:6-8`).
- Consumer app, admin web, buyer web (no CoverPicker / no GIPHY there).
- Provisioning a brand-new GIPHY account — a key already exists (Open question O-1 confirms reuse vs. new dev key).

**Assumptions:** the existing EAS `production` GIPHY key is valid and may be reused for dev/preview (pending O-1); EAS environments map to build profiles by name as proven in the investigation (development→development, preview/preview-sim→preview, production/production-apk→production).

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior demanded | Files touched | Parity |
|---|---------|----------|--------------------------------|---------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | — | none | No CoverPicker / no GIPHY ref there. |
| 2 | Consumer Android | NO | — | none | Same. |
| 3 | Buyer/anon Web | NO | — | none | Authoring surface, not buyer. |
| 4 | **Business iOS** | **YES** | GIF tab loads trending + search on dev/preview/production builds. | `app.config.ts`, `eas.json` (comment/anchor), `.env.example`, `CoverPicker.tsx` or service (1 telemetry call), strict-grep gate | Automatic (shared CoverPicker + services). |
| 5 | **Business Android** | **YES** | Same as iOS. | Same | Automatic (shared code + EAS env applies to both platforms of a profile). |
| 6 | Admin Web | NO | — | none | No CoverPicker. |
| 7 | Business Web preview | PARTIAL (config-only) | If/when the web export is built with the GIPHY env set, GIF tab works; otherwise Pexels still works. | covered transitively by `.env`/build env | Manual — the web export must also receive the env var at build time (Vercel env or build env). Lower priority; note in Open questions. |

This is a HARD gate: surfaces 1/2/3/6 are NOT-covered because none contain the unified CoverPicker or any `EXPO_PUBLIC_GIPHY` reference (proven F-3 blast-radius grep).

---

## 4. Layered specification

This change touches **build-config**, **app-config (config-eval)**, **service/component (1 telemetry line)**, and **CI**. No DB, edge function, hook, or realtime layer is affected.

### 4.A Build-config (operator + repo)

**A1 — EAS remote env (operator action, no repo change):**
Provision `EXPO_PUBLIC_GIPHY_API_KEY` (and, to match the existing belt-and-suspenders fallback, `EXPO_PUBLIC_GIPHY_KEY`) into the `development` and `preview` EAS environments, mirroring how `production` already has them. Exact commands (Seth runs; values not in repo):
```
eas env:create --environment development --name EXPO_PUBLIC_GIPHY_API_KEY --value <key> --visibility plaintext
eas env:create --environment preview     --name EXPO_PUBLIC_GIPHY_API_KEY --value <key> --visibility plaintext
```
(Repeat for `EXPO_PUBLIC_GIPHY_KEY` if the dual-name fallback is to be preserved; otherwise the single `EXPO_PUBLIC_GIPHY_API_KEY` suffices since the service reads it first.)

**A2 — `.env.example` (repo change):**
Add, under the existing `EXPO_PUBLIC_*` block:
```
# GIPHY public key (client-direct; GIPHY ToS forbids proxying). Get from
# https://developers.giphy.com/dashboard/ . Required for the cover-picker GIF tab.
EXPO_PUBLIC_GIPHY_API_KEY=
```
This closes F-3/F-5 (local Metro dev currently has no documented key) and gives developers a place to paste their own key for local `expo start`.

**A3 — `eas.json` (repo change, OPTIONAL belt-and-suspenders):**
The investigation proved EAS resolves env from the named environment, so A1 is sufficient. Do NOT hardcode the GIPHY key value into `eas.json` `env` blocks (it would put a credential in version control and override the EAS env). The only acceptable `eas.json` edit is a comment documenting that the GIPHY key is provisioned via EAS environments — but `eas.json` is strict JSON (no comments). Therefore: **no eas.json value edit**; the strict-grep gate (§4.D) and the config-eval guard (§4.B) carry the enforcement instead.

**Rebuild-vs-OTA implication (LOAD-BEARING — must be stated in the implementation report and to Seth):**
`EXPO_PUBLIC_*` variables are **inlined into the JS bundle at BUILD/bundle time** from the resolved environment. The fix therefore requires:
- A **new EAS build** of the affected profile(s) (`development`, `preview`/`preview-sim`) so the bundler re-resolves `process.env.EXPO_PUBLIC_GIPHY_API_KEY` to the now-present value. An OTA (`eas update`) alone re-publishes the JS bundle and CAN pick up the new env IF the update is exported with the env present in the export environment — but the safest, deterministic path is a fresh dev/preview build. Per memory `project_ota_deferred_until_new_build`, a native rebuild is warranted here only if a config/native change is needed; this is an env-only change, so a fresh dev build (which Seth already runs for business-app testing) is the minimum to verify. For production, the key is already present — no action needed.
- State explicitly: **the already-installed dev build on Seth's device will NOT pick up the key until rebuilt/re-bundled.**

### 4.B App-config fail-loud guard (`mingla-business/app.config.ts`)

Add a config-eval IIFE for the GIPHY key, modeled EXACTLY on the existing `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` guard at `app.config.ts:135-180`. Contract (≤ illustrative, implementor writes the real code):
- Read `process.env.EXPO_PUBLIC_GIPHY_API_KEY ?? process.env.EXPO_PUBLIC_GIPHY_KEY`.
- Read `process.env.EAS_BUILD_PROFILE` (EAS sets this at build time) — OR `VERCEL_ENV` for the web export, matching the existing dual-context handling in this file.
- **Fail-loud rule:** if the build is a **release-bound profile** (`production`, `production-apk`, `preview`, `preview-sim` — i.e. profiles a tester/user will actually touch) and the GIPHY key is absent/blank → `throw new Error("EXPO_PUBLIC_GIPHY_API_KEY is required for the <profile> build (cover-picker GIF tab). Provision it in the matching EAS environment.")`.
- **Do NOT throw** for `development` profile or local (`EAS_BUILD_PROFILE`/`VERCEL_ENV` undefined) — a developer without a key should still get a working dev build with a degraded GIF tab (the friendly copy), not a hard config crash. (This mirrors the Stripe guard's local-vs-production asymmetry.) Optionally `console.warn` in the dev/local case.
- The returned value is injected into `expo.extra` or `process.env` passthrough so the runtime services read it — but note the services already read `process.env.EXPO_PUBLIC_*` directly (which EAS inlines), so the guard's PRIMARY job is to FAIL THE BUILD, not to plumb the value. Keep the guard a validation gate, not a new plumbing path.

This satisfies the "prevent recurrence" ask analogous to `feedback_mingla_business_pk_live_in_production`.

### 4.C Telemetry / Detect (1 call-site)

The investigation (F-7, D-1) showed the `not_configured` CONFIG error is collapsed into friendly copy with zero telemetry. Add a single, surgical telemetry emit that distinguishes CONFIG from transient:

- **Where:** at the point the provider error becomes an error STATE — preferred location is the catch/error handler in `CoverPicker.tsx` that sets `errorCode` for the GIF/Stock grid (the same place `noRetry`/copy is derived). Use the existing diagnostics helper:
  ```
  import { reportNonFatal } from "../../diagnostics/reportNonFatal";  // illustrative path
  if (errorCode === "not_configured") {
    reportNonFatal("coverPicker.provider", err, { provider: kind, code: errorCode });
  }
  ```
- **Rule:** emit ONLY for `not_configured` (and optionally `auth_required`, which is also a non-transient config/session fault). Do NOT emit for `provider_unavailable`, `rate_limited`, `invalid_response` — those are transient and user-facing-only (avoid alert noise).
- `reportNonFatal` already `console.warn`s always (honoring I-NO-SILENT-FAILURES) and `captureException`s to Sentry when configured — exactly the CONFIG-vs-transient split required, with no new dependency.
- **Caveat (D-1):** Sentry DSN (`EXPO_PUBLIC_SENTRY_DSN`) is itself provisioned in EAS `production` only, so on dev/preview builds the Sentry side is a no-op (only the console.warn fires). For the alert to fire from production builds (where the key SHOULD be present so this should be rare) it works as-is. **Open question O-2:** provision the Sentry DSN for dev/preview too if Seth wants config alerts from those builds. Recommended: yes, lightweight, closes the observability loop.

### 4.D Strict-grep CI gate

Add a new gate under `.github/scripts/strict-grep/` (convention: a `.mjs` rule + a `.test.mjs` companion, matching the existing `i-*.mjs` files), e.g. `i-giphy-key-wired.mjs`. It asserts:
1. `mingla-business/app.config.ts` contains the GIPHY fail-loud guard (grep for `EXPO_PUBLIC_GIPHY_API_KEY` AND a `throw` in the same guard region) — i.e. the prevent guard cannot be silently deleted.
2. `mingla-business/.env.example` documents `EXPO_PUBLIC_GIPHY_API_KEY`.
3. (Optional, if feasible without network) a build-config check is NOT possible in pure grep against EAS remote env — so the gate enforces the REPO-side wiring (guard + docs), and the config-eval guard (§4.B) enforces the actual presence at build time. Together they close the F-7 detection gap.

Register the gate in the strict-grep runner manifest the same way sibling gates are registered.

---

## 5. Success criteria (per-surface where parity is manual)

- **SC-1-iOS / SC-1-Android:** On a freshly-built `preview` (or `development` with key provisioned) business build, opening the cover picker and tapping the GIF tab shows GIPHY trending thumbnails (NOT "This source is taking a break.").
- **SC-2-iOS / SC-2-Android:** Typing ≥2 chars in the GIF search field returns GIPHY search results.
- **SC-3:** A `preview`/`production` build attempted WITHOUT the GIPHY key in the matching EAS environment FAILS at config-eval with the explicit error message (proves the §4.B guard).
- **SC-4:** A `development` profile / local build WITHOUT the key still builds successfully (no hard crash) and the GIF tab shows the friendly copy (proves the dev asymmetry).
- **SC-5:** When the GIF path hits `not_configured`, a `console.warn("[coverPicker.provider] ...")` is emitted and (on a Sentry-configured build) a Sentry event is captured; when it hits `provider_unavailable`/`rate_limited`, NO telemetry is emitted (proves the CONFIG-vs-transient split).
- **SC-6:** `.env.example` documents `EXPO_PUBLIC_GIPHY_API_KEY`.
- **SC-7:** The strict-grep gate PASSES with the guard present and FAILS if the guard/`.env.example` entry is removed (proves the prevent gate is live).

---

## 6. Invariants

**Preserved:**
- **I-NO-SILENT-FAILURES** — the telemetry addition strengthens this; the friendly copy already shows, now the engineer is also alerted for CONFIG faults.
- The existing GIPHY fail-close guards (`coverProviderBrowseService.ts:103`, `giphyEventCoverService.ts:83`) are UNCHANGED — they are correct.
- The Stripe `pk_live` config-eval guard (`app.config.ts:135-180`) is the model and must remain untouched.

**New (proposed DRAFT — flip ACTIVE on CLOSE; orchestrator owns the flip):**
- **I-PROPOSED-GIPHY-KEY-FAIL-LOUD (DRAFT):** A release-bound business build (`production`/`production-apk`/`preview`/`preview-sim`) MUST fail at config-eval if `EXPO_PUBLIC_GIPHY_API_KEY` is absent. Verified by SC-3 + the strict-grep gate. Modeled on `feedback_mingla_business_pk_live_in_production`.
- **I-PROPOSED-GIPHY-KEY-WIRED (DRAFT):** `app.config.ts` carries the GIPHY fail-loud guard and `.env.example` documents the key. Verified by the strict-grep gate (§4.D) which FAILS on removal.
- **I-PROPOSED-CONFIG-ERROR-IS-OBSERVABLE (DRAFT, generalizable):** A provider `not_configured` error MUST emit engineering telemetry (not just user copy); transient provider errors MUST NOT. Verified by SC-5.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 (happy) | Key present, tab opened | preview build w/ GIPHY env | Trending GIFs render | runtime/build |
| T2 (happy) | Key present, search | "jazz" | Search results render | runtime |
| T3 (error) | Release build, key absent | `EAS_BUILD_PROFILE=preview`, no key | config-eval THROWS with explicit message | config-eval |
| T4 (edge) | Dev build, key absent | `EAS_BUILD_PROFILE=development`, no key | Build succeeds; GIF tab shows friendly copy | config-eval + runtime |
| T5 (detect) | not_configured at runtime | force null key in dev | `console.warn("[coverPicker.provider]")` fires; Sentry capture on configured build | code |
| T6 (detect-negative) | provider_unavailable | mock 503 from GIPHY | NO telemetry emit; user sees "Couldn't reach GIPHY." | code |
| T7 (gate) | strict-grep with guard present | repo HEAD | gate PASS | CI |
| T8 (gate fails-on-revert) | strict-grep with guard removed | guard deleted from app.config.ts | gate FAIL | CI |
| T9 (regression) | existing jest suites | unchanged | 7/7 still pass | code |

---

## 8. Implementation order

1. **`.env.example`** — add the documented `EXPO_PUBLIC_GIPHY_API_KEY=` entry (§4.A2).
2. **`app.config.ts`** — add the GIPHY config-eval fail-loud guard modeled on the Stripe guard (§4.B).
3. **Telemetry** — add the single `reportNonFatal` call at the GIF/Stock error-state derivation in `CoverPicker.tsx`, gated on `errorCode === "not_configured"` (§4.C).
4. **Strict-grep gate** — add `i-giphy-key-wired.mjs` + `.test.mjs`, register in the runner (§4.D).
5. **Tests** — extend `CoverPicker` test (or add a focused test) for T5/T6; the gate's own `.test.mjs` covers T7/T8.
6. **Operator (Seth, OUT of implementor scope — handoff item):** run the `eas env:create` commands (§4.A1) for development+preview, then a fresh dev/preview build to verify SC-1/SC-2.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** the config-eval guard (§4.B) makes a release-bound build IMPOSSIBLE without the key — the build fails loudly instead of shipping a broken GIF tab.
- **Fails-on-revert test:** the strict-grep gate `i-giphy-key-wired.mjs` MUST FAIL when the `app.config.ts` GIPHY guard or the `.env.example` entry is reverted, and PASS when restored (T7/T8). The `.test.mjs` companion asserts both directions.
- **Protective comment:** the §4.B guard carries a comment: `// ORCH-1116: fail the build (not the user) if the client-direct GIPHY key is missing on a release-bound profile. GIPHY cannot be edge-proxied (ToS); a missing key silently breaks the cover-picker GIF tab. Mirrors the EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY guard above.`

---

## 10. Open questions (need Seth's steering)

- **O-1 (key provenance):** Reuse the existing EAS `production` GIPHY public key for the `development`/`preview` environments, OR mint a separate dev key in the GIPHY dashboard (cleaner rate-limit isolation; the beta key is 100 req/hr per `coverProviderBrowseService.ts:20-21`)? Recommendation: reuse for speed now; mint a dev key later if rate limits bite.
- **O-2 (Sentry DSN for dev/preview):** Provision `EXPO_PUBLIC_SENTRY_DSN` for dev/preview EAS environments so the `not_configured` alert fires from those builds too (D-1)? Recommendation: yes — low cost, closes the detection loop where the bug actually manifests.
- **O-3 (alerting now vs defer):** Ship the `reportNonFatal` telemetry now (recommended — it's one line and reuses existing infra) vs. defer to console-only? Recommendation: ship now.
- **O-4 (business web export):** Does the Vercel/web business-app export need the GIPHY env at build time too (surface 7)? If web authoring is in use, add `EXPO_PUBLIC_GIPHY_API_KEY` to the web build env; otherwise defer.

---

## 11. Downstream routing

**Allowlist (implementor may edit ONLY these):**
- `mingla-business/.env.example`
- `mingla-business/app.config.ts` (GIPHY guard block only)
- `mingla-business/src/components/ui/CoverPicker.tsx` (single telemetry call-site only)
- `.github/scripts/strict-grep/i-giphy-key-wired.mjs` + `.test.mjs` + the runner manifest entry
- A focused test file for the telemetry split (T5/T6)

**DO-NOT-TOUCH:**
- `coverProviderBrowseService.ts` / `giphyEventCoverService.ts` network/guard logic (correct as-is).
- `eas.json` values (no key in version control).
- The Pexels edge path / `event-cover-pexels-curated`.
- The Stripe `pk_live` guard.
- Any consumer / admin / buyer-web file.
- The friendly UI copy / error-state component layout.

**Stop-and-amend** before touching anything outside the allowlist.

**Next handoff:** mingla-implementor (business side) executes §8 steps 1–5. Then mingla-tester verifies SC-1..SC-7 (with a fresh dev/preview build after Seth runs §8 step 6 / §4.A1). Then orchestrator REVIEW → CLOSE (flips the three DRAFT invariants ACTIVE). **Operator pre-req:** Seth provisions the EAS env vars (§4.A1) — without that, SC-1/SC-2 cannot pass even with perfect code.
