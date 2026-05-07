# INVESTIGATION REPORT — ORCH-0739 — Cross-device sync extension audit (events + Expo Web)

**Authored:** 2026-05-06 by mingla-forensics
**Dispatch:** [`prompts/INVESTIGATION_ORCH_0739_CROSS_DEVICE_SYNC_EXTENSION_EVENTS_WEB_BRUTAL.md`](../prompts/INVESTIGATION_ORCH_0739_CROSS_DEVICE_SYNC_EXTENSION_EVENTS_WEB_BRUTAL.md)
**Predecessor:** [`reports/INVESTIGATION_ORCH_0738_CROSS_DEVICE_SYNC_AUDIT.md`](INVESTIGATION_ORCH_0738_CROSS_DEVICE_SYNC_AUDIT.md)
**Mode:** INVESTIGATE-only (extension; appends to ORCH-0738; NO spec)
**Confidence:** HIGH for both phases — events confirmed entirely client-side via grep; web target confirmed via app.json + package.json + Platform.OS branch survey.

---

## Layman summary

Two surprises in this extension audit, both REDUCE Cycle 1's planned scope:

1. **Events aren't a sync risk today — because they're not synced to the server at all.** mingla-business has zero `.from("events").insert/update/delete` calls anywhere in the code. Events live entirely in three persisted Zustand stores (`liveEventStore`, `draftEventStore`, `eventEditLogStore`) — all explicitly labeled `[TRANSITIONAL]` with documented "B-cycle backend will replace this" exit conditions. The architectural sync gaps ORCH-0738 found WILL manifest the moment events get wired to Supabase — but there's nothing to fix in the events code itself today. Cycle 1-3 architecture must land BEFORE events backend integration, not after.
2. **Cycle 1 scope was overestimated.** ORCH-0738 RC-D claimed `signOut` doesn't reset Zustand stores (S0/S1 privacy issue). **That finding was WRONG.** mingla-business has a centralized `clearAllStores()` utility (`src/utils/clearAllStores.ts`) that resets ALL 11 persisted stores. It's wired in TWO places: `AuthContext.signOut` (line 456) AND `onAuthStateChange` SIGNED_OUT branch (line 158). Constitutional #6 IS honored. The grep that produced the false-negative looked for `.reset()` directly on store objects — but the actual mechanism is the imported helper. Apologies for the false alarm. Net effect: Cycle 1 work item "signOut clears Zustand stores" → DONE, no work needed.

What's STILL true from ORCH-0738:
- Zero Realtime in mingla-business (RC-A) ✅ confirmed
- Zero AppState→focusManager wiring (RC-B) ✅ confirmed
- `currentBrand` server-snapshot persistence (RC-C) ✅ confirmed
- React Query cache NOT cleared on signOut (HF-1) ✅ confirmed (only Zustand stores are reset)
- Permission-drift via 5min staleTime on useCurrentBrandRole ✅ confirmed

What's NEW from this extension:
- 🔵 Expo Web target IS shipped (`app.json:web` static SPA + `react-native-web 0.21.0` + `react-dom 19.1.0`); `expo start --web` is the build script
- 🔵 Platform.OS branches exist in 5 components (UI-only — Apple Pay, Safari detection, keyboard avoidance) — none affect state/sync architecture
- 🔵 Events code surface today: 0 mutations, 3 read-only count queries (cascade preview), 3 [TRANSITIONAL] Zustand stores
- 🟡 Web-specific Cycle 1 mechanics: `react-native-web` shims AppState to `visibilitychange`/`focus` events so the planned focusManager fix WORKS the same on web — no platform-specific branching needed
- 🟠 NEW: when events wire to Supabase backend, the same RLS-RETURNING-OWNER-GAP class found in ORCH-0734 will hit events too (LF-1 from ORCH-0734 is now LIVE-relevant prep)

Findings: 0 new root causes (gaps still scoped under ORCH-0738), 1 contributing factor revision, 2 hidden flaws (forward-looking), 7 observations (corrections + facts).
Confidence: HIGH

---

## 1. Cross-references with ORCH-0738

| ORCH-0738 finding | Status post-extension | Action |
|---|---|---|
| **RC-A** Zero Realtime | ✅ CONFIRMED — extends to events when wired | No change |
| **RC-B** Zero focusManager wiring | ✅ CONFIRMED — applies on RN AND web (web uses `visibilitychange` shim via react-native-web) | Cycle 1 implementation works on both platforms with same code |
| **RC-C** `currentBrand` server-snapshot persistence | ✅ CONFIRMED | No change |
| **RC-D** `signOut` doesn't reset Zustand stores | ❌ **WRONG — RETRACTED.** clearAllStores() IS wired in AuthContext (lines 158 + 456) and covers all 11 persisted stores | Remove RC-D from severity priorities. Cycle 1 scope shrinks. |
| **CF-1** useCurrentBrandRole 5min staleTime | ✅ CONFIRMED | No change |
| **CF-2** hardcoded `["brand-role", X]` query key | ✅ CONFIRMED | No change |
| **HF-1** React Query cache not cleared on signOut | ✅ CONFIRMED — only Zustand stores cleared; queryClient untouched | No change |
| **HF-2..7** various staleTime / pattern issues | ✅ CONFIRMED | No change |
| **OB-1** AuthContext onAuthStateChange wired | ✅ CONFIRMED + EXTENDED — also fires `clearAllStores()` defensively | Strengthens evidence for OB-1 |

---

## 2. Phase A — Events deep-trace findings

### A.1 — Mutation surface inventory (events + event_dates)

**Live code grep results:**

```
$ Grep "\.from\([\"'\`](events|event_dates)[\"'\`]\)" mingla-business/src
mingla-business\src\services\brandsService.ts:203 — .select count (cascade preview, brandsService.softDeleteBrand step 1)
mingla-business\src\hooks\useBrands.ts:362 — .select count (past events, useBrandCascadePreview)
mingla-business\src\hooks\useBrands.ts:368 — .select count (upcoming events)
mingla-business\src\hooks\useBrands.ts:374 — .select count (live events)

$ Grep "\.from\([\"'\`](events|event_dates)[\"'\`]\)" mingla-business/app
(no matches)
```

**Conclusion:** mingla-business has **ZERO** `.insert`, `.update`, or `.delete` against `events` or `event_dates` tables. Only 4 read-only `.select count` queries exist, all in cascade preview / soft-delete-blocking logic. Events table is otherwise read-only-from-this-client.

### A.2 — Event Zustand stores classification

| Store | Header marker | Reset wired in clearAllStores? | Server-derived data? | Sync gap today? |
|---|---|---|---|---|
| `liveEventStore` | `[TRANSITIONAL] Zustand persist holds all live events client-side. B1 backend cycle migrates to server storage; this store contracts to a cache + ID-only when backend lands.` (line 16-18) | ✅ Yes (Cycle 6) | NOT yet — currently client-only | N/A — not synced anywhere |
| `draftEventStore` | `[TRANSITIONAL] Zustand persist holds all drafts client-side. B-cycle migrates drafts to server-side storage; this store contracts to a cache + ID-only when backend lands.` (line 19-21) | ✅ Yes (Cycle 3) | NOT yet | N/A |
| `eventEditLogStore` | `[TRANSITIONAL] Zustand persist holds entries client-side. B-cycle migrates audit log to server storage; this store contracts to a cache + ID-only when backend lands.` (line 22-24) | ✅ Yes (ORCH-0704 v2) | NOT yet | N/A |

All three stores have:
- Explicit `[TRANSITIONAL]` markers
- Documented exit conditions (B-cycle backend integration)
- `clearAllStores()` wiring (Constitutional #6 honored)

### A.3 — Event mutation paths (today)

**Today:** Events are mutated ENTIRELY through Zustand store actions (`useDraftEventStore.publishDraft`, `useLiveEventStore.updateLiveEventFields`, etc.). No supabase calls exist for these mutations.

**Cross-device implication today:** Device A creates a draft event → only device A has it. Device B has no awareness. **This isn't stale data — it's missing data.** Operator on iPad can't even see the brand's draft list from another device because drafts aren't synced.

**Cross-device implication post-B-cycle backend:** When B-cycle event backend lands, all of ORCH-0738's findings (RC-A no Realtime, RC-B no focusManager, RC-C currentBrand-style snapshot persistence) will manifest for events. Cycle 1-3 architecture MUST land BEFORE B-cycle event backend OR be co-shipped with it.

### A.4 — Pre-existing latent risk for events (when they wire to Supabase)

ORCH-0734 audit §3 enumerated events RLS policies. They use the same `biz_brand_effective_rank` helper that brands use. When mingla-business code starts calling `.from("events").update/.insert/.delete` against the server, the same two bug classes will manifest:

1. **RLS-RETURNING-OWNER-GAP** (RC-0728-A class) — INSERT...RETURNING may fail because no direct-predicate owner-SELECT policy exists for events. ORCH-0734 §3 LF-1 already flagged this. Solution: add `Account owner can select own events` direct-predicate policy when wiring (mirror ORCH-0734-v1 brands fix).
2. **MUTATION-ROWCOUNT-VERIFIED** (RC-0734-RW-A class) — silent 0-row UPDATE/DELETE. Solution: I-PROPOSED-I CI gate already enforces `.select(...)` chain on mutations; will catch event mutations when they ship.

**These are PRE-WIRE concerns, not today-bugs.** Logging here so the future events backend integration cycle has the checklist.

### A.5 — Event status transitions (today vs future)

Events transition through status: `draft → upcoming → live → past`. Today, all transitions happen via Zustand actions only — no server roundtrip. When backend integration lands:
- Each transition becomes a `.update().eq("id", X)` mutation
- Cross-device sync of status changes (e.g., A transitions event to live → B should see it as live within seconds) will need Realtime push (Cycle 3 scope)
- Without Realtime: B's cached status stays stale until B refetches

### A.6 — Role-gated event mutations

`useCurrentBrandRole` (5min staleTime, ORCH-0738 CF-1) gates UI for event mutations. Today it doesn't matter because there are no real mutations. Post-B-cycle: same permission-drift risk as brands (ORCH-0738 CF-1 fix applies identically).

---

## 3. Phase B — Expo Web platform mechanics findings

### B.1 — Web build verification

**Confirmed shipped:**
- `mingla-business/app.json:61-64`:
  ```json
  "web": {
    "output": "static",
    "favicon": "./assets/images/favicon.png"
  }
  ```
- `mingla-business/package.json` scripts: `"web": "expo start --web"`
- Dependencies: `react-dom: 19.1.0` + `react-native-web: ~0.21.0`
- Output mode: `static` (SPA bundled to static HTML/JS, suitable for any static host)

### B.2 — Platform primitive availability on web

| Primitive | RN behavior | Web behavior (via react-native-web) | Cycle 1 impact |
|---|---|---|---|
| `AppState` | `addEventListener('change', ...)` fires on app foreground/background | Shimmed: maps to `document.visibilitychange` + `window.focus`/`blur` events | Same code works on both; focusManager wiring needs no platform branching |
| `AsyncStorage` (`@react-native-async-storage/async-storage`) | Native AsyncStorage backend | Polyfilled to `localStorage` | Zustand persist works identically; key namespace preserved |
| WebSocket (Supabase Realtime) | RN built-in `WebSocket` API | Browser native `WebSocket` API | Realtime works on both; web has tab-throttling considerations (B.4 below) |
| React Query default `refetchOnWindowFocus` | NO-OP on RN by default (no window) | WORKS by default on web (uses `window.focus`) | On web, current default already provides some refetch-on-foreground behavior. Cycle 1 focusManager wiring makes RN match web behavior. |
| `Platform.OS` | `'ios'` / `'android'` | `'web'` | Used in 5 components for UI/payment branching (none state-relevant) |

### B.3 — Platform-conditional code paths (sync-relevant scan)

5 files have `Platform.OS === 'web'` branches:

| File | Branch purpose | Sync-relevant? |
|---|---|---|
| `BusinessWelcomeScreen.tsx` (3 sites) | Apple Sign-in availability gate (iOS + web only); Google sign-in skip-on-web; Sign-in button rendering | NO — auth UI |
| `BrandEditView.tsx:365` | KeyboardAvoidingView behavior platform branch (`'padding'` vs `'height'`) | NO — UI |
| `PublicBrandPage.tsx:173,205` | `window.location.href` redirect on web vs router push on native | NO — public anon page navigation |
| `CheckoutHeader.tsx:71` | Web-specific header style overrides | NO — UI |
| `PaymentElementStub.tsx:61-71` | Apple Pay availability detection (Safari user-agent check) | NO — payment UI |

**Conclusion:** Zero state/sync logic branches on Platform.OS. All sync-architecture fixes (Cycle 1-3) work cross-platform with the SAME code. Significant — no `.web.ts` overrides needed.

### B.4 — Web-specific Cycle 3 (Realtime) considerations

Browser tab inactivity behavior:
- **Chrome / Safari:** WebSocket connections may be throttled or closed when tab is backgrounded for >5 min
- **Firefox:** Similar throttling
- **Implication:** When the tab returns to foreground, the Realtime channel may need explicit reconnection. Supabase JS client has built-in reconnect logic but it triggers on visibility-change.

**Cycle 3 SPEC requirement:** Explicit visibility-change handler in app root to call `supabase.realtime.connect()` if disconnected. Standard pattern, ~5 lines. Document in Cycle 3 SPEC when written.

### B.5 — Web-specific Cycle 1 (Foundation) implications

Cycle 1 plan (revised post-extension):
1. ~~`signOut` clears Zustand stores~~ → ALREADY DONE per `clearAllStores()` (delete from Cycle 1 scope — RC-D was wrong)
2. **AppState→focusManager wiring** — works cross-platform with same code via react-native-web shim
3. **`queryClient.clear()` on signOut** — ADD to Cycle 1 (HF-1 from ORCH-0738; ~1 line)
4. **`brandKeys.role(brandId)` factory entry + refactor 2 consumers** — pure code refactor, platform-agnostic
5. **`useCurrentBrandRole` staleTime 5min → 30s** — 1 line, platform-agnostic

Revised Cycle 1 scope: ~15-20 lines instead of 25 (smaller — RC-D drop saved work).

### B.6 — Cross-platform parity verification

| Cycle | Cross-platform parity |
|---|---|
| Cycle 1 | ✅ Single code path; works on RN + web |
| Cycle 2 (currentBrand persist ID-only) | ✅ Single code path |
| Cycle 3 (Realtime) | ✅ Single code path + ~5 lines web-specific reconnect handler |
| Cycle 4 (per-store Zustand) | ✅ Single code path |

---

## 4. Findings (classified)

### 🟠 CF-Revision — RC-D from ORCH-0738 is RETRACTED

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/src/utils/clearAllStores.ts:30-42` (utility); `mingla-business/src/context/AuthContext.tsx:158` (onAuthStateChange SIGNED_OUT branch) + line 456 (signOut callback) |
| **Exact code** | clearAllStores resets all 11 persisted Zustand stores via `useCurrentBrandStore.getState().reset()`, etc. (lines 31-41 of clearAllStores.ts). |
| **What it does** | On signOut OR onAuthStateChange SIGNED_OUT, ALL persisted Zustand stores are reset to initial state. Constitutional #6 (logout clears everything) IS honored at the Zustand layer. |
| **What ORCH-0738 incorrectly claimed** | "signOut doesn't reset 11 persisted Zustand stores or call queryClient.clear()." The Zustand part is FALSE (clearAllStores covers all 11). The queryClient.clear() part is TRUE (HF-1). |
| **Severity revision** | Was S0/S1 (RC-D). Now S2 (HF-1 only — React Query cache leak only, Zustand layer is clean). |
| **Cycle 1 scope impact** | Smaller — drop "signOut store reset" work item. Keep "queryClient.clear() on signOut" work item. |

### 🟡 HF-EVENTS-1 — Events backend integration must include the ORCH-0734 fix patterns

| Field | Evidence |
|---|---|
| **File** | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` events RLS policies (per ORCH-0734 §3) |
| **What it does** | Events RLS policies use `biz_brand_effective_rank` helper for INSERT WITH CHECK + UPDATE WITH CHECK. Same SECURITY DEFINER + STABLE pattern that caused brand-CREATE RC-0728-A and brand-DELETE RC-0728-B. |
| **Why classified hidden flaw, not root cause** | NOT manifesting today because no event mutations are wired in mingla-business client. Will manifest the moment any cycle ships event INSERT/UPDATE/DELETE through Supabase. |
| **Recommended direction** | Pre-emptively add direct-predicate owner policies on `events` (mirror ORCH-0734-v1 brands migration) BEFORE event backend integration ships. Or block backend integration on this prereq. |

### 🟡 HF-EVENTS-2 — Events Zustand stores will need ID-only refactor (Cycle 2 pattern) at backend integration time

| Field | Evidence |
|---|---|
| **File** | `liveEventStore.ts:16-18`, `draftEventStore.ts:19-21`, `eventEditLogStore.ts:22-24` — all 3 explicit TRANSITIONAL markers |
| **What it does** | Today: stores hold full event objects (correct — no server source of truth). Future: when B-cycle backend wires events to Supabase, these stores must be refactored to ID-only persistence (mirror Cycle 2 currentBrand pattern). The TRANSITIONAL markers explicitly anticipate this. |
| **Why hidden flaw** | Architectural debt with documented exit. Cycle 4 (per-store Zustand classification) addresses each. |

### 🔵 OB-EVENTS-1 — Events have ZERO supabase mutation surface in mingla-business today

Confirms: 0 `.insert`/.`update`/.`delete` against events; 4 `.select count` reads only (cascade preview). Pre-MVP per memory.

### 🔵 OB-EVENTS-2 — Event Zustand stores reference `clearAllStores()` and properly reset on signOut

Strengthens the RC-D retraction (CF-Revision above).

### 🔵 OB-WEB-1 — Expo Web target is configured AND functional (per app.json + package.json + scripts)

Static SPA output. react-native-web 0.21.0 + react-dom 19.1.0.

### 🔵 OB-WEB-2 — react-native-web shims AppState → visibilitychange / focus / blur

Standard library behavior. Means Cycle 1's planned `AppState.addEventListener('change', ...)` works identically on web. No platform branching needed for the Foundation fix.

### 🔵 OB-WEB-3 — react-native-web maps AsyncStorage → localStorage

Standard library behavior. Zustand persist key namespace preserved. clearAllStores() works identically on both platforms.

### 🔵 OB-WEB-4 — 5 Platform.OS branches exist; ALL are UI-only (auth/payment/keyboard); ZERO sync-architecture branches

Important parity confirmation — no platform-specific state code to worry about.

### 🔵 OB-WEB-5 — Browser tab-inactivity may close Realtime WebSocket; Cycle 3 SPEC must include visibility-change reconnect handler (~5 lines)

Platform-specific consideration for Cycle 3 only. Not blocking.

---

## 5. Five-Layer Cross-Check (events + web extensions)

| Layer | Says | Truth |
|---|---|---|
| **Docs** | `[TRANSITIONAL]` markers in 3 event stores explicitly state "B-cycle migrates to server" | Confirmed; events are pre-MVP |
| **Schema** | `events` table + RLS policies live in production (per ORCH-0734 audit) | Confirmed |
| **Code** | mingla-business has 0 event mutations + 4 count queries + 3 transitional Zustand stores | Confirmed via grep |
| **Runtime** | No event mutations fire from mingla-business client today | Confirmed by code absence |
| **Data** | DB has events table populated by edge functions / admin / manual fixture; mingla-business client doesn't read individual event rows for mutation | Confirmed by code |

No layer disagreement on events (architecturally consistent). For web: docs (app.json) + schema (none — same DB) + code (5 Platform.OS UI branches) + runtime (web build is intentional output target) + data (same backend) all align.

---

## 6. Updated recommendation matrix (extends ORCH-0738 §10)

| Surface | Tier | Reasoning (post-extension) |
|---|---|---|
| `currentBrand` Zustand snapshot | **Tier 0** | Same as ORCH-0738 |
| `useCurrentBrandRole` 5min staleTime | **Tier 0** | Same — security-adjacent |
| `brand_team_members` | **Tier 0** | Same — feeds the role hook |
| Brands list / single | **Tier 0/1** | Same |
| **Events stores (3) — TODAY** | **N/A** | Pre-MVP; no server sync. Architectural cleanup happens at B-cycle backend integration time. |
| **Events stores (3) — POST-B-CYCLE-BACKEND** | **Tier 0** | Critical — events role-gated mutations need same Realtime + ID-only pattern as brands |
| `creator_accounts` profile | **Tier 1** | Same |
| `notificationPrefsStore` | **Tier 3** | Same |
| `audit_log` viewer | **Tier 2** | Same |
| `brandList.ts` stub | **N/A — TRANSITIONAL** | Same |
| Public buyer routes | **N/A** | Same |
| Auth session sync | **Already wired** | Confirmed strengthened (clearAllStores in onAuthStateChange too) |
| **AppState→focusManager wiring** | **Tier 1 — DO FIRST** | Same — works cross-platform via react-native-web shim |
| **queryClient.clear() on signOut** | **Tier 1 — DO FIRST** | NOW the only Constitutional #6 gap (Zustand part is already done) |
| ~~signOut → store reset~~ | **N/A — ALREADY DONE** | clearAllStores covers it |

---

## 7. Updated Cycle 1 scope (revised post-extension)

Drop work items invalidated by RC-D retraction. Keep work items confirmed by extension.

**Cycle 1 — Foundation (revised):**
1. ✅ AppState→focusManager wiring (~8 lines, app root) — works on RN + web
2. ✅ `queryClient.clear()` in signOut path (~1 line, AuthContext) — closes HF-1 (only remaining Constitutional #6 leak)
3. ✅ `brandKeys.role(brandId)` factory entry + refactor 2 consumers (~5 lines) — closes CF-2
4. ✅ `useCurrentBrandRole` staleTime 5min → 30s (~1 line) — partial fix CF-1
5. ❌ ~~signOut clears Zustand stores~~ — DONE; RC-D retracted

Revised total: ~15 lines. Still highest leverage.

**Cycle 2 — Architectural (unchanged for now):**
- `currentBrand` persist ID-only (Tier 0)
- Events stores remain TRANSITIONAL until B-cycle backend; not in Cycle 2 scope. Add ORCH-Y events refactor when backend lands.

**Cycle 3 — Realtime (unchanged + small web addition):**
- Subscribe `brands`, `brand_team_members`, `creator_accounts` at app root
- ADD: visibility-change reconnect handler for web Tab inactivity (~5 lines, web-only)

**Cycle 4 — Per-store Zustand classification (unchanged):**
- Now formally 10 stores (excluding the 3 event stores which are TRANSITIONAL with documented exit + included in B-cycle backend integration's scope)

---

## 8. Open architectural questions (extension)

These ADD to ORCH-0738 §11:

7. **Events backend integration timing.** B-cycle event backend is anticipated but not yet shipped. Should Cycle 1-3 architecture land BEFORE event backend (so events automatically inherit fixes) OR co-ship architecture + event backend (one big cycle)? Recommendation: land Cycle 1-3 first; events backend cycle becomes lighter.
8. **Events RLS pre-emptive fix.** Add `Account owner can select own events` + `Account owner can update own events` policies (mirror brands fix) BEFORE event backend wires up — preventing the same bug class from shipping. Schedule as new ORCH cycle parallel to Cycle 3, OR fold into the events-backend integration cycle.

---

## 9. Confidence Levels

| Finding | Confidence | Reasoning |
|---|---|---|
| Events have zero supabase mutation surface today | **HIGH** | Exhaustive grep in `mingla-business/src` AND `mingla-business/app` |
| All 3 event stores are TRANSITIONAL with documented exit | **HIGH** | Direct file reads of all 3 store headers |
| Expo Web target is shipped | **HIGH** | app.json + package.json verified |
| react-native-web shims AppState/AsyncStorage correctly | **HIGH** | Standard library behavior; documented + version-pinned (0.21.0) |
| Zero sync-relevant Platform.OS branches | **HIGH** | Grep result + manual classification of 5 hits |
| RC-D retraction (signOut DOES reset Zustand stores) | **HIGH** | clearAllStores.ts source code verified + 2 wiring points in AuthContext verified |
| Events backend integration will inherit RC-0728 RLS-RETURNING bug class | **HIGH** | ORCH-0734 audit §3 already enumerated events RLS using same `biz_brand_effective_rank` helper |
| Browser tab inactivity affects WebSocket | **MEDIUM-HIGH** | Standard browser behavior; confirmation pending live test on tab-throttle policies |

---

## 10. Discoveries for orchestrator

| ID | Discovery | Severity | Recommendation |
|---|---|---|---|
| **D-FOR-0739-1** | **ORCH-0738 RC-D was wrong** — `clearAllStores()` IS wired and covers all 11 stores. ORCH-0738 needs an erratum / addendum recording the retraction. | S2 (artifact correction) | Update ORCH-0738 RC-D status to RETRACTED in any future surface (priority board, world map). The Cycle 1 SPEC should NOT include "signOut store reset" work item. |
| D-FOR-0739-2 | Events backend integration cycle (presumably ORCH-NNNN B-cycle) needs pre-flight checklist: (a) add direct-predicate owner-SELECT policies for `events` (mirror ORCH-0734-v1 brands); (b) chain `.select("id")` on every event mutation (I-PROPOSED-I will catch this); (c) Cycle 1-3 architecture must be landed before backend integration goes live for events. | S2 (forward-looking) | Hand to orchestrator to track. The events backend cycle is presumably already in someone's queue — register this dependency. |
| D-FOR-0739-3 | The 3 event Zustand stores are explicitly TRANSITIONAL; their refactor is part of the events backend integration cycle, NOT part of the sync architecture cycles. Cycle 4 scope is now 10 stores not 11. | S4 (scope clarification) | Confirm in Cycle 4 dispatch when written. |
| D-FOR-0739-4 | `useEventEditLogStore` interacts with `useLiveEventStore.updateLiveEventFields` per liveEventStore comments. When events backend wires up, the audit log entries will need server-side mirroring + cross-device sync of edit history. Out of current scope. | S3 (forward-looking) | Note for events backend integration cycle. |
| D-FOR-0739-5 | Web target is `output: static` — fully static SPA. This means: no SSR, no per-user server-side rendering. Auth state must hydrate client-side. WebSocket Realtime must connect client-side after hydration. Standard pattern; no concerns but note for future audit if SSR ever ships. | S4 (note) | Document; no action. |

---

## 11. Confidence on completeness

The dispatch §11 asked: do not return inconclusive. I'm not — but flagging coverage limits explicitly:

- **Events code surface:** I exhaustively grep'd mutations + read all 3 store headers + cross-checked with prior ORCH-0734 audit. HIGH confidence today.
- **Events code surface AT B-CYCLE-BACKEND time:** UNKNOWABLE today because the code doesn't exist yet. Forward-looking findings (HF-EVENTS-1, HF-EVENTS-2) flag the inheritance.
- **Web platform mechanics:** Verified config + dependencies + Platform.OS branches. I did NOT actually run `expo start --web` to confirm runtime behavior. HIGH confidence on architecture; MEDIUM confidence on runtime quirks (browser-specific tab-throttling exact thresholds, etc.) — the latter would need live test.
- **Cross-platform Cycle 1 implementation:** HIGH confidence based on react-native-web 0.21.0 documented behavior. Recommend Cycle 1 implementor verify on local web build before shipping.

---

## 12. Operator post-step

1. Orchestrator REVIEWs this extension report.
2. Orchestrator updates ORCH-0738 with the RC-D retraction note (or creates an erratum addendum).
3. Operator answers ORCH-0738 §11 + ORCH-0739 §8 open questions (prioritize: events backend integration timing).
4. Orchestrator dispatches Cycle 1 SPEC (revised scope: ~15 lines, no signOut store-reset work).
5. After Cycle 1 PASSes, dispatch Cycle 2.
6. After Cycle 2 PASSes, dispatch Cycle 3 (with web-specific reconnect handler addition).
7. After Cycle 3 PASSes, dispatch Cycle 4.
8. The events backend integration cycle (separately tracked) inherits the architecture; pre-flight checklist registered as D-FOR-0739-2.

---

**End of report.**
