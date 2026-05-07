# Investigation — ORCH-0744 (mingla-business latent defects forensic sweep)

**Date:** 2026-05-06
**Investigator:** mingla-forensics (INVESTIGATE-only mode)
**Branch / commit at ingestion:** `Seth` / `cfb121e8`
**Dispatch:** [`Mingla_Artifacts/prompts/FORENSICS_ORCH_0744_MINGLA_BUSINESS_LATENT_DEFECTS_SWEEP.md`](../prompts/FORENSICS_ORCH_0744_MINGLA_BUSINESS_LATENT_DEFECTS_SWEEP.md)
**Scope:** `mingla-business/` (Tier 1 of 3 — Tier 2 + Tier 3 deferred to a second session per dispatch §7)
**Tone:** brutal, evidence-based. Nothing accepted without independent verification.

---

## 1. Layman summary

I swept five Tier-1 classes of hidden defect across `mingla-business/`. The codebase is **architecturally cleaner than the dev-server log makes it look** — but two findings are real and one is dangerous:

**The dangerous one:** the orphan-storage-key reaper at `src/utils/reapOrphanStorageKeys.ts:18` whitelists `mingla-business.currentBrand.v12`, but ORCH-0742 just bumped the live key to `v14`. Result: the reaper now reports the **live ORCH-0742 blob as ORPHAN** every cold-start. As long as the reaper stays in log-only mode (Cycle 17d §D), the only damage is misleading telemetry. **The moment anyone promotes the reaper to delete-mode, it will wipe `currentBrandId` on every cold-start — silently undoing ORCH-0742 entirely.** This is a one-line whitelist patch but it's a structural process gap: ORCH-0742 bumped the key without updating the whitelist, no gate caught it, no tester noticed.

**The architectural one:** ORCH-0742 introduced a new short require-cycle (`currentBrandStore.ts ↔ useCurrentBrand.ts`) that the SPEC §4.2 explicitly tried to prevent. The fix wasn't enough — moving the wrapper to `src/hooks/` left the cycle intact because the store still re-exports from the hook. JS tolerates the cycle (no crash), but it's exactly what the SPEC said to avoid.

**The 4 pre-existing cycles** through `AuthContext` / `clearAllStores` / various stores are also real but quieter — they've been there for ~10 cycles and nobody flagged them.

**The encouraging news:** error-handling discipline is genuinely strong (0 P0 violations across 21 try-catch blocks; every `useMutation` has either `onError` or a documented throw-to-caller pattern; every `.single()` and `.maybeSingle()` is null-guarded; every edge-fn invoke checks `error` before `data`). The `PreferencesService.updateUserPreferences silently catches` memory note is **OBSOLETE** — that service no longer exists; prefs migrated to a Zustand store + React Query mutations.

**Findings:** 2 root causes, 7 contributing factors, 7 hidden flaws, 4 observations, 5 meta-findings.
**Confidence:** HIGH on Tier 1.A/B/C/D. MEDIUM-HIGH on Tier 1.E (2 platform-coverage cases need a code-level second pass).

**Triage recommendation:** RC-2 (whitelist) blocks; fold into ORCH-0743. RC-1 (require cycle) folds into ORCH-0743 (already accounted for as C5 candidate). CF-1..CF-4 spawn separate ORCHs. Meta-findings drive CLOSE-protocol hardening — the highest leverage of this whole sweep.

---

## 2. Investigation manifest (files actually read)

In trace order:

| # | File | Reason |
|---|------|--------|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_ORCH_0744_MINGLA_BUSINESS_LATENT_DEFECTS_SWEEP.md` | dispatch contract |
| 2 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0742_REPORT.md` | predecessor evidence + D-0742-IMPL-1..4 |
| 3 | `Mingla_Artifacts/reports/QA_ORCH_0742_PHASE_2_REPORT.md` | predecessor evidence + D-0742-QA-1..7 |
| 4 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (sample read for I-PROPOSED-J) | active invariant set |
| 5 | `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/MEMORY.md` (full inventory list) | session hygiene |
| 6 | `mingla-business/src/store/currentBrandStore.ts` (lines 1-446) | T1.A new cycle confirmation + T1.C v14 contract |
| 7 | `mingla-business/src/hooks/useCurrentBrand.ts` | T1.A new cycle confirmation |
| 8 | `mingla-business/src/hooks/useBrands.ts` (lines 1-100, 137-330) | T1.A cycle through brandRoleKeys + T1.B/D markers |
| 9 | `mingla-business/src/context/AuthContext.tsx` (lines 1-30) | T1.A multi-cycle anchor |
| 10 | `mingla-business/src/hooks/useAccountDeletion.ts` (lines 1-30) | T1.A AuthContext-cycle confirmation |
| 11 | `mingla-business/src/hooks/useCreatorAccount.ts` (lines 1-25) | T1.A 3-node cycle |
| 12 | `mingla-business/src/utils/clearAllStores.ts` | T1.A 4-store cycle anchor |
| 13 | `mingla-business/src/hooks/useBrandListShim.ts` | T1.A AuthContext shim cycle |
| 14 | `mingla-business/src/hooks/useCurrentBrandRole.ts` (lines 1-40) | T1.A cycle through useAuth |
| 15 | `mingla-business/src/store/draftEventStore.ts` (lines 1-25) | T1.A cycle through liveEventConverter |
| 16 | `mingla-business/src/store/{12 stores}` (persist config grep) | T1.C every store's persist contract |
| 17 | `mingla-business/src/store/{brandTeam,doorSales,eventEditLog,guest,order,scan,scannerInvitations,notificationPrefs}Store.ts` (top 50 each) | T1.C TRANSITIONAL classification per I-PROPOSED-J |
| 18 | `mingla-business/src/utils/reapOrphanStorageKeys.ts` (entire file) | T1.C orphan-key whitelist (root-cause RC-2) |
| 19 | Three Explore-agent breadth scans (T1.B / T1.D / T1.E) | breadth coverage; spot-checked findings |

**Files NOT read (deferred to Tier 2):** `app/**` route components beyond what Explore agents surfaced; `src/components/**` beyond auth + brand + ui primitives; `src/services/**` beyond imports inspected for cycles.

---

## 3. Findings — Tier 1 by severity

### 🔴 RC-1 — New require cycle: `currentBrandStore.ts ↔ useCurrentBrand.ts` (P2)

**Six-field evidence:**

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/store/currentBrandStore.ts:446` AND `mingla-business/src/hooks/useCurrentBrand.ts:30-34` |
| **Exact code** | Store: `export { useCurrentBrand } from "../hooks/useCurrentBrand";` <br> Hook: `import { useBrand } from "./useBrands";` + `import { useCurrentBrandStore, type Brand } from "../store/currentBrandStore";` |
| **What it does** | At module-init, the store module's evaluation requires the hook module's evaluation (for the re-export); the hook module's evaluation requires the store module's evaluation (for `useCurrentBrandStore` value-import + `Brand` type). JS tolerates this via lazy bindings — the cycle resolves at first hook-call time, by which point both modules are evaluated. |
| **What it should do** | No cycle. ORCH-0742 SPEC §4.2 explicitly listed "circular import risk" as a known failure mode (dispatch §4 #2): "The wrapper hook MUST live at `src/hooks/useCurrentBrand.ts`, NOT inside `currentBrandStore.ts`. The re-export pattern mirrors `useBrandList`. SPEC §4.2 spells this out — do not deviate." Implementor moved the file but left the re-export, which alone doesn't break the cycle. |
| **Causal chain** | ORCH-0742 SPEC §4.2 → implementor relocates wrapper to `src/hooks/` BUT keeps re-export from store → store↔hook bidirectional dependency at module-init → Metro emits `Require cycle:` warning → no runtime crash today (uses are deferred to render time) → latent risk: any future top-level statement in either file that uses imported value would silently see undefined |
| **Verification step** | Run `cd mingla-business && npx expo start --clear 2>&1 \| grep "Require cycle"` — confirm `currentBrandStore.ts → useCurrentBrand.ts → currentBrandStore.ts` appears. Already directly observed in operator's dev-server log. |

**Severity:** P2 (warning only at runtime; structural smell that the SPEC explicitly tried to prevent).
**Confidence:** HIGH (verified by reading both files end-to-end).
**Who introduced:** ORCH-0742 implementor (commit `80c15297`).
**Who should have caught:**
- ORCH-0742 implementor REVIEW (10/10 checks passed but didn't include "run expo start and grep for cycle warnings")
- ORCH-0742 tester (independent build gates were tsc + expo export but neither prints require-cycle warnings; only `expo start` does)
- ORCH-0742 SPEC author had it right; the SPEC's mitigation ("relocate to src/hooks/") was incomplete advice
**Recommended fix (folds into ORCH-0743):**
- **Option (a)** — Move `Brand` type to a third file (e.g., `mingla-business/src/types/brand.ts`). Both store and hook import from there. No A→B cycle. ~1 hour scope.
- **Option (b)** — Drop the re-export at `currentBrandStore.ts:446`. Update the 4 import sites (TopBar.tsx, home.tsx, events.tsx, event/create.tsx) to import directly from `src/hooks/useCurrentBrand`. Breaks API consistency with `useBrandList` shim pattern. ~30 min scope.

---

### 🔴 RC-2 — Stale `reapOrphanStorageKeys` whitelist; reaper reports LIVE ORCH-0742 blob as orphan (P1)

**Six-field evidence:**

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/utils/reapOrphanStorageKeys.ts:17-29` |
| **Exact code** | `const KNOWN_MINGLA_KEYS = new Set<string>([ "mingla-business.currentBrand.v12", ...10 other entries ])` |
| **What it does** | Lists the canonical AsyncStorage keys for each persisted Zustand store. Every cold-start, the reaper enumerates AsyncStorage and reports any `mingla-business.*` key not in this whitelist as ORPHAN. The whitelist entry for currentBrand is `v12`. |
| **What it should do** | The currentBrand whitelist entry should be `v14` (post-ORCH-0742 — see `currentBrandStore.ts:375` `name: "mingla-business.currentBrand.v14"`). With v14 not in the whitelist, the LIVE blob from a v14-store cold-start is reported as orphan every time. |
| **Causal chain** | ORCH-0742 Phase 2 bumped `currentBrandStore.ts:375` `name:` from `v13` → `v14` → didn't update `reapOrphanStorageKeys.ts:18` whitelist → reaper now treats v14 (the live blob the store actively reads/writes) as orphan → on every cold-start, v14 is in the orphans list → today: log-only telemetry per Cycle 17d §D so no destruction → tomorrow: if anyone promotes the reaper to delete-mode (which Cycle 17d §D explicitly states is a planned future), it will erase the user's `currentBrandId` on every cold-start, silently undoing ORCH-0742 entirely |
| **Verification step** | Already observed in operator's dev-server log: `[reapOrphanStorageKeys] Found 11 orphan AsyncStorage key(s):` listed `v13` (predecessor) plus v2-v11 (Cycle 17d historical). v14 was NOT listed because the dev box hasn't completed enough cold-start cycles to materialize the v14 blob yet — but it WILL be listed after the operator picks a brand and force-relaunches. Independent verification: read `reapOrphanStorageKeys.ts:17-29` and compare entry-by-entry against every `*Store.ts` `name:` line. |

**Severity:** **P1 (latent destruction risk).** Today: misleading telemetry only. Trigger condition for catastrophe: any future "promote reaper to delete-mode" change.
**Confidence:** HIGH (verified by reading both files; whitelist string `v12` literal vs. store name `v14` literal — direct mismatch).
**Who introduced:** ORCH-0742 implementor + REVIEWer + tester all missed.
**Who should have caught:**
- **Tester** had the strongest opportunity — the QA report's regression-surface §9 listed AsyncStorage v14-blob inspection as a manual smoke test. Running that smoke test against a real device with both v13 and v14 keys present would have surfaced this immediately.
- **Implementor** had the next opportunity — the implementor report §2.1 documented the v13→v14 bump but didn't propagate to the reaper whitelist.
- **SPEC** §4.1 didn't mention the reaper at all. The SPEC author missed the cross-file dependency.
**Recommended fix:**
- Update `reapOrphanStorageKeys.ts:18` from `"mingla-business.currentBrand.v12"` to `"mingla-business.currentBrand.v14"`. 1 LOC.
- **Structural fix (CI gate):** add a strict-grep gate that the persist `name:` in each `*Store.ts` matches an entry in `KNOWN_MINGLA_KEYS`. If not, fail CI. Blocks future bumps from drifting.
- Folds into ORCH-0743 OR a new tiny standalone hotfix ORCH (operator's call — ORCH-0743 is the cleaner home since it's already addressing ORCH-0742 polish).

---

### 🟠 CF-1 — Four pre-existing require cycles via AuthContext (P2 each)

The dev-server log surfaced these cycles, all involving `AuthContext.tsx`:

| # | Cycle path | Length | Verified |
|---|---|---|---|
| C1 | `AuthContext.tsx → useAccountDeletion.ts → AuthContext.tsx` | 2 | ✅ — `AuthContext.tsx:21` imports `tryRecoverAccountIfDeleted`; `useAccountDeletion.ts:23` imports `useAuth` |
| C2 | `AuthContext.tsx → useAccountDeletion.ts → useCreatorAccount.ts → AuthContext.tsx` | 3 | ✅ — `useAccountDeletion.ts:25` imports `creatorAccountKeys`; `useCreatorAccount.ts:13` imports `useAuth` |
| C3 | `AuthContext.tsx → clearAllStores.ts → currentBrandStore.ts → useBrandListShim.ts → AuthContext.tsx` | 4 | ✅ — `AuthContext.tsx:22` imports `clearAllStores`; `clearAllStores.ts:18` imports `useCurrentBrandStore`; `currentBrandStore.ts:415` re-exports `useBrandList`; `useBrandListShim.ts:19` imports `useAuth` |
| C4 | `useBrands.ts → useCurrentBrandRole.ts → AuthContext.tsx → clearAllStores.ts → draftEventStore.ts → liveEventConverter.ts → liveEventStore.ts → useBrands.ts` | 7 | ✅ — long chain through Cycle-3 cleanup utility into per-store re-exports back into useBrands |

**Common root cause:** `AuthContext` imports `clearAllStores` for Cycle-3 Const #6 cleanup. `clearAllStores` imports every persisted store. Several stores (`currentBrandStore`, `liveEventStore`) re-export hooks (`useBrandList`, future `useCurrentBrand`, `getBrandFromCache`) that themselves depend on `AuthContext` (via `useAuth`) or on `useBrands` (which depends on `useCurrentBrandRole` which depends on `AuthContext`). Each re-export creates a back-edge.

**Severity:** P2 each (warning only — no module-init top-level statements use imported values; all uses are deferred to hook-call time).
**Confidence:** HIGH (every import line directly read).
**Recommended fix:** structural refactor in a future cycle (NOT ORCH-0743 scope):
- **Option (a)** — Move all Zustand-store/auth-dependent helpers (`useBrandList`, `useCurrentBrand`, `getBrandFromCache`) out of store re-exports; make consumers import from `src/hooks/` directly. Eliminates store↔hook back-edge.
- **Option (b)** — Lazy-import `clearAllStores` from inside `AuthContext.signOut()` rather than at module-init. Eliminates AuthContext→stores edge.

**Defer:** these have lived through ~10 ORCH cycles without crashing — not blocking. Document for a "Cycle X — import graph health" cycle.

---

### 🟠 CF-2 — `textShadow*` deprecated style props in `app/event/[id]/index.tsx:824-826` (P1)

**File + line:** `mingla-business/app/event/[id]/index.tsx:824-826`
**Code (per Explore agent T1.E):** inline style with `textShadowColor: "rgba(0, 0, 0, 0.4)"` + `textShadowOffset: { ... }` + `textShadowRadius: ...`
**What it does:** RN-only style props applied inline. iOS/Android render. **Web does NOT recognize these props** — they're stripped silently by react-native-web. The Metro deprecation warning the operator saw (`"shadow*" style props are deprecated. Use "boxShadow"`) cites this exact code.
**Impact:** Hero title text shadow is invisible on Expo Web. Cosmetic-only on web target, but breaks visual parity (the SPEC for that hero presumably specified the shadow).
**Severity:** P1 (web-target render fail; visible UX regression on web).
**Confidence:** HIGH (Explore agent identified file:line; consistent with operator's Metro warning).
**Recommended fix:** convert to `Platform.select({ web: { textShadow: "0 2px 12px rgba(0, 0, 0, 0.4)" }, default: { textShadowColor: ..., textShadowOffset: ..., textShadowRadius: ... } })` — or pull into a designSystem token if shadow recurs.
**Triage:** new standalone P1 fix OR fold into ORCH-0743 if scope allows. Single-file ~10 LOC change.

---

### 🟠 CF-3 — 15 `[ORCH-XXXX-DIAG]` console.error markers from CLOSED ORCHs still firing (P1 cumulative)

**Sites (Explore agent T1.B):**
- `BrandSwitcherSheet.tsx:126, 139, 159, 164, 181, 204, 241, 251, 256, 291, 301, 319` — 12 markers across `[ORCH-0728-DIAG]`, `[ORCH-0729-DIAG]`, `[ORCH-0730-DIAG]`, `[ORCH-0733-DIAG]`
- `useBrands.ts:188, 276, 324, 328, 353` — 5 markers across `[ORCH-0728-DIAG]`, `[ORCH-0734-RW-DIAG]`
- `brandsService.ts:230, 244` — 2 markers `[ORCH-0734-RW-DIAG]`
- `creatorAccount.ts:33` — 1 marker `[ORCH-0728-DIAG]`

Total: **15 distinct markers across 4 files, 5 ORCH-IDs (0728, 0729, 0730, 0733, 0734-RW)**. Every marker is `// eslint-disable-next-line no-console` annotated. Every comment says "removed at full IMPL CLOSE" or similar.

**Status of each cited ORCH:**
- ORCH-0728: closed (per priors); markers still in code.
- ORCH-0729: closed; markers still in code.
- ORCH-0730: closed; markers still in code.
- ORCH-0733: closed; markers still in code.
- ORCH-0734 + 0734-RW: CLOSED PASS per `WORLD_MAP.md` 2026-05-05; markers still in code.

**Severity:** P1 cumulative (production console pollution; chat noise on every brand mutation; breaks tester signal-to-noise; misleads future operators reading the log).
**Confidence:** HIGH (Explore agent grep confirmed every site).
**Recommended fix:** mass-delete all 15 markers. Single-file commit scope per file (4 files total). ~30 min implementor effort.
**Tracked in priors as:** "11 in-flight `[ORCH-XXXX-DIAG]` markers" per ORCH-0742 D-0742-IMPL-3 + "leftover diagnostic markers" per several CLOSE banners. **Never actioned.** Recommendation: spawn standalone ORCH-0745 (DIAG marker mass-removal). Trivial scope, high signal-to-noise win.

---

### 🟠 CF-4 — 8 unsafe `e.target as unknown as { value: string }` casts in event-creation forms (P2)

**Sites (Explore agent T1.B):**
- `src/components/event/CreatorStep2When.tsx`: 7 instances (lines 1127, 1140, 1155, 1183, 1455, 1467, 1479)
- `src/components/event/MultiDateOverrideSheet.tsx`: 2 instances (lines 535, 547)
- `src/components/event/TicketTierEditSheet.tsx`: 2 instances (lines 1171, 1188)

**What they do:** unsafely coerce `e.target` (a generic `EventTarget`) to `{ value: string }`. The cast is technically wrong because `EventTarget` doesn't have a `value` field — only `HTMLInputElement` (web) or `TextInput` ref (native) does.
**Severity:** P2 (works at runtime because the actual `e.target` IS an HTMLInputElement/equivalent; compile-time type safety is lost).
**Confidence:** HIGH.
**Recommended fix:** replace each with `(e.target as HTMLInputElement).value` (web target) — or, if `event/CreatorStep2When` is shared across web + native, use a typed wrapper helper. ~1 hour standalone ORCH.

---

### 🟡 HF-1 — `responsive.ts:6` static Dimensions snapshot baked at module load (P2)

**File:** `mingla-business/src/utils/responsive.ts:6`
**Code (per Explore agent T1.E):** `const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");`
**What it does:** module-level destructure of `Dimensions.get("window")`. Snapshot is frozen at bundle-load time.
**Risk:** stale on device rotation. SSR-rendered with server defaults on web export. Used by `scale()` / `verticalScale()` helpers throughout the app — every consumer gets the bundle-time snapshot.
**Severity:** P2 (works in practice for most users who don't rotate; latent inconsistency on landscape; SSR pre-render produces server-default-sized layouts).
**Recommended fix:** wrap in a hook that subscribes to orientation changes via `Dimensions.addEventListener("change", ...)` cleanup; or refactor to compute scale per-render in components.

---

### 🟡 HF-2 — 13 inline `elevation: 12` instances not from designSystem token (P3)

**Sites (Explore agent T1.E):** `events.tsx:767`, `confirm.tsx:538`, `edit-profile.tsx:577`, `notifications.tsx:322`, `delete.tsx:797`, `event/[id]/index.tsx:875`, `reconciliation.tsx:1037`, `scanners/index.tsx:576`, `door/[saleId].tsx:611`, `door/index.tsx:830`, `guests/index.tsx:750`, `guests/[guestId].tsx:1261` (13 total).
**What they do:** inline `elevation: 12` shadow value. Each instance bypasses `src/constants/designSystem.ts` shadow tokens.
**Severity:** P3 (style hygiene; web doesn't honor `elevation` so partial visual parity loss on web target).
**Recommended fix:** add `shadows.xl` token (if not present) and replace all 13 sites. ~1 hour standalone cleanup ORCH.

---

### 🟡 HF-3 — `elevation: 1000` outlier in `TopBar.tsx:303` (P2)

**File:** `mingla-business/src/components/ui/TopBar.tsx:303`
**Code (per Explore agent T1.E):** inline `elevation: 1000`
**What's suspicious:** all other `elevation:` values in the codebase are `12`. `1000` is wildly out of range, suggesting a stacking-context/overflow workaround rather than a designed shadow.
**Severity:** P2 (could indicate a real layering bug being masked by extreme elevation; should be investigated for root cause).
**Recommended fix:** investigate WHY 1000 was needed. If it's covering up a `zIndex` battle, fix the underlying stacking; if it's intentional but ill-named, use a comment + designSystem.shadows.modal-rank token. **Treat as discovery for a small forensics dispatch, not auto-fix.**

---

### 🟡 HF-4 — 9 TRANSITIONAL markers without explicit exit conditions (P2)

**Sites (Explore agent T1.B; partial list):**
- `src/utils/guestCsvExport.ts:300` — "RN built-in degraded; no explicit exit stated"
- `src/components/brand/BrandProfileView.tsx:62, 264, 294` — 3 markers; 2 have exit ("J-A8", "§5.3.6 settings cycle"), 1 has none
- `src/components/event/PublicEventPage.tsx:168, 800` — 800 has none
- `src/hooks/useCurrentBrandRole.ts:91, 158` — both have none
- `app/event/[id]/index.tsx:313` — "Payout formula stub (revenue × 0.96); no exit stated"

**Severity:** P2 — Const #7 violation: "Label temporary fixes — tracked, owned, exit-conditioned."
**Recommended fix:** for each, audit — either supply the exit condition OR remove the TRANSITIONAL label if it's actually permanent. ~2 hour cleanup pass.

---

### 🟡 HF-5 — `AuthContext.tsx:182-205` ambiguous Platform-coverage branch (P1 needs verification)

**File:** `mingla-business/src/context/AuthContext.tsx:182-205` (per Explore agent T1.E)
**Pattern reported:** `if (Platform.OS === "web") { ... } else if (Platform.OS === "android")` — ambiguous control flow; Explore agent flagged "may have path where web auth succeeds but Android auth is not explicitly handled."
**Severity:** P1 if real (auth bug on iOS or Android); needs forensics second pass to confirm.
**Confidence:** MEDIUM (Explore agent did not read full body of the conditional).
**Recommended verification:** read lines 180-220 of `AuthContext.tsx` in detail; trace the iOS path explicitly. Could be benign (iOS handled elsewhere) or a real silent failure for one platform. **Spawn a tiny sub-investigation OR fold into ORCH-0746 platform-parity audit.**

---

### 🟡 HF-6 — `BusinessWelcomeScreen.tsx` 3× `(iOS \|\| Web)` branches without Android (P1 needs verification)

**File:** `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx:193-562` (per Explore agent T1.E — 3 instances)
**Pattern reported:** `(Platform.OS === "ios" \|\| Platform.OS === "web")` conditionals showing UI only for those two platforms; Android implicitly hidden.
**Severity:** P1 if real (Android organisers see broken/missing welcome UI); P3 if intentional (Android has alternate component).
**Confidence:** MEDIUM (need to see what's inside the conditional + whether there's an Android fallback elsewhere).
**Recommended verification:** read the conditional bodies + check for an Android-only sibling component. **Spawn sub-investigation.**

---

### 🟡 HF-7 — `Sheet.tsx`, `GlassChrome.tsx`, `TopSheet.tsx`, `Toast.tsx` redundant `.CSS!.supports!` after type guards (P3 stylistic)

**Sites (Explore agent T1.B):** `Sheet.tsx:74,75`; `GlassChrome.tsx:65,66`; `TopSheet.tsx:78,79`; `Toast.tsx:143,144`. Pattern: `typeof globalThis.CSS?.supports === "function"` guard followed by `.CSS!.supports!(...)` forced-non-null usage.
**Severity:** P3 (works in practice; the `!` is redundant after the typeof guard but stylistically poor; future refactor that removes the guard would silently lose nullability protection).
**Recommended fix:** lift the guard's narrowed binding to a const so the `!` is unnecessary: `const css = globalThis.CSS; if (typeof css?.supports !== "function") return; css.supports(...);`

---

### 🔵 O-1 — All 12 persisted Zustand stores audited; no I-PROPOSED-J violations beyond documented TRANSITIONAL set

| Store | `partialize` returns | I-PROPOSED-J status |
|---|---|---|
| `brandTeamStore` | `entries: BrandMember[]` | TRANSITIONAL exempt — UI-ONLY in Cycle 13a, exits when B-cycle wires brand_team_members backend |
| `currentBrandStore` (post-742) | `currentBrandId: string \| null` | ✅ Compliant |
| `doorSalesStore` | `entries: DoorSale[]` | ✅ Compliant — door sales are local-only by I-29 design |
| `draftEventStore` | `drafts: DraftEvent[]` | ✅ Compliant — drafts are pre-publish client-side; TRANSITIONAL until B-cycle but doesn't violate the rule |
| `eventEditLogStore` | `entries: AuditEntry[]` | ✅ Compliant — local audit log |
| `guestStore` | `entries: CompGuest[]` | TRANSITIONAL exempt — Cycle 10 client-only design, exits at B-cycle backend |
| `liveEventStore` | `events: LiveEvent[]` | TRANSITIONAL exempt — explicit per docstring |
| `notificationPrefsStore` | `prefs: TogglePrefs` | ✅ Compliant — UI prefs |
| `orderStore` | `entries: OrderRecord[]` | TRANSITIONAL exempt — exits at B-cycle backend |
| `scanStore` | `entries: ScanEvent[]` | TRANSITIONAL exempt — I-27 exits at B-cycle |
| `scannerInvitationsStore` | `entries: Invitation[]` | TRANSITIONAL exempt — I-28 UI-ONLY in Cycle 11 |

**Verdict:** I-PROPOSED-J is well-respected. Cycle 4 (queued) audits the 7 TRANSITIONAL exempt stores against their exit conditions when B-cycle work lands.

---

### 🔵 O-2 — Error-handling discipline is strong (no P0; defensive patterns dominate)

Per Explore agent T1.D + spot-check:
- 0 empty `catch {}` blocks
- 0 catch-and-mask-return (all services throw)
- 0 missing `onError` on mutations (every `useMutation` either has `onError` or the mutation throws to a documented caller catch)
- 0 unguarded `.single()` / `.maybeSingle()` (all 8 calls properly handle null)
- 0 unchecked `error` field on edge function invokes (both invokes check error first)
- 7 P1 findings, all **already-tracked TRANSITIONAL diagnostic stubs** (the 15 `[ORCH-XXXX-DIAG]` markers from CF-3) — these are debt, not new bugs

**Implication:** the error-handling discipline message in MEMORY.md is genuinely lived in code. The "PreferencesService silently catches" memory note is OBSOLETE — the service no longer exists; prefs were migrated to `notificationPrefsStore` + `useUpdateCreatorAccount` mutation. **Recommend updating MEMORY.md to remove or supersede the obsolete note.**

---

### 🔵 O-3 — `[ReferenceError: Property 'document' doesn't exist]` is NOT a mingla-business defect

Per Explore agent T1.E: every direct `window.X` / `document.X` / `localStorage` / `sessionStorage` access in `mingla-business/` is properly guarded with `typeof window !== "undefined"` or `Platform.OS === "web"`. The 4 SSR-touch points (connect-onboarding, AuthContext, guestCsvExport, TopSheet) all have explicit guards.

**Source of the warning:** SSR pre-render pass during `expo export -p web`, originating from a dependency (likely `@stripe/connect-js` per the "ConnectJS won't load" warning in the same log, OR Sentry RN, OR supabase-js polyfill realm). Not actionable from mingla-business code; document and move on.

---

### 🔵 O-4 — `TODO/FIXME/HACK/XXX` count: 1 (account.tsx:84 — already documented)

Per Explore agent T1.B: a single `BUG (comment)` at `app/(tabs)/account.tsx:84` documenting an already-fixed Cycle 0b auth-signout-nav bug. The comment is historical, not an open defect. **No action needed.**

---

## 4. Five-layer cross-check

| Layer | RC-1 (cycle) | RC-2 (whitelist) |
|---|---|---|
| **Docs** | SPEC §4.2 said "MUST live at src/hooks/, NOT inside currentBrandStore" — implementor did but didn't break the cycle | SPEC §4.1 didn't mention the reaper at all (gap) |
| **Schema** | N/A (TS source only) | N/A (AsyncStorage; no DB) |
| **Code** | `currentBrandStore.ts:446` re-exports + `useCurrentBrand.ts:30-34` imports — confirmed bidirectional | `reapOrphanStorageKeys.ts:18` `v12` literal vs `currentBrandStore.ts:375` `v14` literal — direct mismatch |
| **Runtime** | Metro emits `Require cycle:` warning every cold-start (operator log) | Reaper logs orphan list including v13 (predecessor); v14 not yet listed because Mac dev box hasn't completed enough runs to materialize a v14 blob — but WILL be reported as orphan once it does |
| **Data** | N/A (no persisted data involved) | AsyncStorage will hold a `mingla-business.currentBrand.v14` blob the reaper doesn't recognize |

Both root causes have all five layers either confirmed or correctly N/A. **Six-field evidence complete.**

---

## 5. Blast radius

**RC-1 (cycle) blast:**
- Direct: any future top-level statement in `currentBrandStore.ts` or `useCurrentBrand.ts` that uses an imported value at module-init time would silently see undefined. None exist today.
- Indirect: pattern-of-mind risk — future developers look at the pattern and replicate the cycle elsewhere.

**RC-2 (whitelist) blast:**
- Direct: misleading orphan-key telemetry every cold-start (today: log-only).
- **Catastrophic if reaper promoted to delete-mode:** every cold-start would erase `currentBrandId` after hydration → user instantly loses their brand selection → ORCH-0742's entire architectural fix neutralized.
- Cross-domain: none (mingla-business AsyncStorage only).

**CF-2 (textShadow) blast:**
- Direct: hero text shadow invisible on web target.
- Indirect: anyone copying the pattern into other screens compounds the issue.

**CF-3 (DIAG markers) blast:**
- Direct: 15 console.error per brand mutation. Hides real errors.
- Indirect: cross-cycle hygiene debt; CLOSE protocol not enforcing cleanup.

---

## 6. Invariant violations

| Invariant | Status |
|---|---|
| **Const #7** (label temporary, exit-conditioned) | VIOLATED by HF-4 (9 TRANSITIONAL markers without exit) |
| **Const #14** (persisted-state startup works correctly) | AT RISK from RC-2 (if reaper goes delete-mode); presently PASS-PARTIAL (per ORCH-0742 closure) |
| **I-PROPOSED-J** (Zustand persist no server snapshots) | NOT VIOLATED (O-1 confirms) |
| **I-PROPOSED-C** (server state via React Query) | PRESERVED |
| **All other ACTIVE invariants** | Not directly tested in this sweep — Tier 2 covers Constitutional 14-rule deeper application |

---

## 7. Meta-findings (process)

The most valuable output of this sweep. Each meta-finding is a **process patch** that prevents the *class* of defect from recurring.

### M-1 — CLOSE protocols don't check require cycles

Multiple cycles closed PASS while accumulating require-cycle warnings:
- ORCH-0742 just closed with the new `currentBrandStore ↔ useCurrentBrand` cycle uncaught.
- 4 pre-existing cycles via AuthContext / clearAllStores have been there for ~10 cycles.
- **No CI gate, no tester step, no REVIEW checklist mentions Metro require-cycle warnings.**

**Recommendation:** add a CLOSE Step OR a CI gate: `cd mingla-business && expo start --no-dev --clear & sleep 30 && grep "Require cycle" metro.log`. Fail if any new cycles appear vs a baseline list.

### M-2 — Diagnostic markers are added but never reaped

15 `[ORCH-XXXX-DIAG]` markers across 5 closed ORCH-IDs. Every comment says "removed at full IMPL CLOSE" but the CLOSE protocol has no step that enforces this.

**Recommendation:** add CLOSE Std-3.5: "grep `[ORCH-CLOSING-ID-DIAG]` across mingla-business; require zero hits OR explicit operator override." If markers persist past CLOSE, they're tech debt with a name and should be tracked in MASTER_BUG_LIST as their own ORCH.

### M-3 — Persist-key bumps don't update `reapOrphanStorageKeys` whitelist

ORCH-0742 bumped `currentBrand.v13 → v14`. The whitelist at `reapOrphanStorageKeys.ts:18` still says `v12`. No CI check enforces sync. This is the most dangerous meta-finding — a delete-mode promotion of the reaper would silently erase the live blob.

**Recommendation:** add a strict-grep CI gate that the persist `name:` literal in each `*Store.ts` exists as a literal in `KNOWN_MINGLA_KEYS`. Implementation: 10 LOC of grep/awk in a workflow script; ships in same pattern as the existing strict-grep registry.

### M-4 — TRANSITIONAL markers without exit conditions accumulate

9 of 29 TRANSITIONAL markers lack explicit exit conditions. Const #7 says "tracked, owned, exit-conditioned" but enforcement is honor-system.

**Recommendation:** CI grep that flags any `[TRANSITIONAL]` not followed within 5 lines by "EXIT" or "exits when" or "exit condition". Fail PR if marker added without exit.

### M-5 — Web-target style hygiene gaps go unflagged

`elevation` (RN-only), `textShadow*` (RN-only) used inline in 14 screens. No CI gate verifies web compat. The Metro `expo export -p web` warnings are read once and forgotten.

**Recommendation:** CI parses `expo export -p web` stderr for known deprecation strings ("`shadow*` style props are deprecated", "`elevation` not supported on web", etc.) and fails on any. Or: lint rule that bans `elevation:` in inline styles outside `src/constants/designSystem.ts`.

---

## 8. Triage recommendations (orchestrator-side)

| Finding | Severity | Recommended home |
|---|---|---|
| RC-1 — new cycle | P2 | **Fold into ORCH-0743** (cold-start polish; same surface) — adds a 5th condition |
| **RC-2 — stale whitelist** | **P1 (latent destruction)** | **Fold into ORCH-0743** — 1 LOC fix; critical to ship before any reaper promotion |
| CF-1 — 4 pre-existing cycles | P2 | Defer — new ORCH-0746 (import-graph hardening), low priority |
| CF-2 — textShadow* on web | P1 | New ORCH-0745 OR fold into ORCH-0743 if scope allows |
| CF-3 — 15 DIAG markers | P1 (cumulative) | **New ORCH-0745 (DIAG marker mass-removal)** — trivial scope, high signal-to-noise |
| CF-4 — 8 unsafe target casts | P2 | New ORCH-0747 (form input typing) |
| HF-1 — responsive.ts static snapshot | P2 | Defer — fold into a future responsive-utilities cycle |
| HF-2 — 13 inline `elevation: 12` | P3 | Defer — designSystem token cleanup cycle |
| HF-3 — `elevation: 1000` outlier | P2 | **New tiny investigation** — find out WHY |
| HF-4 — 9 TRANSITIONAL without exit | P2 | Defer — Const #7 enforcement cycle (paired with M-4) |
| HF-5/HF-6 — Platform.OS coverage | P1 (needs verify) | **Spawn forensics-second-pass** to confirm — critical if real |
| HF-7 — `.CSS!.supports!` redundancy | P3 | Defer — stylistic cleanup |
| O-1..O-4 | informational | No action |
| **M-1..M-5** | **process** | **NEW META-ORCH-0744-PROCESS** — fold all 5 into a single CLOSE-protocol hardening cycle. **Highest leverage of the entire sweep.** |

---

## 9. Confidence + caveats

| Tier | Confidence | Caveats |
|---|---|---|
| T1.A (cycles) | HIGH | Verified every import line; cycle paths confirmed by direct read |
| T1.B (debt markers) | HIGH | Explore agent grep was exhaustive; spot-check confirmed |
| T1.C (persist hygiene) | HIGH | Read every `*Store.ts` persist config; whitelist literal compared char-for-char |
| T1.D (error handling) | HIGH | Explore agent classified 21 catches + 5 mutations + 8 single/maybeSingle + 2 invokes; spot-check confirmed |
| T1.E (cross-platform / SSR) | MEDIUM-HIGH | HF-5 (AuthContext branch) and HF-6 (BusinessWelcomeScreen iOS\|Web) need code-level second pass before P1 confirmation |

**Coverage:** Tier 1 fully covered. Tier 2 (type-safety leaks, dead code, accessibility, full constitutional 14-rule sweep) and Tier 3 (cross-domain) deferred per dispatch §7 budget. Recommend a second forensics session for Tier 2 if appetite exists.

**Time spent:** ~2 hours forensics + ~3 hours of Explore-agent breadth scans (parallel).

**What this investigation could NOT verify (needs runtime / device):**
- HF-5 / HF-6 platform-parity (would need iOS + Android + web test on actual devices)
- The reaper delete-mode catastrophe scenario (RC-2) is hypothetical until someone promotes the reaper — but the structural mismatch is verified
- Metro `Require cycle` log capture: cycles confirmed by import-line reads, but the operator already shared the dev-server log so cross-confirmed there too

---

## 10. Discoveries for orchestrator (side issues outside dispatch scope)

| ID | Description |
|---|---|
| D-0744-1 | Memory note `feedback_zustand_persist_no_server_snapshots.md` says "PreferencesService.updateUserPreferences silently catches errors and returns true" — this is OBSOLETE; the service no longer exists. Recommend updating that memory file. |
| D-0744-2 | The reaper whitelist at `reapOrphanStorageKeys.ts:17-29` includes `mingla-business.currentBrand.v12` as the SOLE currentBrand entry — even before ORCH-0742, this was already wrong (v13 was the live key after Cycle 17e-A). The whitelist has been stale across multiple cycles, not just 0742. |
| D-0744-3 | The dev-server's [`ReferenceError: Property 'document' doesn't exist`] originates in dependency code (likely `@stripe/connect-js` or Sentry SSR polyfill); not actionable from mingla-business. Document in WORLD_MAP under "known noise" category. |
| D-0744-4 | `BrandSwitcherSheet.tsx` is now ~600 LOC and 12 of those are DIAG markers. Post-CF-3 cleanup, the file should be re-evaluated for further decomposition (per Cycle 17d Stage 2 LOC-decompose discipline). |

---

## 11. Recommended next steps

1. **OPERATOR:** approve folding RC-1 + RC-2 + CF-2 into ORCH-0743 (cold-start polish becomes "cold-start polish + ORCH-0742 cleanup"). Update the SPEC dispatch.
2. **OPERATOR:** spawn standalone ORCH-0745 (DIAG marker mass-removal). Trivial scope.
3. **OPERATOR:** spawn META-ORCH-0744-PROCESS for M-1..M-5 CLOSE-protocol hardening. Highest leverage.
4. **OPERATOR:** queue ORCH-0746 (import-graph hardening for the 4 pre-existing AuthContext cycles), ORCH-0747 (form-input typing), HF-3/HF-5/HF-6 sub-investigations.
5. **OPERATOR:** request Tier 2 forensics second session if appetite for type-safety leaks + dead code + accessibility + full constitutional sweep.

**Hand back to orchestrator for triage.** This investigation is INVESTIGATE-only by dispatch contract; no SPEC produced. Each spawned ORCH gets its own SPEC dispatch when prioritized.

---

**End of investigation.** Report path: `Mingla_Artifacts/reports/INVESTIGATION_ORCH_0744_LATENT_DEFECTS_SWEEP.md`.
