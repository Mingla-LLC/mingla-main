# INVESTIGATE — ORCH-1201 [web brand-load regression]

**Skill:** mingla-forensics (INVESTIGATE)
**Date:** 2026-06-21
**Worktree:** `~/Desktop/mingla-orchs/1201-[web-brand-load-regression]` on branch `1201-web-brand-load-regression` (HEAD == origin/main `31124678b`, already rebased)
**Anchor (read-only except this evidence):** `~/Desktop/mingla-main`
**Confidence:** **PROVEN** (runtime-reproduced in real headless Chromium under desktop Chrome AND Samsung-Internet/Android UA, AND with the real `@tanstack/query-core` v5.100.6 + mingla-business's actual QueryClient config). The one residual (a fully-authed live web brand-switch eyeball) is capped at SUSPECTED and flagged for Seth.

---

## Symptom summary (expected vs actual)

- **Seth (verbatim intent):** the mobile-web business app "was not loading brands — showing 'Loading brands…', pages needed to be reloaded. We solved it before, but a couple commits later it has come back. Even on web PC, sometimes I have to reload a page to see its content."
- **Expected:** on a cold web load (desktop Chrome or Android/Samsung Internet), the business app warms its session and renders fully populated content with NO manual reload, on every surface.
- **Actual:** parts of a page render empty (or a section stays on a loading/empty state) until the user manually reloads; intermittent on desktop, frequent on mobile-web where the auth session attaches more slowly.

---

## Comms ledger

- **COMMS-0052 (BLOCK/ALL, OPEN) — ACKNOWLEDGED.** Business-app OTA is blocked (PostHog native module hard-imported in `_layout.tsx`; an OTA to the live runtime would crash on launch). INVESTIGATE ships no code and recommends no OTA, so this does not block the investigation — but it is load-bearing for the fix: **the fix must ship to web via Vercel (web bundle) and ride the NEXT business native build for the apps; it must NOT be OTA'd.** Also confirms PostHog never enters the web bundle (web-stubbed) — see F-5 RULED OUT.
- **COMMS-0054 (WARN/ALL) — read.** ID-space hot; ORCH-1201 is clear of collisions (1200 was the last consumed).

---

## Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `src/utils/brandListState.ts` | ORCH-1136 fix — confirm cached-over-refetch intact |
| 2 | `src/hooks/useBrandListShim.ts` | brand-switcher list shim — trace to underlying query |
| 3 | `src/context/AuthContext.tsx` | ORCH-1004 late-session adoption + isAuthReady state machine |
| 4 | `src/hooks/useBrands.ts` | the brand-list query — confirm enabled gate |
| 5 | `src/utils/authReadiness.ts` | isAuthReady / authStatus derivation |
| 6 | `src/config/queryClient.ts` | QueryClient defaults (staleTime, retry, refetch) |
| 7 | `.github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs` | the CI gate — what it enforces and what it MISSES |
| 8 | `app/_layout.tsx` | provider tree + render gates on web |
| 9 | `src/services/PostHogAnalyticsProvider.web.tsx`, `postHogService.web.ts` | rule PostHog in/out as a web render-gate |
| 10 | `src/utils/coldLoadAuthGates.ts` | web auth-routing predicates |
| 11 | `src/components/brand/BrandSwitcherSheet.tsx`, `app/(tabs)/account.tsx` | the "Loading brands…" surfaces |
| 12 | `src/hooks/useBrandInvitations.ts`, `useBusinessNotifications.ts` | sample ungated auth-scoped hooks |
| 13 | (subagent) every `src/hooks/**` + `src/hooks/marketing/**` query hook | full auth-scoped-hook enumeration vs the gate |
| 14 | live RLS via Supabase MCP (`pg_policy`) | prove the empty-200 mechanism per table |
| 15 | `/tmp/orch-1201/repro_empty200.mjs`, `repro_reactquery.mjs` | runtime repro harnesses |

---

## Q-scorecard

**Q1 — Is the ORCH-1004 late-session adoption still intact (does AuthContext adopt a late session and flip `isAuthReady`)?**
Verdict: **YES, intact.** `AuthContext.tsx:421-452` still applies a late passive event (`INITIAL_SESSION`/`TOKEN_REFRESHED`/`USER_UPDATED`) WITH a usable session post-bootstrap-timeout, clears the timed-out gate, and falls through to `setSession`/`setUser` → `isAuthReady` flips true → gated queries refire. Not the regression. (RULED OUT — F-5.)

**Q2 — Are there NEW auth-scoped hooks that do NOT fold `isAuthReady` into `enabled`, that the CI gate does not catch?**
Verdict: **YES — this is the regression.** ~20 hook files contain at least one auth-scoped, ungated, un-allowlisted query; 50 new hook files landed after the ORCH-1004 fix (`git diff 3562c9b09..HEAD`), and the gate's curated `AUTH_SCOPED_HOOK_FILES` list (24 entries) was never expanded. **The gate PASSES today while the bug exists.** (CONFIRMED ROOT CAUSE — F-1.)

**Q3 — Can an auth-scoped query still cache an RLS empty array under staleTime and never retry?**
Verdict: **YES — proven at runtime.** PostgREST returns HTTP 200 + `[]` to an unauthenticated (anon-key-only) read of an `auth.uid()`-scoped table; supabase-js does not throw, so React Query resolves SUCCESS, caches `[]`, and `retry` (error-only) never fires. (CONFIRMED — F-2, F-3.)

**Q4 — Is the brand-switcher / brand-LIST path itself regressed?**
Verdict: **NO.** `useBrands` (`useBrands.ts:135-136`) still gates `enabled = isAuthReady && accountId !== null`, swaps to `DISABLED_KEY` when disabled, and `brandListState.ts` still serves the cached non-empty list over a background refetch (ORCH-1136). The brand-switcher's OWN list is protected. (RULED OUT as the primary cause — see F-6 nuance.)

**Q5 — Web bundle / chunk / service-worker / stale-JS regression (ORCH-0964/1090/1091 lineage)?**
Verdict: **No new evidence.** `chunkReloadGuard.ts` is intact (auto-reload-once on a chunk error). This is a SECONDARY/ambient contributor to "reload to load" but not the brand-load regression. (SUSPECTED CONTRIBUTOR, low — F-7.)

**Q6 — Provider mount/render-gate ordering on web (PostHog / hydration)?**
Verdict: **RULED OUT.** `PostHogAnalyticsProvider.web.tsx` is a pure `<>{children}</>` passthrough; `postHogService.web.ts` is a no-op; the native posthog module never enters the web bundle. Auth-routing gates in `_layout.tsx` are sound. (RULED OUT — F-5.)

---

## Findings

### F-1 — CONFIRMED ROOT CAUSE: ~20 new auth-scoped React Query hooks fire pre-auth (ungated), uncaught by the CI gate

1. **Symptom** — sections of authed web pages render empty until manual reload; the TopBar notification bell, account partner section, team lists, Ari chat, marketing campaigns, etc. come up empty on a cold web load.
2. **Layer** — code (hook `enabled` gating) × runtime (cache) × CI (gate coverage).
3. **Probe** — full enumeration of `mingla-business/src/hooks/**` query hooks vs `AUTH_SCOPED_HOOK_FILES`; `git diff --name-status 3562c9b09 HEAD -- mingla-business/src/hooks/` (50 new files); `node .github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs`.
4. **Evidence** —
   - The CI gate is a **CURATED LIST, not an AST walk**, by its own header (lines 30-35): *"This gate is intentionally a CURATED list… When a NEW auth-scoped read hook is added, register it…"*. The list (`AUTH_SCOPED_HOOK_FILES`, lines 48-73) has **24 entries** and has not been expanded since the ORCH-1004 fix.
   - **Gate currently PASSES:** `ORCH-1004 gate PASS: all 24 auth-scoped hooks gate enabled on isAuthReady; 5 public/dual-use hooks left ungated`.
   - **20 ungated auth-scoped hook files (DELTA-1)** — each fires `enabled` on a persisted id alone, with NO `isAuthReady`:
     - `useBrandInvitations.ts:55,68,129` (`brand_team_members` / invitations), `useScannerInvitations.ts:46,59`, `useBrandPaystack.ts:60` (`useBrandPaystackStatus`), `useBrandTaxRegistration.ts:42`, **`useBusinessNotifications.ts:174`** (`enabled = userId !== null`), `useNotificationTypePrefs.ts:78`, `useMinglaToSAcceptance.ts:44`, `useAriPreferences.ts:26` (no `enabled` at all), `useConversationList.ts:16` (no `enabled`), `usePartnerSplits.ts:23,33` (no `enabled`), `usePartnerBrandLinks.ts:18` (no `enabled`), `usePartnerStripe.ts:35` (no `enabled`), `useTripEditLog.ts:46`, `useTripHasWebPurchases.ts:25`, `useVenueClaimFeedback.ts:71`, `useCancelTripBooking.ts:87` (`useOperatorRefundPreview`), `marketing/useCampaigns.ts:32`, `marketing/useCampaignReport.ts:32`, `marketing/useTemplate.ts:34`, `marketing/useStarterTemplates.ts:24` (no `enabled`).
   - Verbatim bug shape (`useBusinessNotifications.ts:174-179`): `const enabled = userId !== null; … useQuery({ queryKey: enabled ? businessNotificationKeys.all(userId) : DISABLED_KEY, enabled, staleTime: 30_000, … })`.
5. **Mechanism** — a persisted `userId`/`brandId` rehydrates synchronously from localStorage; the Supabase JWT attaches asynchronously (slower on mobile-web). An ungated hook computes `enabled = true` and fires at t0 BEFORE the JWT. The RLS-scoped read returns 200 + `[]` (F-2/F-3). React Query caches `[]` as success (F-4) and, because `retry` is error-only and `refetchOnWindowFocus` is false, never refetches after the JWT attaches → the surface shows empty/zero until a manual reload remounts and (now-authed) refires it. CI is green throughout because the gate's curated list never grew.
6. **Severity** — **CONFIRMED ROOT CAUSE.**

### F-2 — CONFIRMED: every DELTA-1 table is `auth.uid()`-scoped → 200 + [] to an anon request (schema layer)

1. **Symptom** — pre-auth reads succeed-empty rather than 401.
2. **Layer** — schema (RLS).
3. **Probe** — Supabase MCP `SELECT … FROM pg_policy …` for the DELTA-1 tables.
4. **Evidence (verbatim USING exprs):** `brand_team_members`: `(user_id = auth.uid()) OR biz_is_brand_admin_plus_for_caller(brand_id)`; `notifications`: `(auth.uid() = user_id)`; `notification_preferences`: `(user_id = auth.uid())`; `partner_splits`: `(partner_account_id = auth.uid()) OR …`; `partner_brand_links`: `(partner_account_id = auth.uid())`; `agent_conversations`: `(user_id = auth.uid())`; `marketing_campaigns`: `(account_id = auth.uid()) OR mkt_brand_min_rank(...)`; `marketing_templates`: `(is_starter_pack = true) OR (account_id = auth.uid()) OR …` (authenticated role only — starter rows shared, account rows scoped); `brand_invitations` / `venue_claim_feedback`: brand-membership scoped. For an anon request `auth.uid()` is NULL → zero rows → 200 + `[]`.
5. **Mechanism** — RLS-empty is a SUCCESS, not an error, so the client never sees a retryable failure. (Identical class to ORCH-1004 RC-1/RC-2.)
6. **Severity** — **SECONDARY ROOT CAUSE** (the schema half of the mechanism; correct by design — RLS must fail-closed; the bug is the client firing pre-auth).

### F-3 — CONFIRMED (runtime, real browser): the empty-200 response, reproduced under desktop Chrome AND Samsung-Internet UA

1. **Symptom** — pre-auth RLS reads return 200 + [].
2. **Layer** — runtime.
3. **Probe** — `/tmp/orch-1201/repro_empty200.mjs` (Playwright real headless Chromium; in-page `fetch` with `apikey`+`Authorization` = anon key, NO user JWT; two browser profiles: desktop 1440×900 and a `SAMSUNG SM-S918B / SamsungBrowser/23.0` UA at 360×740).
4. **Evidence** — `evidence/ORCH-1201/repro_empty200_output.txt`: for `brand_team_members`, `notifications`, `partner_splits`, BOTH profiles returned `status:200, isArray:true, length:0, body:"[]"`, `cachedAsSuccess:true, willRetry:false`. VERDICT line: *"REPRODUCED — every RLS-scoped read returns 200 + [] to a pre-auth (anon) fire; React Query caches it as success and never retries."*
5. **Mechanism** — confirms F-2 against the live prod database from a real browser on both target surfaces.
6. **Severity** — **CONFIRMED** (runtime proof of F-2).

### F-4 — CONFIRMED (runtime, real React Query engine): ungated shape caches [] and never refetches; gated shape does not

1. **Symptom** — the cached empty result strands the surface.
2. **Layer** — runtime (cache state machine).
3. **Probe** — `/tmp/orch-1201/repro_reactquery.mjs` using the REAL `@tanstack/query-core` v5.100.6 + mingla-business's verbatim QueryClient defaults (staleTime 5min, retry 2 error-only, refetchOnWindowFocus false). queryFn returns `[]` (no throw) pre-auth and a real row post-auth; session attaches at t=300ms.
4. **Evidence** — `evidence/ORCH-1201/repro_reactquery_output.txt`: **ungated** → `status:success`, `finalDataLength:0`, `queryFnCalls:1` (fired once pre-auth, never re-fired after the JWT) — *"BUG REPRODUCED … never re-fetched after the JWT attached."* **gated** → `finalDataLength:1` — *"CORRECT — query stayed disabled until auth ready, then fired WITH the JWT."* VERDICT: PROVEN.
5. **Mechanism** — the definitive end-to-end proof that the ungated shape poisons the cache and the ORCH-1004 gated shape is the cure.
6. **Severity** — **CONFIRMED** (the load-bearing runtime proof).

### F-5 — RULED OUT: late-session adoption, PostHog provider, web render-gates

1. **Layer** — code.
2. **Evidence** — AuthContext late-event adoption intact (`AuthContext.tsx:421-452`); `isBusinessAuthReady` correct (`authReadiness.ts:66-70`); `PostHogAnalyticsProvider.web.tsx` is `return <>{children}</>`; `postHogService.web.ts` all no-ops; `_layout.tsx` auth gates (`isWebAuthResolving`, `shouldRedirectToSignInFromRoute`, bounded-loading ceiling) are sound and route-agnostic with the public-buyer + self-auth exemptions.
3. **Severity** — **RULED OUT** (none disturbed since their fixes; the most recent `_layout`/AuthContext commits — PostHog #591, ORCH-1192 #601 — are additive analytics, web-stubbed).

### F-6 — SUSPECTED CONTRIBUTOR: brand-switcher "Loading brands…" wedge is well-defended but worth a live eyeball

1. **Layer** — code × runtime (live authed).
2. **Evidence** — `BrandSwitcherSheet.tsx:97-104` renders the cached list BEFORE the loading branch (ORCH-1136 defense-in-depth); `account.tsx:295-316` gates on the `brandList.status` machine + `isAuthWarming`. The brand-list query is gated (Q4). So the EXACT "Loading brands…" string is unlikely to wedge from the F-1 class. BUT the brand list co-mounts with ungated siblings (TopBar's `useBusinessNotifications`), and a fully-authed live web brand-switch on a throttled mobile connection was not eyeballed headless (no live authed session driven).
3. **Severity** — **SUSPECTED CONTRIBUTOR.** Capped at SUSPECTED; recommend a Seth authed-web eyeball (see Repro §"Residual").

### F-7 — SUSPECTED CONTRIBUTOR (low): stale-chunk / SPA cache "reload to load"

1. **Evidence** — `chunkReloadGuard.ts` handles a transient failed-chunk fetch with one auto-reload; the "even on web PC I sometimes reload" tail can be a stale `index.html` pointing at evicted hashed chunks. Orthogonal to the brand-load regression; no new defect found.
2. **Severity** — **SUSPECTED CONTRIBUTOR, low** — out of scope for the brand-load fix; note for the orchestrator.

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| **Docs** | ORCH-1004 close + the gate header assert "every auth-scoped hook folds isAuthReady". | **CONTRADICTS code/CI** — the assertion is only enforced for the 24 curated files; ~20 newer hooks violate it. **The gate header itself is the truth that is no longer true.** |
| **Schema** | All DELTA-1 tables are `auth.uid()`-scoped (fail-closed, correct). | Consistent — RLS is correct; the client is wrong. |
| **Code** | 20 hooks gate on a persisted id alone, no isAuthReady. | The defect lives here. |
| **Runtime** | Real-browser + real-React-Query repro: ungated → cached [] → no refetch; gated → real row. | Confirms code is the truth; the bug is real. |
| **Data** | Pre-auth read = 200 + [] (live prod). | Confirms the empty-200 carrier. |

**Primary contradiction = the bug:** documentation/CI claim universal isAuthReady gating, but the curated gate cannot see the ~20 hooks added since the list was last edited, so the very invariant ORCH-1004 established silently eroded.

---

## Repro evidence (what was run, what happened)

- **`repro_empty200.mjs`** — real headless Chromium, desktop Chrome + Samsung-Internet/Android UA. PASS/REPRODUCED: every RLS-scoped table → 200 + [] pre-auth on both surfaces. Output: `evidence/ORCH-1201/repro_empty200_output.txt`.
- **`repro_reactquery.mjs`** — real `@tanstack/query-core` v5.100.6 + the verbatim mingla-business QueryClient config. PROVEN: ungated caches [] and never refetches after JWT attach; gated gets the real row. Output: `evidence/ORCH-1201/repro_reactquery_output.txt`.
- **Residual (SUSPECTED ceiling):** a fully-authed live web session driven through a real brand switch on a throttled mobile connection was NOT performed headless (would require driving a real Google/Apple OAuth login in Chromium against prod). The mechanism is proven; the specific "Loading brands…" string surfacing is capped at SUSPECTED pending a **Seth authed-web eyeball** (open desktop + Samsung Internet, hard-refresh an authed page, watch the TopBar bell + any section that reads an F-1 hook come up empty until reload).

### Deterministic reproduction recipe
1. Sign in to the business web app (desktop or mobile-web) so a Supabase session is persisted in localStorage.
2. Throttle the network (DevTools → Slow 3G) to widen the JWT-attach window, then hard-reload an authed page that mounts an F-1 hook (any screen — the TopBar `useBusinessNotifications` is always mounted; or `/account` for `usePartnerStripeStatus`; or `/brand/{id}/team` for `useBrandInvitations`).
3. Observe: the F-1-backed section renders empty/zero (e.g. notification bell shows no unread) while gated sections (brand list) populate. Network tab shows the RLS read fired as a 200 + `[]` BEFORE the `Authorization: Bearer <user JWT>` request.
4. Reload again (now warm) → the section populates. That reload-to-see-content is the regression.
5. Headless proof without a login: `node /tmp/orch-1201/repro_empty200.mjs` and `node /tmp/orch-1201/repro_reactquery.mjs`.

---

## Blast radius / cross-surface map

- **Mechanism is web-acute** (async JWT attach is slowest on mobile-web; the bug also exists in principle on native cold start but native bootstrap resolves before first paint behind the splash, and persisted-id rehydration is tighter). **In-scope surfaces:** Business Web preview/prod (desktop + mobile incl. Android/Samsung Internet) — PRIMARY. Business iOS/Android — same code path, lower incidence (native splash masks the window); fix applies (rides next native build per COMMS-0052).
- **Out-of-scope:** Consumer iOS/Android (`app-mobile/`) — separate codebase, not affected by these business hooks. Buyer/anonymous Web — these hooks are NOT on anon routes; the public hooks (`usePublicEvents`, `useBrand` single, etc.) are correctly ungated by design (allowlist) and must STAY ungated. Admin Web — separate app.
- **Highest-blast ungated hooks (ranked):** (1) `useBusinessNotifications` — TopBar, **always mounted on every authed screen**; (2) `usePartnerStripeStatus` — `/account` tab + BrandCreationFlow; (3) `useBrandInvitations`/`useBrandTeamMembers` — team screens; (4) Ari `useConversationList`/`useAriPreferences`; (5) marketing campaigns; (6) deep venue/trip/partner-earnings screens.

---

## Invariant impact (flagged, NOT resolved here)

- **I-DISABLED-QUERY-IS-LOADING (ORCH-0889)** — the gated shape reads as loading, not empty; the ungated hooks violate the spirit (they read as empty, not loading).
- **The ORCH-1004 invariant (every auth-scoped hook folds isAuthReady)** is silently violated by ~20 hooks; the enforcing CI gate is green because its curated list is stale. **The structural defect is the curated-list enforcement model itself** — it relies on every author remembering to register a new hook, which has demonstrably failed 20+ times.
- **I-PROPOSED-BRANDLIST-CACHED-OVER-REFETCH (ORCH-1136)** — intact, not violated.
- **I-PROPOSED-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS** — intact (PostHog web-stubbed).

---

## Discoveries for Orchestrator

- The ORCH-1004 CI gate's **curated-list model does not scale** — 50 new hook files landed since the fix, 20 of them auth-scoped-and-ungated, all invisible to CI. A SPEC should consider replacing/augmenting the curated list with an **AST/heuristic sweep** that flags any `useQuery` reading a non-allowlisted Supabase table/RPC without an `isAuthReady`/session gate, OR at minimum register all 37 newly-discovered auth-scoped hooks (20 to FIX + gate, 17 to register).
- **17 gated-but-unregistered hooks (DELTA-2)** are correct today but unprotected by CI — a future edit dropping the gate won't be caught (the entire venue suite + support stack).
- **F-7 chunk/SPA-cache "reload to load"** tail is a separate, low-priority thread.
- **COMMS-0052**: the fix ships to web via Vercel and rides the next business native build — NO `eas update`.

---

## Confidence & recommended next phase

**Confidence: PROVEN** for the root cause and mechanism (runtime-reproduced twice, two real browsers + the real React Query engine + live RLS). One narrow surface (the literal authed-web "Loading brands…" string) is SUSPECTED pending a Seth eyeball.

**Recommended next phase: SPEC** (mingla-forensics SPEC, or implementor if the orchestrator scopes it tightly). **Recommended scope (direction only — NOT a fix):**
1. Fold `isAuthReady` (from `useAuth`) into the `enabled` of the **20 DELTA-1 ungated auth-scoped hooks**, mirroring the proven ORCH-1004 shape (`const enabled = isAuthReady && <existing predicate>`), and swap their disabled query-key to a `DISABLED_KEY` sentinel where they don't already.
2. **Register all newly-discovered auth-scoped hooks** (the 20 fixed + the 17 DELTA-2 gated-but-unregistered) into `AUTH_SCOPED_HOOK_FILES`, AND harden the gate so it cannot silently miss future hooks (AST/heuristic sweep, or a "every src/hooks file that imports supabase and calls useQuery must be in one of the two lists" completeness check).
3. Leave the public/dual-use allowlist hooks UNGATED (buyer-web depends on them) — do NOT regress anon reads.
4. Regression contract: a fails-on-revert test proving the gate FAILS when any of these hooks loses its isAuthReady gate, and a runtime/cache test asserting an ungated shape strands while a gated shape does not (the `repro_reactquery.mjs` pattern, adapted to jest).
5. Ship to web via Vercel; queue for the next business native build (COMMS-0052) — no OTA.
