# QA — ORCH-1114 [public trip + experience Share button is a dead tap on web]

- **Mode:** TARGETED (tester) — brutal gatekeeper, runtime-proof required (Constitution #1).
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1114-[trip-share-link]/` · branch `ORCH-1114-trip-share-link`
- **Code commit under test:** `e8c45511d`
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1114_PUBLIC_TRIP_EXPERIENCE_SHARE.md`
- **Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1114_PUBLIC_TRIP_EXPERIENCE_SHARE.md`
- **Date:** 2026-06-11

---

## 1. Verdict

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 1 (pre-existing, not introduced) · P4: 2.

Runtime evidence is `proven`-level for the buyer-anon **Web** surface (real Chromium, `navigator.share` undefined, real exported RNW bundle, real ShareModal). Native iOS/Android parity is `suspected`-but-strong (share primitive byte-identical to origin/main; no web-only guard) — no device run, stated explicitly; it does not gate PASS because the only behavior that *changed* on native is "tap opens the same ShareModal event/brand already use," and the share dispatch path is unmodified.

Regression gate satisfied: implementor happy-path tests present + fails-on-revert independently reproduced; tester adversarial **runtime** spec added on-branch, in-diff, with its own fails-on-revert proven.

---

## 2. Success-criteria matrix

| SC | Criterion | Verdict | Evidence (runtime / live-fire) |
|----|-----------|---------|--------------------------------|
| SC-1-Web (trip) | `/t/` Share tap opens ShareModal (Copy link / Share via… / URL / QR), no dead tap | **PASS (proven)** | Playwright real Chromium: tap aria-"Share" → "Copy link" + "Share via…" + URL row + QR all visible. Screenshot `/tmp/orch1114-modal.png` shows the full sheet. Test 1 PASS. |
| SC-2-Web (trip copy) | Copy link → "Link copied" toast + URL copied | **PASS (proven)** | Test 2 PASS: "Link copied" toast visible; captured copied value = `https://business.usemingla.com/t/acme-co/bali-escape`. |
| SC-3-Web (trip native-share fallback) | Share via… (no `navigator.share`) → "Native share not supported on this browser." toast, no silent swallow | **PASS (proven)** | Test 3 PASS: `navigator.share` asserted undefined; tap → exact toast text. |
| SC-4-Web (experience) | Same as SC-1 for `/exp/` with `/exp/…` URL | **PASS (proven)** | Tests 4–6 PASS: modal opens; copied value = `https://business.usemingla.com/exp/acme-co/sunset-sail`; "not supported" toast fires. |
| SC-5-iOS (native parity) | Business iOS Share opens ShareModal; Share via… → OS sheet | **PASS (suspected — no device)** | `sharePublicUrl.ts` + `ShareModal.tsx` byte-identical to origin/main (`git diff --stat` empty); modal mount gated only on `typeof slug==="string"`, NO `Platform.OS==="web"` guard → native branch reachable. Not device-run; stated. |
| SC-6-Android (native parity) | Same via Android `sharePublicUrl` branch | **PASS (suspected — no device)** | Same as SC-5; Android branch (`Share.share({title,message})`) unmodified. |
| SC-7 (helper) | `experiencePublicUrl(...)` → canonical URL; throws `PublicUrlError` on empty; `tripPublicUrl` unchanged | **PASS (proven)** | jest T-1…T-5 PASS; AND the production URL `https://business.usemingla.com/exp/...` was rendered+copied at RUNTIME (not only unit-asserted). |
| SC-8 (no bare Share.share) | Neither route imports/calls RN `Share`; both reference `ShareModal` | **PASS (proven)** | `grep` finds zero `Share`/`Platform`/`Share.share` refs in both routes; runtime fails-on-revert: reverting to `Share.share` made all 3 `/t/` runtime tests FAIL (dead tap reproduced). |
| SC-9 (no silent catch) | No empty `catch {}` around share path | **PASS (proven)** | Empty-catch deleted from both routes (diff); the only share error handling is ShareModal's toast (SC-3 proves it surfaces). |

---

## 3. Findings

### P3-1 — pre-existing unused `glass` import in the trip route (NOT introduced)
- **Evidence:** `app/t/[brandSlug]/[tripSlug].tsx:33` imports `glass`; present on `origin/main` (`git show origin/main:… | grep glass` → line 33). Implementor flagged it in report §10.
- **Impact:** none functional; a lint nit that predates ORCH-1114.
- **Required fix:** none in this ORCH (out of allowlist scope). Orchestrator may sweep separately.
- **Retest:** n/a.

### P4-1 — clean, spec-faithful pattern reuse (praise)
Both routes reuse the already-shipped `ShareModal`/`sharePublicUrl`/`tripPublicUrl` primitives verbatim; the new `experiencePublicUrl` mirrors `tripPublicUrl` exactly (shared `requireSegment` guard, `BUSINESS_PUBLIC_ORIGIN`). No new share UI, no duplicated logic (Constitution #8). DO-NOT-TOUCH files byte-identical.

### P4-2 — protective comments prevent silent regression
The one-line `handleShare` comment in both routes explicitly forbids reverting to the bare RN share API and cites the SPEC; the route-guard tests assert `.not.toMatch(/Share\.share/)` over the whole file (so even a comment containing `Share.share` would fail) — a durable guard.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Reproduced on commit `e8c45511d` (the worktree HEAD code commit), file-level true reverts (not comment-out), then `git checkout`-restore:

1. **Trip route → `origin/main` (`Share.share` dead-tap):** ran `jest public-trip-page.test.ts publicUrls.test.ts` →
   `FAIL app/t/__tests__/public-trip-page.test.ts ● A-PUBLIC-9: trip share routes through ShareModal, not bare Share.share` (1 failed, 14 passed). Matches implementor claim.
2. **`experiencePublicUrl` helper → hand-rolled concat (drop `requireSegment`):** ran `jest publicUrls.test.ts` →
   `FAIL … ✕ T-3: experience helper encodes path segments` AND `✕ T-4/T-5: experience helper rejects empty/whitespace segments (fails-on-revert)` (2 failed, 4 passed). Matches (and is stronger than) the implementor claim.
3. **Restored both** (`cp` from pre-revert backups) → all 23 implementor tests PASS again; `git status` clean (byte-identical to commit).

Implementor's fails-on-revert is independently verified at `e8c45511d`.

---

## 5. Adversarial test added (tester-owned, DIFFERENT ANGLE)

- **Path:** `mingla-business/playwright/orch-1114-share-modal-runtime.spec.ts` (NEW, append-only) + dedicated `mingla-business/playwright.orch1114.config.ts`.
- **Angle vs implementor:** the implementor's tests are **static source-grep guards** (`readFileSync` + `toMatch`) — which cap at "suspected" for a dead-tap (Constitution #1). This spec is a **behavioral RUNTIME** gate: it builds the real Expo Web export, serves it, and drives **real Chromium** (where `navigator.share` is genuinely undefined — the exact original dead-tap condition), navigates the REAL public route component, taps the REAL Share IconChrome, and asserts the REAL ShareModal mounts + the REAL copy/share-via toasts fire. It attacks the failure mode the source guards cannot: "wired in source but dead at runtime."
- **Result:** 6/6 PASS (3 trip + 3 experience): modal opens on tap; "Link copied" toast + exact production URL captured; "Native share not supported on this browser." toast on `navigator.share`-undefined. Console-clean, deterministic (10.9s).
- **Fidelity:** HIGH. Real headless Chromium, real exported `react-native-web` JS bundle, real `ShareModal` + `sharePublicUrl` + `copyPublicUrl`, real `Toast`. The route is driven to its render body by route-mocking the public-trip/experience Supabase REST chain (the test Supabase project is a stub) + seeding a localStorage session to clear the route-agnostic ORCH-1102 auth gate; clipboard `writeText` is stubbed in-page because headless Chromium has no OS clipboard. Everything in the share UI under test is real and unmodified.
- **fails-on-revert verified at `e8c45511d`:** with the trip route reverted to `origin/main`'s `Share.share` and the web bundle re-exported, all 3 `/t/` runtime tests FAILED ("Copy link"/"Share via…" never appear — a genuine dead tap), while the 3 `/exp/` tests still PASSED (proving the spec is specific, not flaky). Restored → 6/6 PASS.
- **In closing diff:** YES — `git diff --name-only origin/main...HEAD` will include the spec + config after commit. Implementor's happy-path tests are already in-diff (publicUrls.test.ts, public-trip-page.test.ts, public-experience-page.test.ts).

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | **PASS** | The whole fix. Runtime-proven: Share tap opens ShareModal on real web (6/6); fails-on-revert reproduces the dead tap. |
| 2 | One owner per truth | PASS | Share URL owned by `tripPublicUrl`/`experiencePublicUrl` (single helper file). |
| 3 | No silent failures | **PASS** | Empty `catch {}` removed; ShareModal toasts on copy-fail and share-unsupported (SC-3 runtime-proven). |
| 4 | One query key per entity | N/A | No query keys touched. |
| 5 | Server state server-side | N/A | No Zustand/server-state change. |
| 6 | Logout clears everything | N/A | No auth/session writes. |
| 7 | `[TRANSITIONAL]` labeled | N/A | None added. |
| 8 | Subtract before adding | PASS | Reuses ShareModal; deletes the inline Share.share + catch; no duplicated share UI. |
| 9 | No fabricated data | PASS | URL built from real slugs via guarded helper; no faked values. |
| 10 | Currency-aware | N/A | No money surface. |
| 11 | One auth instance | PASS | Routes remain anon-tolerant; no `useAuth` added (anon-tolerance preserved). |
| 12 | Validate at the right time | N/A | No datetime validation. |
| 13 | Exclusion consistency | N/A | No list/exclusion logic. |
| 14 | Persisted-state startup | N/A | No persisted-state gate. |

No violations.

---

## 7. Device / parity matrix

| Surface | Verdict | Evidence |
|---------|---------|----------|
| Consumer iOS | N/A (skip) | Routes do not exist in `app-mobile/`. |
| Consumer Android | N/A (skip) | Same. |
| **Buyer/anon Web** (primary) | **PASS (proven)** | 6/6 Playwright real-Chromium runtime tests; screenshots `/tmp/orch1114-modal.png` (modal open), `/tmp/orch1114-trip4.png` (route renders w/ Share icon). |
| Business iOS (native) | PASS (suspected) | Share primitive byte-identical to origin/main; no web-only guard. No device run (stated). |
| Business Android (native) | PASS (suspected) | Same. |
| Admin Web (adjacent) | N/A (skip) | No such routes. |
| Business Web preview (adjacent) | N/A (skip) | Public buyer routes, not in-app preview. |

**Physical iPhone HITL:** not requested for this turn; native parity is preserved-by-construction (unmodified shared primitive). If Seth wants device confirmation of the OS share sheet on business iOS/Android before CLOSE, that is the only `suspected`→`proven` upgrade available; it does not gate PASS because the native share dispatch is unchanged.

**Edge-function live deploy state:** N/A — frontend-only ORCH, no edge functions, no migration.

---

## 8. Discoveries for Orchestrator (not fixed here)

- **D-1 (process/infra, MEDIUM):** the static Expo Web export (`expo export -p web`) runs the app in **SPA mode** and the **route-agnostic ORCH-1102 auth gate redirects EVERY no-user web route to `/` (sign-in)** after the 7s ceiling — including the buyer-anon public routes `/t/`, `/exp/`, `/e/`, `/b/`. To render a public route in a local export I had to seed a localStorage session under BOTH `sb-orch1114-auth-token` (runtime ref) AND the **hardcoded** `sb-gqnoajqerqhnvulmnyvv-auth-token` (production ref in `AuthContext.WEB_AUTH_STORAGE_KEY`). This raises a question worth an orchestrator note: how do genuinely-anonymous buyers reach `/t/`,`/e/`,`/b/`,`/exp/` on `business.usemingla.com` in production? Either the Vercel deploy serves these routes via SSG (bypassing the SPA gate) or the gate would bounce real anon buyers. NOT investigated here (out of ORCH-1114 scope) — flag for forensics if buyer-funnel anon access is unverified. The ORCH-1114 fix itself is correct regardless; this is about the surrounding harness/funnel.
- **D-2 (test-infra, LOW):** the exported bundle bakes `MINGLA_BUSINESS_WEB_URL` from `app.config.ts`'s `extra` default (production origin), ignoring the `expo export` env override — so the ShareModal renders the real `https://business.usemingla.com/...` URL at runtime (a positive: SC-7's production output is runtime-proven, not just unit-asserted).

---

## 9. Routing

**PASS → CLOSE (orchestrator).** Flip `I-PROPOSED-PUBLIC-SHARE-VIA-SHAREMODAL` DRAFT → ACTIVE. OTA per `feedback_eas_ota_publish_per_platform.md` (pure-JS business-app + buyer-web; per-platform `eas update --platform ios` then `--platform android`; no native rebuild). Optional pre-CLOSE upgrade: a single business iOS/Android device tap to lift SC-5/SC-6 from `suspected`→`proven` (the OS share sheet) — not required for PASS.

---

*Artifact: `Mingla_Artifacts/reports/QA_ORCH-1114_PUBLIC_TRIP_EXPERIENCE_SHARE.md`*
