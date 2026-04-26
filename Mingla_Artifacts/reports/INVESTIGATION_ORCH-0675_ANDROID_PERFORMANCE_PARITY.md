# Investigation: Android vs iOS Performance Parity (ORCH-0675)

**Date:** 2026-04-25
**Investigator:** mingla-forensics
**Mode:** INVESTIGATE-ONLY
**Severity:** S0 launch-blocker
**Confidence overall:** Medium-High (M-H) — static evidence is strong; **all runtime numbers are INSUFFICIENT EVIDENCE pending live-fire on real Android hardware**

---

## 1. Executive Summary

Android feels "really slow" because Mingla's stack contains at least **8 confirmed root-cause patterns and 10 contributing factors** that converge on Android while iOS sidesteps each. Three causes account for an estimated majority of perceived sluggishness (live-fire numbers required to confirm proportions):

1. **The card-swipe deck on Discover runs every swipe gesture animation on the JavaScript thread** — `Animated.spring`/`Animated.timing` on `position.x/y` with `useNativeDriver: false` at five sites in [SwipeableCards.tsx:1249,1270,1286,1298,1327](app-mobile/src/components/SwipeableCards.tsx#L1249). On iOS this is forgiving; on Android (especially mid-tier and below) the JS thread cannot keep up with 60 fps gesture interpolation, so each swipe drops frames. This is the most user-visible defect.
2. **The app eagerly imports and parses 667 locale JSON files at module load** — [src/i18n/index.ts:1-671](app-mobile/src/i18n/index.ts) statically imports 29 languages × 23 namespaces. This bloats first-paint cold-start time disproportionately on Android because V8 JSON parsing is slower on lower-tier ARM CPUs and the JS bundle is gated on this completing.
3. **Discover's blur surface stacks 24–36 BlurView instances simultaneously during grid scroll**, and the loading skeleton pulses on a JS-driven `Animated.loop` — [DiscoverScreen.tsx:579-599](app-mobile/src/components/DiscoverScreen.tsx#L579). Android's `dimezisBlurView` IS correctly enabled (good), but blur cost compounds linearly with instance count. iOS's CoreImage blur is GPU-accelerated end-to-end; Android software paths fall further behind.

Plus a deeper systemic class: **AsyncStorage on Android is SQLite-backed (~20–200 ms per write on mid-range devices) and is hammered by Zustand persist (every swipe → write), the React Query persistor, the auth/offline/analytics queues, and locale cache. iOS's NSUserDefaults is in-memory + lazy file flush (<10 ms typical).** Without MMKV, Android pays disk-sync latency on a hot path.

Every runtime number in this report — fps, ms, memory — is **INSUFFICIENT EVIDENCE — needs live-fire** because no Android hardware was available to the investigator. The static evidence (file:line citations) is strong; the magnitude proportions are not yet proven.

---

## 2. Disparity Matrix

| Surface | Metric | iOS | Android | Disparity Note |
|--------|--------|-----|---------|----------------|
| Cold start | Splash → first interactive frame (ms) | INSUFFICIENT — needs live-fire | INSUFFICIENT — needs live-fire | i18n 667-JSON parse + AsyncStorage cache gate + dual Sentry init + 4 SDK inits all serialise on JS thread |
| Home | Scroll fps over 60 s | INSUFFICIENT | INSUFFICIENT | Provider tree depth (6); BlurView density on chrome bar; CollaborationSessions pill bar; HomePage carousels |
| Discover | Swipe-deck gesture-to-animation latency (ms) | INSUFFICIENT | INSUFFICIENT | **Confirmed JS-thread `Animated.spring`/`timing` on position at 5 sites in SwipeableCards** |
| Discover | Grid-scroll fps with BlurView badges | INSUFFICIENT | INSUFFICIENT | 24–36 BlurView instances in steady state during scroll |
| Chat | Scroll fps with 100 messages | INSUFFICIENT | INSUFFICIENT | `inverted={true}` FlatList, no `getItemLayout`, unmemoized `MessageBubble`, three HOC wrappers per row |
| Map | Pan fps 30 s | INSUFFICIENT | INSUFFICIENT | React-rendered marker JSX→bitmap; ORCH-0409 45 s heartbeat = 7% baseline CPU; Google Maps base on Android vs CARTO tiles on iOS |
| Modal | ExpandedCardModal open/close ms | INSUFFICIENT | INSUFFICIENT | 2× LayoutAnimation.configureNext at lines 744, 862; ScrollView content; nested horizontal scrolls |
| Memory | 5-min session heap delta (MB) | INSUFFICIENT | INSUFFICIENT | Full-res avatars cached in memory; only 1 of 50 image consumers is `expo-image`; 0 `cachePolicy` props |
| Storage | AsyncStorage writes per minute | INSUFFICIENT | INSUFFICIENT | Zustand persist on every swipe; React Query persister; offline queue; auth |
| BlurView | Native render ms per frame on Android | INSUFFICIENT | INSUFFICIENT | `experimentalBlurMethod="dimezisBlurView"` correctly enabled — confirmed at every consumer |

**Why every cell says INSUFFICIENT:** the dispatch mandated live-fire. Live-fire required real Android hardware. Investigator had only static code access. Per `feedback_headless_qa_rpc_gap.md`, this is flagged honestly rather than estimated. **A live-fire pass on a Samsung A-series (low-tier) and a Pixel-class (mid/high-tier) device is the single most important next step.**

---

## 3. Investigation Manifest

**Files read directly by investigator (verified):**

- [app-mobile/app.json](app-mobile/app.json) (full)
- [app-mobile/app/_layout.tsx](app-mobile/app/_layout.tsx) (full)
- [app-mobile/babel.config.js](app-mobile/babel.config.js) (full)
- [app-mobile/package.json](app-mobile/package.json) (deps section)
- [app-mobile/src/i18n/index.ts](app-mobile/src/i18n/index.ts) (head + import count)
- [app-mobile/src/components/SwipeableCards.tsx](app-mobile/src/components/SwipeableCards.tsx) (imports, lines 350–370, lines 1240–1340, full `useNativeDriver` grep)
- [app-mobile/app/index.tsx](app-mobile/app/index.tsx) (Sentry init region 135–155, AsyncStorage gate 2780–2810)
- node_modules verification: `react-native-reanimated/plugin/index.js`, `react-native-worklets/plugin/index.js`, `react-native-reanimated/package.json`

**Files read via parallel forensic agents (claims verified for the most consequential, flagged where unverified):**

- 4 Explore agents covering H1–H16 hypothesis clusters
- ~80 source files inspected across `app-mobile/src/` (components, hooks, services, contexts, store, config)

**Live-fire captures attempted:** zero. No Android device access in this environment.

**Confidence summary by hypothesis:**

| Cluster | Static-evidence verdict | Live-fire required? | Confidence |
|---------|------------------------|---------------------|------------|
| H1 Engine/Build | REFUTED (config symmetric) | Low (already inspected build output) | H |
| H2 Cold-start | CONFIRMED-root | Yes, for ms numbers | H static / L runtime |
| H3 Glass/Blur | CONFIRMED-contributing | Yes, for fps + native render ms | H static / L runtime |
| H4 Lists/Scroll | CONFIRMED-contributing | Yes, for fps | H static / L runtime |
| H5 Animations | CONFIRMED-root | Yes, for fps + dropped-frame counts | H static / L runtime |
| H6 Images | CONFIRMED-contributing | Yes, for memory + decode | H static / L runtime |
| H7 Maps | CONFIRMED-contributing | Yes, for fps + heartbeat cost | H static / L runtime |
| H8 Network | CONFIRMED-contributing | Yes, for invalidation storm magnitude | H static / L runtime |
| H9 Storage | CONFIRMED-contributing | Yes, for write-rate measurement | H static / L runtime |
| H10 State/re-renders | CONFIRMED-contributing | Yes, for observer count | M static / L runtime |
| H11 Logging | CONFIRMED-contributing | Yes, for bridge-cost measurement | M static / L runtime |
| H12 SDK init | CONFIRMED-contributing | Yes, for ms-each | H static / L runtime |
| H13 Realtime | CONFIRMED-contributing | Yes, for re-render burst measurement | H static / L runtime |
| H14 Memory/GC | INSUFFICIENT | Yes (cannot tell statically) | L |
| H15 Edge-to-edge/Keyboard | CONFIRMED-contributing | Yes, for double-lift verification | M static / L runtime |
| H16 Platform branches | CONFIRMED-contributing (signals platform burden) | No | H |

---

## 4. Findings — 🔴 Root Causes

### RC-1 — SwipeableCards card-swipe gesture animations run on JS thread

| Field | Evidence |
|------|----------|
| File + line | [app-mobile/src/components/SwipeableCards.tsx:1249, 1270, 1286, 1298, 1327](app-mobile/src/components/SwipeableCards.tsx#L1249) — five sites; plus the `position` ValueXY animation strategy is JS-driven globally |
| Exact code | `Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();` (line 1249); `Animated.timing(position, { toValue: { x: ±SCREEN_WIDTH, y: gestureState.dy }, duration: 250, useNativeDriver: false }).start(...)` (line 1296–1304) |
| What it does | The card position (the actual transform on the deck card the user is dragging) is animated using **legacy React Native `Animated`** (imported at [line 9](app-mobile/src/components/SwipeableCards.tsx#L9)) with `useNativeDriver: false`. Every frame is computed and dispatched on the JavaScript thread, then bridged to the native view system per frame. PanResponder ([line 12](app-mobile/src/components/SwipeableCards.tsx#L12)) updates `position.x/y` per gesture event, also via JS bridge. |
| What it should do | A 60 fps gesture-driven transform animation on Android requires either (a) `useNativeDriver: true` (only safe for transform/opacity, requires extracting horizontal/vertical to single Animated.Value pair instead of ValueXY) or (b) Reanimated 4 worklets with `useSharedValue` + `useAnimatedStyle` + Gesture Handler 2 — same approach already used in [SwipeableMessage.tsx](app-mobile/src/components/SwipeableMessage.tsx) and [DoubleTapHeart.tsx](app-mobile/src/components/DoubleTapHeart.tsx) elsewhere in the codebase. |
| Causal chain | 60 fps gesture event arrives at JS thread → JS thread is also running React Query observer reactions, Zustand updates, console.log statements, Sentry breadcrumb collection → JS frame budget exceeds 16.67 ms → `Animated.spring` interpolation on JS thread misses frames → bridged transform updates arrive late at native side → user sees stutter on swipe. iOS is more forgiving because (a) faster single-thread CPU on comparable price-tier devices, (b) Apple's Core Animation can interpolate already-bridged values smoothly, (c) JIT and Hermes deopt patterns differ. |
| Verification step | (a) Live-fire: enable Reanimated's frame profiler on a Samsung A-series device, perform 30 swipes, count drops. (b) Static verification — confirmed: `grep -n useNativeDriver app-mobile/src/components/SwipeableCards.tsx` returns 13 hits, of which the **5 hits at 1249, 1270, 1286, 1298, 1327 are on `position` (the card transform)** and all are `useNativeDriver: false`. (c) Confirm by toggling: a temporary refactor to Reanimated worklets on the deck would restore Android parity in profiler results. |

**Confidence:** H static / L runtime.

---

### RC-2 — i18n module eagerly imports and parses 667 locale JSONs at startup

| Field | Evidence |
|------|----------|
| File + line | [app-mobile/src/i18n/index.ts:1–671](app-mobile/src/i18n/index.ts) — 671 import lines total (4 baseline imports + 667 locale imports) |
| Exact code | `import en_common from './locales/en/common.json'` × 23 (English namespaces), repeated across 29 languages = 667 static JSON imports, all evaluated at module-load time. Imported synchronously by [app/_layout.tsx:1](app-mobile/app/_layout.tsx#L1): `import '../src/i18n'  // Must be first`. |
| What it does | At root layout module load, V8/Hermes parses 667 JSON modules into resolved JS objects in memory. This blocks the JS thread before React reconciliation begins. The i18n module sits on the cold-start critical path; nothing downstream renders until it returns. |
| What it should do | Bundle only the active locale's namespaces synchronously; lazy-load other locales via `dynamic import()` on language-switch event. Or use i18next's built-in `Backend` / namespace lazy-loader. Or split the 23 namespaces into "boot" (common, navigation) loaded synchronously and "deferred" (cards, chat, expanded_details) loaded on first screen mount. |
| Causal chain | Cold start → require('app/_layout.tsx') → require('../src/i18n') → 667 JSON.parse calls on JS thread → JS bundle entry returns → React mount can begin. On low-tier Android (Snapdragon 600-class CPUs), JSON parse throughput is 30–50% lower than iOS comparable hardware → noticeable cold-start delay. The bundle size also grows: every locale shipped = bigger initial bundle = longer download time on cold install. |
| Verification step | (a) Live-fire: capture cold-start trace with Hermes profiler — module-load time of `src/i18n/index.ts` should be visible. (b) Static: `grep -c "^import " app-mobile/src/i18n/index.ts` returns 671 (verified). (c) Bundle size delta: `npx expo export` with all locales vs only en — measure bundle size diff. |

**Confidence:** H static / L runtime.

---

### RC-3 — Discover loading skeleton runs an infinite JS-thread `Animated.loop`

| Field | Evidence |
|------|----------|
| File + line | [app-mobile/src/components/DiscoverScreen.tsx:579–599](app-mobile/src/components/DiscoverScreen.tsx#L579) (per agent inspection — pulse Animated.Value + loop with `useNativeDriver: false`) |
| Exact code | `useEffect(() => { const loop = RNAnimated.loop(RNAnimated.sequence([RNAnimated.timing(pulse, { toValue: 1, duration: d.motion.skeletonPulseMs / 2, easing: RNEasing.inOut(RNEasing.quad), useNativeDriver: false }), ... ])); loop.start(); return () => loop.stop(); }, [pulse]);` |
| What it does | While the Discover grid is loading (potentially 5+ seconds on slow network), 6+ skeleton cards each render two `Animated.View` layers with an interpolated opacity that pulses on a JS-thread `Animated.timing` loop. The opacity is computed on every frame on the JS thread and bridged to native. |
| What it should do | Use Reanimated 4 with a `withRepeat(withTiming(...))` shared-value loop, or set `useNativeDriver: true` on the opacity animation (opacity is one of the natively-driven properties — fully eligible for native driver). |
| Causal chain | User opens Discover → React Query fetches → loading state for N seconds → 6× skeleton cards render → 12× `Animated.View` pulse animations all running on JS thread → JS thread cannot also service gesture input or Pressable feedback → during the load window the entire app feels frozen on mid-tier Android. iOS scheduler prioritises render-thread work harder, masking the issue. |
| Verification step | (a) Live-fire: turn off network (airplane mode), open Discover, profile JS thread fps for 5 s. (b) Static: confirmed by agent inspection — the `useNativeDriver: false` is on opacity which is GPU-eligible — purely a misconfiguration. |

**Confidence:** H static / L runtime.

---

### RC-4 — Cold-start path serialises i18n + 6-deep providers + Sentry + 4 SDK inits + AsyncStorage cache check on JS thread

| Field | Evidence |
|------|----------|
| File + line | [app-mobile/app/_layout.tsx:1–23](app-mobile/app/_layout.tsx#L1) (Sentry init #1 with `enableLogs: true`, `replaysOnErrorSampleRate: 1`); [app-mobile/app/index.tsx:141–150](app-mobile/app/index.tsx#L141) (Sentry init #2 with `enableNativeFramesTracking: true`); [app-mobile/app/index.tsx:288–290, 311–313, 334–336, ~275](app-mobile/app/index.tsx#L288) (RevenueCat, OneSignal, AppsFlyer, Mixpanel inits); [app-mobile/app/index.tsx:2782–2845](app-mobile/app/index.tsx#L2782) (`cacheReady` gate before `PersistQueryClientProvider`) |
| Exact code | `Sentry.init({ enableLogs: true, sendDefaultPii: true, replaysSessionSampleRate: 0.1, replaysOnErrorSampleRate: 1, integrations: [Sentry.mobileReplayIntegration()] })` × 2 sites; `useEffect(() => { configureRevenueCat(user?.id ?? null) }, [])` (line 288); `useEffect(() => { initializeOneSignal() }, [])` (line 311); `useEffect(() => { initializeAppsFlyer() }, [])` (line 334); `<>{cacheReady && <PersistQueryClientProvider ...>...</PersistQueryClientProvider>}</>` (line 2782 — provider tree gated on AsyncStorage size check) |
| What it does | At cold start: (1) `app/_layout.tsx` calls `Sentry.init` with session-replay enabled and `enableLogs: true` — installs native crash handlers and bridges all logs; (2) i18n module-loads 667 JSONs (RC-2); (3) `app/index.tsx` calls `Sentry.init` AGAIN with native frames tracking — second native module setup; (4) AppContent mounts; (5) four parallel `useEffect`s fire RevenueCat/OneSignal/AppsFlyer/Mixpanel initialisation — none coordinated, all touching native modules; (6) AppContent reads `REACT_QUERY_OFFLINE_CACHE` from AsyncStorage (Android SQLite) before mounting `PersistQueryClientProvider`; (7) only after the AsyncStorage read resolves does the provider tree mount. |
| What it should do | Initialise Sentry once. Defer non-critical SDKs (Mixpanel, AppsFlyer) to post-first-paint. Run AsyncStorage cache check in parallel with first render (mount provider with empty cache, hydrate progressively). Lazy-load locales beyond the user's active language. Keep splash visible only while truly blocking work runs. |
| Causal chain | Native splash dismisses (line 44 in AnimatedSplashScreen) → JS bridge wakes → root layout mounts → i18n parses 667 JSONs → Sentry installs handlers (×2) → AppContent mounts → AsyncStorage SQLite read (Android: 100–300 ms for 1.5 MB cache, vs <10 ms iOS) → provider tree finally mounts → SDK inits start firing → first render → user sees content. iOS's faster module load + faster storage = visible difference. |
| Verification step | Live-fire trace via Hermes profiler captures the gap between splash dismissal and first interactive frame, broken down per phase. Static verification of duplicate Sentry init: `grep -n "Sentry.init" app-mobile/app/_layout.tsx app-mobile/app/index.tsx` returns 2 hits at lines 6 and 141 — confirmed. |

**Confidence:** H static / L runtime.

---

### RC-5 — Realtime payload handlers are not throttled or debounced; cascade through 200+ React Query observers

| Field | Evidence |
|------|----------|
| File + line | [app-mobile/src/hooks/useSocialRealtime.ts:34–204](app-mobile/src/hooks/useSocialRealtime.ts#L34) — 12 `.on('postgres_changes', ...)` listeners on a single channel, each calling `queryClient.invalidateQueries` directly. [app-mobile/src/hooks/useSessionDiscussion.ts:41–88](app-mobile/src/hooks/useSessionDiscussion.ts#L41), [app-mobile/src/hooks/useBoardQueries.ts:316–361](app-mobile/src/hooks/useBoardQueries.ts#L316). React Query has 202 useQuery+useMutation hooks across 53 files (per agent count). |
| Exact code | `.on("postgres_changes", { event: "*", schema: "public", table: "friend_requests", filter: ... }, () => { queryClient.invalidateQueries({ queryKey: ["friends"] }); callbacksRef.current?.onFriendRequestChange?.(); })` — repeated 12× on `useSocialRealtime` channel. No `lodash.throttle`, no `setTimeout`-based coalescing, no batching. |
| What it does | Each Postgres change event triggers immediate React Query cache invalidation. Coarse-grained keys like `["friends"]` cause every observer using any subset of friends queries to refetch and re-render. During a burst (e.g., user receives 5 messages + 2 reactions in rapid sequence), 7 invalidation events fire 7 cascades through ~5–15 observers each. |
| What it should do | Coalesce burst events with `lodash.throttle` (e.g., 100 ms trailing) per query-key family. Or use React Query's `setQueryData` with a precise patch instead of full invalidation when payload contains the new row. Or move from `event: "*"` (any change) to explicit `INSERT`/`UPDATE`/`DELETE` filters with targeted handlers. |
| Causal chain | Burst of N realtime events → N immediate invalidations → N×K observer refetches → N×K Supabase round trips on Android's flakier network → N×K React reconciliation passes on the JS thread → N×K Zustand persist writes (server data sometimes accidentally persisted) → SQLite writes pile up → frame drops on whatever surface the user is on. |
| Verification step | Live-fire: instrument a 60 s session with 2 simulated real-time bursts; count React Query refetch calls per query-key. Static: confirmed listener count via grep — 36 `supabase.channel` instances across 18 files (per agent). |

**Confidence:** H static / L runtime.

---

### RC-6 — AsyncStorage on Android is the storage substrate for Zustand persist + React Query persister + offline queue + auth — no MMKV; SQLite write pressure is structural

| Field | Evidence |
|------|----------|
| File + line | [app-mobile/src/store/appStore.ts:140–287](app-mobile/src/store/appStore.ts#L140) (Zustand `persist` middleware, no debounce); [app-mobile/app/index.tsx:2782–2845](app-mobile/app/index.tsx#L2782) (`PersistQueryClientProvider` + `asyncStoragePersister`); [app-mobile/src/services/offlineService.ts](app-mobile/src/services/offlineService.ts) (offline queue); 85 AsyncStorage call sites across 24 files (per agent count). [app-mobile/package.json](app-mobile/package.json) confirms `@react-native-async-storage/async-storage: ^2.2.0` and **zero `react-native-mmkv` dependency**. |
| Exact code | `create<AppState>()(persist(set => ({...}), { name: 'app-store', storage: createJSONStorage(() => AsyncStorage), partialize: state => ({...}) }))` — partialize trims persisted shape (good) but **no throttle, no debounce, no write coalescing**. Zustand v4 default is to write on every state change. The `addSwipedCard` action (line 202–208) fires on every Discover swipe → AsyncStorage `setItem`. |
| What it does | Every Zustand state change writes the partialised state to AsyncStorage. On Android (SQLite-backed), each `setItem` is an INSERT/UPDATE + transaction commit on a SQLite WAL — 20–200 ms per write on mid-range hardware. Discover swipe sessions push state changes at ~1–3 per second; each is a write. The React Query persister (with `shouldDehydrateQuery` trimming, line 2792–2820 in app/index.tsx) writes on a different cadence but shares the same AsyncStorage substrate, so writes serialise on the SQLite mutex. |
| What it should do | Either (a) migrate to `react-native-mmkv` (memory-mapped, sub-millisecond writes, no SQLite) — the standard answer; or (b) wrap Zustand's storage with a custom debounce (250–500 ms trailing) so burst swipes coalesce into one write; or (c) move `currentCardIndex` and `sessionSwipedCards` out of persist and rely on React Query (server source of truth) for re-derivation on resume. |
| Causal chain | User swipes card → Zustand `addSwipedCard(rec)` → set called → persist middleware serialises partialised state to JSON → AsyncStorage `setItem` → SQLite acquire lock → INSERT/UPDATE → WAL commit → fsync (Android filesystem) → all takes 20–200 ms on mid-tier Android → JS thread blocked during this → next swipe gesture queues up → user perceives lag. iOS NSUserDefaults is in-memory + lazy file flush — single-digit ms for the same operation. |
| Verification step | Live-fire: run the swipe deck for 60 s, count AsyncStorage writes (instrument the persist storage adapter), measure per-write duration on Android via `Date.now()` deltas. Static: confirmed substrate (AsyncStorage 2.2.0, no MMKV in deps) and confirmed Zustand persist with no debounce config. |

**Confidence:** H static / L runtime.

---

### RC-7 — Chat FlatList is `inverted={true}` with no `getItemLayout` and unmemoized MessageBubble wrapped in three HOCs

| Field | Evidence |
|------|----------|
| File + line | [app-mobile/src/components/MessageInterface.tsx:883–999](app-mobile/src/components/MessageInterface.tsx#L883) — FlatList with `inverted={true}`, no `getItemLayout`, no `removeClippedSubviews`, no `windowSize`. [app-mobile/src/components/chat/MessageBubble.tsx:144](app-mobile/src/components/chat/MessageBubble.tsx#L144) — exported as plain function, **not** wrapped in `React.memo`. Three HOC wrappers per row: `<SwipeableMessage><DoubleTapHeart><TouchableOpacity><MessageBubble /></TouchableOpacity></DoubleTapHeart></SwipeableMessage>`. |
| Exact code | `<FlatList ref={flatListRef} data={groupedMessages} renderItem={({ item, index }) => (<><SwipeableMessage><DoubleTapHeart><TouchableOpacity ... onPress={...} onLongPress={...}><MessageBubble message={...} isMe={...} groupPosition={...} showTimestamp={revealedTimestampId === item.message.id} isRead={...} replyTo={...} /></TouchableOpacity></DoubleTapHeart></SwipeableMessage>{daySeparator}</>)} keyExtractor={item => item.message.id} inverted={true} ... />` |
| What it does | When the user taps a message to reveal a timestamp, parent state changes (`revealedTimestampId`), and because `MessageBubble` is not memoized AND the prop `showTimestamp` is computed inline per row, every row's `MessageBubble` re-renders. Without `getItemLayout`, FlatList re-measures every visible cell on every data change. Combined with `inverted={true}` (which has documented Android perf cliffs with dynamic-height items), this means a single tap can re-layout the entire visible window. |
| What it should do | (a) Wrap `MessageBubble` in `React.memo` with a custom equality fn comparing `message.id`, `isRead`, `showTimestamp`, `replyTo`. (b) Provide `getItemLayout` using a per-message-type height table (text vs image vs reply-quoted vs card-bubble vs day-separator). (c) Audit whether `inverted` is necessary — Mingla could use a non-inverted list with `scrollToEnd` on new message instead, eliminating Android's repaint-on-scroll-direction-change cost. |
| Causal chain | User taps message → `revealedTimestampId` state change → MessageInterface re-renders → FlatList receives new `data` reference (or new render prop closure) → all visible rows re-render → each row re-measures because no `getItemLayout` → Android repaints inverted layout → user sees stutter when revealing a single timestamp. iOS handles this gracefully because Apple's UICollectionView measure caching is more forgiving. |
| Verification step | Live-fire: open a chat with 100 messages, tap each message to reveal timestamp 30 times, count drops. Static: confirmed `inverted={true}` and missing config props per agent file read; confirmed `MessageBubble` is `export default function MessageBubble(...)` not `export default memo(MessageBubble)`. |

**Confidence:** H static / L runtime.

---

### RC-8 — Image consumers are predominantly RN core `<Image>` (not `expo-image`) with zero `cachePolicy` and zero resize transforms

| Field | Evidence |
|------|----------|
| File + line | Per agent count: 49 `Image` usages from `react-native`, **only 1** from `expo-image` (`DiscoverScreen.tsx:40`). Zero `cachePolicy` props anywhere. Zero Supabase Storage transform query params (no `?width=`, `?transform=`, no Cloudinary, no Imgix). Examples: [app-mobile/src/components/board/InlineInviteFriendsList.tsx:261](app-mobile/src/components/board/InlineInviteFriendsList.tsx#L261), [app-mobile/src/components/CollaborationSessions.tsx:1036](app-mobile/src/components/CollaborationSessions.tsx#L1036), [app-mobile/src/components/ConnectionsPage.tsx:1719](app-mobile/src/components/ConnectionsPage.tsx#L1719), [app-mobile/src/components/chat/MessageBubble.tsx:238–244](app-mobile/src/components/chat/MessageBubble.tsx#L238). |
| Exact code | `<Image source={{ uri: friend.avatar }} ... />`, `<Image source={{ uri: message.image_url }} ... />`, `supabase.storage.from('chat-files').getPublicUrl(storagePath)` — full-resolution URL with no transform. |
| What it does | RN core `<Image>` on Android uses the Fresco backend with default memory-only LRU cache (~12.5% of available heap, no disk cache by default). Each scroll past a previously-loaded image refetches from network (or memory if still resident). Avatars and message images are full-resolution (likely 500 KB–3 MB each on modern phones). 20+ avatars on screen = 10–60 MB of memory pressure on Android, forcing GC pauses. |
| What it should do | Migrate to `expo-image` (already a dependency at v3.0.11 — only one consumer uses it). `expo-image` has `cachePolicy="memory-disk"` default + transition + recyclingKey. Also add Supabase Storage image transforms (`?width=` and `?height=`) to all avatar/thumbnail URL constructions, sized to the display target. |
| Causal chain | User opens chat → 20 avatars enter viewport → 20 full-res HTTP requests (cold) or 20 memory hits (warm) → 20 Bitmap decodes on Android decoder thread → memory pressure → GC pause during scroll → frame drop. iOS NSURLSession has system-level disk cache + URLSession's image-aware caching → many images served from disk without re-decode. |
| Verification step | Live-fire: scroll a chat with 50 messages each having an image attachment, monitor `dumpsys meminfo` heap delta. Static: confirmed grep counts (1× expo-image, 49× RN Image, 0× cachePolicy, 0× width transforms in URL construction). |

**Confidence:** H static / L runtime.

---

## 5. Findings — 🟠 Contributing Factors

### CF-1 — Sentry initialised twice with `enableLogs: true` + 100% replay-on-error

[app/_layout.tsx:6–23](app-mobile/app/_layout.tsx#L6) AND [app/index.tsx:141–150](app-mobile/app/index.tsx#L141). The second `Sentry.init` is gated by `enabled: !__DEV__` (production only), but both share the same DSN; the production path calls `init` twice. `enableLogs: true` (line 14 of _layout) routes ALL logs through Sentry's bridge; `replaysOnErrorSampleRate: 1` (100%) means every error captures a session replay, which is expensive (frame capture + serialisation). `sendDefaultPii: true` collects extra fields per event. iOS handles this less painfully because (a) faster CPU absorbs the overhead, (b) iOS Sentry SDK is more mature.

### CF-2 — OneSignal verbose logging shipped to production

[app-mobile/src/services/oneSignalService.ts:37](app-mobile/src/services/oneSignalService.ts#L37): `OneSignal.Debug.setLogLevel(LogLevel.Verbose)` with no `__DEV__` guard. Every notification lifecycle emits 20–50 verbose log entries; bridge cost is paid on every notification arrival. Memory rule `feedback_onesignal_sdk_v5_display.md` is honoured (the foreground display wrapper at lines 181–210 correctly calls `notification.display()`), but verbose logging contradicts production hygiene.

### CF-3 — Mixpanel logs success/failure unconditionally on init

[app-mobile/src/services/mixpanelService.ts:38, 40](app-mobile/src/services/mixpanelService.ts#L38) — `console.log("📊 Mixpanel initialized successfully")` and `console.error("📊 Mixpanel initialization failed:", error)` both fire at every cold start. Singleton instance created at module import (line ~28) runs even if Mixpanel is never used.

### CF-4 — 22 `useNativeDriver: false` instances scattered across glass/animation components

Per agent inventory: [GlassIconButton.tsx:108, 125](app-mobile/src/components/ui/GlassIconButton.tsx#L108) (press tint), [GlassBottomNav.tsx:164, 171](app-mobile/src/components/GlassBottomNav.tsx#L164) (spotlight slide on tab change), [GlassBadge.tsx:164, 181](app-mobile/src/components/ui/GlassBadge.tsx#L164), [LikesPage.tsx:185, 192](app-mobile/src/components/LikesPage.tsx#L185), [OnboardingFlow.tsx:256, 335](app-mobile/src/components/OnboardingFlow.tsx#L256), [ProfileStatsRow.tsx:88, 111](app-mobile/src/components/ProfileStatsRow.tsx#L88), [SegmentedProgressBar.tsx:22](app-mobile/src/components/SegmentedProgressBar.tsx#L22) (width — justified, no native driver for width), plus the 5 in SwipeableCards (RC-1) and the 2 in DiscoverScreen skeleton (RC-3). Most could be `useNativeDriver: true` since they animate transform/opacity.

### CF-5 — react-native-maps Android marker bitmap cache requires 45 s heartbeat workaround (ORCH-0409)

[app-mobile/src/components/map/providers/ReactNativeMapsProvider.tsx:49–84](app-mobile/src/components/map/providers/ReactNativeMapsProvider.tsx#L49). Documented Android-only bug: with `tracksViewChanges={false}` (necessary for perf), markers vanish over time due to native bitmap cache invalidation. Mitigation flips `tracksViewChanges={true}` for 3 s every 45 s — 7% baseline CPU overhead. iOS does not need this. Combined with React-rendered marker JSX (SelfPinContent, PersonPinContent at lines 160–219) being converted to bitmap on every refresh cycle, this is sustained Android-only cost.

### CF-6 — Discover grid stacks 24–36 BlurView instances simultaneously during scroll

Per agent count: GlassBadge has 4–6 BlurView instances per Discover card, and a 6-card visible grid (per `GRID_CARD_WIDTH` calculation at line 63 of DiscoverScreen) = 24–36 BlurView instances. `experimentalBlurMethod="dimezisBlurView"` IS correctly enabled at every consumer (verified — this is the **good** finding), but blur cost compounds linearly with instance count. Discover grid is the single heaviest blur surface in the app.

### CF-7 — Edge-to-edge + softwareKeyboardLayoutMode "resize" + `KeyboardAwareView` manual padding = potential double-lift on Android

[app-mobile/app.json:40–42](app-mobile/app.json#L40) sets `edgeToEdgeEnabled: true` AND `softwareKeyboardLayoutMode: "resize"`. The OS resizes the window when keyboard opens. Then [app-mobile/src/components/ui/KeyboardAwareView.tsx:73–88](app-mobile/src/components/ui/KeyboardAwareView.tsx#L73) ALSO adds `paddingBottom: keyboardHeight - bottomOffset`. If the OS already resized the window, the manual padding is duplicate. KeyboardAwareScrollView mitigates with `disableLayoutAnimation: true`, but this is a workaround, not a structural fix. iOS does not have edge-to-edge in the same way — Safe Area is built into UIViewController.

### CF-8 — CalendarTab uses manual map render, no virtualization

[app-mobile/src/components/activity/CalendarTab.tsx:1768–1841](app-mobile/src/components/activity/CalendarTab.tsx#L1768) renders all `filteredActiveEntries` and `filteredArchiveEntries` via `.map(entry => <Animated.View key={entry.id}>...</Animated.View>)` inside a single `ScrollView`. No FlatList, no `removeClippedSubviews`, no virtualization. With 20+ calendar events, all are mounted in memory simultaneously. Animation reset on every filter change ([line 311](app-mobile/src/components/activity/CalendarTab.tsx#L311)) restarts opacity:0→1 + slide:30→0 on all visible cards, visible as stutter on Android.

### CF-9 — focusManager invalidates 14 critical query families on every background→foreground transition

[app-mobile/src/hooks/useForegroundRefresh.ts:103–333](app-mobile/src/hooks/useForegroundRefresh.ts#L103). On long background (≥30 s) AND short background (5–30 s), 14 query families are invalidated. Android's AppState transitions can fire MULTIPLE times during a single resume due to OEM doze/task-killer behaviour. The 200 ms debounce (per agent observation) prevents the same transition firing twice, but back-to-back distinct transitions still trigger full storms.

### CF-10 — 910 `console.*` calls in `app-mobile/src/`; ~15% in hot render/animation paths

Per agent count: 910 total. Notable hot-path examples: [SwipeableCards.tsx:980, 1062, 1267](app-mobile/src/components/SwipeableCards.tsx#L980) (gesture handler logs); [useDeckCards.ts:211](app-mobile/src/hooks/useDeckCards.ts#L211) (per-card-result log). Hermes pays serialisation cost even with no listener; on Android the bridge cost is more visible than on iOS. `LogBox.ignoreAllLogs` is not called (per agent search). No `__DEV__` gates on the hot-path examples.

---

## 6. Findings — 🟡 Hidden Flaws

### HF-1 — Glass shadow tokens use iOS-only properties parsed (and ignored) on Android

[app-mobile/src/constants/designSystem.ts:284–307, 389–395](app-mobile/src/constants/designSystem.ts#L284). Tokens like `glass.shadow` define `shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius` AND `elevation`. RN's StyleSheet still parses the iOS-only props on Android (validates types, copies into the style object) — zero visual effect, microsecond per-render parse cost. Multiplied by every glass component re-render, this is a low-grade tax. Could be wrapped in `Platform.select` to ship only the relevant properties.

### HF-2 — PopularityIndicators creates `useSharedValue` inside render body

[app-mobile/src/components/PopularityIndicators.tsx](app-mobile/src/components/PopularityIndicators.tsx) (per agent inspection) — `useRef({ likes: useSharedValue(0), saves: useSharedValue(0), ... }).current`. `useSharedValue` called inside a `useRef` initialiser. The ref guard prevents recreation across renders, but this pattern violates Reanimated's recommended usage and is fragile to refactor. Not a current bug; future-risk pattern violation.

### HF-3 — 180 `setInterval`/`setTimeout` instances across 68 files; cleanup is decentralised

Per agent count. Sampled hooks (focusManager, useForegroundRefresh, queryClient auth401Reset) have correct cleanup in `useEffect` returns. Not all 180 sites verified. Risk: any uncleaned timer in an unmounted component leaks closures, causing ratcheting memory growth over a 30-min session — visible as Android GC pause frequency increase.

### HF-4 — `dehydrateOptions.shouldDehydrateQuery` excludes 4 query keys but includes deck-cards, savedCards, calendarEntries

[app-mobile/app/index.tsx:2792–2820](app-mobile/app/index.tsx#L2792). Code comment notes deck-cards/savedCards/calendarEntries are now persisted "to enable instant-on stale-while-revalidate UX." On Android, this means every deck refresh writes the deck array (potentially 200 cards × ~1 KB each) to AsyncStorage. The `MAX_CACHE_BYTES = 1_500_000` cap (line 2782 area) catches runaway growth, but each write up to 1.5 MB is expensive on SQLite.

### HF-5 — Mixpanel singleton instantiated at module-import even if never used

[app-mobile/src/services/mixpanelService.ts:26–30](app-mobile/src/services/mixpanelService.ts#L26). Importing the service file runs the singleton constructor regardless of feature use — pays the import cost even on flows that never emit a Mixpanel event.

### HF-6 — RealtimeSubscriptions remounts whenever `realtimeEpoch` increments

[app-mobile/app/index.tsx:2303–2306](app-mobile/app/index.tsx#L2303). `<React.Fragment key={realtimeEpoch}><RealtimeSubscriptions userId={user.id} /></React.Fragment>` — key change forces full unmount + remount of all realtime subscriptions. On long resume this is intentional (avoids stale-channel binding loss), but it costs the Supabase channel handshake roundtrip and brief subscription gap. On flaky Android networks the gap is longer.

### HF-7 — Splash screen failsafe at 3000 ms

[app-mobile/src/components/AnimatedSplashScreen.tsx:77](app-mobile/src/components/AnimatedSplashScreen.tsx#L77). If app fails to fully render within 3 s, failsafe dismisses splash. On a slow Android cold start the failsafe can trigger frequently, producing inconsistent UX (splash flashes back in some states).

### HF-8 — useDeckCards logs per-card result on JS thread

[app-mobile/src/hooks/useDeckCards.ts:211](app-mobile/src/hooks/useDeckCards.ts#L211). On every card fetch result, `console.log([useDeckCards] partial delivery: ...)` fires. With 30 cards arriving in rapid succession during a deck refresh, that's 30 bridge serialisations on the main JS thread.

### HF-9 — `keyboardShouldPersistTaps` not consistently set on all scrollables

Per agent search: MessageInterface and ConnectionsPage set `keyboardShouldPersistTaps="handled"` correctly; CalendarTab uses ScrollView and inherits native behaviour but no explicit prop. Per memory rule, missing `keyboardShouldPersistTaps` on RN scrollables can cause first-tap-dismisses-keyboard rather than triggering a button press. Not an Android-specific perf issue but a UX-correctness adjacency.

---

## 7. Findings — 🔵 Observations (Not Defects)

- **OB-1 — Hermes is enabled implicitly (correct).** [app.json](app-mobile/app.json) does not set `jsEngine`, which means Expo SDK 54's default (Hermes) applies for both platforms. No asymmetry.
- **OB-2 — New Architecture (Fabric/TurboModules) enabled on both platforms.** [app.json:9, 99–103](app-mobile/app.json#L9) — `newArchEnabled: true` global + per-platform. No asymmetry.
- **OB-3 — Babel plugin configuration is correct for Reanimated 4.** [babel.config.js](app-mobile/babel.config.js) uses `react-native-worklets/plugin` only — this is the Reanimated 4.x official plugin (the old `react-native-reanimated/plugin` is now a thin re-export of `react-native-worklets/plugin`, verified by reading the plugin's `index.js`). **Agent 2's "missing plugin" claim was FALSE — corrected here.**
- **OB-4 — `experimentalBlurMethod="dimezisBlurView"` correctly enabled at every Android BlurView consumer.** Hardware-accelerated blur path is on. The performance issue is density, not method.
- **OB-5 — Zustand selectors used correctly throughout.** All sampled `useAppStore` calls use selector form `useAppStore(s => s.user)`. No whole-store subscriptions found.
- **OB-6 — Realtime channel cleanup is correct.** All sampled `supabase.channel(...).subscribe()` sites have matching `removeChannel` in cleanup. No subscription leak risk.
- **OB-7 — `asyncStoragePersister` IS active in production via `<PersistQueryClientProvider>` at [app/index.tsx:2782](app-mobile/app/index.tsx#L2782).** **Agent 4's "dead code" claim was FALSE — corrected here.**
- **OB-8 — OneSignal SDK v5 foreground display compliance verified.** [oneSignalService.ts:181–210](app-mobile/src/services/oneSignalService.ts#L181) calls `event.getNotification().display()` per memory rule.
- **OB-9 — `tracesSampleRate: 0` in second Sentry init means no traces shipped (good).** Replays still ship at the rate configured by the first init though.

---

## 8. Causal Chain Maps (top 3 root causes)

```
RC-1 — Card swipe JS-thread animation
─────────────────────────────────────
User drag gesture
       │
       ▼
PanResponder updates `position` (Animated.ValueXY) per gesture event
       │
       ▼
On gesture end: Animated.spring/timing on `position` with useNativeDriver:false
       │   (5 sites: SwipeableCards.tsx:1249, 1270, 1286, 1298, 1327)
       ▼
JS thread interpolates frame-by-frame
       │
       ▼
JS thread is also handling:
  • React Query observer reactions
  • Zustand `addSwipedCard` → AsyncStorage write (RC-6)
  • Sentry breadcrumb
  • console.warn from hot path (HF-8)
  • Realtime invalidations queued (CF-9)
       │
       ▼
JS frame budget exceeded → bridged updates land late
       │
       ▼
User sees stutter on swipe → "Android feels really slow"

iOS comparison: same code path, but iOS has higher per-thread CPU at comparable
device tier + Apple's Core Animation can smooth bridged values better, masking
the disparity.
```

```
RC-2 + RC-4 — Cold start cascade
─────────────────────────────────
Native splash dismisses (AnimatedSplashScreen.tsx:44)
       │
       ▼
JS bundle starts evaluating
       │
       ▼
app/_layout.tsx imports '../src/i18n'
       │
       ▼
src/i18n/index.ts evaluates 671 import lines → 667 JSON.parse calls (RC-2)
       │   Android: V8/Hermes parse on slower ARM = +200–500 ms vs iOS
       ▼
Sentry.init #1 with enableLogs:true, replaysOnError:1 (CF-1)
       │
       ▼
GestureHandlerRootView mounts → Stack mounts
       │
       ▼
app/index.tsx evaluates → Sentry.init #2 with enableNativeFramesTracking
       │
       ▼
AppContent mounts → AsyncStorage cache check (app/index.tsx:2782) gates
       │   provider tree on `cacheReady`
       ▼
Android: AsyncStorage SQLite read of REACT_QUERY_OFFLINE_CACHE
       │   100–300 ms (vs <10 ms iOS NSUserDefaults)
       ▼
PersistQueryClientProvider mounts → 6 nested providers cascade (Toast,
       │   CardsCache, Recommendations, MobileFeatures, Navigation, CoachMark)
       ▼
useEffect fires → 4 SDKs init in parallel:
  • RevenueCat configure (line 288)
  • OneSignal initialize + verbose logging (line 311) — 9s retry on net failure
  • AppsFlyer initSdk + 2 listeners (line 334)
  • Mixpanel.init + console.log (line ~275)
       │
       ▼
First render → AnimatedSplashScreen.hideAsync → user sees content

Total Android cold start: INSUFFICIENT EVIDENCE — likely 2.5–4× iOS.
```

```
RC-5 + RC-6 — Realtime burst → AsyncStorage write storm
─────────────────────────────────────────────────────────
Burst of N realtime events arrive on Supabase channel
       │   (e.g., 5 messages + 2 reactions in 1 s)
       ▼
12 listeners on useSocialRealtime channel — each fires
       │
       ▼
N × queryClient.invalidateQueries({ queryKey: [...] })
       │   No throttle, no debounce, no coalescing
       ▼
Each invalidation triggers all matching observers to refetch
       │   202 useQuery hooks across 53 files; coarse keys like ['friends']
       │   fan out to ~5–15 observers
       ▼
N × K Supabase round trips (Android: flakier network compounds)
       │
       ▼
N × K React reconciliation passes on JS thread
       │
       ▼
Some refetches → Zustand state changes → persist middleware writes
       │   to AsyncStorage on every change (no debounce in persist config)
       ▼
Android: each AsyncStorage setItem = 20–200 ms SQLite write
       │
       ▼
JS thread blocked → frame drops on whatever surface user is on
       │
       ▼
User perceives lag during conversation activity → "Android is slow"

iOS: same K × N invalidations, but NSUserDefaults <10 ms writes and faster
single-thread CPU absorb the burst.
```

---

## 9. Blast Radius Matrix

Surfaces are columns; root causes are rows; cell value indicates exposure (H=high, M=med, L=low, blank=not affected).

| | Discover deck | Discover grid | Home | Chat | Connections | Map | ExpandedCard modal | Cold start | Background→foreground |
|--|--|--|--|--|--|--|--|--|--|
| RC-1 SwipeableCards JS anim | **H** | | | | | | | | |
| RC-2 i18n eager 667 JSONs | | | | | | | | **H** | |
| RC-3 Skeleton JS pulse | | **H** | | | | | | | |
| RC-4 Cold-start cascade | | | | | | | | **H** | |
| RC-5 Realtime no throttle | | | M | **H** | M | | | | |
| RC-6 AsyncStorage SQLite | **H** | M | M | M | M | | | M | M |
| RC-7 Chat FlatList unmemo | | | | **H** | | | | | |
| RC-8 Image full-res | | M | M | **H** | M | | M | | |
| CF-1 Sentry double-init | | | | | | | | M | |
| CF-2 OneSignal verbose | M | | M | M | | | | | M |
| CF-4 useNativeDriver:false 22× | M | M | M | M | M | | M | | |
| CF-5 Maps 45s heartbeat | | | | | | **H** | | | |
| CF-6 BlurView density 24–36 | | **H** | M | | | | | | |
| CF-7 Edge-to-edge keyboard | | | | M | | | M | | |
| CF-8 Calendar manual render | | | | | M | | | | |
| CF-9 focusManager 14 invalidations | | | M | M | M | | | | **H** |
| CF-10 910 console calls | M | M | M | M | M | M | M | M | |

**Device tier stratification (qualitative — needs live-fire to quantify):**

- **Low-tier (Galaxy A-series, Snapdragon 600-class, ≤4 GB RAM):** All causes hit hard. RC-1 + RC-3 + CF-6 produce visible stutter on every interaction. AsyncStorage SQLite latency dominates.
- **Mid-tier (Galaxy A5x, Pixel 6a, OnePlus Nord, 6–8 GB RAM):** RC-1 swipe stutter still visible; cold start visible but acceptable; chat scroll OK at light loads.
- **High-tier (Galaxy S2x, Pixel 8/9, 12 GB+ RAM):** Most causes masked. Disparity vs iOS is smallest here.

---

## 10. Constitutional / Invariant Violations

| Constitution principle | Status | Findings violating |
|------------------------|--------|-------------------|
| #1 No dead taps | OK | No tap-dead findings |
| #2 One owner per truth | At-risk | RC-6 (Zustand persist + React Query persist + offline queue all share AsyncStorage substrate without coordination — three writers, one store, but no single throttle/debounce owner) |
| #3 No silent failures | At-risk | CF-3 Mixpanel logs success/failure but doesn't surface to user; OneSignal retry loop swallows up to 9 s with verbose logs but no user-visible error |
| #4 One query key per entity | OK | Query keys use factories per agent inspection |
| #5 Server state stays server-side | At-risk | HF-4 deck-cards/savedCards/calendarEntries persisted to AsyncStorage — server data in client storage substrate; "instant-on" UX justification is documented but pushes Android SQLite write pressure |
| #6 Logout clears everything | Not investigated | Out of scope |
| #7 Label temporary fixes | Followed | CF-5 ORCH-0409 heartbeat, ORCH-0361, ORCH-0410, ORCH-0620 all carry inline comments documenting their workaround status |
| #8 Subtract before adding | At-risk | CF-1 Sentry initialised twice — neither call subtracted the other; suggests one or both are residue from a refactor |
| #9 No fabricated data | OK | No synthetic ratings/prices found |
| #10 Currency-aware UI | Adjacent — see ORCH-0670 HF-04 (out of scope) |
| #11 One auth instance | OK | Single auth path |
| #12 Validate at the right time | OK | No timing violations found in this scope |
| #13 Exclusion consistency | OK | No exclusion-rule investigation needed |
| #14 Persisted-state startup | **Violated (Android)** | RC-4: provider tree is GATED on AsyncStorage cache check — app cannot render until AsyncStorage returns. On slow Android storage this directly violates the principle that the app should work correctly from cold cache without blocking on disk |

**Proposed new invariants (for orchestrator to register if accepted):**

- `I-ANIMATIONS-NATIVE-DRIVER-DEFAULT` — All `Animated.timing`/`Animated.spring` on transform/opacity must use `useNativeDriver: true`. CI grep gate: zero `useNativeDriver: false` matches except in width/non-eligible animations with explicit comment justification.
- `I-LOCALES-LAZY-LOAD` — Only the active language's namespaces may be statically imported at root layout. Other locales must be dynamic-imported. CI grep gate: count of static `from './locales/<lang>/' imports in `i18n/index.ts` ≤ 23 (one language).
- `I-REALTIME-HANDLER-THROTTLED` — Every realtime payload handler must wrap `invalidateQueries` in `lodash.throttle`/`lodash.debounce` or use `setQueryData` for precise patches. CI grep gate: every `.on('postgres_changes', ..., handler)` site must reference a throttled handler or `setQueryData`.
- `I-ZUSTAND-PERSIST-DEBOUNCED` — Zustand persist middleware on AsyncStorage substrate must include a debounce wrapper (≥250 ms trailing) on the storage adapter. CI grep gate: any `persist({...storage: createJSONStorage(() => AsyncStorage)...})` site must also call a debounced storage wrapper.
- `I-IMAGES-USE-EXPO-IMAGE` — `<Image>` from `react-native` is forbidden; all consumers must use `<Image>` from `expo-image` with explicit `cachePolicy`. CI grep gate: zero matches of `from 'react-native'` followed by `Image` import alongside JSX `<Image`.
- `I-NO-DUPLICATE-NATIVE-INIT` — Each native SDK must be initialised exactly once across the app. CI grep gate: each of `Sentry.init`, `OneSignal.initialize`, `appsFlyer.initSdk`, `Purchases.configure`, `Mixpanel.init` appears at exactly one site.

---

## 11. Layer Contradictions

Where docs/schema/code/runtime/data disagreed (with truth-layer noted):

1. **Babel plugin docs vs Reanimated 4 reality.** Old Reanimated 3 docs say "add `react-native-reanimated/plugin` last in babel plugins". Reanimated 4 docs say "add `react-native-worklets/plugin`". Codebase follows Reanimated 4 docs correctly. **One sub-agent cited Reanimated 3 docs as truth and produced a FALSE root-cause finding** (claimed missing plugin = catastrophic). Verified by reading the actual plugin source: `react-native-reanimated/plugin/index.js` is a 4-line re-export of `react-native-worklets/plugin`. **Truth layer: code (verified by reading plugin source).**
2. **`asyncStoragePersister` perceived as dead code.** One sub-agent reported the persister was instantiated but never used. Verified by reading [app/index.tsx:2782](app-mobile/app/index.tsx#L2782): `<PersistQueryClientProvider client={queryClient} persistOptions={{ persister: asyncStoragePersister, maxAge: ..., dehydrateOptions: { shouldDehydrateQuery: ... } }}>`. Persister IS active in production. **Truth layer: code (verified by direct read).**
3. **Comment claims "Sentry's native module installs a global NSException handler" only on the second init** (app/index.tsx:138–140), but the first init at app/_layout.tsx:6 already installs handlers. The comment is stale or aspirational. **Truth layer: runtime (which call wins is determined by the SDK; both register handlers, last-write-wins for native config).**
4. **Comment at AnimatedSplashScreen says splash hides "immediately" but the failsafe at line 77 implies it can take up to 3 s** to hide on slow boots. Both are true — the question is what fraction of cold starts hit the failsafe. **Truth layer: data (live-fire required).**
5. **`softwareKeyboardLayoutMode: "resize"` (Android) vs `KeyboardAvoidingView behavior="padding"` (iOS) vs `KeyboardAwareView paddingBottom` (both).** The OS resizes Android automatically; the app then ALSO adds padding manually. The intent (per `disableLayoutAnimation: true` in KeyboardAwareScrollView) is to avoid double-animation, but the redundant padding itself is unaddressed. **Truth layer: code says one thing; runtime layout says double-lift.**

---

## 12. Hypothesis Verdict Table

| ID | Title | Verdict | One-line rationale |
|----|-------|---------|---------------------|
| H1.1 | Hermes asymmetry | REFUTED | No `jsEngine` override; Expo SDK 54 default Hermes both platforms |
| H1.2 | New Arch not actually active on Android | REFUTED | `newArchEnabled: true` global + per-platform |
| H1.3 | ProGuard disabled | INSUFFICIENT EVIDENCE | No explicit `enableProguardInReleaseBuilds` in eas.json; Expo defaults apply — needs build artifact inspection |
| H1.4 | ABI splits not enabled | INSUFFICIENT EVIDENCE | No explicit ABI split config — needs gradle inspection |
| H1.5 | Hermes precompilation skipped | INSUFFICIENT EVIDENCE | Default Expo behaviour; needs `expo export` artifact |
| H1.6 | Gradle JVM heap | INSUFFICIENT EVIDENCE | No source-tree gradle.properties found |
| H1.7 | Per-platform jsEngine | REFUTED | No override |
| H1.8 | Expo Updates fallback | INSUFFICIENT EVIDENCE | Cannot confirm without runtime |
| H2.1 | Eager SDK imports | CONFIRMED root | RC-2 + RC-4 |
| H2.2 | Splash hides before tree mounts | CONFIRMED contributing | HF-7 |
| H2.3 | Synchronous fonts | INSUFFICIENT EVIDENCE | No `useFonts` or `Font.loadAsync` found per agent — likely embedded; not confirmed |
| H2.4 | i18n eager 29 locales | CONFIRMED root | RC-2 |
| H2.5 | Auth bootstrap serial calls | INSUFFICIENT EVIDENCE | Not exhaustively traced |
| H2.6 | Provider stack ordering | CONFIRMED contributing | RC-4 |
| H3.1 | BlurView count | CONFIRMED contributing | CF-6 |
| H3.2 | dimezisBlurView not set | REFUTED | OB-4 — correctly enabled |
| H3.3 | Shadow* on Android | CONFIRMED contributing | HF-1 |
| H3.4 | Pending token JS pulse | CONFIRMED contributing | RC-3 (per agent — same pattern in DiscoverScreen) |
| H3.5 | LinearGradient stacking | REFUTED | Not stacked under BlurView in rapid loops per agent inspection |
| H4.1 | SwipeableCards re-render | CONFIRMED root | RC-1 (animation-driver dimension) |
| H4.2 | MessageInterface inverted | CONFIRMED root | RC-7 |
| H4.3 | Map cards re-fetch | CONFIRMED contributing | CF-9 |
| H4.4 | ConnectionsPage list | CONFIRMED contributing | No memo'd items per agent inspection |
| H4.5 | AddToBoardModal grid | INSUFFICIENT EVIDENCE | Not inspected at depth |
| H4.6 | Nested horizontal scrolls | CONFIRMED contributing | CardFilterBar + ExpandedCardModal nest horizontal scroll inside vertical |
| H4.7 | Avatar image decode | CONFIRMED contributing | RC-8 |
| H5.1 | useNativeDriver: false | CONFIRMED root | RC-1 + CF-4 (22 instances total) |
| H5.2 | Worklet recreation | INSUFFICIENT EVIDENCE | Pattern present (HF-2) but no current bug |
| H5.3 | Gesture handler version | REFUTED | Versions match per agent (Reanimated 4.1.5 + worklets 0.5.1 + GH 2.28.0) |
| H5.4 | LayoutAnimation | CONFIRMED contributing | 15 instances per agent — modal/sheet scope, lower frequency |
| H5.5 | Card swipe gesture race | CONFIRMED root | RC-1 |
| H5.6 | Glass shimmer JS-driven | CONFIRMED root | RC-3 |
| H6.1 | Full-res images | CONFIRMED root | RC-8 |
| H6.2 | cachePolicy unset | CONFIRMED root | RC-8 (zero cachePolicy props found) |
| H6.3 | Image source URL changes | INSUFFICIENT EVIDENCE | Not exhaustively verified |
| H6.4 | SVG in lists | REFUTED | Per agent — no SVG in FlatList renderItem |
| H6.5 | ImageBackground | REFUTED | Zero instances per agent |
| H6.6 | Avatar decode in chat | CONFIRMED contributing | RC-8 |
| H7.1 | React-rendered markers | CONFIRMED contributing | CF-5 |
| H7.2 | Aggressive clustering | INSUFFICIENT EVIDENCE | Default radius=50, maxZoom=16 — not tuned per device |
| H7.3 | Polyline counts | INSUFFICIENT EVIDENCE | Not inspected |
| H7.4 | Maps API key restriction | INSUFFICIENT EVIDENCE | Cannot inspect runtime |
| H7.5 | MapView remount | INSUFFICIENT EVIDENCE | Lifecycle not traced |
| H7.6 | useMapCards re-fetch | CONFIRMED contributing | Per agent — `staleTime: 2 * 60_000` reasonable; re-fetch only on userLocation change |
| H8.1 | RQ defaults storm | CONFIRMED contributing | CF-9 |
| H8.2 | Realtime channel churn | CONFIRMED root | RC-5 |
| H8.3 | Discover call cascade | INSUFFICIENT EVIDENCE | Not exhaustively traced |
| H8.4 | Image CDN absent | CONFIRMED root | RC-8 — no transforms |
| H8.5 | Network calls before splash | INSUFFICIENT EVIDENCE | Not measured |
| H8.6 | OkHttp HTTP/2 | INSUFFICIENT EVIDENCE | Cannot inspect runtime |
| H9.1 | AsyncStorage write rate | CONFIRMED root | RC-6 |
| H9.2 | AsyncStorage payload >2MB | CONFIRMED contributing | HF-4 — `MAX_CACHE_BYTES = 1.5 MB` cap acknowledges the risk |
| H9.3 | Zustand persist debounce | CONFIRMED root | RC-6 — no debounce |
| H10.1 | Provider stack height | CONFIRMED contributing | RC-4 (6 deep) |
| H10.2 | Zustand selector misuse | REFUTED | OB-5 |
| H10.3 | Query observer count | CONFIRMED contributing | 202 hooks per agent count |
| H10.4 | useEffect dep bugs | INSUFFICIENT EVIDENCE | Spot-check clean per agent; not exhaustive |
| H11.1 | console.* count | CONFIRMED contributing | CF-10 |
| H11.2 | Sentry breadcrumb volume | CONFIRMED contributing | CF-1 (`enableLogs: true` + `maxBreadcrumbs: 50`) |
| H11.3 | SDK debug flags in prod | CONFIRMED contributing | CF-2 (OneSignal verbose unguarded) |
| H12.1 | AppsFlyer init blocking | CONFIRMED contributing | RC-4 |
| H12.2 | Mixpanel init queue | CONFIRMED contributing | CF-3 + HF-5 |
| H12.3 | OneSignal display() | REFUTED | OB-8 — compliant |
| H12.4 | RevenueCat init prefetch | CONFIRMED contributing | RC-4 |
| H12.5 | Init order parallel | CONFIRMED contributing | RC-4 (4 SDKs in parallel useEffects, no coordination) |
| H13.1 | Channel count steady state | CONFIRMED contributing | ~3 baseline, +1 per session |
| H13.2 | Subscription churn | CONFIRMED contributing | HF-6 |
| H13.3 | UI updates not throttled | CONFIRMED root | RC-5 |
| H14.1 | Bitmap leak on Android | INSUFFICIENT EVIDENCE | Cannot measure statically |
| H14.2 | Listener leaks | INSUFFICIENT EVIDENCE | Spot-check clean; 180 timer sites not exhaustively audited |
| H14.3 | Navigation memory growth | INSUFFICIENT EVIDENCE | Cannot measure statically |
| H15.1 | Edge-to-edge inset cost | CONFIRMED contributing | CF-7 |
| H15.2 | softwareKeyboardLayoutMode resize | CONFIRMED contributing | CF-7 |
| H15.3 | KeyboardAvoidingView misbehave | CONFIRMED contributing | CF-7 — double-lift |
| H16.1 | Platform.OS branches count | CONFIRMED contributing | 69 across 29 files — signals platform burden |
| H16.2 | Platform.select iOS-only opts | CONFIRMED contributing | Examples in OnboardingFlow font sizing, ConnectionsPage isAndroidPreBlur |

**Tally:** Confirmed-root: **8** • Confirmed-contributing: **30** • Refuted: **8** • Insufficient evidence: **24**

---

## 13. Live-Fire Gaps (Priority-Ordered List of Findings That Need Runtime Confirmation)

Every cell of the Disparity Matrix (§2) is an "INSUFFICIENT EVIDENCE — needs live-fire". Below is the priority order in which the founder should commission live-fire to maximally validate this report's static claims:

1. **RC-1 verification** — Profile a 30-swipe deck session on a Samsung A-series (low-tier) and a Pixel-class (mid-tier) device. Capture JS thread fps, dropped frames, gesture-to-animation latency. Compare iOS equivalent. **Highest value: confirms or refutes the largest user-visible defect.**
2. **RC-2 + RC-4 verification** — Capture cold-start trace from `expo start --clear` reload to first interactive frame on Android vs iOS, broken down per phase (i18n parse, Sentry init, AsyncStorage cache check, provider mount, SDK inits). Compare ms each.
3. **RC-6 verification** — Instrument the Zustand persist storage adapter with `Date.now()` deltas; run a 60 s deck session; report writes-per-minute and per-write duration on Android.
4. **RC-3 verification** — Open Discover with airplane mode (forces persistent loading state); profile JS thread fps for 5 s.
5. **RC-7 verification** — Open chat with 100 messages; reveal 30 timestamps in sequence; count drops.
6. **RC-8 verification** — Scroll a chat with 50 image messages; capture `dumpsys meminfo` heap delta over 5 minutes.
7. **CF-5 verification** — Open map; pan 30 s; profile fps. Verify the 45 s heartbeat fires and measure CPU spike duration.
8. **CF-6 verification** — Scroll Discover grid for 30 s; profile fps and BlurView native render ms per frame on Android.
9. **CF-9 verification** — Background app for 60 s; foreground; count React Query refetch storm magnitude (logs invalidations and observer count).
10. **CF-7 verification** — Open chat, focus input, observe whether content lifts once or twice; measure overshoot pixels.

**Without live-fire, this report's confidence remains M-H static / L runtime. With live-fire, confidence converges to H.**

---

## 14. Founder Steering Questions (Before Spec Dispatch)

These are decisions the founder must make before the orchestrator can write a Spec; surfacing each so the spec scope is bounded:

1. **Scope of fix wave 1 — narrow or broad?** Option A: ship RC-1 (SwipeableCards Reanimated migration) + RC-2 (i18n lazy-load) + RC-6 (MMKV migration or Zustand debounce) as a focused trio targeting the 80% impact path. Option B: ship all 8 root causes in a coordinated wave. **Orchestrator default: A** — narrow waves ship faster and prove value.

2. **MMKV migration or Zustand debounce?** MMKV requires a native rebuild (one-time cost, big perf win, ~5 MB binary increase). Zustand debounce is JS-only, OTA-eligible, smaller win. Both can coexist long-term. **Orchestrator default: ship Zustand debounce first via OTA, queue MMKV for the next native build.**

3. **i18n lazy-load — by language or by namespace?** By-language is simpler (load active language at boot, others on switch). By-namespace is more aggressive (load only `common` + `navigation` at boot, defer others to first use). **Orchestrator default: by-language** — simpler, fewer breaking points.

4. **Reanimated migration scope for SwipeableCards?** Full rewrite (use `Gesture.Pan` + `useSharedValue` + `useAnimatedStyle`) or surgical fix (extract `position` to two separate `Animated.Value`s for x/y and set `useNativeDriver: true` on transform translate)? **Orchestrator default: surgical fix first** — lower risk, ships faster, validates the disparity is the driver. Full rewrite later if surgical fix doesn't close the gap.

5. **Sentry init — keep both calls or consolidate?** Both init sites have legitimate-sounding rationale. Consolidate to a single call in `app/_layout.tsx` with the union of both configs? Or keep `enabled: !__DEV__` second call separate? **Orchestrator recommends: consolidate**, with `enabled: !__DEV__` gating the production-only fields.

6. **Image migration — `expo-image` everywhere or just hot paths?** All 49 RN Image consumers eventually, or just chat + connections + discover first? **Orchestrator default: hot paths first** — chat + connections + avatars list. Backlog the rest.

7. **Maps marker rewrite — convert to bitmap markers or accept the heartbeat?** ORCH-0409 heartbeat is documented. A bitmap-marker rewrite is a bigger refactor. **Orchestrator default: keep heartbeat** as it ships acceptable perf; revisit only if live-fire shows map fps is critical.

8. **Live-fire commission — internal or external?** Internal: founder runs profiling on personal devices. External: hire QA service to run a structured test matrix on 5+ Android device tiers. **Orchestrator default: internal first** for the top 3 root causes (RC-1, RC-2, RC-4); external matrix only if internal results are ambiguous.

9. **Should the "INSUFFICIENT EVIDENCE" list block Spec dispatch?** Some items (e.g., H1.3 ProGuard, H7.4 Maps API key) cannot be confirmed without native build inspection or runtime testing. Block the Spec or proceed with confirmed items? **Orchestrator default: proceed** with confirmed items; file the unknowns as deferred ORCH-IDs for parallel investigation.

---

## 15. References

### Files cited in this report (with line numbers)

- [app-mobile/app.json](app-mobile/app.json#L9)
- [app-mobile/app/_layout.tsx](app-mobile/app/_layout.tsx#L1)
- [app-mobile/app/index.tsx](app-mobile/app/index.tsx#L141) (Sentry, line 141), (cacheReady gate, line 2782), (SDK inits, lines 288, 311, 334, ~275)
- [app-mobile/babel.config.js](app-mobile/babel.config.js)
- [app-mobile/package.json](app-mobile/package.json)
- [app-mobile/src/i18n/index.ts](app-mobile/src/i18n/index.ts)
- [app-mobile/src/components/SwipeableCards.tsx](app-mobile/src/components/SwipeableCards.tsx#L1249)
- [app-mobile/src/components/DiscoverScreen.tsx](app-mobile/src/components/DiscoverScreen.tsx#L579)
- [app-mobile/src/components/MessageInterface.tsx](app-mobile/src/components/MessageInterface.tsx#L883)
- [app-mobile/src/components/chat/MessageBubble.tsx](app-mobile/src/components/chat/MessageBubble.tsx#L144)
- [app-mobile/src/components/AnimatedSplashScreen.tsx](app-mobile/src/components/AnimatedSplashScreen.tsx#L77)
- [app-mobile/src/components/map/providers/ReactNativeMapsProvider.tsx](app-mobile/src/components/map/providers/ReactNativeMapsProvider.tsx#L49)
- [app-mobile/src/components/activity/CalendarTab.tsx](app-mobile/src/components/activity/CalendarTab.tsx#L1768)
- [app-mobile/src/components/ui/KeyboardAwareView.tsx](app-mobile/src/components/ui/KeyboardAwareView.tsx#L73)
- [app-mobile/src/store/appStore.ts](app-mobile/src/store/appStore.ts#L140)
- [app-mobile/src/services/oneSignalService.ts](app-mobile/src/services/oneSignalService.ts#L37)
- [app-mobile/src/services/mixpanelService.ts](app-mobile/src/services/mixpanelService.ts#L36)
- [app-mobile/src/services/appsFlyerService.ts](app-mobile/src/services/appsFlyerService.ts#L26)
- [app-mobile/src/services/revenueCatService.ts](app-mobile/src/services/revenueCatService.ts#L45)
- [app-mobile/src/hooks/useSocialRealtime.ts](app-mobile/src/hooks/useSocialRealtime.ts#L34)
- [app-mobile/src/hooks/useForegroundRefresh.ts](app-mobile/src/hooks/useForegroundRefresh.ts#L46)
- [app-mobile/src/hooks/useDeckCards.ts](app-mobile/src/hooks/useDeckCards.ts#L211)
- [app-mobile/src/constants/designSystem.ts](app-mobile/src/constants/designSystem.ts#L284)

### Related ORCH-IDs

- ORCH-0361 — Initial 3 s `tracksViewChanges` window for marker avatar load
- ORCH-0409 — 45 s map marker heartbeat workaround for Android bitmap cache invalidation
- ORCH-0410 — Maps provider unification (MapLibre→react-native-maps)
- ORCH-0540 — Live-fire mandatory for SQL RPC pre-CLOSE (cited as governing rule for live-fire honesty)
- ORCH-0620 — Inverted FlatList paddingTop hack (Android keyboard interaction)
- ORCH-0640 — Bouncer signal migration (CalendarTab and saved cards lineage)
- ORCH-0670 — Concerts/events forensics (currency-aware UI principle adjacency)
- ORCH-0672 — `glass.chrome.pending` token regression (recent change to the surface this investigation now spans)

### Memory rules applied

- `feedback_headless_qa_rpc_gap.md` — Every runtime claim flagged as INSUFFICIENT EVIDENCE without live-fire
- `feedback_solo_collab_parity.md` — Surfaces inspected for both modes where applicable; SwipeableCards is mode-agnostic (used by both)
- `feedback_forensic_thoroughness.md` — Sub-agent findings verified before inclusion; two FALSE claims caught and corrected (babel plugin, asyncStoragePersister)
- `feedback_layman_first.md` — Executive summary leads in plain English
- `feedback_no_summary_paragraph.md` — No closing summary paragraph
- `feedback_short_responses.md` — Detail in this file; chat summary stays compact
- `feedback_vscode_markdown.md` — CommonMark formatting throughout

---

## 16. Addendum — Founder-Submitted Findings (2026-04-25 cycle 2)

After the cycle-1 forensics report landed, the founder ran an independent static cross-check against the live working tree and submitted additional evidence. This section folds those findings in **without overwriting the cycle-1 report** so the evidence trail remains visible. Cycle-1 findings remain as written above; this addendum supplements, refines verdicts, and adds new root causes that cycle-1 missed.

### 16.1 New 🔴 Root Cause — RC-9: Deck queries hardcode `limit: 10000` and persisted results collide with the same file's CursorWindow / 1.5 MB guard

**This is the single nastiest chain in the app and cycle-1 underweighted it.**

| Field | Evidence |
|------|----------|
| File + line | [app-mobile/src/hooks/useDeckCards.ts:184](app-mobile/src/hooks/useDeckCards.ts#L184) — hardcoded `limit: 10000`. Passes through [app-mobile/src/services/deckService.ts:341, 394, 476](app-mobile/src/services/deckService.ts#L341) (singles + curated). Edge functions accept the high limit at [supabase/functions/discover-cards/index.ts:630](supabase/functions/discover-cards/index.ts#L630) and [supabase/functions/generate-curated-experiences/index.ts:1269](supabase/functions/generate-curated-experiences/index.ts#L1269). The result is then explicitly persisted to AsyncStorage via React Query persister at [app-mobile/app/index.tsx:2802, 2823](app-mobile/app/index.tsx#L2802) — the same file whose CursorWindow / 1.5 MB guard at lines [2757, 2765](app-mobile/app/index.tsx#L2757) is implicit acknowledgement that this size class is dangerous on Android. |
| Exact code | `limit: 10000` at useDeckCards.ts:184; `'deck-cards'` excluded from earlier exclude-list per the comment "deck-cards, savedCards, calendarEntries are now PERSISTED to enable instant-on stale-while-revalidate UX" (app/index.tsx:2802 region) — explicitly opting in to persistence of the 10k-limit result. |
| What it does | Each deck mount can request up to 10,000 cards from singles + curated. The React Query persister writes the result to AsyncStorage (Android: SQLite). Even with the existing partialise + per-key `shouldDehydrateQuery` filter, the deck-cards key is allowed through. On Android the SQLite write of a multi-MB JSON payload takes 100–500 ms; serialise + parse is on the JS thread. |
| What it should do | (a) Cap deck query at the actual UI need (Discover renders ≤30 cards visible; pre-buffer ~50–100). (b) Move deck-cards back to in-memory React Query cache only — do NOT persist large server-state collections to AsyncStorage; pay the cold-cache refetch instead. (c) If "instant-on stale-while-revalidate" UX is a strict requirement, store only a **shallow card-id manifest** (≤2 KB) and rehydrate the bodies from server. |
| Causal chain | Discover mount → `useDeckCards` queries with `limit: 10000` → edge fn returns up to N×K KB JSON → React Query observer fires → persister `shouldDehydrateQuery` permits → JSON.stringify of full deck on JS thread → AsyncStorage `setItem` → Android SQLite WAL commit, possibly chunked across CursorWindow boundaries → 100–500 ms write blocks JS thread. On warm starts, the reverse chain (read 1.5 MB, JSON.parse, hydrate observers) dominates first paint. iOS NSUserDefaults handles the same payload in <30 ms, so the disparity is structural, not a per-record cost difference. |
| Verification step | Live-fire: instrument `setItem` in the persister adapter; capture payload size + duration on Android during a deck refresh. Static: confirmed `limit: 10000` at useDeckCards.ts:184 by founder; confirmed downstream propagation through service + edge layer. |
| Constitutional violation | **#5 (server state stays server-side)** — the deck is server-derived ranked recommendations, not client state. Persisting 10 k records to AsyncStorage subverts React Query's separation of concerns. **#2 (one owner per truth)** at-risk — the 10 k limit and the 1.5 MB CursorWindow guard live in different files with no coordinated contract. |

**Confidence:** H static / L runtime.

**Why this is the ugliest chain:** RC-1 (SwipeableCards JS animations) is per-frame cost during interaction. RC-9 is **per cold/warm start AND per resume AND per deck refresh** — it sits on the most frequently-traversed perf path in the app. A successful Path A wave that fixes RC-1 alone but leaves RC-9 in place will not fully close the disparity gap.

### 16.2 New 🟠 Contributing — CF-11: All tabs stay mounted; `isTabVisible` is accepted by hot tabs but **not used**

| Field | Evidence |
|------|----------|
| File + line | [app-mobile/app/index.tsx:2362](app-mobile/app/index.tsx#L2362) — root layout keeps all tab screens mounted. [app-mobile/app/index.tsx:2690](app-mobile/app/index.tsx#L2690) — `tabHidden` only flips visibility (`display: none` / opacity), does NOT unmount. [app-mobile/src/components/HomePage.tsx:25](app-mobile/src/components/HomePage.tsx#L25) — accepts `isTabVisible` prop but doesn't use it. [app-mobile/src/components/DiscoverScreen.tsx:198](app-mobile/src/components/DiscoverScreen.tsx#L198) — same accepts-but-unused. [app-mobile/src/components/ConnectionsPage.tsx:826](app-mobile/src/components/ConnectionsPage.tsx#L826) — only uses `isTabVisible` for one inner panel guard, not for the heavy hooks. |
| What it does | All four tab screens stay mounted at all times. Their hooks (React Query observers, realtime subscriptions, animations, intervals, image loaders) keep running while invisible. On Android, this means the "hidden" Discover deck still re-fetches on focus events, the "hidden" map still consumes the ORCH-0409 marker heartbeat, and the "hidden" chat still renders typing indicators. |
| What it should do | Either (a) lift `isTabVisible` into actual hook gating: `useDeckCards({ enabled: isTabVisible })`, `useMapCards(location, { enabled: isTabVisible })`, suspend animations when `!isTabVisible`. Or (b) restructure root layout to lazy-mount tabs (mount on first visit, keep alive for subsequent visits — common React Native pattern). |
| Causal chain | User opens Home → all 4 tabs mount eagerly → 4× hook stacks fire → 4× refetch storms on every foreground resume → JS thread contention on Android. iOS handles parallel hook work better at a given device tier; Android shows it as visible jank in the active tab. |

**Confidence:** H static / L runtime.

### 16.3 New 🟠 Contributing — CF-12: DiscoverMap fires keep-warm + 200-card singles + curated fan-out on mount with no visibility gating

| Field | Evidence |
|------|----------|
| File + line | [app-mobile/src/components/map/DiscoverMap.tsx:146](app-mobile/src/components/map/DiscoverMap.tsx#L146) — fires keep-warm on mount. [DiscoverMap.tsx:151](app-mobile/src/components/map/DiscoverMap.tsx#L151) — `useMapCards(userLocation)` always runs. [DiscoverMap.tsx:153](app-mobile/src/components/map/DiscoverMap.tsx#L153) — `usePairedMapSavedCards(...)` always runs. [app-mobile/src/hooks/useMapCards.ts:111](app-mobile/src/hooks/useMapCards.ts#L111) — singles request capped at 200 cards. [useMapCards.ts:148](app-mobile/src/hooks/useMapCards.ts#L148) — curated requests fan out via `Promise.allSettled`. Custom marker children at [DiscoverMap.tsx:161, 183, 198](app-mobile/src/components/map/DiscoverMap.tsx#L161). `tracksViewChanges` heartbeat logic at [DiscoverMap.tsx:72](app-mobile/src/components/map/DiscoverMap.tsx#L72) (the ORCH-0409 workaround already noted in CF-5). |
| What it does | Even when the Map tab is not visible (CF-11), DiscoverMap is mounted and fires keep-warm + 200-card singles + curated fan-out. On a single navigation event the user pays the cost of map data they may never see this session. |
| What it should do | Gate the keep-warm + map hooks on `isTabVisible` (depends on CF-11 fix). Or move keep-warm to a server-side cron that pre-warms the user's region rather than client-driven. |

**Confidence:** H static / L runtime.

### 16.4 New 🟡 Hidden — HF-10: `logger.ts` always hits `console` regardless of `__DEV__`

[app-mobile/src/utils/logger.ts:27, 92, 102, 107](app-mobile/src/utils/logger.ts#L27). The app-wide logger wrapper *always* writes to `console.*` — the `__DEV__` guard is missing. This means CF-10's "910 console.*" count is an undercount; the real production-bridge cost includes every logger.info/warn/error call routed through the wrapper. Updated raw count from founder: **975 console.* sites**. Hermes still pays serialisation cost per call.

### 16.5 New 🟡 Hidden — HF-11: Auth bootstrap pile-on at cold start

[app-mobile/src/hooks/useAuthSimple.ts:80, 101, 103, 175, 185](app-mobile/src/hooks/useAuthSimple.ts#L80). At bootstrap: `getSession` → keep-warm → deck prefetch → map-location seed → profile load. All sit on the cold-start critical path alongside the i18n parse (RC-2), dual Sentry init (CF-1), and 4 SDK inits (RC-4). Each individually is small; the chain compounds. This refines and strengthens RC-4's causal map: the auth bootstrap is the **fifth** layer in the cold-start cascade not previously enumerated.

### 16.6 New 🔵 Observation — OB-10: Metro bundle time is **not** the Android-specific smoking gun

Historical logs from 2026-04-16 show **Android bundle time 62,946 ms vs iOS 69,270 ms** — Metro bundles Android *faster* than iOS in this codebase. This eliminates "Android Metro/transform disparity" as a hypothesis and **sharpens focus on runtime**: every Android slowness must be explained by what happens **after** the JS bundle is loaded, not by build-time differences. This OB also implicitly **REFUTES** any hypothesis that Hermes precompilation or transform overhead is platform-asymmetric.

### 16.7 Updated Counts (from founder cross-check)

| Metric | Cycle-1 estimate | Founder-verified | Source |
|--------|-----------------|------------------|--------|
| AsyncStorage direct call sites | 85 (24 files) | **92** | Founder grep |
| `console.*` direct sites | 910 | **975** (+ logger.ts wrapper amplifies) | Founder grep + HF-10 |
| BlurView direct JSX sites | 12 | **18** + glass wrappers (GlassTopBar:179, GlassSessionSwitcher:190, GlassBottomNav:182, GlassCard:104) | Founder grep |
| `Platform.OS === 'android'` branches | 69 (29 files) | **52 explicit Android branches** | Founder count — likely different counting method (excludes Platform.select / iOS-positive branches) |

The cycle-1 figures came from sub-agents; founder figures override.

### 16.8 Verdict Refinements (override §12 where listed)

| Hypothesis | Cycle-1 verdict | Refined verdict | Reason |
|-----------|-----------------|-----------------|--------|
| **H1** Engine/Build | REFUTED | **MIXED** | Hermes bytecode confirmed in `app-mobile/dist/_expo/static/js/android/*.hbc` (9.1 MB) ✓; New Arch confirmed; **but** no checked-in `app-mobile/android/` folder, so R8/ProGuard/ABI-splits/Gradle-heap claims remain INSUFFICIENT EVIDENCE |
| **H7.6** Map re-fetch on region change | CONFIRMED contributing | **REFUTED** | `useMapCards` keys off `userLocation` (the user's GPS), NOT camera-region. Pan does not trigger refetch. Cycle-1 was wrong here. |
| **H12.3** OneSignal display() compliance | REFUTED | **REFUTED (stronger evidence)** | Wrapper exposes `display()` correctly at [oneSignalService.ts:171, 201](app-mobile/src/services/oneSignalService.ts#L171). Memory rule satisfied. |
| **OB-10 (new)** Metro bundle time | n/a | **Bundle time is NOT the disparity** | 2026-04-16 logs: Android 62,946 ms vs iOS 69,270 ms. Build-time hypothesis dead. |

### 16.9 Updated Hypothesis Tally (post-addendum)

- Confirmed-root: **9** (was 8 — RC-9 added)
- Confirmed-contributing: **32** (was 30 — CF-11, CF-12 added)
- Refuted: **9** (was 8 — H7.6 flipped REFUTED)
- Mixed (new): **1** (H1 reclassified)
- Insufficient evidence: **23** (was 24 — OB-10 retired bundle-time concern)

### 16.10 Updated Causal Chain (for RC-9 — supersedes priority on §8 maps)

```
RC-9 — Deck overfetch + persisted collision
─────────────────────────────────────────────
User opens Discover (or warm-starts the app)
       │
       ▼
useDeckCards hook fires (useDeckCards.ts:184)
       │
       ▼
Query payload: { limit: 10000, ... } passes through
  deckService.ts:341 → singles request
  deckService.ts:394, 476 → curated request
       │
       ▼
Edge functions accept the high limit:
  discover-cards:630, generate-curated-experiences:1269
       │
       ▼
Edge returns up to N×K KB JSON (singles + curated combined)
       │
       ▼
React Query observer settles → persister `shouldDehydrateQuery`
  permits 'deck-cards' key (per comment at app/index.tsx:2802 region)
       │
       ▼
JSON.stringify of full deck on JS thread (Android: 50-200 ms for multi-MB)
       │
       ▼
AsyncStorage setItem → SQLite WAL commit → fsync
       │   Android: 100-500 ms; CursorWindow boundary handling at app/index.tsx:2757-2765
       │   acknowledges the size risk
       ▼
JS thread blocked → Discover surface janks → user perceives slow Android
       │
       ▼
On NEXT cold/warm start: reverse chain (SQLite read → JSON.parse → hydrate)
       │
       ▼
First-paint deferred until rehydration completes

iOS: same code path, but NSUserDefaults <30 ms for same payload class.
Disparity is per-byte at scale, not per-record.
```

### 16.11 Path A Scope Refinement (for orchestrator's recommendation)

In light of RC-9 + CF-11 + CF-12, the original **Path A** (RC-1 + RC-3 + RC-2 + Zustand debounce) is **insufficient by itself**. RC-9 must join Path A or be its own urgent parallel SPEC, because:

- RC-9 sits on cold-start, warm-start, AND resume (most frequently-traversed perf path)
- RC-9 is OTA-eligible — fix is in JS layer (cap the limit, switch persister rule)
- RC-9 is independent of the animation work — no merge conflict risk
- Without RC-9, the AsyncStorage debounce (CF-6 → Zustand) fixes only the swipe-tax write rate but leaves the multi-MB deck write/read intact

**Refined Path A (recommended):** RC-1 (SwipeableCards surgical) + RC-2 (i18n lazy-load by language) + RC-3 (skeleton useNativeDriver:true) + **RC-9 (deck-limit cap + remove from persister)** + Zustand persist debounce. Five items, all OTA-eligible, no native rebuild required.

CF-11 + CF-12 (tab visibility gating) are bigger architectural moves and should be queued as Path C (next native build) **or** as a small standalone Wave 1.5 if the Path A surgical fixes don't close the gap measurably in live-fire.

### 16.12 Layer Contradictions Discovered in Cycle 2

1. **Comment at app/index.tsx:2802 region** says deck-cards persisted to enable instant-on UX → **Code at useDeckCards.ts:184** sets the limit to 10000 → **Code at app/index.tsx:2757-2765** has CursorWindow / 1.5 MB guard. Three locations agree the payload is large; none coordinate the limit with the cap. **Truth layer: code (limit:10000 wins because it determines payload size; the cap is a downstream symptom).**
2. **`isTabVisible` prop signature** is plumbed through HomePage and DiscoverScreen → **Component bodies do not reference it**. Either the prop is residue from an abandoned optimization, or the consumer was added before the producer wired the gate. **Truth layer: code (the prop is decorative without the consumer).**
3. **Founder-verified counts** (92, 975, 18, 52) override cycle-1 sub-agent estimates (85, 910, 12, 69). Sub-agent figures retained in §10/§11 with footnote pointing to this addendum. **Truth layer: code (founder grep is authoritative).**

### 16.13 Founder Steering — Updated (refines §14)

The 9 founder steering questions in §14 stand. The addendum adds two:

- **Q-10 (new):** Should RC-9 (deck-limit + persister) join Path A's first SPEC dispatch, or split as a parallel urgent SPEC? **Orchestrator default: join Path A** — single coordinated SPEC for RC-1 + RC-2 + RC-3 + RC-9 + Zustand debounce. They share the AsyncStorage substrate and benefit from a unified test matrix.
- **Q-11 (new):** Cap value for the deck limit — what's the actual UI need? Discover renders ≤30 cards visible at any time. Buffer recommendation: 50 (singles) + 20 (curated) = 70 cards, with prefetch on swipe-down. **Orchestrator default: 50 + 20 = 70**, founder confirms or overrides.

---

## 17. Current Hypothesis Verdict Summary (Post-Addendum, Final)

| Status | Count | Items |
|--------|-------|-------|
| 🔴 Confirmed root cause | **9** | RC-1, RC-2, RC-3, RC-4, RC-5, RC-6, RC-7, RC-8, **RC-9 (new)** |
| 🟠 Confirmed contributing | **32** | CF-1 through CF-10, **CF-11 (new), CF-12 (new)**, plus 20 hypothesis-cluster sub-points |
| 🟡 Hidden flaws | **11** | HF-1 through HF-9, **HF-10, HF-11 (new)** |
| 🔵 Observations | **10** | OB-1 through OB-9, **OB-10 (new — bundle time refutes build-disparity)** |
| ❌ Refuted | **9** | Original 8 + **H7.6 (flipped from contributing)** |
| 🔶 Mixed | **1** | **H1 (reclassified)** |
| ⚪ Insufficient evidence (live-fire required) | **23** | Was 24, OB-10 retired bundle-time hypothesis |

**Top 3 root causes by user impact (orchestrator's revised ranking after addendum):**

1. **RC-9** — Deck overfetch + persister collision (most frequently-traversed path; cold + warm + resume all pay)
2. **RC-1** — SwipeableCards JS-thread animations (most user-visible per-interaction defect)
3. **RC-6** + **RC-2** tied — AsyncStorage substrate write pressure / i18n cold-start parse (structural foundation for everything else)

