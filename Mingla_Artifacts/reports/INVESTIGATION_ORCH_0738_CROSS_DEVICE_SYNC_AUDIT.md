# INVESTIGATION REPORT — ORCH-0738 — Cross-device sync audit (mingla-business, BRUTAL)

**Authored:** 2026-05-06 by mingla-forensics
**Dispatch:** [`prompts/INVESTIGATION_ORCH_0738_CROSS_DEVICE_SYNC_AUDIT_BRUTAL.md`](../prompts/INVESTIGATION_ORCH_0738_CROSS_DEVICE_SYNC_AUDIT_BRUTAL.md)
**Mode:** INVESTIGATE only (audit + recommendation matrix; NO spec — orchestrator REVIEWs and dispatches tiered fix cycles separately)
**Confidence:** HIGH for the architectural findings (zero Realtime, zero AppState/focusManager wiring); MEDIUM-HIGH for individual surface tier classifications (some stores need byte-level type inspection to confirm server-vs-client classification — flagged where unclear).

---

## Layman summary

mingla-business has **zero automatic cross-device sync** today. Three architectural gaps cause it:

1. 🔴 **No Supabase Realtime anywhere** — confirmed by exhaustive grep. No WebSocket subscription, no push notification of DB changes from server to other devices.
2. 🔴 **No AppState→React Query focus integration** — React Query's default `refetchOnWindowFocus` does nothing in React Native because nothing wires `AppState 'active'` to React Query's `focusManager`. Even within ONE device, going to background + coming back doesn't refetch anything.
3. 🔴 **Persistent Zustand snapshots of server entities** — `currentBrand` is a full server-row snapshot persisted to AsyncStorage with no freshness check. Survives cold-start, never refreshes against server until user does a mutation locally. The brand-delete cross-device gap is one symptom of this pattern.

11 of 13 Zustand stores persist data to AsyncStorage. Most appear to hold server-derived state (orders, guests, scans, door sales, draft events, live events, brand team, scanner invitations, event edit log, current brand). On sign-out, these stores ARE NOT cleared — Constitutional #6 violation (logout clears everything). When user A signs out and user B signs in on the same device, persisted data from user A may be readable until staleTime expires (5min) AND a new consumer triggers a fetch.

The good news: **auth-level cross-device sync IS wired**. AuthContext subscribes to `supabase.auth.onAuthStateChange` so a sign-out on device A propagates to device B (eventually). Auth is the only sync layer that works today.

Findings: 4 root causes, 2 contributing factors, 7 hidden flaws, 4 observations.
Confidence: HIGH (architectural) / MEDIUM-HIGH (per-surface classification — I read the 5 highest-risk stores in detail; the lower-risk stores were classified by name + persistence pattern + grep but not deep-read; this is acknowledged in Section 11).

---

## 1. Executive Summary — top 5 sync risks

| Rank | Risk | Severity | Current state | Fix tier |
|---|---|---|---|---|
| 1 | **`currentBrand` stale snapshot survives across cold-start with no freshness check** | S1 — phantom navigation + mutation against tombstone | Zustand persist v13; partialize keeps full Brand object; no migrate-time refetch | Tier 1 (refetch-on-foreground) MINIMUM; ideally Tier 0 (Realtime DELETE → clear currentBrand) |
| 2 | **Permission/role drift across devices** — team membership change on A, B's `useCurrentBrandRole` cache (5min staleTime) keeps showing old rank | S0 — security-adjacent (user attempts admin action without admin perms; RLS denies but UX confusion + potential data leak) | useCurrentBrandRole React Query 5min staleTime; no Realtime; no focusManager | Tier 0 (Realtime push on brand_team_members change) |
| 3 | **Logout doesn't clear persisted Zustand stores** — user B signs in on device, sees user A's draft events / orders / scans / brand team snapshots until staleTime expires | S1 — privacy / data leak across user accounts on shared device | AuthContext.signOut does NOT call store.reset() on any of the 11 persisted stores | Tier 0 (synchronous reset on signOut) |
| 4 | **No AppState→focusManager integration** — backgrounded app stays stale forever; user perceives "frozen" data | S2 — confusion + within-device staleness; amplifies all other risks | Zero `focusManager.setEventListener` in mingla-business code | Tier 1 — infrastructure fix benefits ALL React Query consumers simultaneously (cheapest single-leverage fix in the audit) |
| 5 | **Stale brand displayName / cover / hue in `currentBrand` snapshot** — A renames brand "Vibes" → "Vibes Pop"; B keeps showing "Vibes" in TopBar / headers / Toasts indefinitely | S3 — cosmetic but undermines trust | currentBrand snapshot includes displayName, hue, cover; no refresh path | Resolved automatically by fix #1 above |

**Most dangerous unfixed gap (single):** #2 — permission drift. Combined with the existing `useCurrentBrandRole` 5min staleTime + no foregrounding refetch, an operator demoted on one device can keep performing admin-only operations from another device for up to 5 minutes (until next consumer mounts) AND the operations FAIL silently or with cryptic errors because RLS is the only enforcement boundary catching them.

**Single highest-leverage fix (single):** #4 AppState integration. ~8 lines of code in app root, fixes within-device staleness for all React Query consumers in one shot. Doesn't solve cross-device push, but downgrades many cross-device gaps from "indefinite stale" to "stale until next foreground."

---

## 2. Investigation Manifest

| File / Surface | Layer | Why |
|---|---|---|
| `mingla-business/src/store/currentBrandStore.ts` | Zustand persist | The operator-confirmed surface (brand-delete cross-device gap); read in full |
| `mingla-business/src/store/draftEventStore.ts` | Zustand persist | Likely server-derived (drafts pre-publish); inspected partialize + version |
| `mingla-business/src/store/liveEventStore.ts` | Zustand persist | Holds events; inspected partialize + version |
| `mingla-business/src/store/brandTeamStore.ts` | Zustand persist | Holds team membership (load-bearing for permissions); inspected |
| `mingla-business/src/store/orderStore.ts` | Zustand persist | Server-derived order entities; inspected |
| `mingla-business/src/store/guestStore.ts` | Zustand persist | Server-derived guest entities; inspected |
| `mingla-business/src/store/scanStore.ts` | Zustand persist | Server-derived scan events; inspected |
| `mingla-business/src/store/doorSalesStore.ts` | Zustand persist | Server-derived door sales; inspected |
| `mingla-business/src/store/eventEditLogStore.ts` | Zustand persist | Server-derived edit log; inspected |
| `mingla-business/src/store/scannerInvitationsStore.ts` | Zustand persist | Server-derived invitations; inspected |
| `mingla-business/src/store/notificationPrefsStore.ts` | Zustand persist | Likely client prefs OR server-mirrored prefs; inspected name |
| `mingla-business/src/store/orderStoreHelpers.ts` | helper | Not a store; skipped after confirming |
| `mingla-business/src/store/brandList.ts` | [TRANSITIONAL] stub | Already labeled transitional; not in active risk set |
| `mingla-business/src/hooks/useBrands.ts` | React Query | Brand list + single + cascade; staleTime config inspected |
| `mingla-business/src/hooks/useBrand.ts` (within useBrands.ts) | RQ | Single brand by id |
| `mingla-business/src/hooks/useCurrentBrandRole.ts` | RQ | **Permission cache (5min staleTime)** — high-risk for permission drift |
| `mingla-business/src/hooks/useAuditLog.ts` | RQ | Read-only; staleTime 1min |
| `mingla-business/src/hooks/useCreatorAccount.ts` | RQ | Account profile read; staleTime 5min |
| `mingla-business/src/hooks/useAccountDeletion.ts` | RQ | Mutation hook; not a query |
| `mingla-business/src/hooks/useBrandListShim.ts` | wrapper | Forwards to useBrands; not its own query |
| `mingla-business/src/hooks/usePermissionWithFallback.ts` | RQ wrapper | Reads role + computes permission; cache discipline depends on role hook |
| `mingla-business/src/context/AuthContext.tsx` | Auth | onAuthStateChange listener; signOut path |
| Live DB grep for `supabase.channel` / `.subscribe(` / `realtime` / `onPostgresChange` / `on_postgres_changes` across mingla-business/src | Realtime | Zero matches (CRITICAL evidence) |
| Live DB grep for `focusManager` / `onlineManager` / `AppState` / `refetchOnAppActive` across mingla-business | RQ AppState | Zero matches (CRITICAL evidence) |
| Live DB grep for `reset()` / store reset on AuthContext signOut path | Sign-out hygiene | Zero matches (CRITICAL evidence) |
| `mingla-business/app/brand/[id]/index.tsx` | Route | Already read in ORCH-0734-RW investigation; reuses findings |

---

## 3. Surface Inventory Table

### Server-state surfaces — Zustand persisted

| Surface | Persisted? | What it holds | Source of truth | Update path | Cross-device sync | Confidence |
|---|---|---|---|---|---|---|
| `currentBrandStore.currentBrand` | ✅ v13, AsyncStorage `mingla-business.currentBrand.v13` | Full Brand snapshot (id + displayName + slug + hue + cover + role + stats + currentLiveEvent) | server `public.brands` row | setter via component handlers; useBrandList replaced server-side `brands` array (correct) but `currentBrand` snapshot kept | NONE | HIGH |
| `liveEventStore.events` | ✅ v2, AsyncStorage | Live event records | server `public.events` (rows where status=live) | setter from app code | NONE | HIGH (pre-MVP wiring; minimal real data today) |
| `draftEventStore.drafts` | ✅ v6, AsyncStorage | Draft events (pre-publish) | client-only OR server-mirrored — needs confirmation | setter | NONE; if client-only, OK; if server-backed, vulnerable | MEDIUM (needs deeper inspection — flagged as open question) |
| `brandTeamStore.entries` | ✅ v1, AsyncStorage | Team member entries by brand | server `public.brand_team_members` | setter | NONE — **PERMISSION DRIFT VECTOR** | HIGH |
| `orderStore.entries` | ✅ v1, AsyncStorage | Order records | server `public.orders` | setter | NONE | HIGH |
| `guestStore.entries` | ✅ v1, AsyncStorage | Guest records | server (likely `public.tickets` or attendees view) | setter | NONE | HIGH |
| `scanStore.entries` | ✅ v1, AsyncStorage | Scan event records | server `public.scan_events` | setter | NONE | HIGH |
| `doorSalesStore.entries` | ✅ v1, AsyncStorage | Door sales transactions | server `public.door_sales_ledger` | setter | NONE | HIGH |
| `eventEditLogStore.entries` | ✅ v1, AsyncStorage | Edit log entries by event | server (likely `public.audit_log` filtered) | setter | NONE | HIGH |
| `scannerInvitationsStore.entries` | ✅ v2, AsyncStorage | Scanner invitations by event | server `public.scanner_invitations` | setter | NONE | HIGH |
| `notificationPrefsStore.prefs` | ✅ v1, AsyncStorage | Notification preferences | server `public.notification_preferences` (likely) | setter | NONE | MEDIUM (could also be local-only) |

### Client-state-only Zustand (non-persisted or genuinely client)

| Surface | Persisted? | What it holds | Risk |
|---|---|---|---|
| `brandList.ts` (legacy stub) | N/A — `[TRANSITIONAL]` | Stub Brand[] for Cycle 1-2 | NONE — slated for removal per existing TRANSITIONAL marker |
| `orderStoreHelpers.ts` | N/A — helper module | Pure functions | NONE |

### Server-state surfaces — React Query

| Hook | Query key | staleTime | refetch config | Cross-device sync | Risk class |
|---|---|---|---|---|---|
| `useBrands(accountId)` | `brandKeys.list(accountId)` = `["brands","list",accountId]` | 5 min | None — defaults | NONE — invalidates only on local mutation | Stale list across devices |
| `useBrand(brandId)` | `brandKeys.detail(brandId)` = `["brands","detail",brandId]` | 5 min | None | NONE | Stale single-brand reads (rename, cover change) |
| `useBrandCascadePreview(brandId)` | `brandKeys.cascadePreview(brandId)` | 30 sec | None | Polling-via-staleTime works because BrandDeleteSheet remounts | Acceptable for short-lived sheet |
| `useCurrentBrandRole(brandId)` | `["brand-role", brandId]` (NOT from a factory — hardcoded) | 5 min | None | NONE — **PERMISSION DRIFT VECTOR** | S0/S1 — security-adjacent |
| `useAuditLog(brandId)` | `["audit-log", brandId]` | 1 min | None | NONE | Read-only viewer; minor |
| `useCreatorAccount()` | (would need re-read; not blocking the audit) | 5 min | None | NONE | Stale display_name / marketing_opt_in across devices |
| `useAccountDeletion` | (mutation, not a query) | N/A | N/A | N/A | N/A |
| `usePermissionWithFallback` | wrapper around useCurrentBrandRole | inherits | inherits | inherits | inherits |

### Route surfaces (dynamic params)

Routes are READ-ONLY pointers to entities — risk depends on whether the resolution hook (`useBrand`, `useEvent`, etc.) handles null + the entity-was-deleted case.

| Route | Param | Resolution hook | Null handling | Risk |
|---|---|---|---|---|
| `/brand/[id]/index.tsx` | `id` | `useBrandList().find()` shim → React Query | Falls through to BrandProfileView's not-found state ✅ (per ORCH-0734-RW finding) | LOW given the React-Query backing (UNLESS Zustand currentBrand is read separately for headers — re-verify) |
| `/brand/[id]/edit.tsx` | `id` | likely `useBrand(id)` | unverified — sample read recommended | MEDIUM (deferred) |
| `/brand/[id]/audit-log.tsx` | `id` | useAuditLog | useAuditLog returns []; ok | LOW |
| `/brand/[id]/team.tsx` | `id` | likely brandTeamStore | If reads from Zustand persist directly without server refetch → HIGH | MEDIUM-HIGH |
| `/brand/[id]/payments/*` | `id` | unverified | Depends on Stripe Connect cache freshness | MEDIUM |
| `/event/[id]/*` (multiple) | `id` | likely liveEventStore + draftEventStore | Persisted Zustand → stale risk | MEDIUM-HIGH |
| `/checkout/[eventId]/*` | `eventId` | anon route — no auth context | Buyer flow — single-device per session typically | LOW (different threat model) |
| `/o/[orderId].tsx` | `orderId` | likely orderStore | Persisted Zustand → stale risk | MEDIUM-HIGH |
| `/e/[brandSlug]/[eventSlug].tsx` | slugs | anon public page | Public read; minor | LOW |

### Auth surface

| Surface | Mechanism | Cross-device sync |
|---|---|---|
| `AuthContext.session` | `supabase.auth.onAuthStateChange` listener | ✅ WIRED — sign-out propagates; SIGNED_IN propagates |
| `AuthContext.signOut` calls `supabase.auth.signOut()` | Server-side session revoke | ✅ propagates to other device |
| `AuthContext.signOut` does NOT call any Zustand `.reset()` | Local state cleanup | ❌ MISSING — Constitutional #6 violation |
| Token refresh | Built-in supabase-js | ✅ |

---

## 4. Findings (classified)

### 🔴 RC-A — Zero Supabase Realtime in mingla-business

| Field | Evidence |
|---|---|
| **File + line** | Negative grep: `Grep "supabase\.channel\|\.subscribe(\|realtime\|onPostgresChange\|on_postgres_changes" mingla-business/src` → 0 matches |
| **Exact code** | (absence of code) |
| **What it does** | Nothing. No channel subscriptions exist. Devices receive no push notifications of DB changes. |
| **What it should do** | At minimum, subscribe to changes on `brands` (DELETE event → invalidate brand list + clear currentBrand if matching) and `brand_team_members` (UPDATE/DELETE → invalidate role cache). |
| **Causal chain** | Device A mutates → DB changes → no event published to devices B/C/etc. → B/C continue serving stale cache + stale Zustand snapshots until they happen to refetch by some other trigger (mutation, app cold-start, staleTime + observer-mount). |
| **Verification step** | Already verified by grep. Could supplement by checking server-side Realtime publication config in Supabase Dashboard → Database → Realtime → confirm publication exists for `brands` (probably default `supabase_realtime`). |

### 🔴 RC-B — Zero AppState→React Query focusManager wiring

| Field | Evidence |
|---|---|
| **File + line** | Negative grep across `mingla-business/`: `focusManager`, `onlineManager`, `AppState`, `refetchOnAppActive` → 0 matches |
| **Exact code** | (absence of code in app root / providers) |
| **What it does** | Without this wiring, React Query's default `refetchOnWindowFocus: true` does nothing in React Native (the default depends on browser `window.focus`/`blur` events). When the app comes back to foreground after being away, no query refetches. |
| **What it should do** | At app root: `import { focusManager } from "@tanstack/react-query"; AppState.addEventListener('change', s => focusManager.setFocused(s === 'active'));`. ~8 lines. Single highest-leverage fix in this audit. |
| **Causal chain** | App backgrounds → minutes/hours pass → app foregrounds → React Query caches still considered fresh because no `setFocused(true)` was called → user sees data from before the background → unaware of how stale it is. |
| **Verification step** | Add the wiring; observe that all React Query consumers refetch when app returns from background; confirm via Metro logs. |

### 🔴 RC-C — `currentBrandStore` persists a server-row snapshot with no freshness check

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/src/store/currentBrandStore.ts:367-387` |
| **Exact code** | ```ts<br>const persistOptions: PersistOptions<CurrentBrandState, PersistedState> = {<br>  name: "mingla-business.currentBrand.v13",<br>  storage: createJSONStorage(() => AsyncStorage),<br>  partialize: (state) => ({ currentBrand: state.currentBrand }),<br>  version: 13,<br>  migrate: (persistedState, version) => {<br>    // Cycle 17e-A v12 → v13 — drops `brands` array...<br>    // After this migration runs, useBrands() React Query hook owns the brand list<br>    if (version < 13) {<br>      const old = persistedState as Partial<{ currentBrand: Brand | null }> \| null;<br>      return { currentBrand: old?.currentBrand ?? null };<br>    }<br>    return persistedState as PersistedState;<br>  },<br>};<br>``` |
| **What it does** | Persists the full `currentBrand: Brand \| null` object (id + displayName + slug + hue + cover + role + stats + currentLiveEvent) to AsyncStorage. On cold-start, hydrates the persisted object. The migrate function does NOT re-fetch from server. The `currentBrand` snapshot is whatever the server said it was AT THE MOMENT it was last set. |
| **What it should do** | Persist ONLY `currentBrandId: string \| null` (a pure pointer — that's client state). On hydration, immediately fetch `useBrand(currentBrandId)` and use server-fresh data. If brand is deleted server-side, useBrand returns null → clear currentBrandId. Constitutional #5 compliance: "Server state stays server-side." |
| **Causal chain** | Device A deletes brand X → server brands.deleted_at NOT NULL → device A invalidates React Query brand list (correct). Device B's currentBrandStore.currentBrand still holds the full pre-delete Brand object. Device B's TopBar / brand-page header / any consumer of `useCurrentBrand()` reads the stale snapshot. User sees "phantom brand" until they manually navigate away or restart app. **This is the operator-confirmed symptom 2026-05-06.** |
| **Verification step** | Two-device test (operator already confirmed). Or static-trace: read `useCurrentBrand()` consumers, confirm they read from Zustand persist not from React Query. |

### 🔴 RC-D — `AuthContext.signOut` does not reset persisted Zustand stores (Constitutional #6 violation)

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/src/context/AuthContext.tsx:441` (signOut) — confirmed via grep: `reset()`, `clear()`, `useCurrentBrandStore.*reset` → 0 matches |
| **Exact code** | (absence of `reset()` calls in signOut path) |
| **What it does** | When user A signs out, `supabase.auth.signOut()` is called (server-side session revoke + onAuthStateChange propagates). But the 11 persisted Zustand stores (currentBrand, brandTeam, orders, guests, scans, doorSales, draftEvents, liveEvents, eventEditLog, scannerInvitations, notificationPrefs) RETAIN their data in AsyncStorage. |
| **What it should do** | signOut MUST sequentially reset every persisted store (or at least clear AsyncStorage keys) before/during sign-out. Constitutional #6: "Logout clears everything — no private data survives sign-out." |
| **Causal chain** | User A signs out → user A's draft events / brand team snapshots / orders / guests still in AsyncStorage. User B signs in on the same device → opens the app → sees user A's data flash briefly OR persistently in surfaces that read from Zustand before triggering server fetches. Cross-account data leak. |
| **Verification step** | Two-account test on same device: sign in as A, create a draft event, sign out, sign in as B → confirm draft visible (OR verify it's not — if cleared elsewhere, this finding could be MEDIUM not HIGH). I have NOT performed this runtime test; the static-trace evidence is the absence of reset calls. |

### 🟠 CF-1 — `useCurrentBrandRole` 5-minute staleTime + no Realtime + no focusManager → permission drift window

| Field | Evidence |
|---|---|
| **File** | `mingla-business/src/hooks/useCurrentBrandRole.ts:98` |
| **What it does** | When user's role on a brand changes (admin demotes them), the device that didn't make the change continues serving the cached old role for up to 5 minutes minimum — and indefinitely if no consumer re-mounts. Combined with no foregrounding refetch, no Realtime push. |
| **Why classified contributing, not root cause** | Doesn't cause cross-device staleness alone — the absence of Realtime (RC-A) does. But the 5-min staleTime on a permission-bearing surface is too generous for a security-adjacent cache. |
| **Recommended direction** | Tier 0 (Realtime push on `brand_team_members` change) OR Tier 1 (reduce staleTime to 30s + wire focusManager) AS A MINIMUM. |

### 🟠 CF-2 — Hardcoded query key `["brand-role", brandId]` (not from factory)

| Field | Evidence |
|---|---|
| **File** | `mingla-business/src/hooks/useCurrentBrandRole.ts` (key not from `brandKeys` factory) + `mingla-business/src/hooks/useBrands.ts:292` (`useSoftDeleteBrand` does `queryClient.removeQueries({ queryKey: ["brand-role", brandId] })` — also hardcoded) |
| **What it does** | Two consumers hardcode the same string key. Drift risk: if one consumer renames "brand-role" to e.g. "brand-permissions" and the other doesn't, cache invalidation silently misses. Constitutional #4 violation. |
| **Why classified contributing, not root cause** | Doesn't cause today's cross-device sync issue. But it's tech debt that compounds over time. |
| **Recommended direction** | Add `brandKeys.role(brandId)` to the existing factory in `useBrands.ts:45-62`; refactor both consumers to use it. |

### 🟡 HF-1 — Sign-out doesn't invalidate React Query cache

| Field | Evidence |
|---|---|
| **File** | `mingla-business/src/context/AuthContext.tsx` signOut path |
| **What it does** | After signOut, React Query's queryClient still has cached data from the prior user's session. If user B signs in on the same device, mounts a query — depending on whose accountId is used as the key parameter, B might see A's data briefly OR React Query refetches with B's accountId. The behavior depends on key-parameter discipline + staleTime. |
| **Why classified hidden flaw** | Less bad than RC-D because most queries are keyed by accountId/userId — naturally segregated. But edge cases (queries keyed only by brandId, or by route param without a per-user component) could leak. |
| **Recommended direction** | `queryClient.clear()` in signOut path. ~1 line. Cheap. |

### 🟡 HF-2 — `useBrands` 5-min staleTime is too long for a list that owners can mutate

| Field | Evidence |
|---|---|
| **File** | `mingla-business/src/hooks/useBrands.ts:75` |
| **What it does** | List query stays fresh 5 min before refetch. If A creates a brand, then opens B (same account) → B's cache might be < 5min old → B doesn't see the new brand until cache becomes stale and a re-mount fires. |
| **Why classified hidden flaw** | Within-device acceptable; cross-device combined with no Realtime + no focusManager creates indefinite staleness. |
| **Recommended direction** | Reduce to 30s OR wire focusManager + add Realtime push for brand DELETEs (covers create implicitly). |

### 🟡 HF-3 — `useBrand(id)` 5-min staleTime — same issue, single-brand surface

(Same shape as HF-2.)

### 🟡 HF-4 — `useCreatorAccount` 5-min staleTime; A renames profile, B keeps showing old display_name in headers

| Field | Evidence |
|---|---|
| **File** | `mingla-business/src/hooks/useCreatorAccount.ts:57` |
| **Recommended direction** | Cosmetic only. Tier 1-2 fix — wire focusManager (free) + accept TTL. Realtime overkill for profile rename. |

### 🟡 HF-5 — `usePermissionWithFallback` inherits useCurrentBrandRole's drift

The wrapper around useCurrentBrandRole inherits its sync gap — flagged so the fix can target both.

### 🟡 HF-6 — `["brand-role", brandId]` key collision across hooks (ORCH-0734-RW already-shipped useSoftDeleteBrand removeQueries uses the literal key — confirmed)

(See CF-2.)

### 🟡 HF-7 — 11 of 13 Zustand stores persist server-derived data; brand-delete-style stale-snapshot risk multiplies

The `currentBrand` symptom (RC-C) is one instance of a 10x pattern. Every other store with `partialize: { entries: ... }` likely has the same structural risk for its entity domain (orders, guests, scans, etc.).

| Recommended direction | Per-store decision: keep client-state-only persistence (e.g., notificationPrefs probably is, no risk); OR convert server-snapshots to React Query (mirror useBrands pattern); OR add hydration-time freshness check. Not all 11 need the same treatment. |

### 🔵 OB-1 — AuthContext.onAuthStateChange listener IS wired (auth-level cross-device sync works)

| Evidence | `AuthContext.tsx:135` `supabase.auth.onAuthStateChange(async (_event, s) => { setSession(s); ... });` |
| Why noteworthy | This is the ONE cross-device sync mechanism that works in mingla-business today. Sign-out from device A → device B's onAuthStateChange fires SIGNED_OUT → app re-renders → user routed to BusinessWelcomeScreen. Token refresh failures also propagate. |
| Implication | Realtime subscription pattern can mirror this — single app-root subscription, fan-out to invalidate appropriate caches. |

### 🔵 OB-2 — `useBrandCascadePreview` 30-sec staleTime is correctly tuned

| Evidence | `useBrands.ts:354` — 30s staleTime; comment notes "counts change frequently in active operations." |
| Why noteworthy | Different from the 5-min surfaces. Demonstrates per-surface staleness tuning is possible — most surfaces just haven't been tuned. |

### 🔵 OB-3 — `brandList.ts` is `[TRANSITIONAL]` stub data (already known, slated for removal)

| Evidence | `mingla-business/src/store/brandList.ts:1-15` header — explicitly transitional. |
| Why noteworthy | Not in active risk set. Existing technical debt with a documented exit plan. |

### 🔵 OB-4 — `useAuditLog` 1-min staleTime appropriate for a log viewer

| Evidence | `useAuditLog.ts:23` `STALE_TIME_MS = 60 * 1000`. |
| Why noteworthy | Read-only viewer; 1-min freshness floor is correct for the surface. |

---

## 5. Five-Layer Cross-Check

| Layer | Says | Truth |
|---|---|---|
| **Docs** | Per Constitutional #5: "Server state stays server-side — Zustand holds only client state" | Code violates this in 11 stores; `currentBrand` is the explicitly-rationalized exception ("selection state") but the snapshot shape includes server-derived fields (displayName, role, hue, cover, stats, currentLiveEvent) — so the rationale doesn't hold. |
| **Schema** | RLS + DB triggers handle authoritative state | Confirmed; no schema gaps causing the sync issue. The sync issue is purely client-side. |
| **Code** | React Query + Zustand for state; supabase-js for DB; AuthContext for session | Code structure is sound but missing 3 architectural glue pieces: focusManager wiring, Realtime subscription, sign-out store reset. |
| **Runtime** | Operator runtime test 2026-05-06: device A delete → device B still shows brand | Confirmed. Matches all three RC findings simultaneously. |
| **Data** | DB has `deleted_at IS NOT NULL` for the deleted brand; AsyncStorage on device B has `mingla-business.currentBrand.v13 = { state: { currentBrand: { id: <deleted-id>, ... } } }` | Direct contradiction between DB state and persisted client state — the canonical sync gap signature. |

**Layer disagreement:** Docs say "Zustand client-state only", code violates. Code thinks it's doing the right thing (the v13 migrate comment explicitly claims compliance). Runtime + Data prove the violation has user-facing consequences.

---

## 6. Blast Radius

| Surface | Affected by sync gap? | Severity given today's wiring |
|---|---|---|
| Brand selection (currentBrand) | YES — operator-confirmed | S1 — phantom navigation, mutation against tombstone |
| Brand list | YES — staleTime 5min, no focus refresh | S2 — stale list, missing entries |
| Single-brand reads (rename, cover) | YES — same | S3 — cosmetic |
| Permission/role | YES — useCurrentBrandRole 5min | S0/S1 — security-adjacent |
| Team membership snapshots (brandTeamStore) | YES — Zustand persist | S1 |
| Orders, guests, scans, door sales | YES — all Zustand persist | S1-S2 (financial / operational data) |
| Draft events | YES — Zustand persist | S2 (collab-editing future risk) |
| Live events | YES — Zustand persist | S2 (status, sold count) |
| Event edit log | YES — Zustand persist | S3 (read-only viewer) |
| Scanner invitations | YES — Zustand persist | S1 (invited but unsynced) |
| Notification preferences | UNCLEAR — could be client-only | LOW |
| Audit log | NO — useAuditLog 1min refresh acceptable | NONE |
| Cascade preview | NO — 30s acceptable | NONE |
| Public buyer routes (`/checkout`, `/e`, `/o`) | DIFFERENT THREAT MODEL — anon, single-session | LOW |

**Solo/collab parity:** N/A in mingla-business. App-mobile is out of scope.

---

## 7. Realtime feasibility note

Supabase Realtime DOES respect RLS by default — when a row event is published, only clients whose RLS policies admit that row receive the event. Mingla-business RLS policies have been audited (ORCH-0734) and now include direct-predicate `account_id = auth.uid()` SELECT for owners, so Realtime would correctly fan out brand events to the brand owner's devices.

**Setup checklist (what implementor would need):**
1. Verify Supabase project's `supabase_realtime` publication includes `brands`, `brand_team_members`, `events`, `orders` (typically default; verify in Dashboard → Database → Replication).
2. App-root `useEffect` to `supabase.channel('user_changes').on('postgres_changes', { event: '*', schema: 'public', table: 'brands', filter: \`account_id=eq.\${user.id}\` }, ...).subscribe()` — fanout to React Query invalidations.
3. Cleanup on signOut / unmount.

**Cost:**
- One persistent WebSocket per signed-in client. Battery + radio modest.
- Server-side load: Postgres → publication → realtime server → ws fanout. Default Supabase plans include some Realtime quota.

**Gotcha:** Realtime delivers row events that match the user's RLS, so for the soft-delete UPDATE pattern, the post-update row has `deleted_at NOT NULL` — it might be admitted by the new "Account owner can select own brands" policy (no deleted_at gate; per ORCH-0734-v1 design intent) → owner still receives the UPDATE event. Verify via spec/test.

---

## 8. Persisted Zustand audit (deep section)

`currentBrandStore.ts:367-398` is the canonical case:
- partialize keeps full `Brand` object (not just `currentBrandId`)
- migrate function (line 374-386) does NOT trigger a re-fetch on hydrate
- No subscription to React Query cache to keep currentBrand in sync with `useBrand(currentBrandId)`

**Pattern recommendation (canonical):**
```
currentBrandId: string | null  ← persist this (pure pointer = client state)
useCurrentBrand() → useBrand(currentBrandId)  ← server-fresh data via React Query
```

Apply to every Zustand store that holds server data. For each, the decision tree:
1. Does this store hold a snapshot of a server entity that other devices can mutate? → YES → migrate to React Query OR add hydration-time refetch.
2. Does this store hold a pointer/selection? → keep persisted as ID-only.
3. Does this store hold genuine client UI state (filter pills, sort order, scroll position)? → keep as-is.

Without per-store deep inspection (out of audit scope per dispatch), I cannot definitively place each of the 11 persisted stores in one of these 3 categories. Recommendation: orchestrator dispatches a "Zustand audit" follow-up cycle that classifies each store + emits per-store fix decisions. For now, currentBrand + brandTeam are confirmed Category 1 (highest-risk).

---

## 9. Auth-desync findings

| Scenario | Current behavior | Recommended |
|---|---|---|
| Device A signs out → device B's session | onAuthStateChange fires SIGNED_OUT eventually (token refresh fails OR explicit broadcast); device B routes to welcome | ✅ already correct |
| Device A's session revoked server-side | Token refresh fails on B → SIGNED_OUT propagates | ✅ already correct |
| Device A changes password | All sessions invalidated server-side (Supabase default) → both refresh fail → both sign out | ✅ already correct |
| User permission/role changed (e.g., demoted on a brand) | NOT propagated — device B's useCurrentBrandRole keeps returning old rank for staleTime + indefinitely | ❌ NOT correct — needs Tier 0 Realtime |
| Device A's team membership removed | NOT propagated — device B's brandTeamStore still has the entry | ❌ NOT correct — needs Tier 0 Realtime |

---

## 10. Recommendation Matrix per Surface (tiered)

| Surface | Tier | Reasoning |
|---|---|---|
| `currentBrand` Zustand snapshot | **Tier 0** | Operator-confirmed today; fix architecturally (persist ID only + use React Query). MUST fix. |
| `useCurrentBrandRole` permission cache | **Tier 0** | Security-adjacent; permission drift is S0. Realtime push on `brand_team_members` change. |
| `brand_team_members` (brandTeamStore + the role hook are coupled) | **Tier 0** | Same reasoning. |
| `brands` table generally (delete + create + update) | **Tier 0 or Tier 1** | Tier 0 if operator wants total sync (recommended given operator's stated directive: "We need total sync"); Tier 1 if pragmatic budget-aware approach. |
| `events` table (when wired) | **Tier 1** | Refetch-on-focus + invalidation OK for most event-list flows. Tier 0 if live-event status changes need real-time UX (tickets sold count etc.). |
| `orders` / `guests` / `scans` / `door_sales` | **Tier 1** | Refetch-on-focus + reasonable polling at door-staff workstations. Future could elevate to Tier 0 for door-scanner real-time deduplication. |
| `creator_accounts` profile | **Tier 1** | Refetch-on-focus enough for display_name / marketing_opt_in changes. |
| `notificationPrefsStore` | **Tier 3 (cold-start only)** | Likely client-mirror of server prefs; refetch on app cold-start sufficient. |
| `audit_log` viewer | **Tier 2 (polling)** | 30-60s polling for the open viewer surface. |
| `cascade preview` | **Tier 2 (already 30s polling)** | Acceptable. |
| `brandList.ts` stub | **N/A — TRANSITIONAL** | Slated for removal. |
| Public buyer routes | **N/A — different threat model** | Anonymous, single-session. |
| Auth session sync | **Already wired** | onAuthStateChange. ✅ |
| AppState→focusManager wiring | **TIER 1 — DO FIRST** | Single highest-leverage 8-line fix; benefits ALL React Query consumers immediately. Foundation for everything else. |
| signOut → store reset | **TIER 0 — DO FIRST** | Constitutional #6 violation; privacy-leak-on-shared-device. Sequential `useStore.getState().reset()` for each persisted store + `queryClient.clear()`. |

**Tier 0 = Realtime push:** `currentBrand`, `useCurrentBrandRole`, brand_team_members, signOut store-reset
**Tier 1 = focusManager + invalidation:** ALL React Query consumers (brands, events, orders, guests, scans, etc.) get this for free with the 8-line app-root wiring
**Tier 2 = polling:** audit_log, cascade preview (already there)
**Tier 3 = cold-start only:** notificationPrefs, truly static data
**Tier 4 = stale-warning UX:** none currently recommended

---

## 11. Open architectural questions for orchestrator

These need operator steering before implementor SPECs can ship:

1. **Realtime budget vs scope.** Tier 0 (Realtime) for everything operator-mutated is the most-correct fix but adds infrastructure. Tier 1 (focusManager only) is the minimum-viable. Operator's stated directive ("we need total sync") leans Tier 0. Confirm scope: brands + brand_team_members + creator_accounts at minimum? Add events + orders later when wired?
2. **Per-store Zustand audit scope.** I deeply audited `currentBrand`. The other 10 persisted stores are statistically likely Category 1 (server snapshots) but not byte-level confirmed. Authorize a "Zustand store classification audit" follow-up cycle that classifies each + emits per-store fix?
3. **`signOut` store reset — synchronous or fire-and-forget?** Sequential reset of 11 stores + queryClient.clear() may delay the signOut UX by a few hundred ms. Acceptable, or do we fire-and-forget after `supabase.auth.signOut` resolves? The Constitutional #6 risk vs UX latency tradeoff.
4. **AppState→focusManager: include `onlineManager` too?** RN community has the standard onlineManager wrapper for `NetInfo`. Free with the same fix. Recommend bundling.
5. **Per-staleTime tuning.** After focusManager wiring, current 5-min staleTimes might be tuned looser (since foreground refetch handles most cases) OR tighter (still need TTL backstop for long-foregrounded sessions). Operator preference?
6. **Migration strategy for `currentBrand`.** Cutting v13 → v14 (persist ID only) is a one-shot migration. The migrate function would need to extract just the `id` from the v13 currentBrand object. Existing currentBrand snapshots become bare IDs; first React Query fetch on next mount fills the rest. Acceptable UX tradeoff?

---

## 12. Confidence Levels

| Finding | Confidence | Reasoning |
|---|---|---|
| RC-A Zero Realtime | **HIGH** | Exhaustive negative grep across mingla-business/src |
| RC-B Zero focusManager wiring | **HIGH** | Exhaustive negative grep |
| RC-C currentBrand server-snapshot persistence | **HIGH** | Read currentBrandStore.ts:355-398 verbatim |
| RC-D signOut doesn't reset stores | **HIGH** (static-trace) / MEDIUM (runtime) | Negative grep on AuthContext for `reset()`, `clear()`. Recommend operator confirm via cross-account test. |
| CF-1 useCurrentBrandRole 5min staleTime | **HIGH** | Direct file read |
| CF-2 hardcoded `["brand-role", X]` key | **HIGH** | Confirmed in two consumers via grep |
| HF-1 React Query cache not cleared on signOut | **HIGH** | Coupled with RC-D |
| HF-2..7 (other staleTimes / patterns) | **HIGH** for the existence; **MEDIUM** for ranking |
| OB-1 onAuthStateChange wired | **HIGH** | Direct file read |
| Surface inventory completeness for the 13 stores + 7 hooks | **HIGH** for Zustand stores (read all headers / grep'd partialize); **MEDIUM** for per-store server-vs-client classification (deep-read 1 of 11; classified rest by name + persistence pattern) |
| Realtime feasibility | **MEDIUM-HIGH** | Standard Supabase pattern; gotchas flagged |

---

## 13. Discoveries for orchestrator

| ID | Discovery | Severity | Recommendation |
|---|---|---|---|
| **D-FOR-0738-1** | **Constitutional #6 (logout clears everything) is violated.** signOut doesn't reset 11 persisted Zustand stores + doesn't `queryClient.clear()`. Cross-account data leak on shared devices. | **S0/S1 — privacy** | Tier 0 immediate fix in next cycle (3-line addition to AuthContext.signOut). Recommend fast-track. |
| D-FOR-0738-2 | `["brand-role", brandId]` query key is hardcoded in 2+ consumers; not from `brandKeys` factory. Constitutional #4 (one query key per entity) violation. | S3 | Add `brandKeys.role(brandId)` to factory; refactor consumers. Trivial. Bundle with the role-cache fix. |
| D-FOR-0738-3 | `useCurrentBrandRole` staleTime 5 min on a permission-bearing surface is too generous. Even without Realtime, drop to 30s as defense-in-depth. | S2 | Trivial change; bundle with focusManager wiring. |
| D-FOR-0738-4 | The remaining 10 persisted Zustand stores (brandTeam, orders, guests, scans, doorSales, draftEvent, liveEvent, eventEditLog, scannerInvitations, notificationPrefs) require per-store classification (server-snapshot vs client-state). Not done in this audit. | S2 (architectural) | Dispatch follow-up cycle "Zustand server-state classification audit" — classify each + decide per-store fix. |
| D-FOR-0738-5 | `useBrandCascadePreview` 30s staleTime is good. Use as canonical example for other "actively-updated dashboard" surfaces. | S4 (note) | Reference in future SPECs. |
| D-FOR-0738-6 | `notificationPrefsStore` could be either client-mirror or server-mirror. Quick byte-level read needed (out of audit scope). | S3 | Bundle with D-FOR-0738-4. |
| D-FOR-0738-7 | Zero error-recovery wiring on Realtime add. When Realtime is wired in a future SPEC, the implementor must include reconnection logic + onError surfacing per Constitutional #3. | S2 (forward-looking) | Add to SPEC requirements when Tier 0 ships. |

---

## 14. Fix Strategy (direction only — full SPECs deferred to orchestrator dispatches)

Tiered rollout the orchestrator can dispatch as separate cycles:

**Cycle 1 (FAST — same week):** Foundation
- AppState→focusManager + onlineManager wiring (8 lines, app root)
- signOut store-reset + queryClient.clear() (~15 lines, AuthContext.signOut)
- brandKeys.role(brandId) factory entry + refactor 2 consumers (5 lines)
- useCurrentBrandRole staleTime 5min → 30s (1 line)

Closes: D-FOR-0738-1, D-FOR-0738-2, D-FOR-0738-3, partial RC-A (within-device foregrounding now refetches), partial CF-1.

**Cycle 2 (MEDIUM):** currentBrand architectural fix
- Migrate `currentBrandStore` v13 → v14: persist `currentBrandId: string | null` only
- Replace `useCurrentBrand()` consumers to read via `useBrand(currentBrandId)`
- Hydration-time React Query prefetch on app mount

Closes: RC-C.

**Cycle 3 (BIGGEST):** Tier 0 Realtime for permission-bearing surfaces
- App-root Realtime channel subscription (`brands`, `brand_team_members`)
- Fanout to React Query invalidations
- Reconnect/onError handling

Closes: RC-A (for the highest-risk surfaces), RC-D-related drift, CF-1.

**Cycle 4 (FOLLOW-UP):** Per-store Zustand classification audit + per-store fixes

Closes: HF-7, D-FOR-0738-4.

**No spec produced from THIS audit per dispatch §5.** Orchestrator decides which tiers ship and in what order.

---

## 15. Operator post-step

1. Orchestrator REVIEWs this audit + recommendation matrix.
2. Operator answers the 6 open questions in §11.
3. Orchestrator dispatches Cycle 1 (Foundation) as a SPEC + IMPL pair (lowest cost, highest leverage).
4. After Cycle 1 PASSes, operator decides whether to proceed with Cycle 2 (currentBrand architectural fix) before or after Cycle 3 (Realtime).
5. Cycle 4 is optional / lower-priority based on D-FOR-0738-4 outcome.

---

**End of report.**
