# INVESTIGATE — ORCH-1145 "navigate away from the Hub tab lands on an error"

- **ORCH:** ORCH-1145 (venue listing → Hub "Venue" tab, Phase-1 move-only)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1145-[venue-hub-tab]/` · branch `ORCH-1145-venue-hub-tab`
- **Commit under test:** `1e2a3badcee4d805922d2f422eb5c880c3444562`
- **Reporter:** Seth (pre-merge dev-channel testing) — "navigating away from the hub tab i land on an error."
- **Mode:** INVESTIGATE (read-only — NO fix proposed)
- **Confidence:** `root cause probable` (exhaustive code-trace + the exact `+not-found` "error" screen identified; live-fire blocked by a named blocker — see Repro Evidence). Source-trace is conclusive and deterministic, not a timing heisenbug.

---

## 1. Symptom summary (expected vs actual)

| | |
|---|---|
| **Expected** | Tester moves between the Hub bottom-tab and other surfaces (Home / Ari / Blast / Account) and between Hub sub-tabs (Events / Experiences / Trips / **Venue**) without hitting an error. |
| **Actual** | A navigation step in/around the Hub lands the user on the Mingla-branded 404 screen — **`app/+not-found.tsx`**: *"Hmm, that's not a real page. Maybe a typo? Or it moved?"* with a "Go home" button. |
| **Regression?** | YES — introduced by ORCH-1145. Pre-1145 the same nav-lock effect could not produce an invalid route (proven below). |

---

## 2. Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `git show 1e2a3badc` (full 10-file diff) | Establish exactly what ORCH-1145 changed. |
| 2 | `mingla-business/app/(tabs)/hub/_layout.tsx` | Prime suspect — nav-lock effect that calls `router.replace`. |
| 3 | `mingla-business/src/hooks/useHubTabs.ts` | `HubTabName` union, `deriveHubVisibleTabs`, `pickHubInitialTab`, `useHubInitialTab`, global last-tab key. |
| 4 | `mingla-business/src/components/hub/HubSubNav.tsx` | Sub-tab pill routing (`ROUTES`/`LABELS`), `detectActiveSubTab`. |
| 5 | `mingla-business/app/(tabs)/hub/listing.tsx` (NEW) | The Venue tab route FILE name (`listing.tsx`, URL `/hub/listing`). |
| 6 | `mingla-business/src/components/venue/VenueListingContent.tsx` (NEW) | Rule out a render throw inside the venue body. |
| 7 | `mingla-business/app/brand/[id]/listing.tsx` | Thin `<Redirect>` + active-brand set; redirect-loop check. |
| 8 | `mingla-business/src/store/currentBrandStore.ts` | Confirm `setCurrentBrandId` / `currentBrandId` exist (redirect uses them). |
| 9 | `mingla-business/src/types/brand.ts` | Confirm `hasPhysicalLocation` / `placePoolId` exist on `Brand`. |
| 10 | `mingla-business/app/(tabs)/_layout.tsx` | Bottom-tab navigation (UNCHANGED by 1145). |
| 11 | `mingla-business/app/(tabs)/hub/index.tsx` | Cold Hub landing → `Redirect /hub/events`. |
| 12 | `mingla-business/app/+not-found.tsx` | The "error" screen the user lands on. |
| 13 | `app/(tabs)/hub/__tests__/venueTab.contract.test.ts`, `hub-layout-nav-lock.test.ts` | Why the jest gates did NOT catch this. |
| 14 | `git show 1e2a3badc^:.../hub/_layout.tsx` | Pre-1145 baseline — prove the route was always valid before. |

---

## 3. Q-scorecard

**Q1 — Does leaving the Hub bottom-tab entirely (Hub → Home/Ari/Blast/Account) crash?**
`Verdict:` **NO, not directly.** The nav-lock effect early-returns when the pathname is no longer a `/hub/` route (`_layout.tsx:161`), so leaving to another bottom tab does not fire the redirect. Bottom-tab nav (`(tabs)/_layout.tsx handleChange`) is unchanged by 1145. (probable)

**Q2 — Does switching Hub sub-tabs (Venue ↔ Events/Experiences/Trips) crash?**
`Verdict:` **NO for pill taps.** Pill taps route via `ROUTES[id]` (`HubSubNav.tsx:97,129`), which correctly maps `venue → /(tabs)/hub/listing`. The mismatch is NOT in the pill path. (probable)

**Q3 — What is the introduced crash mechanism?**
`Verdict:` **The Hub layout's nav-lock redirect builds a route from the BARE tab name — `router.replace(\`/(tabs)/hub/${initialTab}\`)` (`_layout.tsx:173`). ORCH-1145 added `"venue"` to `HubTabName` and to `pickHubInitialTab`, but the Venue route FILE is `listing.tsx` (URL `/hub/listing`), NOT `venue.tsx`. When `initialTab === "venue"`, the redirect targets `/(tabs)/hub/venue`, which has no route file → expo-router serves `app/+not-found.tsx`.** This is the CONFIRMED ROOT CAUSE (F-1). (probable)

**Q4 — When does `initialTab === "venue"` AND the redirect fire (the real-world trigger)?**
`Verdict:` Two deterministic paths (F-2):
- (a) **Venue-only / venue-first brand cold-entering the Hub:** `hub/index.tsx` redirects to `/hub/events`; the layout computes `active="events"`; for a brand whose `visibleTabs` does not include `events` but does include `venue`, `pickHubInitialTab` returns `"venue"` (no events present → `visibleTabs[0]`). `!visibleTabs.includes("events")` is TRUE → `router.replace('/(tabs)/hub/venue')` → 404.
- (b) **Any brand after the tester last viewed the Venue tab:** the last-tab key is GLOBAL (`@mingla/hub/lastTab`, `useHubTabs.ts:32`), so `storedTab="venue"` persists across brands; `pickHubInitialTab` returns `"venue"` whenever venue is visible, and any redirect fire then targets `/hub/venue`. (probable)

**Q5 — Is this the same as the tester's flagged P4 one-frame flash on the `brand/[id]/listing` redirect?**
`Verdict:` **DISTINCT.** The P4 is a cosmetic one-frame flash in the `<Redirect>` alias (`brand/[id]/listing.tsx`). The crash is the nav-lock `router.replace` building a non-existent `/hub/venue` route. Different file, different mechanism, different severity. (probable)

**Q6 — Blast radius: Venue only, or also Events/Experiences/Trips nav?**
`Verdict:` **Venue only.** `events`/`trips`/`experiences`/`getstarted` each have a matching route file (`events.tsx`, `trips.tsx`, `experiences.tsx`, `getstarted.tsx`), so `router.replace(\`/(tabs)/hub/${initialTab}\`)` resolves for every PRE-1145 tab name. Only `venue` (file `listing.tsx`) breaks the name↔file invariant. (probable)

---

## 4. Findings (six-field evidence)

### F-1 — `router.replace(\`/(tabs)/hub/${initialTab}\`)` builds the non-existent route `/(tabs)/hub/venue` when `initialTab === "venue"` — CONFIRMED ROOT CAUSE

1. **Symptom:** User lands on `app/+not-found.tsx` ("Hmm, that's not a real page. Maybe a typo? Or it moved?") during Hub navigation.
2. **Layer:** Code (client navigation).
3. **Probe:**
   - `git show 1e2a3badc -- .../hub/_layout.tsx .../useHubTabs.ts .../HubSubNav.tsx`
   - `ls app/(tabs)/hub/` (route files present)
   - `grep -rn 'hub/\${' app/ src/` (every route built from a bare tab name)
   - `git show 1e2a3badc^:.../hub/_layout.tsx` (pre-1145 baseline)
4. **Evidence (verbatim):**
   - `app/(tabs)/hub/_layout.tsx:172-174`
     ```ts
     if (!visibleTabs.data.includes(active)) {
       router.replace(`/(tabs)/hub/${initialTab}` as never);
     }
     ```
   - `src/hooks/useHubTabs.ts:9-14` — `"venue"` is now a member of `HubTabName`:
     ```ts
     export type HubTabName = "getstarted" | "events" | "trips" | "experiences" | "venue";
     ```
   - `src/hooks/useHubTabs.ts:58-66` (`pickHubInitialTab`) — returns `"venue"` (stored-tab branch) and, for a venue-first brand, via `visibleTabs[0]` at line 68.
   - `src/components/hub/HubSubNav.tsx:43,59` — the Venue ROUTE is `/(tabs)/hub/listing` (file `listing.tsx`), NOT `venue.tsx`.
   - `ls app/(tabs)/hub/`: `events.tsx experiences.tsx getstarted.tsx index.tsx listing.tsx trips.tsx _layout.tsx` — **NO `venue.tsx`.** (`app/(tabs)/hub/venue*` → "no matches found".)
   - `app/+not-found.tsx:31-60` — the branded 404 screen with the exact copy reported.
   - `grep -rn 'hub/\${' app/ src/` → only `_layout.tsx:173` (plus its two test pins). No `venue→listing` normalization exists anywhere.
5. **Mechanism:** ORCH-1145 widened `HubTabName` and the initial-tab picker to include `"venue"`, but the route file is `listing.tsx`. The nav-lock effect string-concatenates the bare tab name into a URL (`/(tabs)/hub/${initialTab}`) instead of mapping it through `ROUTES`. When the picker yields `"venue"`, the resulting `/(tabs)/hub/venue` has no route → expo-router falls back to `+not-found`, which is the "error" the user sees.
6. **Severity:** **CONFIRMED ROOT CAUSE.**

### F-2 — Two deterministic firing conditions for F-1 — SECONDARY (trigger characterization)

1. **Symptom:** The 404 appears specifically when the Hub layout's visible-tab redirect fires while `initialTab` has resolved to `"venue"`.
2. **Layer:** Code (state + effect timing).
3. **Probe:** trace `deriveHubVisibleTabs` (`useHubTabs.ts:34-51`) + `pickHubInitialTab` (`:53-69`) + the layout effect (`_layout.tsx:149-175`) + `hub/index.tsx` (`Redirect /hub/events`).
4. **Evidence (verbatim):**
   - Cold Hub entry redirects to events: `app/(tabs)/hub/index.tsx:17` → `<Redirect href="/(tabs)/hub/events" />`.
   - The layout computes `active` from the path (`_layout.tsx:162-171`); on `/hub/events`, `active="events"`.
   - `deriveHubVisibleTabs` only pushes `events` if `counts.events > 0` (`useHubTabs.ts:43`); a venue-first brand with zero events → `visibleTabs` excludes `events`, includes `venue` (`:49`).
   - `pickHubInitialTab` with no events present returns `visibleTabs[0]` → `"venue"` (`:67-68`); OR returns `"venue"` directly when `storedTab==="venue"` and venue is visible (`:63-65`).
   - Last-tab key is GLOBAL, not per-brand: `HUB_LAST_TAB_STORAGE_KEY = "@mingla/hub/lastTab"` (`useHubTabs.ts:32`) — so once the tester opens the Venue tab on ANY brand, `storedTab="venue"` sticks across brands.
5. **Mechanism:** With `active="events"` (the cold-entry interim route) not in a venue-first brand's `visibleTabs`, the guard at `_layout.tsx:172` evaluates TRUE and fires the F-1 redirect to the broken `/hub/venue`. The global last-tab makes path (b) reachable on multi-brand accounts. The reporter's "navigate away from the hub tab … land on an error" matches leaving the Venue tab and the Hub layout re-resolving on re-entry/re-render.
6. **Severity:** **SECONDARY ROOT CAUSE** (it is the activation condition of F-1; not a second bug).

### F-3 — Pre-1145 the same line could not build an invalid route — proves the regression is F-1 — RULED OUT (as a pre-existing bug)

1. **Symptom:** None pre-1145.
2. **Layer:** Code (historical baseline).
3. **Probe:** `git show 1e2a3badc^:mingla-business/app/(tabs)/hub/_layout.tsx`.
4. **Evidence (verbatim):** pre-1145 the `active` ladder produced only `getstarted | trips | experiences | events`, and `HubTabName` was `getstarted | events | trips | experiences`. Every possible `initialTab` had a matching route file (`getstarted.tsx`, `events.tsx`, `trips.tsx`, `experiences.tsx`). The same `router.replace(\`/(tabs)/hub/${initialTab}\`)` line existed and always resolved.
5. **Mechanism:** The `tabName ↔ route-file` 1:1 invariant held before 1145; 1145 broke it by naming the venue route `listing.tsx` while the tab name is `venue`.
6. **Severity:** **RULED OUT** (confirms F-1 is the sole introduced cause).

### F-4 — The redirect alias and `VenueListingContent` are NOT the crash — RULED OUT

1. **Symptom:** Suspected redirect loop or render throw on the new files.
2. **Layer:** Code.
3. **Probe:** read `brand/[id]/listing.tsx`, `currentBrandStore.ts`, `VenueListingContent.tsx`, `types/brand.ts`.
4. **Evidence (verbatim):**
   - `brand/[id]/listing.tsx:43-47` guards the set with `brandId !== currentBrandId`, then a single `<Redirect href="/(tabs)/hub/listing">` (line 50) — no loop; `/hub/listing` is a real route.
   - `currentBrandStore.ts` exports both `setCurrentBrandId` (`:200`) and `currentBrandId` — the alias's calls resolve.
   - `types/brand.ts:328,335` — `placePoolId?` and `hasPhysicalLocation?` exist; the layout's `venueVisibility` memo handles `undefined` via `=== true` / `!= null` (`_layout.tsx:79-80`) — no type crash.
   - `VenueListingContent.tsx` renders a complete component with a null-brand "No listing yet" branch (`:251-260`); it is extracted verbatim from ORCH-1040 and is only mounted on `/hub/listing` (a valid route), so it is never reached when the 404 fires. (Note a pre-existing latent `ctx.data?.gallery_urls.length ?? 0` at `:324` — inherited, not introduced, and off the nav-away path — logged as a Discovery, not a finding.)
5. **Mechanism:** None of these participate in the broken `/hub/venue` redirect.
6. **Severity:** **RULED OUT.**

---

## 5. Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction |
|-------|-------|---------------|
| **Docs** | Commit msg + `listing.tsx` header claim the nav-lock guard + order were "PRESERVED unmodified" and the move is a faithful relocation. | The doc is true about the GUARD line, but MISSES that the redirect TARGET (`/hub/${initialTab}`) now has a reachable value (`venue`) with no route file. **Contradiction:** "preserved" hides a broken implicit invariant. |
| **Schema** | n/a (no DB/edge change). | — |
| **Code** | `HubTabName` includes `venue`; route file is `listing.tsx`; nav-lock builds `/hub/${initialTab}`; pill routing uses `ROUTES[venue]=/hub/listing`. | **The nav-lock path bypasses `ROUTES`** — the one place that knows `venue→listing`. This gap IS the bug. |
| **Runtime** | expo-router resolves `/(tabs)/hub/venue` to `app/+not-found.tsx`. | Matches the reporter's "error" screen exactly. |
| **Data** | `@mingla/hub/lastTab` is a single global key; can hold `"venue"`. | Makes path F-2(b) reachable for multi-brand accounts. |

---

## 6. Repro evidence (live-fire status)

- **Sim available:** iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6` (booted); business app installed (`com.sethogieva.minglabusiness`).
- **Blocker (named):** Metro is NOT running, and the installed bundle is not provably built from this worktree's `1e2a3badc`. A faithful live repro requires (1) rebuilding the business dev client from this worktree via `IOS_DEV_BUILD_REBUILD_RUNBOOK.md`, (2) starting Metro, (3) signing in, and (4) seeding/selecting a venue-first brand (or setting `@mingla/hub/lastTab="venue"`) to drive the redirect. That multi-step setup was not completed in this pass.
- **Why confidence is still `probable`, not `suspected`:** the defect is a STATIC, deterministic route-name/file mismatch (not a state/timing heisenbug). The trace is closed end-to-end: the only route-from-tab-name builder is `_layout.tsx:173`; `initialTab` is typed `HubTabName` and provably reaches `"venue"`; no `venue.tsx` route file exists (`ls` confirmed); expo-router's documented fallback for an unmatched route is `+not-found`, whose copy matches the report verbatim. The pre-1145 baseline proves the regression boundary.
- **Recommended runtime confirmation (for the implementor/tester at fix time):** on a venue-first brand (or with `@mingla/hub/lastTab` = `"venue"`), cold-open the Hub → observe the 404; then capture `xcrun simctl io booted recordVideo` while reverting the fix to prove fails-on-revert.

---

## 7. Blast radius / cross-surface map

| Surface | Affected? | Reason |
|---|---|---|
| Business iOS | **YES** | Native expo-router 404 on `/hub/venue`. |
| Business Android | **YES** | Same shared route logic. |
| Business Web preview | **YES** | Same `_layout.tsx`; web shows `+not-found` too (`+not-found` is cross-platform per its header). |
| Consumer iOS/Android/Buyer Web | **NO** | `app-mobile/` + buyer web untouched; ORCH-1145 is business-only. |
| Admin Web | **NO** | Not in scope. |

**Tab blast radius within the Hub:** **Venue ONLY.** Events / Experiences / Trips / Get-started each have a route file matching their tab name, so the `router.replace(\`/(tabs)/hub/${initialTab}\`)` line resolves for them. The broken name↔file mapping exists solely for `venue` (file `listing.tsx`).

---

## 8. Invariant impact (flagged, NOT resolved)

- **Implicit invariant violated:** *"Every `HubTabName` value must equal its route-file segment under `app/(tabs)/hub/`."* ORCH-1145 broke it (`venue` ↔ `listing.tsx`). The nav-lock redirect is the only consumer that depends on this implicit 1:1 mapping; pill routing (`ROUTES`) does not.
- **I-PROPOSED (for the SPEC to consider, owner = orchestrator at CLOSE):** *the Hub nav-lock redirect must resolve the target route through the same `ROUTES`/route-map used by `HubSubNav`, OR `HubTabName` route segments must equal their file names* — enforced by a fails-on-revert test that asserts the redirect target for every `HubTabName` resolves to an existing `app/(tabs)/hub/*` route file.
- **Existing pin not violated:** `hub-layout-nav-lock.test.ts` (the `/hub/` early-return guard) is preserved and is NOT the cause.

---

## 9. Discoveries for Orchestrator (side issues)

- **D-1 (P4, tester-flagged, DISTINCT from the crash):** one-frame flash in the `brand/[id]/listing.tsx` `<Redirect>` alias. Cosmetic; separate from F-1. Not fixed here.
- **D-2 (pre-existing latent, NOT introduced by 1145):** `VenueListingContent.tsx:324` `ctx.data?.gallery_urls.length ?? 0` will throw if `ctx.data` is defined but `gallery_urls` is undefined. Inherited verbatim from ORCH-1040's `brand/[id]/listing.tsx`; off the nav-away path. Flag for a future hardening pass.
- **D-3 (design/UX):** `@mingla/hub/lastTab` is a single GLOBAL key, so the last-viewed sub-tab leaks across brands (e.g. open Venue on Brand A → Brand B also tries to land on Venue). Pre-existing, but ORCH-1145 makes it newly consequential (venue may not exist on Brand B). Worth a per-brand-scoped key, but out of this bug's scope.

---

## 10. Recommended next phase + scope (direction only — NOT a fix)

- **Next phase:** SPEC → IMPLEMENT (small, surgical).
- **Exact fix location (single root cause):** `mingla-business/app/(tabs)/hub/_layout.tsx:173` — the redirect must NOT string-concatenate the bare `HubTabName` into the URL. It must map the tab name to its real route (e.g. resolve through the same route map `HubSubNav` uses, where `venue → /(tabs)/hub/listing`), so `venue` never produces `/hub/venue`.
- **Regression contract (fails-on-revert):** add a test asserting that, for every `HubTabName`, the redirect target route file exists under `app/(tabs)/hub/` (explicitly that `venue` resolves to `listing.tsx`, NOT `venue.tsx`). This must FAIL if the fix is reverted to `\`/(tabs)/hub/${initialTab}\``.
- **Scope discipline:** fix is one mapping in `_layout.tsx`; do NOT rename the route file (would break `ROUTES`, the alias redirect, `detectActiveSubTab`, and the contract tests). Do NOT widen into D-1/D-2/D-3.

---

**Confidence: `root cause probable`** — exhaustive, deterministic source trace with the exact `+not-found` "error" screen identified and the pre-1145 regression boundary proven; the only unmet bar is a from-this-worktree live build (named blocker), and the defect is static (route-name/file mismatch), not timing-dependent.
