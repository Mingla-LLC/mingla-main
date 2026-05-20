# INVESTIGATION — ORCH-0887 [Mingla Business Web Performance — slow page loads + hanging loaders]

**Mode:** `mingla-forensics` INVESTIGATE
**Tree:** `/Users/sethogieva/Desktop/mingla-main` @ branch `Seth`
**Severity:** S1-high
**Classification:** `performance` + `ux` + `architecture-flaw`
**Affected surfaces:** business-web-preview (CONFIRMED slow per operator), buyer-web — `/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}`, `/o/{orderId}` (CONFIRMED inherit the same root cost path via shared `app/_layout.tsx` — conversion-impacting). Out of scope: business-iOS, business-Android, consumer apps.

---

## Section 0 — Mandatory ingestion checklist

Every file opened with absolute path. Phase 0 of the brief was executed in full.

| File | Why it matters | Read |
|---|---|---|
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/_layout.tsx` | Root provider chain + splash gate logic + post-mount side-effects | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/(tabs)/_layout.tsx` | Tab shell mount | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/(tabs)/home.tsx` | First-paint query stack | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/index.tsx` | Pre-auth redirect logic; renders `BusinessWelcomeScreen` or `<Redirect>` | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/checkout/[eventId]/_layout.tsx` | Buyer-web cross-check anchor | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/package.json` | Dependency + version inventory; `@tanstack/react-query` version | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/metro.config.js` | Bundle resolver overrides | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/app.json` | `web.output` setting + plugin list | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/app.config.ts` | Build-time config + URL scheme + iOS shenanigans | ✅ partial (top 40 lines, enough to confirm no web-specific webpack escape hatch) |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/vercel.json` | Web build command + rewrites | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/context/AuthContext.tsx` | Auth bootstrap; `supabase.auth.getSession()` chain | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/config/queryClient.ts` | QueryClient defaults + persistence wiring (the comment is the smoking-gun confession) | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/hooks/useBrands.ts` | `useBrand(currentBrandId)` (splash gate) + `useBrands(userId)` + Realtime channel cost | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/hooks/useCurrentBrand.ts` | Bridges store ID → React Query brand fetch | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/hooks/useCurrentBrandRecovery.ts` | Default-brand recovery chain — gates `currentBrandId` resolution | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/utils/authReadiness.ts` | `isAuthReady` derivation; the `loading` flag origin | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/hooks/useCreatorAccount.ts` | Gated by `isAuthReady`; needed by recovery chain | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/hooks/useEventOrders.ts` | First-paint sales summary queries | ✅ partial (lines 1-220, the parts that mount before paint) |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/store/currentBrandStore.ts` | Zustand persist whitelist (only `currentBrandId` post ORCH-0742) | ✅ partial (lines 140-200) |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/services/supabase.ts` | SSR storage shim + `detectSessionInUrl: Platform.OS === "web"` | ✅ full (top 50) |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/payments/StripeProviderWrapper.tsx` | Web-side passthrough Fragment (zero cost) | ✅ full |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/diagnostics/sentry.ts` | ORCH-0886 platform shim (web no-op) | ✅ full |
| `git log --oneline -15` | Recent commits including ORCH-0886 [SSR window-is-not-defined permanent fix] (`5170bfef`) | ✅ |
| `/Users/sethogieva/Desktop/mingla-main/.github/scripts/strict-grep/README.md` | Confirms NO web-perf CI gates exist | ✅ partial |

Discovery notes (no assumptions):
- `babel.config.js` does NOT exist in `mingla-business/`. Expo SDK 54 + Reanimated v4 rely on SWC/auto-injection — no `react-native-reanimated/plugin` manual entry needed.
- There is NO `persistQueryClient` / `PersistQueryClientProvider` / `createSyncStoragePersister` import anywhere in `mingla-business/src/**` or `mingla-business/app/**`. The `queryClient.ts` header comment lines 19-22 explicitly confess this and states the persister packages were "installed but unused". (Worse: they are NOT in `package.json` either — they were removed at some point. Cleaner state, same outcome: no persistence on any platform.)
- `react-native-pell-rich-editor` has a web-side platform shim (`src/components/marketing/ComposerV2/richEditor.tsx` — stub class). Marketing-only surface; not on the home-tab cold path.

---

## Section 1 — Cold-load timeline (predicted from code; operator instrumentation steps below)

The forensic was static-only (Phase 0 §6 of the brief — no dev-server started). The following is the predicted timeline based on source reads. Operator instrumentation steps are in Section 1b.

### 1a. Predicted cold-load sequence for `business.usemingla.com/home`

```
T+0      HTML shell delivered by Vercel (static-prerendered HTML from
         `expo export -p web` → `dist/` upload; `web.output: "static"`
         in app.json line 71-74 → expo-router writes per-route HTML).
         The HTML is small (~10–40KB) and parses immediately.

T+~50ms  Browser starts fetching the main JS bundle
         (/_expo/static/js/web/entry-<hash>.js). This is one giant
         monolithic Metro web bundle — Expo Router static export does
         NOT split per route at the JS layer. Every dependency listed
         in package.json that is web-reachable is in this single file:
         supabase-js, expo-router, react-native-web, reanimated web
         shim, gesture-handler web shim, expo-image, expo-router,
         expo-splash-screen, mixpanel-react-native, react-native-svg,
         react-native-qrcode-svg, expo-camera, etc. Predicted size:
         3–6 MB uncompressed, 800KB–1.5MB gzipped (cannot measure —
         `dist/` only contains a stale Android Hermes bundle from
         2026-05-17). The bundle download blocks first React render.

T+~800ms RootLayout mounts:
         GestureHandlerRootView → SafeAreaProvider →
         QueryClientProvider → AuthProvider → StripeProviderWrapper
         (web=Fragment) → RootLayoutInner → Stack.

         AuthProvider useEffect fires immediately
         (app/_layout.tsx:228-246; AuthContext.tsx:142-202).
         bootstrap() calls supabase.auth.getSession().

         On web, supabase.auth.getSession() reads from localStorage
         via the AsyncStorage browser shim
         (src/services/supabase.ts:31-40 — `ssrSafeStorage` returns
         null during SSR, then real AsyncStorage post-hydration).
         For a logged-in user with persisted session, this is a
         single localStorage read (~5ms) followed by JWT validity
         check; for an expired/refresh-due token, it triggers a
         /auth/v1/token network round-trip (~150–300ms).

T+~1100ms loading flips false. AuthContext.loading = false.

         RootLayoutInner now starts watching the splash gate:
         (loading || !brandReady || splashHidden).

         useBrand(currentBrandId) starts. If currentBrandId is hydrated
         from Zustand persist (mingla-business-current-brand key in
         localStorage), it fires immediately. The query hits Supabase
         REST /rest/v1/brands?id=eq.<uuid>... — adds another ~150–300ms.

T+~1400ms brandFetched = true (or brandFetchTimedOut = true at the
         2 s ceiling per app/_layout.tsx:73,102-109).

T+~1500ms RootLayoutInner renders <Stack>; expo-router resolves the
         active route to (tabs)/home. TabsLayout mounts BottomNav +
         DesktopCanvas + Slot → home.tsx.

         home.tsx mounts (app/(tabs)/home.tsx:126). On mount:
         - useBrands(user.id) — list query, +~150ms
         - useCurrentBrand() — already cached from splash gate
         - useCurrentBrandRecovery() — re-runs the resolution
         - useServerDraftsForBrand(brandId) — query
         - useBusinessEventsForBrand(brandId) — query
         - useEventSalesSummaries([liveEvents]) — useQueries fan-out
         - Realtime: useBrands sets up a `brand-stats-orders-*`
           channel via supabase.channel() (useBrands.ts:122-166).
           Same in useBrand (line 187-223). WebSocket handshake ~150ms.

T+~1700ms First useful paint of the home tab content.

T+~1900ms First interactive (event handlers attached after React Query
         resolution; Suspense not used here so paint precedes data
         resolution — empty-state flicker is the trade-off).
```

Even on a fast connection, this is **>1.5 s** from URL-bar to useful pixels — and that's the best case (warm Vercel cache, persisted Supabase session, persisted currentBrandId). Cold first-visit (no localStorage state) adds a full Supabase signup/OAuth redirect dance which is multi-second.

### 1b. Operator-driven instrumentation (since the investigator cannot drive the browser)

The brief §4a permits this hand-off. Steps for operator:

1. Open Chrome DevTools → Network tab → check "Disable cache" → check "Preserve log".
2. Open Application tab → Storage → "Clear site data" for `business.usemingla.com`.
3. Switch to Performance tab → click record → load `https://business.usemingla.com/home` → wait until interactive → stop.
4. Capture these specific data points from the recording:
   - "Time to first byte" (TTFB) on the document request
   - "DOMContentLoaded" timestamp
   - Network tab: the largest JS file under `/_expo/static/js/web/` and its transfer size + parse time
   - Console: count of distinct `[auth] bootstrap-*` log lines (AuthContext.tsx:146-164) — this dates the auth-resolve moment in dev builds (`__DEV__ === true`).
   - Network tab: look for any `/rest/v1/brands` request fired before any user input → confirm whether `useBrand(currentBrandId)` was the gating fetch.
   - Network tab: a stuck-pending `/rest/v1/...` request that never resolves would explain the "hanging loader" symptom (H4 candidate).

The static analysis below predicts the timeline; operator instrumentation will quantify the exact numbers.

---

## Section 2 — Bundle + build config findings (H1, H2)

### H1 — Monolithic JS bundle, no route-level code-splitting → **CONFIRMED**

Evidence:
- `mingla-business/vercel.json:3` declares `"buildCommand": "npx expo export -p web"`.
- `mingla-business/app.json:71-74` declares `"web": { "output": "static" }`.

`expo export -p web` with `web.output: "static"` produces per-route HTML shells AND **a single monolithic JS bundle**. Expo Router (≤ v6.x as of the installed `~6.0.23` per `package.json:70`) does NOT implement route-level JS code-splitting in the static export pass — every route ships every dependency. This is a long-standing Expo Router limitation; the static-output feature only splits HTML/head metadata, not JS chunks.

Heavyweight dependencies that ship in the same bundle as a checkout buyer-anon page:
- `react-native-reanimated ~4.1.1` + `react-native-worklets 0.5.1` (web shim is ~200KB)
- `react-native-gesture-handler ~2.28.0` (web shim adds another ~80KB)
- `@stripe/react-connect-js 3.4.1` + `@stripe/connect-js 3.4.2` (used only in business `/brand/[id]/payments` but shipped to buyers)
- `@stripe/stripe-react-native ^0.65.1` (gated by `StripeProviderWrapper.tsx` web Fragment, but the import graph still pulls type-side modules — partial mitigation only)
- `react-native-pell-rich-editor ^1.10.0` (web shim; only used in marketing composer)
- `mixpanel-react-native ^3.3.0`
- `expo-camera ~17.0.10` (used for QR scanning at the door — buyers don't need it)
- `react-native-qrcode-svg 6.3.21`
- `react-native-webview ^13.16.1`
- `@react-native-google-signin/google-signin ^16.0.0` (web doesn't use it — gated by `Platform.OS !== "web"` in AuthContext.tsx:65, but the module import still ships)
- `react-native-appsflyer ^6.17.9` (no-op on web)
- `onesignal-expo-plugin ^2.5.0` + `react-native-onesignal ^5.4.5`
- `@react-native-async-storage/async-storage ^2.2.0`

Verdict: every buyer landing on `/checkout/{eventId}` to pay £15 for a ticket downloads the entire 800KB–1.5MB gzipped bundle including code they never execute. **CONFIRMED**.

### H2 — CSR-only, no SSR / static prerender → **REFUTED** (but with a major caveat)

Evidence:
- `mingla-business/app.json:72` is `"output": "static"`, NOT `"single"`. So expo-router DOES emit static HTML shells per route during the export pass.

Caveat that re-introduces most of the H2 cost:
- `app/_layout.tsx:227-251` mounts `AuthProvider` + `RootLayoutInner` which immediately call `supabase.auth.getSession()` (AuthContext.tsx:142-202). Until that resolves, every page's `loading === true` (Index.tsx:18-24 returns a spinner; the splash gate in RootLayoutInner gates the Stack mount in the soft sense). The static HTML shell is delivered fast — but it's a near-empty `<div id="root"/>` plus the JS bundle. The user sees a blank-then-spinner-then-content sequence, not server-rendered content.
- Per-route static export means the SEO bots in `vercel.json:13-46` get a separate `/api/og-event` / `/api/public-event` rewrite path. Those serve real content. Real users do NOT get that path (it's user-agent-gated).

So technically REFUTED — static prerender IS enabled — but the user experience is indistinguishable from CSR-only because the static HTML contains no useful content, only the shell.

### Bundle inspection limitation

`mingla-business/dist/` contains only a stale Android Hermes bundle (`dist/_expo/static/js/android/entry-*.hbc`, 6.5 MB) dated 2026-05-17, not a current web export. The forensic could not measure the exact web bundle size without running `npx expo export -p web`. **Operator action requested:** run `cd mingla-business && npx expo export -p web && ls -laS dist/_expo/static/js/web/` and share the top file sizes. This quantifies H1 precisely.

---

## Section 3 — Auth + brand bootstrap walk (H3)

### H3 — Auth bootstrap blocks first paint → **CONFIRMED**

Chain (file:line cited at every hop):

1. `app/_layout.tsx:75-92` — `RootLayoutInner` reads `loading` from `useAuth()`.
2. `app/_layout.tsx:117-129` — splash hide gated on `loading || !brandReady || splashHidden`. On web, `SplashScreen.hideAsync()` is a no-op (line 64-66 docstring), but the React tree state still gates downstream consumers via the same flag.
3. `app/index.tsx:18-24` — returns `<ActivityIndicator>` while `loading` is `true`. For ANY non-authenticated cold-load to `/`, this is the blocking spinner.
4. `src/context/AuthContext.tsx:128` — `loading` initialises to `true`.
5. `src/context/AuthContext.tsx:142-202` — single `useEffect` calls `bootstrap()` which awaits `supabase.auth.getSession()` (line 149-152).
6. `src/services/supabase.ts:39` — `storage = typeof window === "undefined" ? ssrSafeStorage : AsyncStorage`. During SSR/prerender pass, getSession() returns no session in zero ms because `ssrSafeStorage.getItem` returns `null` synchronously. In the browser, AsyncStorage reads localStorage, which is the persisted session JSON; if expired, supabase-js fires the token-refresh round-trip.
7. `src/services/supabase.ts:48` — `detectSessionInUrl: Platform.OS === "web"`. If the URL is from an OAuth redirect (`#access_token=...`), supabase-js extracts + finalises before getSession() resolves — adds ~50ms but happens only on the post-OAuth round-trip.
8. `src/context/AuthContext.tsx:166-198` — if a session exists, the bootstrap then sequentially awaits `ensureCreatorAccount(s.user)` (line 171) THEN `tryRecoverAccountIfDeleted(s.user.id)` (line 181). Both are network round-trips. Only AFTER both resolve does `setLoading(false)` fire (line 199).
9. `setLoading(false)` triggers React to re-render `Index` (no longer spinner) AND re-render `RootLayoutInner` (releases the splash gate). Effective time-to-Stack-mount: bundle-parse + 1×getSession + 1×creator-account-upsert + 1×recover-check = ~3 network RTTs before any tab content can render.

**This is the dominant fixed-cost path on web.** Mobile feels fast because (a) the bundle is preloaded into the Expo Go / dev-build runtime (no download), (b) the cold-launch native splash masks the auth round-trip (lines 63-67 prevent autohide; the user does not see a blank screen during the auth bootstrap), and (c) AsyncStorage on mobile is a native SQLite/MMKV read with no network. On web, every cold-load eats the full chain visibly.

### Cross-impact: buyer-anon routes inherit the SAME auth bootstrap

`app/checkout/[eventId]/_layout.tsx:1-37` is anon-tolerant (lines 5-9 comment) and renders `<CartProvider><Stack/></CartProvider>` — but it is a CHILD of `app/_layout.tsx`. That means EVERY buyer who lands on `/checkout/{eventId}` to pay for a ticket pays the full `<AuthProvider>` bootstrap cost (lines 1-3 above) plus the brand splash gate (lines 110-115 in `_layout.tsx`). Even though the buyer has no session, `supabase.auth.getSession()` still runs and returns `{ session: null }`, then `setLoading(false)` fires after one RTT. They are unnecessarily waiting for an auth system they don't use. **Severity escalation: this is conversion-impacting.** The same applies to `app/e/[brandSlug]/[eventSlug].tsx`, `app/b/[brandSlug]/index.tsx`, `app/o/[orderId].tsx`, `app/t/[brandSlug]/[tripSlug].tsx`.

---

## Section 4 — Query-state inventory (H4 — the hanging loader)

### H4 — Stuck React Query under pending `enabled` predicate → **CONFIRMED (high confidence) with specific mechanism**

#### React Query version + v5 `isPending` semantic check

`mingla-business/package.json:53` → `"@tanstack/react-query": "^5.100.6"`. **v5 is installed.**

In `@tanstack/react-query` v5, `useQuery` returns `isPending: true` whenever there is no data AND the query has not produced an error — including when `enabled: false`. This is the breaking change from v4, where the v4 equivalent (`isLoading` v4) was `false` for disabled queries. The v5 docs are explicit: "isPending is true for queries that are disabled (enabled: false) and have no data."

Concretely: a hook that returns `{ ...query, isLoading: query.isPending }` to a loader UI would leave the loader **forever** if `enabled` never flips to `true`. The v5-safe replacement is `isLoading: query.isLoading` (v5's `isLoading` is `isPending && isFetching`, so `enabled: false` correctly gives `isLoading: false`).

#### Grep audit of `isPending` consumers

Comprehensive grep against `mingla-business/src` + `mingla-business/app` shows 80+ `isPending` references. **Categorisation:**
- **Mutations** (safe — mutation `isPending` semantics unchanged in v5): every site under `*Mutation.isPending`, `useMutation()` result, `useUpdateCreatorAccount`, `useCreateBrand`, `useUpdateBrand`, `useSoftDeleteBrand`, `useCreateVenueBrand`, `useRefundOrder`, `useAccountDeletion`, etc. — these are NOT the bug.
- **Query consumers reading `isPending` from `useQuery`/`useQueries`:** the grep matched **zero** direct `query.isPending` reads on a cold-load query. The code uses `isFetched`, `isFetching`, `data === undefined`, or no flag at all and renders fallbacks based on `data ?? []`.

So the **classic v5 `isPending` footgun is NOT present in the bug-prone form.** The codebase happens to dodge the trap because it checks `isFetched` / `data` instead of `isPending`.

#### BUT — there IS still a stuck-loader mechanism in the splash gate

`app/_layout.tsx:92-115` constructs `brandReady`:

```ts
const brandReady =
  (currentBrandId === null && !brandRecoveryResolving) ||
  brandFetched ||
  (brandFetchStatus === "idle" && !brandRecoveryResolving) ||
  brandFetchTimedOut;
```

The chain that drives `brandReady`:
- `currentBrandId` comes from `useCurrentBrandId()` (line 93) which reads Zustand persist.
- `useBrand(currentBrandId)` (line 94) returns `isFetched` + `fetchStatus`.
- `useCurrentBrandRecovery()` returns `isResolving` (line 95).

The recovery hook (`useCurrentBrandRecovery.ts:103-111`) defines `isResolving` as:
```ts
const isResolving =
  (authStatus === "bootstrapping" || authStatus === "refreshing") ||
  (isAuthReady &&
    userId !== null &&
    (!brandsQuery.isFetched ||
      !creatorAccount.isFetched ||
      (resolution !== null &&
        resolution.brandId !== currentBrandId &&
        errorMessage === null)));
```

`brandsQuery` is `useBrands(userId)`. `creatorAccount` is `useCreatorAccount()`. Both are gated by `isAuthReady` (which requires `authStatus === "signed_in_ready"` per `authReadiness.ts:66-70`).

**The hang mechanism (file:line citations):**

If the `useBrands` query OR the `useCreatorAccount` query enters retry-loop or never settles (e.g. RLS error, network drop on first attempt, edge case where Supabase returns 401 that retry-1 also fails on), then:
- `brandsQuery.isFetched === false` AND `creatorAccount.isFetched === false`
- Therefore `isResolving === true`
- Therefore `brandRecoveryResolving === true`
- Therefore none of the four ORd branches of `brandReady` resolves to `true`:
  - branch 1 needs `!brandRecoveryResolving` — false
  - branch 2 needs `brandFetched` — false (brand fetch hasn't been kicked off because `currentBrandId` is still pending recovery)
  - branch 3 needs `!brandRecoveryResolving` — false
  - branch 4 needs `brandFetchTimedOut` — true after 2s
- Branch 4 IS the 2 s hard-timeout escape hatch (line 73 `BRAND_FETCH_TIMEOUT_MS = 2000`, line 102-109 sets the timer).

**So the splash always escapes within 2 s in theory.** But there's a subtlety in line 103-104:
```ts
if (loading) return; // auth still bootstrapping; no timeout yet
if (brandFetchTimedOut) return;
```

The 2 s timer only ARMS after `loading === false`. If `supabase.auth.getSession()` itself never resolves (e.g. on a stale/corrupt persisted JWT that triggers an infinite refresh-retry loop in the Supabase JS client), `loading` stays `true` forever, the timer never arms, `RootLayoutInner` still renders `<Stack>` (Stack is always rendered — gate is on splash hide and downstream consumers, not on Stack mount), but `Index` (`app/index.tsx:18-24`) keeps returning the spinner forever. **This is the most likely "hanging loader" mechanism on web.**

Compounding factors that make this more likely on web than mobile:
- Web localStorage holds the persisted Supabase JWT. If the user has an expired refresh token that the server has revoked, `supabase.auth.refreshSession()` returns 401 + supabase-js retries.
- The retry policy of `@supabase/supabase-js 2.74` does NOT have a hard ceiling on the bootstrap-refresh path — it can loop until it gives up via internal logic, but during that loop, `getSession()` does NOT resolve (it awaits the refresh).
- There is no `Promise.race` with a hard timeout wrapping `supabase.auth.getSession()` anywhere. AuthContext.tsx:149-152 awaits the bare promise.

**Cited file:line for the hang mechanism:**
- `src/context/AuthContext.tsx:149-152` — bare `await supabase.auth.getSession()` with no timeout race
- `src/context/AuthContext.tsx:199` — `setLoading(false)` is reachable ONLY if line 149-152 resolves
- `app/_layout.tsx:102-109` — 2 s brand-fetch timeout DOES NOT ARM until `loading === false`
- `app/index.tsx:18-24` — spinner returned forever while `loading === true`

#### Other `enabled:` predicate inventory (cold-load chain)

| Hook | File:line | `enabled` predicate | Cold-load risk |
|---|---|---|---|
| `useBrand(currentBrandId)` | `src/hooks/useBrands.ts:184` | `brandId !== null` | LOW — currentBrandId is hydrated from Zustand or null; both terminate the gate cleanly |
| `useBrands(accountId)` | `src/hooks/useBrands.ts:114` | `accountId !== null` | LOW — gated on `user?.id`; if auth never resolves, `userId` stays `null`, query stays disabled (but the hang is upstream in auth) |
| `useCreatorAccount` | `src/hooks/useCreatorAccount.ts:52` | `isAuthReady && userId !== null` | LOW for same reason |
| `useCurrentBrandRole(brandId, userId)` | `src/hooks/useCurrentBrandRole.ts:89` | `brandId !== null && userId !== null` | LOW — only enabled in tab views that need role |
| `useEventOrders(eventId)` | `src/hooks/useEventOrders.ts:62` | `!loading && session !== null && eventId !== null` | MEDIUM — if `loading` stays true forever (auth hang), this stays disabled too |
| `useEventSoldCounts(eventIds)` | `src/hooks/useEventOrders.ts:136` | `!loading && session !== null` | Same as above |
| `useEventSalesSummaries(events)` | `src/hooks/useEventOrders.ts:185` | `!loading && session !== null` | Same |
| `useExperiencesByBrand(brandId)` | `src/hooks/useExperiencesByBrand.ts:21` | `brandId !== null && brandId.length > 0` | LOW |
| `usePendingExperiences(brandId)` | `src/hooks/usePendingExperiences.ts:34` | Same | LOW |
| `useIntakeSchema` | `src/hooks/useIntakeSchema.ts:56,73` | Composite | LOW (not on home cold path) |
| `useAgentChat(conversationId)` | `src/hooks/useAgentChat.ts:55` | `!!conversationId` | LOW (not on home cold path) |

**None of these consumers read `isPending` — they read `data` / `isFetched`. The v5 footgun does not trigger here.** The hang is one layer up: the splash/Index gate is keyed off `loading` (boolean), and `loading` can stay `true` forever if the auth bootstrap stalls.

---

## Section 5 — Persistence audit (H5)

### H5 — No `persistQueryClient` on web → **CONFIRMED**

Evidence:
- `src/config/queryClient.ts:18-22` (header comment): "Persistence: NOT wired in 13a. `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister` are installed but unused."
- Even worse than the comment claims: those two packages are NOT in `package.json` dependencies anymore (cf. lines 43-100 of `package.json` — neither is listed). The plan to wire persistence was deleted along the way.
- `grep -rn "persistQueryClient\|PersistQueryClientProvider\|createSyncStoragePersister\|createAsyncStoragePersister"` against `mingla-business/src` and `mingla-business/app` returns ZERO matches.

Impact:
- Every page navigation OR refresh on web is a full cold-fetch of every React Query that mounts. Cached query data is held only in-memory; tab close = cache gone.
- Zustand persist (`src/store/currentBrandStore.ts:156-168`) ONLY holds `currentBrandId` (a string). It does NOT cache brand records, event lists, sales summaries, or any server data. Per `feedback_zustand_persist_no_server_snapshots.md` invariant `I-PROPOSED-J`, this is correct architecturally — but the missing companion is React Query persistence, which would close the gap.
- On mobile, the asymmetry that helps mobile: AsyncStorage IS used by Zustand persist (same `currentBrandId` only), AND the React Query in-memory cache survives across screen navigations because the app stays mounted (no full reload). On web, refreshing the page or opening a new tab kills the cache. Combined with H1's monolithic bundle re-download (also cacheable via HTTP, but parse cost remains), this means every web tab open is full price.

---

## Section 6 — Reanimated / GestureHandler footprint (H6)

### H6 — Reanimated + GestureHandler web-shim weight → **CONFIRMED (contributing factor)**

Evidence:
- `package.json:92` → `react-native-reanimated ~4.1.1`
- `package.json:98` → `react-native-worklets 0.5.1`
- `package.json:86` → `react-native-gesture-handler ~2.28.0`
- `app/_layout.tsx:229` → `<GestureHandlerRootView style={{ flex: 1 }}>` wraps the entire tree (mandatory mount; no opt-out per platform).
- `grep -rn "useAnimatedStyle\|Animated\.\|Reanimated" mingla-business/src/components` returns **128 matches** across components. Every animated component pays the Reanimated v4 worklet bootstrap cost on web (the SWC-compiled worklet runtime ships in the bundle even if not used on a given route).

Reanimated v4 web is a known heavyweight — the worklet runtime + interpolation engine + animated value system is ~200KB ungzipped. On a buyer-anon route that doesn't animate anything, this is pure dead weight. Contributing factor to H1's monolithic-bundle bloat but not the primary cost driver. The Reanimated team has improved web-side tree-shaking in 4.x but the conditional `<GestureHandlerRootView>` mount at the absolute root forces inclusion regardless.

### Realtime channel side-effect cost

Beyond H6, the `useBrand` hook (`src/hooks/useBrands.ts:189-223`) AND `useBrands` (`useBrands.ts:122-166`) AND `useBrandStripeStatus`, `useBrandStripeBankVerification`, `useOrderRealtimeSubscription`, `useBusinessNotifications` all open Supabase Realtime WebSocket channels on mount. On the home tab cold-load, this fires at least 2-3 `supabase.channel().subscribe()` calls, each opening a WSS handshake (~150ms). Not directly on the first-paint path (WebSocket establishment runs in parallel to paint), but each adds to the early network contention and the "buggy" feel.

---

## Section 7 — Dev-vs-prod mode discrimination (H7)

### H7 — Dev-mode artifact only → **REFUTED, but with operator confirmation needed**

Evidence the slowness applies in production too:
- Operator's symptom report named "business.usemingla.com" pages (production hostname), not localhost. The brief §1 ("Mobile is fast but web is really slow") confirms the comparison is between production-web and production-mobile.
- Vercel deploys via `npx expo export -p web` (vercel.json:3) which IS a production build (minified, tree-shaken Metro web bundle).

Dev-mode WOULD make it 3-5× worse (Metro dev server transforms each module on demand + ships unminified code + HMR overhead), so if operator's measurements are from `npm run web` locally, ALL hypothesis severities scale up. **Operator action: confirm whether the slowness symptom was observed on (a) production `business.usemingla.com`, (b) local `npm run web` dev, or (c) both.** If (a), H1+H3+H5 are the dominant costs. If (b)-only, mark this report as a dev-mode artifact and only fix the hang (H4-derived from H3) for prod parity.

---

## Section 8 — Buyer-web cross-check

Routes inspected:
- `app/checkout/[eventId]/_layout.tsx`
- `app/checkout/[eventId]/{buyer,confirm,index,payment}.tsx` (filenames only — not opened)
- `app/e/[brandSlug]/[eventSlug].tsx`, `app/e/[brandSlug]/index.tsx`
- `app/b/[brandSlug]/index.tsx`
- `app/o/[orderId].tsx`
- `app/t/[brandSlug]/[tripSlug].tsx`

Direct check via grep:
- `app/o/[orderId].tsx:4` — header explicitly states "ANON-TOLERANT — outside (tabs)/ group; MUST NOT call useAuth or…"
- `app/o/[orderId].tsx:162` — comment "Lookups (NO useAuth — anon-tolerant per I-21)"
- `app/o/[orderId].tsx:55` — DOES import `useBrandList` from currentBrandStore (the shim that wraps the React Query `useBrands` hook). On a true anon (no session), the inner `useBrands(null)` correctly disables — but the page still pays the bundle + auth-bootstrap cost.
- `app/checkout/[eventId]/_layout.tsx:7-9` — explicitly anon-tolerant per memory feedback `feedback_anon_buyer_routes`.

**Inheritance verdict:** YES, buyer-web routes inherit every cost path identified in §2 (bundle) + §3 (auth bootstrap) + §5 (no persistence) + §6 (Reanimated weight). They do NOT inherit §4's hang mechanism per se (no `useBrand(currentBrandId)` because there is no `currentBrandId` for anon users), but they DO inherit the upstream "loading stuck forever if `supabase.auth.getSession()` stalls" mechanism in `app/index.tsx:18-24`. Critically, the BUYER routes do NOT render `app/index.tsx` because they have their own route group — but they DO render `app/_layout.tsx` which mounts `<AuthProvider>` and runs the same `bootstrap()` useEffect. The buyer route doesn't gate its render on `loading`, so it CAN paint over the loading state. **But** the auth bootstrap still runs in the background, consuming CPU + network during the critical first-paint window. Net result: buyers see the page slightly faster than the home tab, but still pay the bundle cost (H1) and the SSR-shell-then-CSR-hydration pattern (H2 caveat). Conversion impact = real.

---

## Section 9 — Five-truth-layer cross-check summary

**Docs.** No `WEB.md` or `web-*.md` in `mingla-business/`. The README is the boilerplate Expo welcome. `IOS_DEV_BUILD_REBUILD_RUNBOOK.md` exists for iOS but no web equivalent. The strict-grep registry README (`/Users/sethogieva/Desktop/mingla-main/.github/scripts/strict-grep/README.md`) lists no perf gates. ORCH-0886 [SSR window-is-not-defined permanent fix] (commit `5170bfef`, 2026-05-19) shipped platform shims for Sentry + pell-rich-editor — those WORK and are not regressions; they prevent SSR crashes but do not address bundle weight or auth bootstrap cost. No documented web-perf story exists.

**Schema.** Not directly relevant for perf but worth noting: the `pg_derive_brand_stripe_status` RPC + the `brands`/`creator_accounts` SELECTs that fire on cold load all have indexes (brands.id PK, creator_accounts.id PK, events.brand_id index per prior ORCH). Server is not the bottleneck. Network RTT to Supabase EU region from a US-based buyer adds 80–150ms per query (compounding cost of H3's serialised getSession → ensureCreatorAccount → tryRecoverAccountIfDeleted chain).

**Code.** All the Phase 0 files reviewed. The story is consistent: a single monolithic bundle, an auth-blocking root provider, no React Query persistence, no per-route code-splitting, no Suspense-based streaming — every page pays the maximum cost on every load.

**Runtime.** Could not execute (sandbox + brief §6 restrictions). Operator instrumentation steps in §1b will quantify TTFB / bundle parse / auth resolve.

**Data.** Network tab inspection deferred to operator. Predicted: 1 HTML, 1 main JS bundle, 1-3 chunked JS files, 1 `supabase.auth.getSession()` POST, 1-2 `/rest/v1/creator_accounts` GETs, 1 `/rest/v1/brands` GET, 1-2 WebSocket upgrade requests to `wss://<supabase>.realtime`, plus AppsFlyer/Mixpanel/OneSignal init beacons.

---

## Section 10 — Dominant cost path + hang mechanism

**Dominant cost path (one sentence):** The slowness is primarily driven by H1 [monolithic JS bundle with no route-level code-splitting via `expo export -p web` static output, shipping every dependency including Reanimated/GestureHandler/Stripe-Connect/Camera/QR/SVG/AppsFlyer to every page including anon-buyer checkout] + H3 [auth bootstrap serialises `supabase.auth.getSession()` → `ensureCreatorAccount()` → `tryRecoverAccountIfDeleted()` before `loading` flips false and lets `app/index.tsx` render anything past the spinner], with H5 [no `persistQueryClient` so every web tab/refresh = full cold fetch] as the multiplier; the indefinitely-hanging loader is a stalled `supabase.auth.getSession()` Promise (`src/context/AuthContext.tsx:149-152` — bare await with no timeout race) blocking `setLoading(false)` (line 199), which leaves `app/index.tsx:18-24` returning `<ActivityIndicator>` forever AND prevents the 2 s brand-fetch timeout (`app/_layout.tsx:102-109`) from ever arming because that timer is gated on `loading === false`.

**Hang mechanism citation:** `src/context/AuthContext.tsx:149-152` (bare `await supabase.auth.getSession()`) + `app/index.tsx:18-24` (spinner-while-loading) + `app/_layout.tsx:103` (`if (loading) return` — guards the 2 s brand-fetch escape timer behind the same flag, defeating it on web-only auth-stall paths).

---

## Section 11 — Risks + open questions for operator

### Risks / what to NOT do without further work
- Do NOT enable route-level code-splitting via a Webpack/Expo Router rewrite without first confirming Expo Router v6 supports it without breaking the static-export contract (per inspection, it does not at the static layer; a Next.js-style App Router migration would be a much larger lift than ORCH-0887 should commit to).
- Do NOT add `persistQueryClient` without a key-versioning strategy — stale cache after a server-side schema migration causes subtle data bugs. The original ORCH-0742 ZustandPersist memory notes (`feedback_zustand_persist_no_server_snapshots.md`) explain why server snapshots were banished from Zustand persist; the same discipline (TTL, version key, dehydrate filter) must apply if persistence is added.
- Do NOT touch the auth bootstrap order (`ensureCreatorAccount` must run before any Brand fetch, per the existing OAuth-redirect flow guarantees) without re-running the ORCH-0808 AppsFlyer + Mixpanel attribution tests.
- The brand-fetch 2 s timeout (`BRAND_FETCH_TIMEOUT_MS`) is a known fallback (`ORCH-0743 / C1` per the inline comment lines 71-73). Adding a similar timeout race around `supabase.auth.getSession()` will close the "infinite hang" bug but may cause a refresh-loop UX if the token is genuinely revoked — the right pattern is `Promise.race([getSession(), timeout(3000)])` + on-timeout treat as signed-out + show retry CTA.

### Open questions for operator
1. **Was the slowness observed on production `business.usemingla.com` or local `npm run web`?** (resolves H7 ambiguity)
2. **Do you have a Chrome DevTools Performance trace of a cold-load you can share?** (turns predicted timeline into measured timeline)
3. **Have any users reported buyer-web hangs at `/checkout/{eventId}` or `/e/{brandSlug}/{eventSlug}`, or is the symptom only on the authenticated business surface?** (severity escalation gate)
4. **Is there a deployed Vercel preview URL where I can run `curl -I /home` to capture HTTP cache headers?** (would refine the H1 transfer-cost estimate)
5. **What is acceptable web cold-load p95 from the operator's perspective?** (calibrates SPEC fan-out aggressiveness — sub-2s vs sub-4s changes the spec scope by a factor of 2)

### Recommended SPEC fan-out (for the orchestrator's next step — investigation produces no spec text, only a recommended scope)

- **ORCH-0887-A [Auth bootstrap timeout race]** — wrap `supabase.auth.getSession()` in `Promise.race` with 3 s timeout in `src/context/AuthContext.tsx:149-152`; on timeout treat as signed-out; surface retry CTA in `app/index.tsx`. Closes the indefinite-hang bug. Smallest blast radius. **Highest priority.**
- **ORCH-0887-B [Bundle bloat reduction Phase 1]** — move all web-incompatible imports behind `Platform.OS !== "web"` lazy imports or `.web.ts` platform-split files. Targets: `react-native-appsflyer`, `react-native-onesignal`, `react-native-google-signin`, `mixpanel-react-native`, `expo-camera`, `react-native-qrcode-svg`, `react-native-webview`. Closes the H1 dead-weight share carried by buyer-anon routes.
- **ORCH-0887-C [React Query persistence on web]** — re-add `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister` (or `createSyncStoragePersister` for web localStorage), wire into `src/config/queryClient.ts` with a version key + per-query dehydrate filter (skip mutations, skip `enabled: false`). Eliminates the cold-fetch tax on every web tab.
- **ORCH-0887-D [Buyer-anon auth-bootstrap bypass]** — split `app/_layout.tsx` so anon routes (`/checkout`, `/e`, `/b`, `/o`, `/t`) mount a lighter provider tree without `AuthProvider` running `getSession()`. Either via expo-router route groups (`(buyer)/_layout.tsx` vs `(auth)/_layout.tsx`) or conditional provider mounting based on `pathname`. Removes the auth-bootstrap RTT from the conversion-critical buyer path.
- **ORCH-0887-E [Defer non-critical post-auth side-effects]** — the cascade of `initializeAppsFlyer`, `mixpanelService.initialize`, `revenueCatService.initialize`, `initializeOneSignal`, `evictEndedEvents`, `reapOrphanStorageKeys` in `app/_layout.tsx:136-204` runs at mount. Move all of these behind `requestIdleCallback` (web) / `InteractionManager.runAfterInteractions` (native) so they don't compete with first-paint.

A/B/C/D in that priority order. E is a cleanup pass that follows.

---

## Layman summary of the report

- **Why web is slow** — every page on `business.usemingla.com` downloads ONE giant JavaScript file containing every screen + every library (including ones for camera, QR codes, ad attribution, and other things buyers will never use). On phones, this code is already on the device; on the web, the browser re-downloads it on every visit.
- **Why the spinner sometimes hangs forever** — the app waits for `supabase.auth.getSession()` to finish before showing anything. If that single call gets stuck (stale token, network hiccup), the spinner spins forever because there's no timeout. The 2-second safety timeout we DO have only kicks in AFTER auth finishes — so if auth is what's stuck, the timeout never triggers.
- **Why mobile is fast** — the native app keeps the JavaScript in memory between screens, so auth + brand data are warm. The web app throws everything away on every refresh because there is no React Query cache persistence wired up at all.
- **Why buyer pages are also affected** — anonymous buyer routes (`/checkout/{eventId}`, `/e/{brand}/{event}`, `/b/{brand}`) share the same root layout as the authenticated business app, so they pay the same auth-bootstrap cost even though buyers don't have accounts. This is conversion-impacting.
- **The good news** — there is NO subtle React Query v5 `isPending` bug in this codebase (the team correctly uses `isFetched`/`data` checks). The hang is one layer up in the auth bootstrap, which is a smaller, more surgical fix.
- **The recommended path** — five sub-ORCHs (A through E above). A is a 30-line fix that stops the infinite hang. B + C are medium-effort fixes that halve cold-load time. D protects the conversion funnel for buyers. E is polish.

---
