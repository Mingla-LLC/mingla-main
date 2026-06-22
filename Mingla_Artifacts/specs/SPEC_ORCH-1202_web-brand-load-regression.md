# SPEC — ORCH-1202 [business-web brand-load regression]

**Skill:** mingla-forensics (SPEC)
**Date:** 2026-06-21
**Worktree:** `~/Desktop/mingla-orchs/1201-[web-brand-load-regression]` (folder retains the `1201` label) on branch `1202-web-brand-load-regression` (HEAD == origin/main, already rebased).
**Anchor (read-only except writing this SPEC):** `~/Desktop/mingla-main`.
**Source of truth:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1202_web-brand-load-regression.md` (PROVEN root cause; runtime-reproduced twice). This SPEC honors that investigation's recommended scope and does NOT widen it.
**Confidence basis:** every hook below was re-enumerated and line-verified in the worktree for this SPEC (not copied from the investigation). The DELTA-2 set was re-derived by exact set arithmetic against the gate's two lists.

---

## 1. Executive summary

On a cold web load of the business app, ~20 React Query hooks that read RLS-protected (`auth.uid()`-scoped) tables fire BEFORE the Supabase session attaches. The unauthenticated read returns HTTP **200 + `[]`** (a success, not a 401), so React Query caches the empty result and — because `retry` is error-only and `refetchOnWindowFocus` is false — never refetches after the JWT arrives. The section stays empty/zero until the user manually reloads. Worst on mobile-web (slowest JWT attach); the always-mounted TopBar notification bell (`useBusinessNotifications`) is the highest-blast offender.

The proven cure (ORCH-1004) is to fold `isAuthReady` into each hook's React Query `enabled` so the query stays *disabled* (reads as loading, not empty) until auth is ready, then fires WITH the JWT. The ORCH-1004 CI gate that was supposed to enforce this universally is a **hand-maintained curated list** that went stale: 50 new hook files landed since the list was last edited and 20 of them are auth-scoped-and-ungated, all invisible to a green CI.

This SPEC:
1. Fixes the **20 ungated auth-scoped hooks** (DELTA-1) by folding `isAuthReady` into `enabled`, mirroring `useBrands.ts` byte-for-byte in shape.
2. Registers the **20 fixed + 17 already-gated-but-unregistered** (DELTA-2) auth-scoped hooks into `AUTH_SCOPED_HOOK_FILES`, and adds **3 newly-discovered public hooks** to `PUBLIC_HOOK_ALLOWLIST`.
3. **Hardens the gate from opt-in to fail-closed** with a COMPLETENESS CHECK: every query-hook file under `mingla-business/src/hooks/**` MUST appear in one of the two lists or CI fails. This is the structural fix that prevents a fourth recurrence.

Pure-JS; ships to web via Vercel `[deploy]`; rides the next business native build; **NO `eas update`** (COMMS-0052 BLOCK).

---

## 2. Scope & non-goals

### In scope
- Gate the **20 DELTA-1** ungated auth-scoped hooks (§4.A table) — fold `isAuthReady` into `enabled`, `DISABLED_KEY` sentinel for the disabled query-key.
- Register **37 auth-scoped hooks** (20 DELTA-1 + 17 DELTA-2) into `AUTH_SCOPED_HOOK_FILES` (§4.B).
- Add **3 public hooks** to `PUBLIC_HOOK_ALLOWLIST` (§4.B): `useBrandStripeCountries.ts`, `useTripTierAllIn.ts`, `usePublicExperience.ts`.
- Harden the gate with a fail-closed **completeness check** (§4.C).
- Regression-test contract proving fails-on-revert (§7, §9).
- DRAFT invariant `I-PROPOSED-1202-AUTH-SCOPED-HOOK-COMPLETENESS` (§6).

### Non-goals (explicitly NOT in this SPEC — do not touch)
- **Do NOT gate the PUBLIC_HOOK_ALLOWLIST hooks** (anon buyer-web reads depend on them). Gating them is a regression (§4.D).
- **Do NOT change any realtime subscription, `staleTime`, `queryFn`, query-key factory, or `refetch*` behavior** in the touched hooks. Only the `enabled` computation, the `useAuth` import, and the disabled-state query-key sentinel change.
- **Do NOT touch** `AuthContext.tsx`, `authReadiness.ts`, `queryClient.ts`, `brandListState.ts`, `useBrands.ts`, `useBrandListShim.ts` — all confirmed correct (investigation F-5, F-6, Q1, Q4).
- **Do NOT** address F-7 (stale-chunk / SPA "reload to load") — separate low-priority thread, registered for the orchestrator.
- **Do NOT** OTA the business app (`eas update`) — COMMS-0052 BLOCK.
- **Do NOT** convert the gate into an auth-table-introspecting AST analyzer that resolves service-module call graphs — the completeness check is a membership test, not a data-flow analyzer (§4.C rationale).

### Assumptions
- The `useBrands.ts` shape (`const { isAuthReady } = useAuth(); const enabled = isAuthReady && <pred>; queryKey: enabled ? <key> : DISABLED_KEY`) is the canonical, gate-passing template (verified at `useBrands.ts:135-136,191`).
- `DISABLED_KEY` is defined per-file (there is NO shared util); each fixed hook that lacks one defines its own local `const DISABLED_KEY = [...] as const;` (matches existing convention across 28 hook files).
- `useAuth` is imported from `"../context/AuthContext"` (marketing hooks: `"../../context/AuthContext"`).

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior demanded | Files touched there | Parity |
|---|---------|----------|-------------------------------|---------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NOT covered | — | none | N/A — these are `mingla-business` hooks; consumer app is a separate codebase. |
| 2 | Consumer Android (`app-mobile/`) | NOT covered | — | none | N/A — same reason. |
| 3 | Buyer/anonymous Web | NOT covered (must NOT regress) | Anon reads (public events/trips/experiences, all-in price, stripe countries) keep working with NO auth gate | none (allowlist additions PROTECT this) | Automatic — allowlist additions guarantee these stay ungated. |
| 4 | Business iOS | Covered (rides next native build) | Cold-start authed sections render loading→data, never empty-until-reload | the 20 DELTA-1 hooks | Automatic — shared hook code. Lower incidence (native splash masks the JWT window) but the fix applies. |
| 5 | Business Android | Covered (rides next native build) | Same as iOS | same 20 hooks | Automatic — shared hook code. |
| 6 | Admin Web (`mingla-admin/`, adjacent) | NOT covered | — | none | N/A — separate app, separate hooks. |
| 7 | **Business Web preview/prod (adjacent — PRIMARY here)** | **Covered** | On cold web load (desktop Chrome AND Android/Samsung Internet), the TopBar bell, account/partner sections, team lists, Ari chat, marketing campaigns, venue suite, etc. render loading→data with NO manual reload | the 20 DELTA-1 hooks + the gate file | Automatic — shared hook code; ships via Vercel `[deploy]`. |

Primary surface = **Business Web** (surface 7); the bug is web-acute (async JWT attach is slowest on mobile-web). NOT-covered reasons are one-phrase each above.

---

## 4. Layered specification

Only two layers are touched: **Hook** (client `enabled` gating) and **CI gate** (the strict-grep script + its regression test). No DB, edge, service, realtime, or new-component changes.

### 4.A — Hook layer: the 20 DELTA-1 fixes (exact before → after)

**Universal recipe for every DELTA-1 hook:**
1. Add the import (after existing imports): `import { useAuth } from "../context/AuthContext";` (marketing/ hooks: `"../../context/AuthContext"`). If the file already imports from AuthContext for another reason, add `useAuth` to that import.
2. Inside the hook body, before the `enabled` computation, add: `const { isAuthReady } = useAuth();`
3. Fold `isAuthReady` into `enabled`:
   - If the hook HAS a `const enabled = <pred>;` → change to `const enabled = isAuthReady && <pred>;`.
   - If the hook HAS an inline `enabled: <pred>,` in the `useQuery` options → either lift it to a `const enabled = isAuthReady && <pred>;` above the call and reference `enabled` in both `enabled` and `queryKey`, OR inline `enabled: isAuthReady && <pred>,` (lifting is preferred so the queryKey can reuse it).
   - If the hook has **NO `enabled`** → add `const enabled = isAuthReady;` and pass `enabled,` into `useQuery`.
4. Make the disabled-state query-key a `DISABLED_KEY` sentinel: `queryKey: enabled ? <existing key> : DISABLED_KEY`. If the file has no `DISABLED_KEY`, add a local `const DISABLED_KEY = ["<hook-slug>-disabled"] as const;` near the top (mirror `useBrands.ts` / `useBusinessNotifications.ts`). Where a hook already uses a `"...-disabled"` inline literal or a `"__none__"`/`"none"`/`.all` fallback key, REPLACE that fallback with the `DISABLED_KEY` sentinel so the disabled state has one canonical key.
5. **Preserve byte-for-byte:** every realtime `useEffect`/`supabase.channel` block (gate its early-return on the new `enabled` exactly as today — most already do via the existing predicate), `staleTime`, `refetch*`, `queryFn`, query-key factories, and all mutations in the same file.

> For hooks with a realtime subscription (`useBusinessNotifications`): the subscription's `useEffect` already early-returns on `userId === null`; after the fix it should early-return on `!enabled` (which now also covers pre-auth). Verify the subscription does not fire pre-auth — if its guard is `userId !== null`, change it to `enabled` so it too waits for auth. Do NOT otherwise alter the channel.

**Per-hook table** (relative to `mingla-business/src/hooks/`; line numbers verified in the worktree this SPEC was written against — implementor must re-confirm after rebase and adjust if drifted):

| # | File | Hook(s) | Current `enabled` (verbatim) | Target `enabled` | queryKey disabled-state change |
|---|------|---------|------------------------------|------------------|-------------------------------|
| 1 | `useBrandInvitations.ts` | `useBrandInvitations` (L48) | `enabled: brandId !== null,` (L55) | `enabled: isAuthReady && brandId !== null,` | already `: ["brand-invitations-disabled"]` (L52-54) — keep, or fold to local DISABLED_KEY |
| 1b | `useBrandInvitations.ts` | `useBrandTeamMembers` (L61) | `enabled: brandId !== null,` (L68) | `enabled: isAuthReady && brandId !== null,` | already `: ["brand-team-members-disabled"]` (L65-67) — keep |
| 1c | `useBrandInvitations.ts` | `useMyPendingInvites` (L121) | `enabled: userId !== null && enabled,` (L129) | `enabled: isAuthReady && userId !== null && enabled,` | already `: ["brand-invitations-my-pending-disabled"]` — keep |
| 2 | `useScannerInvitations.ts` | `useScannerInvitationsForBrand` (L39) | `enabled: brandId !== null,` (L46) | `enabled: isAuthReady && brandId !== null,` | already `: ["scanner-invitations-brand-disabled"]` — keep |
| 2b | `useScannerInvitations.ts` | `useScannerInvitationsForEvent` (L52) | `enabled: eventId !== null,` (L59) | `enabled: isAuthReady && eventId !== null,` | already `: ["scanner-invitations-event-disabled"]` — keep |
| 3 | `useBrandPaystack.ts` | `useBrandPaystackStatus` (L54) | `enabled: typeof brandId === "string" && brandId.length > 0,` (L60) | `enabled: isAuthReady && typeof brandId === "string" && brandId.length > 0,` | lift to `const enabled`; queryKey (L58) → `enabled ? brandPaystackKeys.status(brandId) : DISABLED_KEY` (define local DISABLED_KEY; drop the `?? "none"` fallback) |
| 3b | `useBrandPaystack.ts` | `useBrandBanks` (L43) | `enabled,` (caller param, default true) (L47) | **LEAVE AS-IS — see note** | no change |
| 4 | `useBrandTaxRegistration.ts` | `useBrandTaxRegistration` (L37) | `enabled: brandId !== null,` (L42) | lift `const enabled = isAuthReady && brandId !== null;` | queryKey (L41) `["brand", brandId, "taxRegistration"]` → `enabled ? ["brand", brandId, "taxRegistration"] : DISABLED_KEY` (define local DISABLED_KEY) |
| 5 | `useBusinessNotifications.ts` | `useBusinessNotifications` (L171) | `const enabled = userId !== null;` (L174) | `const enabled = isAuthReady && userId !== null;` | already `enabled ? businessNotificationKeys.all(userId) : DISABLED_KEY` (L178) — keep. Also gate the realtime subscription on `enabled`. |
| 6 | `useNotificationTypePrefs.ts` | `useNotificationTypePrefs` (L76) | `const enabled = userId !== null;` (L78) | `const enabled = isAuthReady && userId !== null;` | already `enabled ? notificationPrefKeys.all(userId) : DISABLED_KEY` — keep |
| 7 | `useMinglaToSAcceptance.ts` | `useMinglaToSAcceptance` (L40) | `const enabled = brandId !== null && userId !== null;` (L44) | `const enabled = isAuthReady && brandId !== null && userId !== null;` | already `enabled ? ...detail(brandId, userId) : DISABLED_KEY` — keep |
| 8 | `useAriPreferences.ts` | `useAriPreferences` (L17) | **NO enabled** (useQuery L26) | add `const enabled = isAuthReady;` + `enabled,` | queryKey (L27) `agentQueryKeys.profile()` → `enabled ? agentQueryKeys.profile() : DISABLED_KEY` (define local DISABLED_KEY) |
| 9 | `useConversationList.ts` | `useConversationList` (L11) | **NO enabled** (useQuery L16) | add `const enabled = isAuthReady;` + `enabled,` | queryKey (L17) `agentQueryKeys.conversations()` → `enabled ? agentQueryKeys.conversations() : DISABLED_KEY` |
| 10 | `usePartnerSplits.ts` | `usePartnerSplits` (L18) | **NO enabled** (useQuery L23) | add `const enabled = isAuthReady;` + `enabled,` | queryKey (L24) → `enabled ? partnerSplitsKeys.list(params) : DISABLED_KEY` |
| 10b | `usePartnerSplits.ts` | `usePartnerEarningsSummary` (L30) | **NO enabled** (useQuery L33) | add `const enabled = isAuthReady;` + `enabled,` | queryKey (L34) → `enabled ? partnerSplitsKeys.summary(params) : DISABLED_KEY` |
| 11 | `usePartnerBrandLinks.ts` | `usePartnerBrandLinks` (L14) | **NO enabled** (useQuery L18) | add `const enabled = isAuthReady;` + `enabled,` | queryKey (L19) → `enabled ? partnerBrandLinksKeys.list() : DISABLED_KEY` |
| 12 | `usePartnerStripe.ts` | `usePartnerStripeStatus` (L31) | **NO enabled** (useQuery L35; `staleTime:0`, refetchOnMount:"always") | add `const enabled = isAuthReady;` + `enabled,` | queryKey (L36) → `enabled ? partnerStripeKeys.status() : DISABLED_KEY`. **Preserve `staleTime:0`/`refetchOnMount`/`refetchOnWindowFocus` exactly.** |
| 13 | `useTripEditLog.ts` | `useTripEditLog` (L42) | `const enabled = tripEventId !== null && tripEventId.length > 0;` (L46) | `const enabled = isAuthReady && tripEventId !== null && tripEventId.length > 0;` | already `enabled ? ...byTrip(...) : DISABLED_KEY` — keep |
| 14 | `useTripHasWebPurchases.ts` | `useTripHasWebPurchases` (L24) | `const enabled = tripEventId !== null && tripEventId.length > 0;` (L25) | `const enabled = isAuthReady && tripEventId !== null && tripEventId.length > 0;` | already `enabled ? [...] : [...,"__disabled__"]` — keep (or fold to local DISABLED_KEY) |
| 15 | `useVenueClaimFeedback.ts` | `useVenueClaimFeedback` (L65) | `const enabled = brandId !== null && Boolean(followUpAt);` (L71) | `const enabled = isAuthReady && brandId !== null && Boolean(followUpAt);` | queryKey (L75) `feedbackKey ?? brandKeys.feedback("__none__")` → `enabled ? feedbackKey : DISABLED_KEY` (define local DISABLED_KEY; drop `"__none__"` fallback) |
| 15b | `useVenueClaimFeedback.ts` | `useVenueClaimOpenCount` (L173) | `const enabled = brandId !== null && Boolean(followUpAt);` (L177) | `const enabled = isAuthReady && brandId !== null && Boolean(followUpAt);` | queryKey (L179-180) → `enabled ? brandKeys.feedback(brandId) : DISABLED_KEY` (drop `"__none__"` fallback) |
| 16 | `useCancelTripBooking.ts` | `useOperatorRefundPreview` (L84) | `const enabled = orderId !== null && orderId.length > 0;` (L87) | `const enabled = isAuthReady && orderId !== null && orderId.length > 0;` | already `enabled ? ...preview(orderId,"operator") : DISABLED_KEY` — keep |
| 16b | `useCancelTripBooking.ts` | `useBuyerRefundPreview` (L52) | `const enabled = orderId !== null && ... && token !== null && ...;` (L56-57) | **LEAVE AS-IS — see note** (buyer HMAC-token anon path) | no change |
| 17 | `marketing/useCampaigns.ts` | `useCampaigns` (L28) | `const enabled = typeof input.account_id === "string" && input.account_id.length > 0;` (L32-33) | `const enabled = isAuthReady && typeof input.account_id === "string" && input.account_id.length > 0;` | queryKey (L35-37) → `enabled ? marketingKeys.campaigns.list(...) : marketingKeys.campaigns.all` (keep `.all` fallback OR a DISABLED_KEY — `.all` is acceptable; do not break the key factory) |
| 18 | `marketing/useCampaignReport.ts` | `useCampaignReport` (L29) | `const enabled = typeof campaignId === "string" && campaignId.length > 0;` (L32) | `const enabled = isAuthReady && typeof campaignId === "string" && campaignId.length > 0;` | queryKey (L34-36) → `enabled ? ...byId(campaignId) : marketingKeys.campaigns.all` |
| 19 | `marketing/useTemplate.ts` | `useTemplate` (L29) | `const enabled = typeof templateId === "string" && templateId.length > 0 && templateId !== "new";` (L34-37) | prepend `isAuthReady &&` | queryKey (L39-41) → `enabled ? ...byId(templateId) : marketingKeys.templates.all` |
| 20 | `marketing/useStarterTemplates.ts` | `useStarterTemplates` (L23) | **NO enabled** (useQuery L24) | add `const enabled = isAuthReady;` + `enabled,` | queryKey (L25) `marketingKeys.templates.starter` → `enabled ? marketingKeys.templates.starter : marketingKeys.templates.all` |

**Notes / carve-outs (DO NOT GATE these two — they are NOT auth-scoped-by-uid):**
- **`useBrandBanks` (in `useBrandPaystack.ts`, row 3b):** reads the Paystack bank *list* (a static, non-`auth.uid()`-scoped resource; no brand id). It takes a caller `enabled` param. Leave unchanged. It is NOT a separate file, so the *file* `useBrandPaystack.ts` still gets registered for `useBrandPaystackStatus`. The gate checks at file granularity; `useBrandPaystack.ts` passes once `useBrandPaystackStatus` folds `isAuthReady` (the gate's regex looks for ANY `isAuthReady`-folded `enabled` in the file).
- **`useBuyerRefundPreview` (in `useCancelTripBooking.ts`, row 16b):** the BUYER refund path is an anonymous HMAC-token route (token-scoped, not `auth.uid()`-scoped) used on buyer-web. Leave its `enabled` unchanged. The file `useCancelTripBooking.ts` still gets registered because `useOperatorRefundPreview` (auth-scoped) folds `isAuthReady` — one folded `isAuthReady` in the file satisfies the gate regex. **IMPLEMENTOR: verify the gate passes for this file with one gated + one ungated hook (it will, because the regex is file-level `\bisAuthReady\b` + an `enabled` containing `isAuthReady`); if a future stricter per-hook gate is desired it is out of scope here.**

> **Why file-granularity is acceptable:** the existing gate (and this SPEC) checks per-FILE. A file with at least one auth-scoped hook that folds `isAuthReady` passes. The two carve-out hooks above are intentionally-anon co-residents; gating them would break (Paystack bank list has no auth context; buyer refund is a token route). This matches the gate's existing file-level model and is not a regression — the auth-scoped hook in each file IS gated.

### 4.B — CI gate: list registration

**Add to `AUTH_SCOPED_HOOK_FILES`** (currently 24 entries) the following **37** files (20 DELTA-1 + 17 DELTA-2), bringing the list to **61**:

**DELTA-1 (20)** — the just-fixed files:
```
useBrandInvitations.ts, useScannerInvitations.ts, useBrandPaystack.ts,
useBrandTaxRegistration.ts, useBusinessNotifications.ts, useNotificationTypePrefs.ts,
useMinglaToSAcceptance.ts, useAriPreferences.ts, useConversationList.ts,
usePartnerSplits.ts, usePartnerBrandLinks.ts, usePartnerStripe.ts,
useTripEditLog.ts, useTripHasWebPurchases.ts, useVenueClaimFeedback.ts,
useCancelTripBooking.ts, marketing/useCampaigns.ts, marketing/useCampaignReport.ts,
marketing/useTemplate.ts, marketing/useStarterTemplates.ts
```

**DELTA-2 (17)** — already correctly gated (`isAuthReady` or the `!loading && session !== null` session-equivalent), but absent from CI; registering them protects against a future edit silently dropping the gate:
```
useBrandHours.ts, useBrandPlacePipelineState.ts, useCreatorAccount.ts,
useExperienceDetail.ts, useExperienceSoldCount.ts, useMenus.ts,
useRsvpApprovals.ts, useSupportQueue.ts, useSupportStaff.ts, useSupportTickets.ts,
useVenueAvailability.ts, useVenueCapacityRules.ts, useVenueIntelligence.ts,
useVenueReservationSettings.ts, useVenueReservations.ts, useVenueTables.ts,
useVenueWaitlist.ts
```
> (`useVenueIntelligence.ts` gates via the `SESSION_GATE_EQUIVALENT` `!loading && session !== null` pattern — the gate already treats that as satisfying; no churn needed.)

**Add to `PUBLIC_HOOK_ALLOWLIST`** (currently 5 entries) the following **3** genuinely-public/anon-safe hooks, each with a one-line reason, bringing the allowlist to **8**:
```
["useBrandStripeCountries.ts", "static 34-country list; no auth context, no auth.uid()-scoped read (anon-safe UI helper)"],
["useTripTierAllIn.ts", "fetchTierAllInCents → pg_public_event_tier_allin SECURITY DEFINER public RPC; anon buyer-web trip checkout route (ORCH-1147)"],
["usePublicExperience.ts", "anon-readable published experience via public read path; buyer-web experience page (no useAuth, no sign-in)"],
```

After this change the gate reports `all 61 auth-scoped hooks gate enabled on isAuthReady; 8 public/dual-use hooks left ungated`.

### 4.C — CI gate: the fail-closed COMPLETENESS CHECK (the structural fix)

This is the most important deliverable. Add a new check to `orch-1004-auth-scoped-query-readiness.mjs` that converts the curated list from **opt-in** (authors must remember to register) to **fail-closed** (every query hook MUST be classified or CI fails).

**Detection signal (decided after analysis):** the reliable, low-false-positive signal for "this file is a data-reading hook that must be classified" is **"the file calls `useQuery` or `useInfiniteQuery`"**. (NOTE: many registered hooks — `useTrips`, `useExperiencesByBrand` — do NOT import the supabase client directly; they route through service modules. Therefore a "imports supabase client" signal is INSUFFICIENT and would miss them. The investigation's phrasing "imports supabase AND calls useQuery" is superseded here by the verified-stronger signal: **calls useQuery/useInfiniteQuery**, full stop. This is why the completeness set is exactly the 68 query-hook files, which decompose cleanly into 61 auth-scoped + 8 public − 1 absent-but-allowlisted-tolerated `useBrand.ts` = the live set.)

**Algorithm (add to the gate, after the existing per-hook checks, before the final pass/fail):**

```
1. Recursively walk `mingla-business/src/hooks/**/*.ts` (include the `marketing/` subdir;
   EXCLUDE `__tests__/**` and any `*.test.ts` / `*.spec.ts`).
2. For each file, read its source. Classify it as a QUERY HOOK if a regex matches a
   useQuery/useInfiniteQuery CALL (not just an import): /\buseQuery\s*[<(]/ OR
   /\buseInfiniteQuery\s*[<(]/  (the `<` covers `useQuery<T>(...)`, the `(` covers `useQuery({...})`).
3. If NOT a query hook → SKIP (this tolerates mutation-only hooks, useQueryClient-only
   imperative hooks, re-export shims, and key-factory/util files — none call useQuery/useInfiniteQuery).
4. If it IS a query hook, compute its path relative to the hooks dir (POSIX separators,
   e.g. "marketing/useCampaigns.ts").
5. It MUST be a member of AUTH_SCOPED_HOOK_FILES OR PUBLIC_HOOK_ALLOWLIST (membership
   satisfies coverage — allowlist membership is ALSO valid coverage).
6. If a query-hook file is in NEITHER list → push a failure:
     `ORCH-1202 completeness: unregistered query hook "<relpath>" — it calls
      useQuery/useInfiniteQuery but is in neither AUTH_SCOPED_HOOK_FILES nor
      PUBLIC_HOOK_ALLOWLIST. Add it to AUTH_SCOPED_HOOK_FILES (if it reads an
      auth.uid()-scoped table/RPC/service — then it MUST fold isAuthReady into
      enabled) or to PUBLIC_HOOK_ALLOWLIST with a one-line anon-safe reason.`
7. ALSO (reverse direction — keep the existing per-file checks): every entry in
   AUTH_SCOPED_HOOK_FILES that exists on disk is still run through checkHook() (folds
   isAuthReady), so registering a hook that later loses its gate fails CI.
```

**False-positive handling (explicit):**
- **Mutation-only hooks** (`useMutation` but no `useQuery`/`useInfiniteQuery` call): the step-2 regex requires a useQuery/useInfiniteQuery CALL, so they never enter the completeness set. (Verified: 10 such files — e.g. `marketing/useSendNow.ts`, `useAccountDeletion.ts`.)
- **`useQueryClient`-only imperative hooks** (`useEventCoverVideoUpload.ts`, `useVenueClaimRefresh.ts`): they call `useQueryClient`, not `useQuery`. The regex `\buseQuery\s*[<(]` will NOT match `useQueryClient(` because `useQueryClient` is a different identifier — BUT a naive `/useQuery/` substring WOULD falsely match `useQueryClient`. **The regex MUST require a `<` or `(` IMMEDIATELY after `useQuery`/`useInfiniteQuery` (allowing whitespace), AND must NOT match `useQueryClient`.** Use a negative-lookahead or word boundary: `/\buseQuery(?!Client)\s*[<(]/` and `/\buseInfiniteQuery\s*[<(]/`. Implementor MUST add a self-test case proving `useEventCoverVideoUpload.ts`-style `useQueryClient()` is NOT classified as a query hook.
- **Re-export / shim files** (`useBrandListShim.ts`): it does not call `useQuery` itself (it delegates to `useBrands`), so the regex skips it. Confirmed.
- **Absent allowlist entries** (`useBrand.ts` is allowlisted but does not exist on disk): the completeness walk only sees on-disk files, so an absent allowlist entry causes no failure; the existing `checkPublicNotGated` already tolerates missing files. No change needed.

**Detection-robustness self-tests** (add to the `--self-test` block — see §9): (a) a `useQuery<T>(` string classifies as query hook; (b) a `useQuery({` string classifies; (c) a `useQueryClient()` string does NOT classify; (d) a `useMutation(`-only string does NOT classify; (e) a re-export `export { x } from "./y"` does NOT classify.

### 4.D — Allowlist preservation (hard guard)

The completeness check treats **allowlist membership as satisfying coverage** (§4.C step 5). The existing `checkPublicNotGated` continues to assert each allowlisted hook is NOT gated (fails if someone folds `isAuthReady` into a public hook). Net: the 8 public hooks (`usePublicEvents`, `usePublicTripBySlug`, `usePublicTripById`, `useBrand` [absent], `useIntakeSchema`, + the 3 new) stay ungated and anon buyer-web reads are protected. **No public hook is gated by this SPEC.**

---

## 5. Success criteria

- **SC-1 (Web — primary):** On a cold business-web load (desktop Chrome AND Android/Samsung Internet) of an authed page, every section backed by a DELTA-1 hook renders loading→data and is populated WITHOUT a manual reload. Specifically the TopBar notification bell (`useBusinessNotifications`) shows the correct unread count on first paint after auth, not zero-until-reload.
- **SC-1-iOS / SC-1-Android (Business native):** same hooks fire only after `isAuthReady`; no behavioral regression on native (rides next native build). Verified by the gate + jest, native eyeball deferred to the next build.
- **SC-2 (per-hook gate):** Each of the 20 DELTA-1 hooks reads `isAuthReady` from `useAuth()` and folds it into its `enabled` computation; its disabled-state queryKey is a sentinel (`DISABLED_KEY` or an explicit `"...-disabled"`/`.all` fallback). The ORCH-1004 gate passes for all 61 registered files.
- **SC-3 (completeness, fail-closed):** Running the gate, EVERY `.ts` file under `mingla-business/src/hooks/**` (excluding tests) that calls `useQuery`/`useInfiniteQuery` is a member of `AUTH_SCOPED_HOOK_FILES` or `PUBLIC_HOOK_ALLOWLIST`. Adding a new unregistered query hook FAILS CI with the §4.C step-6 message.
- **SC-4 (allowlist preserved):** No public hook (`usePublicEvents`, `usePublicTripBySlug`, `usePublicTripById`, `useIntakeSchema`, `useBrandStripeCountries`, `useTripTierAllIn`, `usePublicExperience`) is gated on `isAuthReady`; `checkPublicNotGated` passes for all 8.
- **SC-5 (no behavior drift):** No `staleTime`, `queryFn`, query-key factory, realtime subscription, or `refetch*` option changed in any DELTA-1 hook (diff shows only `useAuth` import, `isAuthReady` fold into `enabled`, and the disabled-key sentinel).
- **SC-6 (carve-outs preserved):** `useBrandBanks` and `useBuyerRefundPreview` remain ungated (anon/token routes); their files still pass the gate via their auth-scoped co-resident hook.

---

## 6. Invariants

### Preserved
- **I-DISABLED-QUERY-IS-LOADING (ORCH-0889):** the gated shape reads as loading, not empty. The DELTA-1 fixes RESTORE compliance (they currently violate the spirit). Verified by SC-1.
- **The ORCH-1004 invariant** (every auth-scoped hook folds `isAuthReady`): re-established and now enforced fail-closed by the completeness check.
- **I-PROPOSED-BRANDLIST-CACHED-OVER-REFETCH (ORCH-1136):** untouched (`brandListState.ts`/`useBrands.ts` not modified).
- **I-PROPOSED-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS:** untouched (no analytics/provider changes).

### NEW (DRAFT — flips ACTIVE on CLOSE; orchestrator owns the flip)

**`I-PROPOSED-1202-AUTH-SCOPED-HOOK-COMPLETENESS` (DRAFT)**
- **Rule:** Every `.ts` file under `mingla-business/src/hooks/**` (excluding `__tests__`/`*.test.ts`/`*.spec.ts`) that calls `useQuery` or `useInfiniteQuery` MUST be a member of exactly one of `AUTH_SCOPED_HOOK_FILES` (then it MUST fold `isAuthReady` into its React Query `enabled`) or `PUBLIC_HOOK_ALLOWLIST` (then it MUST NOT gate on `isAuthReady`). A query hook in neither list is a CI failure.
- **Enforcement:** the completeness check in `.github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs` (§4.C), wired into `mingla-business` package.json `test:orch-1004` and the strict-grep CI workflow.
- **Regression test:** the gate's `--self-test` block plus the jest test (§9) — a synthetic unregistered query-hook fixture makes the completeness check FAIL; removing a registered hook's `isAuthReady` gate makes the per-hook check FAIL; both PASS when restored.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 (happy) | DELTA-1 hook folds isAuthReady | `useBusinessNotifications` source | `enabled` contains `isAuthReady &&`; queryKey disabled → DISABLED_KEY | Hook (jest source-assert) |
| T2 (happy) | All 61 registered hooks pass per-hook gate | run gate | `ORCH-1004 gate PASS: all 61 ...` | CI gate |
| T3 (happy) | Completeness: every query hook classified | run gate completeness check | no `unregistered query hook` failures | CI gate |
| T4 (error/fails-on-revert) | A DELTA-1 hook loses its isAuthReady gate | revert one fold | gate FAILS: `<file>: auth-scoped hook does not read isAuthReady ...` | CI gate |
| T5 (error/fails-on-revert) | Synthetic unregistered query hook added | drop a `useQuery` fixture file into hooks/ in a sandbox copy | completeness FAILS: `unregistered query hook "<relpath>" ...` | CI gate (jest, sandbox dir) |
| T6 (edge) | `useQueryClient`-only hook NOT classified | source with `useQueryClient()` only | NOT in completeness set; no failure | CI gate self-test |
| T7 (edge) | Mutation-only hook NOT classified | source with only `useMutation(` | NOT in completeness set; no failure | CI gate self-test |
| T8 (error) | A public hook gets gated on isAuthReady | fold isAuthReady into `usePublicEvents` | `checkPublicNotGated` FAILS | CI gate |
| T9 (cache, adapted from repro_reactquery.mjs) | Ungated shape strands; gated shape waits | real query-core, queryFn returns [] pre-auth then row at t=300ms | ungated: finalDataLength 0, queryFnCalls 1; gated: finalDataLength 1 | Runtime (jest) |
| T10 (edge) | Carve-out files pass with mixed hooks | `useCancelTripBooking.ts` (1 gated + 1 ungated buyer) | gate PASS for the file | CI gate |

---

## 8. Implementation order

1. **Hook layer (DELTA-1):** edit the 20 files per §4.A. Run `tsc` / lint after each cluster. Verify diffs show ONLY the `useAuth` import + `isAuthReady` fold + disabled-key sentinel (SC-5).
2. **Gate registration (§4.B):** add the 37 entries to `AUTH_SCOPED_HOOK_FILES` and the 3 to `PUBLIC_HOOK_ALLOWLIST`. Run `node .github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs` from repo root — expect `PASS: all 61 ... 8 public`.
3. **Gate hardening (§4.C):** add the completeness check + the detection regex + the 5 robustness self-test cases to the `--self-test` block. Run `--self-test` (expect all cases pass) and the full gate (expect PASS).
4. **Regression tests (§9):** add/extend the jest test (`mingla-business/src/hooks/__tests__/authScopedQueryReadiness.test.ts` or a sibling) per §9, including the T5 sandbox-fixture test and the T9 cache test.
5. **Prove fails-on-revert:** temporarily revert one DELTA-1 fold → gate FAILS (T4); add a sandbox unregistered query hook → completeness FAILS (T5); restore both → PASS. Capture output in the implementation report.
6. Run the existing `mingla-business` jest + strict-grep suites; confirm no collateral failures.

### Scoped allowlist (implementor MAY modify ONLY these)
- The 20 DELTA-1 hook files listed in §4.A.
- `.github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs`.
- The jest regression test file (extend existing `__tests__/authScopedQueryReadiness.test.ts` or add one sibling test file).
- (If a DELTA-1 hook needs a local `DISABLED_KEY` const added — that is within its own file, already allowed.)

### DO-NOT-TOUCH
`AuthContext.tsx`, `authReadiness.ts`, `queryClient.ts`, `brandListState.ts`, `useBrands.ts`, `useBrandListShim.ts`, the 17 DELTA-2 hook files (registration is a gate-list edit, NOT a hook edit — they are already correct), all `app/` files, all service/edge/migration files, any consumer (`app-mobile/`) or admin code. Stop-and-amend before touching anything outside the scoped allowlist.

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** the fail-closed completeness check (§4.C) — the curated list can no longer silently go stale because any new query hook that is not classified fails CI. This is the root fix for the meta-bug (curated list drift), not just the 20 symptom hooks.

**Test 1 — gate self-test (in-script, `--self-test`):** add the 5 detection cases from §4.C and a completeness case (a fixture path not in either list FAILS classification). MUST exit non-zero on a missing classification, zero when all classified. Protective comment in the script explaining WHY the completeness check exists (curated-list drift shipped ORCH-1202 green).

**Test 2 — jest (`authScopedQueryReadiness.test.ts`):**
- **Fails-on-revert (per-hook):** assert that for a representative DELTA-1 hook (e.g. `useBusinessNotifications.ts`) the source contains `isAuthReady` folded into `enabled`; the test must be written so that reverting the fold makes it FAIL. (The gate itself is the canonical enforcer; this is the redundant unit assertion.)
- **Fails-on-revert (completeness):** in a temp sandbox dir, replicate the gate's completeness algorithm against a fixture set containing one unregistered `useQuery` file → assert it reports the failure; remove the fixture → assert clean. Reverting the completeness check (deleting it from the .mjs) makes this test's import-and-run fail to detect the fixture → FAIL.
- **Cache proof (T9, adapted from `/tmp/orch-1201/repro_reactquery.mjs`):** with real `@tanstack/query-core` + the mingla-business QueryClient defaults, prove the ungated shape (`enabled` true pre-auth, queryFn returns `[]`) caches empty and never refetches (`queryFnCalls === 1`, `finalDataLength === 0`) while the gated shape (`enabled` false until t=300ms) fires once auth-ready and returns the row (`finalDataLength === 1`). This proves the FIX SHAPE at runtime and fails if the gated shape is reverted to ungated.

**Tester adversarial angle (different from the happy-path test — for mingla-tester):** attack the **completeness check itself**, not the hooks. (1) Add a synthetic auth-scoped `useQuery` hook fixture in a real (or temp) hooks path with NO list entry → the gate MUST fail with the exact §4.C message. (2) Take a registered hook and delete its `isAuthReady` gate → the gate MUST fail with the per-hook message. (3) Add a `useQueryClient`-only file → the gate MUST NOT flag it (false-positive guard). (4) Gate a public allowlist hook on `isAuthReady` → `checkPublicNotGated` MUST fail. (5) Confirm the carve-out files (`useCancelTripBooking.ts`, `useBrandPaystack.ts`) pass with one gated + one intentionally-ungated hook. The tester writes these as independent fixtures, not by trusting the implementor's self-test.

---

## 10. Open questions

- **OQ-1 (carve-out granularity):** the gate is file-level, so `useCancelTripBooking.ts` and `useBrandPaystack.ts` pass with one gated + one intentionally-ungated (anon/token) hook. This SPEC accepts file-level granularity (matches the existing gate model). If Seth/orchestrator later wants per-EXPORT gating (each exported query hook individually proven gated), that is a follow-on ORCH — NOT in this scope. **Recommended: accept file-level; no action.**
- **OQ-2 (service-routed auth-scoped hooks):** `useExperienceDetail`, `useRsvpApprovals`, `useSupportTickets` read auth-scoped data via service modules (no direct supabase import) and are already gated; they ARE in the 17 DELTA-2 registration set (caught by the useQuery-call signal, not a supabase-import signal). Confirmed covered. No action.
- **OQ-3 (F-7 stale-chunk tail):** the "even on web PC I sometimes reload" residual (`chunkReloadGuard` / stale `index.html`) is orthogonal and NOT addressed here; registered for the orchestrator as a separate low-priority thread. No action in this SPEC.
- **OQ-4 (live authed-web eyeball):** investigation F-6 capped the literal "Loading brands…" string surfacing at SUSPECTED. The brand LIST itself is already gated (not a DELTA-1 hook); this SPEC fixes the co-mounted siblings (notably `useBusinessNotifications`). A Seth authed-web eyeball after deploy (per the investigation's recipe) confirms the user-visible cure. Noted for verification, not a code change.

---

## 11. Downstream routing

- **Next = mingla-implementor (claude side).** Execute §4 + §8 in the worktree `~/Desktop/mingla-orchs/1201-[web-brand-load-regression]` on branch `1202-web-brand-load-regression`. Inputs: this SPEC + `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1202_web-brand-load-regression.md` + the harnesses `/tmp/orch-1201/repro_reactquery.mjs` (adapt for T9). Hard constraints: scoped allowlist + DO-NOT-TOUCH (§8), no public-hook gating (§4.D), no `eas update` (COMMS-0052), no behavior drift (SC-5). Output: implementation report in the worktree `Mingla_Artifacts/reports/IMPLEMENT_ORCH-1202_*.md` with fails-on-revert evidence (§9 step 5).
- **Then = mingla-tester.** Adversarial angle in §9 ("tester adversarial angle") — attack the completeness check itself, independently of the implementor's self-test; verify SC-1 on web (desktop + Samsung Internet) per the investigation repro recipe.
- **Then = mingla-orchestrator CLOSE.** Flip `I-PROPOSED-1202-AUTH-SCOPED-HOOK-COMPLETENESS` to ACTIVE; ship web via Vercel `[deploy]` (touches `mingla-business/`); queue for the next business native build; **explicitly SKIP `eas update` for mingla-business** (COMMS-0052). Update WORLD_MAP + INVARIANT_REGISTRY.

---

## Comms ledger

- **COMMS-0052 (BLOCK/ALL, OPEN) — ACKNOWLEDGED.** Business-app OTA is blocked (PostHog native module hard-imported in `_layout.tsx`). This SPEC ships NO OTA: web via Vercel `[deploy]` only; the pure-JS fix rides the next business native build. Already acked by the ORCH-1202 lineage in the ledger; this SPEC re-affirms.
- **COMMS-0055 (WARN/ALL) — read.** Canonical ID = ORCH-1202 (renumbered from 1201; folder retains the 1201 label, branch is `1202-web-brand-load-regression`). Honored throughout.
- **COMMS-0054 (WARN/ALL) — read.** ID-space hot; this SPEC claims no new ORCH-ID.
