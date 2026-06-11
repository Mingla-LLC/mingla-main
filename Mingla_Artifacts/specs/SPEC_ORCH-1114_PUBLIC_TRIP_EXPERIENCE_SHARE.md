# SPEC — ORCH-1114 [public trip + experience page Share button does not share the link]

- **Mode:** SPEC (forensics) — binding build contract. No code; illustrative fragments ≤3 lines only.
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1114-[trip-share-link]/` · branch `ORCH-1114-trip-share-link`
- **Date:** 2026-06-11
- **Source investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1114_PUBLIC_TRIP_SHARE.md` (ROOT CAUSE PROVEN)
- **Confidence carried in:** ROOT CAUSE PROVEN (F-1 + F-2 fully explain the dead tap; F-5 is the proven cluster sibling).

---

## 1. Executive summary

On the public buyer-anon **trip** page (`/t/{brandSlug}/{tripSlug}`) and the public **experience** page (`/exp/{brandSlug}/{experienceSlug}`) — both served as Expo Web at `business.usemingla.com` — tapping the top-right Share icon does nothing on a desktop browser. The pages call React-Native `Share.share`, which on `react-native-web` returns a **rejected promise** whenever `navigator.share` is undefined (all desktop browsers and most macOS Safari configs). The route's empty `catch {}` swallows that rejection with no fallback, so the buyer gets a dead tap: no share sheet, no copy-link, no toast.

The sibling public **event** (`/e/`) and **brand** (`/b/`) pages already solved this: they open the web-aware `ShareModal` (`src/components/ui/ShareModal.tsx`), which uses `navigator.share` when present AND always offers copy-link, a QR code, and platform deep-links with success/failure toasts — working in any browser. This ORCH replicates that exact, already-shipped pattern on the two broken pages. No new share UI is built; the existing primitive is reused.

The fix:
1. Replace the inline `handleShare`/`Share.share`/empty-`catch` on both pages with `ShareModal` state (`shareModalVisible`) + a `<ShareModal>` mount, exactly as `PublicEventPage.tsx` wires it.
2. Reuse the canonical `tripPublicUrl` helper for the trip page; add a net-new `experiencePublicUrl` (+ `experiencePublicPath`) helper to `publicUrls.ts` for the experience page (no such helper exists today — confirmed below).
3. Add fails-on-revert regression tests asserting the share control routes through `ShareModal`, not bare `Share.share`.

---

## 2. Scope & non-goals

### In scope (exactly two pages + one helper + tests)
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` — swap inline `Share.share` for `ShareModal`.
- `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` — same swap.
- `mingla-business/src/constants/publicUrls.ts` — add `experiencePublicPath` + `experiencePublicUrl` (mirror `tripPublicPath`/`tripPublicUrl`). Reuse existing `tripPublicUrl`.
- `mingla-business/src/constants/__tests__/publicUrls.test.ts` — add canonical + empty-segment-rejection assertions for trip + experience builders.
- New tests guarding the two route source files route through `ShareModal` (locations in §7/§9).

### Non-goals (do NOT touch — HARD)
- Event page (`/e/`), brand page (`/b/`), `PublicEventPage.tsx`, `PublicBrandPage.tsx` — already correct; reference only.
- The `ShareModal` component itself, `sharePublicUrl.ts`, `shareIntents.ts`, `copyPublicUrl` — reused verbatim, NOT modified.
- Authenticated Hub share paths (`app/(tabs)/hub/trips.tsx`, `hub/experiences.tsx`) — already route through `ShareModal` and work; out of scope (they hardcode URLs but are NOT broken — D-3).
- Native iOS/Android share behavior — already works via `ShareModal`'s internal `sharePublicUrl` native branch; must NOT regress (see §3).
- No new share UI, no design change, no new share surface, no DB/edge/RLS/migration work (frontend-only).
- The `IconChrome` share-button placement, `accessibilityLabel="Share"`, size, overlay positioning, and the X-close button — UNCHANGED. Only the `onPress` target changes.

### Assumptions (verified against source)
- `tripPublicUrl({ brandSlug, tripSlug })` EXISTS in `publicUrls.ts` (line 80) → reuse it.
- `experiencePublicUrl` / `experiencePublicPath` DO **NOT** exist (grep confirmed: `publicUrls.ts` has only `eventPublicUrl`, `brandPublicUrl`, `checkoutPublicUrl`, `tripCheckoutUrl`, `tripPublicUrl`, OG-image helpers) → must be ADDED.
- The public experience route path segment is `/exp/{brandSlug}/{experienceSlug}` (the route file is `app/exp/[brandSlug]/[experienceSlug].tsx`; existing hardcoded URL used `/exp/`).
- `ShareModal` props are `{ visible, onClose, url, title, description? }` (verified). `description` is optional.
- Trip exposes `payload.trip.title` (string) + `payload.trip.description` (string, may be empty). Experience exposes `payload.experience.title` (string) + `payload.experience.description` (string | null).

---

## 3. Cross-Surface Impact Declaration (MANDATORY per-surface table)

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NOT covered | n/a — these routes do not exist in the consumer app | none | — |
| 2 | Consumer Android (`app-mobile/`) | NOT covered | n/a — routes absent | none | — |
| 3 | **Buyer/anon Web** (`mingla-business/` `/t/…`, `/exp/…`) | **COVERED (primary)** | Tapping Share opens the `ShareModal` sheet: Copy link (→ "Link copied" toast), Share via… (→ `navigator.share` when present, else "Native share not supported on this browser." toast), QR, platform deep-links, tappable URL row. NO dead tap, NO silent failure. | `app/t/[brandSlug]/[tripSlug].tsx`, `app/exp/[brandSlug]/[experienceSlug].tsx`, `src/constants/publicUrls.ts` | Automatic (shared `ShareModal`) |
| 4 | **Business iOS** (native) | COVERED (parity-preserve) | Tapping Share opens the same `ShareModal`; "Share via…" routes through `sharePublicUrl`'s native iOS branch → real OS share sheet. Copy link uses `expo-clipboard`. Must match event/brand native behavior. | same two route files | Automatic (shared `ShareModal`) |
| 5 | **Business Android** (native) | COVERED (parity-preserve) | Same `ShareModal`; "Share via…" → `sharePublicUrl` Android branch (RN `Share.share` with message). | same two route files | Automatic (shared `ShareModal`) |
| 6 | Admin Web (`mingla-admin/`) | NOT covered | n/a — no such routes | none | — |
| 7 | Business Web preview (adjacent) | NOT covered | n/a — public buyer routes, not the in-app preview surface | none | — |

**Native parity note (Constitution / non-regression):** today the inline `Share.share` already works on native iOS/Android (F-3). After the swap, native share runs through `ShareModal` → `sharePublicUrl`, whose native branches (`Platform.OS === "android"` and the iOS/else branch) call RN `Share.share` with the correct `{ title, message, url }` payload — this is the SAME primitive event/brand pages already use on native. Parity is therefore preserved by construction, NOT regressed. The implementor MUST NOT add a web-only guard that would suppress the modal on native.

---

## 4. Layered specification

Frontend-only. No Database / Edge / Service / Hook / Realtime layers are touched. Two layers apply: **Constant/helper** and **Component (route)**.

### 4.1 Constant/helper layer — `src/constants/publicUrls.ts`

Add two exports, mirroring the existing `tripPublicPath` / `tripPublicUrl` pair (lines 70–83) exactly in shape, ordering, and the `requireSegment(...)` guard:

- `experiencePublicPath(input: { brandSlug: string; experienceSlug: string }): string`
  → returns `/exp/${requireSegment(input.brandSlug,"brandSlug")}/${requireSegment(input.experienceSlug,"experienceSlug")}`.
- `experiencePublicUrl(input: { brandSlug: string; experienceSlug: string }): string`
  → returns `${BUSINESS_PUBLIC_ORIGIN}${experiencePublicPath(input)}`.

Contract requirements (inherited from the sibling helpers — do NOT deviate):
- Use the shared `requireSegment` (which `encodeURIComponent`s and throws `PublicUrlError` on empty/whitespace segments). Do NOT hand-roll encoding.
- Place the two new exports adjacent to the trip helpers (after line 83), with a one-line comment referencing ORCH-1114 and "mirror of tripPublicPath/tripPublicUrl".
- Do NOT modify `tripPublicPath`/`tripPublicUrl` or any other export.

### 4.2 Component layer — `app/t/[brandSlug]/[tripSlug].tsx`

**Imports**
- ADD `useState` to the `react` import (currently only `useCallback`).
- ADD `import { ShareModal } from "../../../src/components/ui/ShareModal";`
- ADD `import { tripPublicUrl } from "../../../src/constants/publicUrls";` (reuse).
- REMOVE `Share` from the `react-native` import list.
- REMOVE `Platform` from the `react-native` import **only if** it becomes unused after the swap (verify; if still referenced elsewhere keep it — current file uses `Platform` only inside `handleShare`, so it should be removed).

**State (modal visibility)**
- ADD `const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);` alongside the other top-of-component hooks (mirror `PublicEventPage.tsx:206`).

**Handler (replaces the inline `Share.share`)**
- REPLACE the entire `handleShare` `useCallback` (current lines 80–95, the `Share.share` + empty `catch {}` block, incl. its ORCH-0874 comment) with a 1-line opener:
  `const handleShare = useCallback((): void => { setShareModalVisible(true); }, []);`
  (mirror `PublicEventPage.tsx:263–265`; note: now synchronous `void`, NOT `async`.)
- The `IconChrome` share button's `onPress` MUST become `onPress={handleShare}` directly (remove the `() => { void handleShare(); }` async wrapper at lines 236–238, since `handleShare` is now synchronous). Everything else on that `IconChrome` (`icon="share"`, `size={36}`, `accessibilityLabel="Share"`) and its `shareOverlay` wrapper position is UNCHANGED.

**Modal mount**
- ADD `<ShareModal …>` as the LAST sibling inside the top-level `<View style={styles.host}>` return block (after the two overlay `<View>`s, before the closing `</View>`), mirroring `PublicEventPage.tsx:421–427`:
  - `visible={shareModalVisible}`
  - `onClose={() => setShareModalVisible(false)}`
  - `url={tripPublicUrl({ brandSlug, tripSlug })}` — at this point in the render both are confirmed strings (the early `payload` guards have returned for non-string/missing data; the render body only runs after the loading/error/not-found returns). The implementor MUST confirm `brandSlug`/`tripSlug` are narrowed to `string` at the mount site; if TypeScript cannot narrow, guard with the existing `typeof … === "string"` pattern and pass a stable value (do NOT mount the modal with a malformed URL — `tripPublicUrl` throws `PublicUrlError` on empty segments, which is acceptable fail-closed but must not crash render; gate the mount on valid slugs if needed).
  - `title={payload.trip.title}`
  - `description={payload.trip.description?.slice(0, 200)}` (optional; matches the event page's `.slice(0,200)` convention; `description` may be empty string — passing it is harmless).

**Removed protective comment:** the ORCH-0874 `handleShare` JSDoc ("share → native share sheet with the public trip URL", lines 80) is superseded; replace with a one-line note referencing ORCH-1114 ("share → web-aware ShareModal (copy-link/QR/native-share-via); see SPEC_ORCH-1114").

### 4.3 Component layer — `app/exp/[brandSlug]/[experienceSlug].tsx`

Identical transformation, with the experience helper:
- ADD `useState`; ADD `import { ShareModal } from "../../../src/components/ui/ShareModal";`; ADD `import { experiencePublicUrl } from "../../../src/constants/publicUrls";`.
- REMOVE `Share` from the `react-native` import; REMOVE `Platform` if it becomes unused (current file uses `Platform` only in `handleShare` — verify and remove).
- ADD `const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);`.
- REPLACE the `handleShare` `useCallback` (current lines 79–94) with `const handleShare = useCallback((): void => { setShareModalVisible(true); }, []);`.
- Change the share `IconChrome` `onPress` from the `() => { void handleShare(); }` wrapper (lines 216–218) to `onPress={handleShare}`. Placement, `icon="share"`, `size={36}`, `accessibilityLabel="Share"`, `shareOverlay` UNCHANGED.
- ADD `<ShareModal>` as the last sibling inside the top-level `<View style={styles.host}>` (after the two overlay views):
  - `visible={shareModalVisible}` / `onClose={() => setShareModalVisible(false)}`
  - `url={experiencePublicUrl({ brandSlug, experienceSlug })}` (with the same slug-narrowing guard as the trip page)
  - `title={experience.title}` (the render body already binds `const experience = payload.experience;` at line 136)
  - `description={experience.description?.slice(0, 200) ?? undefined}` (experience `description` is `string | null`; coalesce null to undefined so the optional prop stays optional).

### 4.4 States (every state of the share interaction — all delivered by the reused `ShareModal`, none re-implemented)

| State | Trigger | UI / behavior | Owner |
|-------|---------|---------------|-------|
| Closed (default) | initial render | `shareModalVisible=false`; modal not shown; Share icon idle | route |
| Open | tap Share icon | `setShareModalVisible(true)` → `ShareModal` Sheet animates up | route → ShareModal |
| Copy success | tap "Copy link" | `copyPublicUrl` resolves → "Link copied" toast | ShareModal |
| Copy failure | clipboard unavailable | "Copy failed. Try Share via instead." toast | ShareModal |
| Native-share success | tap "Share via…" (web w/ `navigator.share`, or native) | OS/Web share sheet opens | ShareModal → sharePublicUrl |
| Native-share unsupported | tap "Share via…" (web, no `navigator.share`) | "Native share not supported on this browser." toast (NO silent failure) | ShareModal |
| QR | always visible when open | QR encodes `url` | ShareModal |
| Platform deep-link | tap Twitter/WhatsApp/Email/SMS | opens intent or "Couldn't open {label}." toast | ShareModal |
| Close | tap X / backdrop | `onClose` → `setShareModalVisible(false)` | route → ShareModal |

The route owns ONLY `visible` + `onClose` + the three props (`url`, `title`, `description`). All copy/toast/QR/deep-link/native-share states are the `ShareModal`'s existing responsibility and are NOT re-implemented in the route.

---

## 5. Success criteria (numbered, observable, testable)

- **SC-1-Web (trip):** On desktop Chrome (where `navigator.share` is undefined), opening `/t/{brandSlug}/{tripSlug}` and tapping the Share icon opens the `ShareModal` sheet showing "Copy link", "Share via…", the URL `https://business.usemingla.com/t/{brandSlug}/{tripSlug}`, and a QR. NO dead tap.
- **SC-2-Web (trip copy):** Tapping "Copy link" copies the trip URL and shows the "Link copied" toast.
- **SC-3-Web (trip native-share fallback):** Tapping "Share via…" on a browser without `navigator.share` shows the "Native share not supported on this browser." toast (no silent swallow).
- **SC-4-Web (experience):** Same as SC-1 for `/exp/{brandSlug}/{experienceSlug}` with the `/exp/…` URL.
- **SC-5-iOS (native parity):** On business iOS, tapping Share opens `ShareModal`; "Share via…" opens the native OS share sheet with the trip/experience URL. Behavior matches the event page.
- **SC-6-Android (native parity):** On business Android, same as SC-5 via the Android `sharePublicUrl` branch.
- **SC-7 (helper):** `experiencePublicUrl({ brandSlug: "acme", experienceSlug: "sunset-sail" })` returns `https://business.usemingla.com/exp/acme/sunset-sail`; it throws `PublicUrlError` on an empty `brandSlug` or `experienceSlug`. `tripPublicUrl` continues to return `…/t/{brandSlug}/{tripSlug}`.
- **SC-8 (no bare Share.share):** Neither route file imports or calls react-native `Share` after the change; both reference `ShareModal`. (Fails-on-revert guard — §9.)
- **SC-9 (no silent catch):** Neither route file contains an empty `catch {}` around a share path. The only error handling for share is inside `ShareModal` (which toasts).

---

## 6. Invariants

**Preserved:**
- **Anon-tolerance** (`feedback_anon_buyer_routes.md`): neither route gains `useAuth` or a sign-in redirect. `ShareModal`, `tripPublicUrl`, `experiencePublicUrl` are all auth-free. Verified by existing `public-trip-page.test.ts` A-PUBLIC-1/2 (still pass).
- **Constitution #1 (no dead taps / `feedback_interactive_elements_must_fire_runtime_proof.md`):** the whole point — the Share control now fires (opens the modal) at runtime on web. Tester must prove it FIRES on a real browser (not source-only).
- **Constitution #3 (no silent failures):** the empty `catch {}` (the violation) is removed; `ShareModal` surfaces success/failure via toasts.
- **Canonical-origin helpers (`publicUrls.ts`):** new `experiencePublicUrl` uses `BUSINESS_PUBLIC_ORIGIN` + `requireSegment`, matching siblings — no new hardcoded origin string.

**Proposed NEW (DRAFT — orchestrator flips ACTIVE at CLOSE):**
- **`I-PROPOSED-PUBLIC-SHARE-VIA-SHAREMODAL` (DRAFT):** every buyer-anon public detail page (`/e/`, `/b/`, `/t/`, `/exp/`) shares via the web-aware `ShareModal`/`sharePublicUrl` primitive — never a bare inline `Share.share` with a swallow-only `catch`. Verified by the §9 fails-on-revert tests on the trip + experience routes (and the pre-existing correctness of event/brand).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | helper happy path (trip) | `tripPublicUrl({brandSlug:"acme",tripSlug:"bali"})` | `https://business.usemingla.com/t/acme/bali` | helper unit |
| T-2 | helper happy path (experience) | `experiencePublicUrl({brandSlug:"acme",experienceSlug:"sunset-sail"})` | `https://business.usemingla.com/exp/acme/sunset-sail` | helper unit |
| T-3 | helper encodes segments | `experiencePublicPath({brandSlug:"my brand",experienceSlug:"sail one"})` | `/exp/my%20brand/sail%20one` | helper unit |
| T-4 | helper rejects empty segment (fails-on-revert) | `experiencePublicUrl({brandSlug:"",experienceSlug:"x"})` | throws `PublicUrlError` | helper unit |
| T-5 | helper rejects empty experienceSlug | `experiencePublicUrl({brandSlug:"a",experienceSlug:"  "})` | throws `PublicUrlError` | helper unit |
| T-6 | trip route routes share through ShareModal (happy/structural) | read `app/t/[brandSlug]/[tripSlug].tsx` | source matches `<ShareModal` AND `setShareModalVisible` AND `tripPublicUrl(` | route source guard |
| T-7 | trip route has NO bare Share.share (error-path/fails-on-revert) | read trip route source | source does NOT match `Share.share` AND does NOT import `Share` from react-native | route source guard |
| T-8 | experience route routes share through ShareModal | read `app/exp/[brandSlug]/[experienceSlug].tsx` | source matches `<ShareModal` AND `experiencePublicUrl(` | route source guard |
| T-9 | experience route has NO bare Share.share | read experience route source | source does NOT match `Share.share` AND no `Share` import | route source guard |
| T-10 | anon-tolerance preserved (edge) | existing `public-trip-page.test.ts` A-PUBLIC-1/2 | still pass (no `useAuth`, no auth redirect) | route source guard |

---

## 8. Implementation order

1. **Helper** — `src/constants/publicUrls.ts`: add `experiencePublicPath` + `experiencePublicUrl` (§4.1).
2. **Helper tests** — `src/constants/__tests__/publicUrls.test.ts`: add T-1…T-5 (import the new + existing trip builders; assert canonical output + `PublicUrlError` on empty segments).
3. **Trip route** — `app/t/[brandSlug]/[tripSlug].tsx`: imports, `useState`, replace `handleShare`, `onPress={handleShare}`, mount `<ShareModal>` (§4.2).
4. **Experience route** — `app/exp/[brandSlug]/[experienceSlug].tsx`: same (§4.3).
5. **Route guard tests** — add T-6…T-9 (see §9 for exact file locations).
6. **Run gates** — `npm test` for the touched specs; `tsc --noEmit` (the worktree's typecheck); confirm `public-trip-page.test.ts` (A-PUBLIC-1…8) still passes. Prove fails-on-revert per §9.

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** source-grep route-contract tests (the same mechanism `public-trip-page.test.ts` already uses — `readFileSync` the route file + `expect(source).toMatch/.not.toMatch`).

**Implementor happy-path test (REQUIRED at CLOSE):**
- Extend `mingla-business/app/t/__tests__/public-trip-page.test.ts` with **A-PUBLIC-9** (and a sibling for experience):
  - A-PUBLIC-9 (trip): asserts the trip route source `toMatch(/<ShareModal/)` AND `toMatch(/setShareModalVisible/)` AND `toMatch(/tripPublicUrl\(/)` AND `**not**.toMatch(/\bShare\.share\b/)` AND `**not**.toMatch(/^import[\s\S]*\bShare\b[\s\S]*from ["']react-native["']/m)`.
  - Create `mingla-business/app/exp/__tests__/public-experience-page.test.ts` (new dir — does not exist yet) mirroring `public-trip-page.test.ts` for the experience route, INCLUDING the same `<ShareModal>` / `experiencePublicUrl(` / no-`Share.share` assertions.
- This is the test that asserts the share control **routes through the web-aware `ShareModal`/`sharePublicUrl`, NOT bare `Share.share`.** It FAILS the instant the route is reverted to `Share.share` (the `.not.toMatch(/Share\.share/)` flips) and PASSES when restored. ✅ fails-on-revert.

**Helper fails-on-revert:** T-4/T-5 fail if `experiencePublicUrl` is ever changed to skip `requireSegment` (e.g. hand-rolled string concat without the empty-segment guard).

**Protective comments:** in both route files, the swapped-in one-line `handleShare` comment must read e.g. `// ORCH-1114: share → web-aware ShareModal (copy-link/QR/native-share-via). NEVER revert to bare Share.share — it dead-taps on react-native-web (navigator.share undefined). See SPEC_ORCH-1114.` In `publicUrls.ts`, the new helpers carry a `// ORCH-1114: experience public-URL helper, mirror of tripPublicUrl.` comment.

---

## 10. Open questions

- **None blocking.** Two confirmations the implementor must satisfy in-pass (not design questions, just narrowing):
  1. Confirm `Platform` is unused after the swap in each route before removing it from the `react-native` import (avoid an unused-import lint error OR a missing-import error). Current source uses `Platform` ONLY inside `handleShare`, so removal is expected — but verify.
  2. Confirm the `url` prop's slug values are TypeScript-narrowed to `string` at the `<ShareModal>` mount site (the render body runs after the not-found/error early returns). If the compiler still sees `string | undefined`, gate the modal mount on `typeof brandSlug === "string" && typeof tripSlug === "string"` (resp. `experienceSlug`) so `tripPublicUrl`/`experiencePublicUrl` never receive an empty segment and throw mid-render.

---

## 11. Downstream routing

**Next = `mingla-implementor`.** Build exactly §4 (helper + two routes) + §7/§9 tests, in the §8 order. Run `npm test` on the touched specs + `tsc --noEmit`; prove the §9 fails-on-revert (revert one route to `Share.share`, watch A-PUBLIC-9 / experience test fail, restore). Frontend-only: NO migration, NO edge deploy, NO `db push`. Then → `mingla-tester` for the device/runtime gate (Constitution #1 demands a REAL browser proof: load `/t/` and `/exp/` on desktop Chrome where `navigator.share` is undefined, tap Share, see the modal + "Copy link" → "Link copied" toast + the "Native share not supported on this browser." toast on "Share via…"; plus native iOS/Android parity that "Share via…" opens the OS sheet). Then → `mingla-orchestrator` CLOSE (flip `I-PROPOSED-PUBLIC-SHARE-VIA-SHAREMODAL` → ACTIVE; OTA per `feedback_eas_ota_publish_per_platform.md` since this is pure-JS business-app + buyer-web — no native rebuild needed).

**Working tree:** `~/Desktop/mingla-orchs/ORCH-1114-[trip-share-link]/` on branch `ORCH-1114-trip-share-link`.

---

## Allowlist + DO-NOT-TOUCH

**Allowlist (implementor may modify ONLY these):**
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`
- `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx`
- `mingla-business/src/constants/publicUrls.ts`
- `mingla-business/src/constants/__tests__/publicUrls.test.ts`
- `mingla-business/app/t/__tests__/public-trip-page.test.ts` (extend with A-PUBLIC-9)
- `mingla-business/app/exp/__tests__/public-experience-page.test.ts` (CREATE)

**DO-NOT-TOUCH (stop-and-amend before any edit):**
- `src/components/ui/ShareModal.tsx`, `src/utils/sharePublicUrl.ts`, `src/utils/shareIntents.ts`
- `src/components/event/PublicEventPage.tsx`, `src/components/brand/PublicBrandPage.tsx`, `app/e/**`, `app/b/**`
- `app/(tabs)/hub/trips.tsx`, `app/(tabs)/hub/experiences.tsx`
- `src/components/ui/IconChrome.tsx`, the route `styles`/overlay layout, the X-close handler
- any DB / edge / migration / RLS file (none are in scope)

Amendments append in-file or land as `SPEC_AMENDMENT_ORCH-1114_*.md` — never silently widen.

---

*Artifact: `Mingla_Artifacts/specs/SPEC_ORCH-1114_PUBLIC_TRIP_EXPERIENCE_SHARE.md`*
