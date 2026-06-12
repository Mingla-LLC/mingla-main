# INVESTIGATE — ORCH-1114 [public trip page Share button does not share the link]

- **Mode:** INVESTIGATE (forensics)
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1114-[trip-share-link]/` · branch `ORCH-1114-trip-share-link` (rebased on origin/main; anchor at `a7cc767e3`)
- **Date:** 2026-06-11
- **Confidence:** ROOT CAUSE PROVEN (runtime-grade — proven against the installed react-native-web `Share` source, the exact code executed in the browser). No live browser session required because the executed module is read verbatim and is deterministic.

---

## Symptom summary (expected vs actual)

On the PUBLIC trip page (`/t/{brandSlug}/{tripSlug}`, served as Expo Web at `business.usemingla.com`), tapping the Share icon (top-right IconChrome) does nothing observable — no share sheet, no copy-link, no toast, no feedback.

- **Expected:** tapping Share offers the buyer a way to share the page link (native share sheet where supported; otherwise a usable fallback such as copy-link).
- **Actual:** dead tap. On a desktop browser the share promise rejects and the empty `catch {}` swallows it silently. On a mobile browser with the Web Share API it may pop the OS sheet, but there is no fallback and no copy path, so the control is unreliable and frequently a no-op.

---

## Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | Code (route) | Primary suspect — `handleShare` + `Share.share` + empty `catch {}` |
| 2 | `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` | Code (route) | Cluster check — public event page |
| 3 | `mingla-business/src/components/event/PublicEventPage.tsx` | Code (component) | Where event-page share actually lives |
| 4 | `mingla-business/src/components/ui/ShareModal.tsx` | Code (kit) | The web-aware share primitive used by event/brand |
| 5 | `mingla-business/src/utils/sharePublicUrl.ts` | Code (util) | The web-aware share/copy implementation |
| 6 | `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` | Code (route) | Cluster check — public experience page |
| 7 | `mingla-business/app/b/[brandSlug]/index.tsx` + `src/components/brand/PublicBrandPage.tsx` | Code (route+component) | Cluster check — public brand page |
| 8 | `node_modules/react-native-web/dist/exports/Share/index.js` | **Runtime** | The exact `Share.share` code executed in the browser |
| 9 | `mingla-business/src/constants/publicUrls.ts` | Code (helper) | Canonical public-URL helper (`tripPublicUrl`) |
| 10 | `app.json` (web.output) | Config | Confirms `/t/` is served as web (`output: "single"`) |
| 11 | `app/(tabs)/hub/trips.tsx`, `hub/experiences.tsx` | Code | Authenticated share path (uses ShareModal — correct) |
| 12 | `mingla-business/app/t/__tests__/public-trip-page.test.ts` | Test | What the existing test asserts about share (nothing) |

---

## Q-scorecard

**Q1 — Is the public trip page Share button a dead tap, and why?**
Verdict: YES — PROVEN. `handleShare` calls react-native-web `Share.share`, which rejects when `window.navigator.share` is undefined; the route's empty `catch {}` swallows the rejection with no fallback. (F-1, F-2)

**Q2 — Does the bug affect native business iOS/Android, or only web?**
Verdict: WEB-SPECIFIC for the dead-tap. On native iOS/Android `Share.share` is the real OS share sheet and works. But the public `/t/` route's primary real-world traffic is WEB (buyer arrives via share link in a browser). (F-3)

**Q3 — Do the sibling public pages (event `/e/`, brand `/b/`) share this defect?**
Verdict: NO — REFUTED for event + brand. Both route share to `ShareModal` → `sharePublicUrl`, which is web-aware (uses `navigator.share` when present, and ALWAYS offers copy-link / QR / platform deep-links as fallback). (F-4)

**Q4 — Is there a sibling that DOES share the defect (true causal cluster)?**
Verdict: YES — the public EXPERIENCE page `/exp/{brandSlug}/{experienceSlug}` has the IDENTICAL inline `Share.share` + empty `catch {}` bug. It was authored as a copy of the trip page. (F-5)

**Q5 — Is the share URL constructed correctly, and is there a canonical helper to reuse?**
Verdict: URL value is correct (`https://business.usemingla.com/t/{brandSlug}/{tripSlug}`) but it is HARDCODED. A canonical helper `tripPublicUrl({brandSlug, tripSlug})` already exists in `src/constants/publicUrls.ts` and should be reused. (F-6)

**Q6 — What does the existing test assert about share?**
Verdict: NOTHING. `public-trip-page.test.ts` covers anon-tolerance, mounting, and state handling only. The share control is entirely untested. (F-7)

---

## Findings (six-field evidence)

### F-1 — `Share.share` on react-native-web rejects when `navigator.share` is absent — CONFIRMED ROOT CAUSE
1. **Symptom:** Tapping Share on the public trip page in a browser does nothing.
2. **Layer:** Runtime (the executed react-native-web module).
3. **Probe:** `cat mingla-business/node_modules/react-native-web/dist/exports/Share/index.js`
4. **Evidence (verbatim):**
```js
class Share {
  static share(content, options) {
    ...
    if (window.navigator.share !== undefined) {
      return window.navigator.share({ title: content.title, text: content.message, url: content.url });
    } else {
      return Promise.reject(new Error('Share is not supported in this browser'));
    }
  }
}
```
5. **Mechanism:** On web, `Share.share` is NOT the native OS sheet. When `window.navigator.share` is `undefined` (all desktop Chrome/Firefox, Safari macOS in most configs, and any browser without the Web Share API) it returns a REJECTED promise. The trip page is served as web (`app.json` → `web.output: "single"`), so this is the code that actually runs for buyers.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — Empty `catch {}` swallows the rejection with NO fallback — CONFIRMED ROOT CAUSE
1. **Symptom:** No share sheet, no error, no copy-link, no toast — a pure dead tap.
2. **Layer:** Code (route).
3. **Probe:** Read `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` lines 81-95.
4. **Evidence (verbatim):**
```js
const handleShare = useCallback(async (): Promise<void> => {
  if (typeof brandSlug !== "string" || typeof tripSlug !== "string") return;
  const url = `https://business.usemingla.com/t/${brandSlug}/${tripSlug}`;
  const title = query.data?.trip.title ?? "Mingla trip";
  try {
    await Share.share(
      Platform.OS === "ios"
        ? { url, message: title }
        : { message: `${title} ${url}`, title },
    );
  } catch {
    // Native Share rejection (user cancels) is non-actionable;
    // do not surface a toast. Constitution #3 exempts user-cancelled flows.
  }
}, [brandSlug, tripSlug, query.data?.trip.title]);
```
5. **Mechanism:** The branch is `Platform.OS === "ios"` vs else — there is NO `Platform.OS === "web"` branch. On web, `Share.share` rejects (F-1), control falls into the empty `catch {}`, which assumes the only rejection cause is "user cancelled native sheet." On web the rejection means "share is impossible," yet the code provides no copy-link or toast fallback → the user sees nothing. The protective comment is WRONG for the web surface (it reasons only about native user-cancel).
6. **Severity:** CONFIRMED ROOT CAUSE (F-1 + F-2 together are the complete cause).

### F-3 — Native iOS/Android business app: share WORKS; web is the broken surface — RULED OUT (native) / CONFIRMED (web)
1. **Symptom:** N/A on native; dead tap on web.
2. **Layer:** Runtime (platform branch).
3. **Probe:** Read the `Platform.OS === "ios"` branch + RN native Share semantics.
4. **Evidence:** On native, `Share` resolves to React Native's native module — `Share.share` opens the real OS share sheet. The iOS branch passes `{ url, message }`; the else (Android-native) branch passes `{ message, title }`. Both are valid native payloads.
5. **Mechanism:** The bug is exclusively a web-platform-branch omission. Native iOS/Android share works. But the public `/t/` route's real audience is browsers reached via a share link, so the broken surface is the one that matters most.
6. **Severity:** RULED OUT for native; the web surface is the CONFIRMED defect.

### F-4 — Event + Brand public pages do NOT have this bug (use web-aware ShareModal) — RULED OUT
1. **Symptom:** Event/brand share works on web.
2. **Layer:** Code.
3. **Probe:** Grep `Share.share|ShareModal|onShare` across event/brand components.
4. **Evidence:** `PublicEventPage.tsx:264` → `handleShare = () => setShareModalVisible(true)`; `PublicBrandPage.tsx:315` → `onShare: () => setShareModalVisible(true)` + `<ShareModal …>`. `ShareModal` → `sharePublicUrl` (`src/utils/sharePublicUrl.ts`), which has an explicit `Platform.OS === "web"` branch using `navigator.share` AND always offers **copy-link** (`copyPublicUrl` → `navigator.clipboard.writeText`), a **QR code**, and **platform deep-links** as fallbacks, with toasts (`"Native share not supported on this browser."`).
5. **Mechanism:** Event + brand pages were built on the correct ShareModal primitive; the trip + experience pages were built with a one-off inline `Share.share` that bypasses it.
6. **Severity:** RULED OUT (event/brand are correct — they are the reference fix shape).

### F-5 — Public EXPERIENCE page `/exp/` has the IDENTICAL bug — SECONDARY ROOT CAUSE (causal cluster)
1. **Symptom:** Share on the public experience page is the same dead tap on web.
2. **Layer:** Code (route).
3. **Probe:** Read `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` lines 79-94.
4. **Evidence (verbatim):**
```js
const handleShare = useCallback(async (): Promise<void> => {
  ...
  const url = `https://business.usemingla.com/exp/${brandSlug}/${experienceSlug}`;
  const title = query.data?.experience.title ?? "Mingla experience";
  try {
    await Share.share(
      Platform.OS === "ios" ? { url, message: title } : { message: `${title} ${url}`, title },
    );
  } catch {
    // User-cancelled native Share is non-actionable; Constitution #3 exempts.
  }
}, [brandSlug, experienceSlug, query.data?.experience.title]);
```
File header confirms: "Mirrors /t/[brandSlug]/[tripSlug] exactly." It inherited the exact defect.
5. **Mechanism:** Same as F-1+F-2 — no web branch, empty `catch {}`, no fallback.
6. **Severity:** SECONDARY ROOT CAUSE — same defect, must be fixed in the same pass to fix the cluster not the symptom.

### F-6 — Share URL is hardcoded; canonical `tripPublicUrl` helper exists and should be reused — SUSPECTED CONTRIBUTOR (maintenance)
1. **Symptom:** URL string duplicated across files (drift risk if the domain ever changes).
2. **Layer:** Code.
3. **Probe:** Read `src/constants/publicUrls.ts`.
4. **Evidence:** `export const tripPublicUrl = (input: { brandSlug; tripSlug }) => \`${BUSINESS_PUBLIC_ORIGIN}${tripPublicPath(input)}\`` already exists (also `eventPublicUrl`, `brandPublicUrl`, `checkoutPublicUrl`). The trip page instead hardcodes `https://business.usemingla.com/t/${brandSlug}/${tripSlug}`. There is NO `experiencePublicUrl` helper yet (the `/exp/` page hardcodes too). Note: the authenticated Hub share paths (`hub/trips.tsx:324`, `hub/experiences.tsx:353`) ALSO hardcode the same strings but route through `<ShareModal>`, so they WORK on web despite the hardcoded URL.
5. **Mechanism:** The URL VALUE is correct today, so this is not the cause of the dead tap — but the fix should reuse `tripPublicUrl` (and add `experiencePublicUrl`) so the corrected share path stays in sync with the canonical origin.
6. **Severity:** SUSPECTED CONTRIBUTOR (maintenance / correctness hygiene, not the live cause).

### F-7 — No test covers the share control — SUSPECTED CONTRIBUTOR (regression gap)
1. **Symptom:** The dead tap shipped and persisted because nothing guards share behavior.
2. **Layer:** Test.
3. **Probe:** Read `mingla-business/app/t/__tests__/public-trip-page.test.ts`.
4. **Evidence:** The 8 tests (`A-PUBLIC-1..8`) assert anon-tolerance (no `useAuth`), no sign-in redirect, mounting of `TripPreview`/`TripCheckoutFlow`, hook usage, and state handling. ZERO assertions about `handleShare`, `Share`, `ShareModal`, web fallback, or copy-link.
5. **Mechanism:** No fails-on-revert guard exists for the web share path, so the regression was invisible to CI.
6. **Severity:** SUSPECTED CONTRIBUTOR — the SPEC must add a fails-on-revert test asserting the corrected share path (web-aware) on both trip and experience pages.

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| **Docs** | File header (line 80) claims "share → native share sheet with the public trip URL." JSDoc assumes native. | YES — doc assumes native; the page is served as WEB where the native sheet does not exist. The doc never accounts for the web surface. |
| **Schema** | N/A — no DB/RLS involved (frontend-only). | — |
| **Code** | `handleShare` branches `ios` vs else only; empty `catch {}`; bypasses the web-aware `ShareModal`/`sharePublicUrl`. | YES — code diverges from the sibling event/brand convention (ShareModal). |
| **Runtime** | Installed react-native-web `Share.share` rejects when `navigator.share` is undefined (verbatim source). | This is the truth-holding layer: the web rejection + empty catch = dead tap. |
| **Data** | N/A. | — |

The gap between the **Docs/Code** assumption ("native share works") and the **Runtime** reality ("web rejects, no fallback") IS the bug.

---

## Repro evidence

- **Runtime-grade proof without a live session:** the executed module `react-native-web/dist/exports/Share/index.js` is read verbatim (F-1). Its behavior is deterministic: `navigator.share === undefined` → rejected promise → empty `catch {}` (F-2) → no UI. This is the exact code path the browser runs.
- **Web surface confirmed:** `app.json` → `web.output: "single"` confirms `/t/` and `/exp/` are served as Expo Web at `business.usemingla.com`.
- **No iOS simulator run performed:** the defect is a web-platform-branch omission proven from the executed web bundle's source, not a native gesture/animation/keyboard bug; the live-fire directive's exemption for "the executed code path is read verbatim and deterministic" applies. If SPEC/TEST wants belt-and-suspenders, a browser repro on a desktop Chrome session (`navigator.share === undefined`) will show the dead tap; a mobile-Chrome session may pop the OS sheet (illustrating the inconsistency), and neither offers any copy-link fallback.

---

## Blast radius / cross-surface map

| Surface | Affected? | Behavior |
|---------|-----------|----------|
| Buyer/anon Web — `/t/{brandSlug}/{tripSlug}` | **BROKEN (in scope)** | Dead tap on desktop browsers; unreliable on mobile; no fallback. |
| Buyer/anon Web — `/exp/{brandSlug}/{experienceSlug}` | **BROKEN (in scope — cluster)** | Identical dead-tap defect (F-5). |
| Buyer/anon Web — `/e/{brandSlug}/{eventSlug}` | Working | Uses ShareModal (web-aware). Out of scope. |
| Buyer/anon Web — `/b/{brandSlug}` | Working | Uses ShareModal (web-aware). Out of scope. |
| Business iOS/Android (native, public routes) | Working | Native `Share.share` opens the OS sheet. |
| Business app authenticated Hub share (`hub/trips.tsx`, `hub/experiences.tsx`) | Working | Already route through `<ShareModal>`. Out of scope. |
| Consumer app (`app-mobile/`) | N/A | These routes do not exist there. |
| Admin web (`mingla-admin/`) | N/A | — |

**In-scope surfaces to fix:** public trip page `/t/` and public experience page `/exp/`. **Out-of-scope:** event, brand, Hub, and native-only behavior (already correct).

---

## Invariant impact

- No existing `INVARIANT_REGISTRY.md` entry is violated by the defect itself.
- **Constitution #1 (dead-tap / interactive-elements-must-fire):** the Share control claims to share but does nothing at runtime on web — a textbook dead tap. Memory rule `feedback_interactive_elements_must_fire_runtime_proof.md` applies; the fix must be proven to FIRE at runtime on web.
- The protective comment in `handleShare` ("Constitution #3 exempts user-cancelled flows") is MISAPPLIED on web: the rejection there is "share impossible," not "user cancelled."
- SPEC should consider proposing `I-PROPOSED-PUBLIC-SHARE-VIA-SHAREMODAL` (DRAFT): all buyer-anon public detail pages share via the web-aware `ShareModal`/`sharePublicUrl` primitive, never a bare inline `Share.share` with a swallow-only catch.

## Discoveries for Orchestrator

- **D-1 (cluster):** `/exp/` carries the identical bug (F-5) — fix in the same ORCH.
- **D-2 (helper gap):** No `experiencePublicUrl` helper exists in `publicUrls.ts`; adding one alongside reusing `tripPublicUrl` keeps both fixed pages on the canonical origin (F-6).
- **D-3 (hardcoded-but-working):** Authenticated Hub share paths hardcode the same URL strings but work (they use ShareModal). Not a bug; flagged for the helper-consolidation note only.
- **D-4 (test gap):** No share test exists on the trip page; SPEC must add a fails-on-revert guard for both pages (F-7).
- **No COMMS-ledger BLOCK/WARN entry targets this ORCH or forensics.** COMMS-0002 (backend allowlist) and COMMS-0018 (deploy-from-merged-main) are N/A — this is frontend-only, no edge deploy, no migration. COMMS-0003 (external-API docs) is N/A — no external provider integration.

---

## Confidence

**ROOT CAUSE PROVEN.** F-1 (verbatim executed react-native-web `Share` source) + F-2 (empty `catch {}`, no web branch, no fallback) fully explain the dead tap with runtime-grade evidence. The cluster (F-5) is proven by verbatim source. The fix shape is established by the working sibling reference (F-4).

## Recommended next phase + scope (direction only — NOT a fix)

- **Next phase:** SPEC (forensics SPEC mode) → then implementor.
- **Recommended scope (direction, not a contract):** make the public trip page AND the public experience page share via the existing web-aware path used by event/brand — i.e. the `ShareModal`/`sharePublicUrl` primitive (which already has the web `navigator.share` branch plus copy-link/QR/platform-deep-link fallbacks and toasts) — instead of the bare inline `Share.share` + empty `catch {}`. Reuse the canonical `tripPublicUrl` helper (and add an `experiencePublicUrl` helper) so the share URL stays on `BUSINESS_PUBLIC_ORIGIN`. Add a fails-on-revert test on both pages asserting the share control routes through the web-aware primitive (not bare `Share.share`). Keep scope to the two broken public pages; do not touch event/brand/Hub/native.

---

*Artifact: `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1114_PUBLIC_TRIP_SHARE.md`*
