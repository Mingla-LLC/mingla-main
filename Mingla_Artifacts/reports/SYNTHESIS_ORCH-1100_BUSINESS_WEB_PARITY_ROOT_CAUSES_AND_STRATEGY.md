# ORCH-1100 — Business Web Parity: Consolidated Root Causes + Fix Strategy

Date: 2026-06-07
Mode: INVESTIGATION + AUDIT only (no fixes shipped). Seth-directed: "find out why first, then strategy."
Method: 5-front investigation — 1 live-device runtime (CDP on physical Samsung SM-A725F) + 4 source traces, all re-grounded on real `origin/main` (HEAD `129df41e1`).
Source reports: `INVESTIGATION_ORCH-1100_DEVICE_RUNTIME.md`, `_FRONT_A_BRAND_HYDRATION.md`, `_FRONT_B_GLASS_TRANSPARENCY.md`, `_FRONT_C_COMPOSER_INTERACTION.md`, `_FRONT_D_PARITY_AUDIT_V2.md`.

## Process note (honesty)
The first parity pass was contaminated: source agents read the shared anchor checkout, which was 9 commits behind origin/main, and falsely concluded "ORCH-1098 isn't on main." Re-grounded against actual origin/main in a clean worktree. Corrected facts: ORCH-1098 DID land (home.html deleted, static-home redirect deleted, BottomNav web fix, WebSafeGestureDetector). BUT the mobile-web **route firewall was NOT retired** — it was intentionally kept and only ~12 routes were promoted. My ORCH-1098 close overstated "the app works on phone."

## The 5 proven root causes (all current on main; device-confirmed where noted)

### RC-1 — Degraded shell: signed-in but no brand → empty Home + 2-tab nav (DEVICE-PROVEN)
- **Trigger:** multi-tab GoTrue auth-token Web-Lock contention. With many tabs on the same origin (observed: 9 tabs, 7 same-origin), the per-origin Navigator lock `lock:sb-…-auth-token` is orphaned; `getSession()` times out at 3s (`AuthContext.tsx:195-212` `[auth] bootstrap-timeout`).
- **Code weakness:** the brand-load query chain (`useBrands`, auth-gated `useBrands.ts:136`) only runs once the session RESOLVES. On timeout, the app renders signed-in chrome from the stored session but the brand fetch **never fires** (device: only `stripe-mode` calls; `/rest/v1/brands` absent). Amplifier: `useCurrentBrand` auto-clears `currentBrandId` when the ungated `useBrand` detail returns null during a token gap (`useCurrentBrand.ts:43-47`). No Zustand hydration flag → first-frame null read as "no brand."
- **Nav collapse mechanism:** no brand → `useCurrentBrandRole(null)` → role null → rank 0 → `visibleTabsForRank` keeps only rank-0 tabs (Home, Account); Hub/Blast/Ari filtered (`navTabGate.ts`).
- **Proof it's the lock, not auth-expiry:** closing the 8 extra tabs + identical reload → full hydration (38 calls, brand loaded, 5 tabs back). 3/3 reproducible.

### RC-2 — Transparent sheets on phone web (DEVICE-PROVEN)
- Blur-kill (`inject-mobile-blur-css.mjs`) forces `backdrop-filter:none` on ≤767px. Components gate on `CSS.supports("backdrop-filter")` (returns true; the `!important` media rule defeats it at runtime) → render a glass panel whose blur is stripped → only a ~6% tint over a transparent base. Device: "Switch brand" panel `background-color: rgba(0,0,0,0)`.
- **Gap:** only `SheetMobile.tsx` has the `windowWidth<768` opaque fallback. `TopSheet` (brand switcher — worst), `GlassChrome`, `Toast`, `BlastCustomersCta`, `AiDisclosureModal` lack it. ("Pick an audience" = SheetMobile renders correctly opaque — proves the fix pattern works.) The Android `ANDROID_GLASS_USES_OPAQUE_FALLBACK` policy was never generalized to the web blur-kill.

### RC-3 — Composer Back dead + body untappable (DEVICE-PROVEN; pre-existing, newly reachable)
- **Back:** `compose.tsx:415-448` `navigation.addListener("beforeRemove")` → `preventDefault()` then `Alert.alert(...)`. `Alert.alert` is a no-op on react-native-web → nav stays cancelled, no Save/Discard dialog → button looks dead. (Hardware back works.) Device: button receives its own tap, click changes nothing. 2/2.
- **Body:** `ComposerV2Editor.tsx:153-199` fixed numeric `bodyHeight` (`CHROME_CONTENT_PX=376`, iPhone-tuned) + no ScrollView. On web the extra TopBar+MarketingSubNav+URL bar overflow the budget; the `contenteditable` collapses to a 23px strip; the rest is a non-editable wrapper that swallows taps. NOT an overlay (device hit-tested).

### RC-4 — Mobile-web route firewall blocks ~85/97 routes (THE dominant parity gap) (DEVICE-corroborated)
- `app/_layout.tsx:137-150` `ORCH_1093_SIGNED_IN_ROUTE_STATUS` whitelists ~12 routes as `"interactive"`; everything else defaults to `"static-section"` (`?? "static-section"` L188-193) → `Orch1093MobileRouteRecovery` renders a "staying protected → return Home" stub on mobile web (L406-410, L668-695). Gated by `isMobileWebRouteEntry()` so **desktop web is unaffected.**
- ORCH-1098 intentionally KEPT the firewall mechanism ("promote one route at a time after device proof") and promoted only ~12. So the bulk of the business app — all manage screens, checkout, deep settings, invite-acceptance, public pages — still shows the stub on a phone browser. Device confirmed: `/blast` deep-link → "route staying protected → Home."

### RC-5 — Native modules not web-quarantined → hard breaks on BOTH web platforms
- Door scanner: `scanner/index.tsx:585` mounts `expo-camera` with zero Platform guard (also tracked as ORCH-1099).
- Buyer checkout intake file upload: `platformImagePicker.ts` stub, no `<input>` fallback (`IntakeFilePickerChooserSheet.tsx`).
- Group-chat image attach: stub picker no-op (`GroupChatPanel.tsx:86`).
- (Counter-examples that WORK: brand avatar, edit-profile avatar, CoverPicker all branch to a real web `<input>`/`pickBrowserFiles` — the correct pattern exists, just not applied everywhere.)

## The systemic theme (why this keeps happening)
The business app is Expo/React-Native retrofitted onto web. The recurring failure CLASSES are: (a) reanimated/gesture on web, (b) native modules not web-gated, (c) glass/blur with no web fallback, (d) native-tuned fixed-height/no-scroll layouts on web, (e) the firewall masking each route's true state, (f) auth/state-hydration timing on web. "Every button works" requires retiring the firewall AND closing each failure class systemically AND verifying per-route on a real device — not whack-a-mole.

## Fix strategy (phased, leverage-ordered — for approval, NOT yet a spec)

**Phase 1 — the 4 named symptoms (fast, low-risk, high-visibility):**
1. RC-1: fire the brand-load from the stored session even when `getSession()` times out (decouple brand hydration from the lock); add a Zustand hydration flag (first-frame null = loading, not "no brand"); harden the auto-clear; mitigate the GoTrue lock (acquire-timeout / single-tab leader). Fixes the degraded shell for everyone, not "close your tabs."
2. RC-2: extract a shared `shouldUseRealBlur(width)` helper + opaque fallback, apply to the 5 gapped glass components.
3. RC-3: web-split the composer Back dirty-guard (real in-tree confirm or rely on autosave) + wrap the composer body in a ScrollView/flex on web.

**Phase 2 — retire the route firewall = true parity (the big one):**
4. Systematically promote the ~85 firewalled routes to interactive, verifying EACH boots signed-in on a real device; fix the recurring failure class each one hits as it surfaces (reanimated→WebSafeGestureDetector, native module→web-gate, glass→opaque fallback, fixed-height→scroll). Keep a per-route guard ONLY where a route genuinely still crashes, with the offender logged. This is the bulk of "no surprises."

**Phase 3 — native-module quarantine (RC-5):** standardize the proven web `<input>`/`pickBrowserFiles` pattern across scanner camera, checkout intake upload, group-chat attach.

**Phase 4 — lock it in / prevent recurrence:** strict-grep gates (no BlurView without width-aware opaque fallback; no GestureDetector without WebSafeGestureDetector on web; no native picker without a web branch; every new route declares a firewall status) + a Playwright/device web-parity harness that boots every route signed-in on a mobile profile and asserts no-crash + real content. This makes "every button works" enforced, not hoped.

## Recommended sequencing
Phase 1 first (days) for immediate relief on the bugs you reported, in parallel with standing up the Phase 4 device-parity harness (so Phase 2 has a safety net). Then Phase 2 as a controlled, device-verified sweep (the largest effort). Phase 3 alongside Phase 2. This time, the per-route device harness up front is the discipline that avoids both the original 13-ORCH detour AND silent parity gaps.
