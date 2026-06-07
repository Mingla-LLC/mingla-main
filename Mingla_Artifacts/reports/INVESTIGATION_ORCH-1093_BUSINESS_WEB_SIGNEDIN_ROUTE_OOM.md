# INVESTIGATION - ORCH-1093 Business Web Signed-In Route OOM

Date: 2026-06-06
Skill: forensic-mingla
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1093-[business-web-signedin-route-oom]`
Branch: `ORCH-1093-business-web-signedin-route-oom`
Registration commit: `510fa24a0`

## Verdict

ORCH-1093 is a real signed-in mobile-browser memory failure, not a stale deploy, missing route, or route-specific Trips bundle problem. Production `/home` can render signed in on Samsung A72 Chrome, but direct `/hub/trips` dies with Chrome `Aw, Snap!` and logcat `V8 javascript OOM` in `CrRendererMain`. The direct Expo route still eagerly loads about 2,884,148 raw bytes before route work: `__common` about 1,881,365 bytes plus `index` about 998,981 bytes plus runtime. `/hub/trips` itself is only about 12,305 raw bytes, so the crash is caused by the signed-in Expo app boot/shared shell crossing the phone renderer memory ceiling before the lightweight Trips route can matter.

## Ledger and Constraints Factored

- `COMMS_LEDGER.md` was read before investigation work. Active `ALL` WARN/FYI entries were factored; no open ORCH-1093-specific BLOCK entry required action.
- No ledger edit was made because this investigation did not discover cross-ORCH impact requiring a new comms entry.
- Deployment discipline from COMMS remains binding: no worktree deploys, no OTA/reap/merge in this phase, preserve ORCH-1091 cache/chunk recovery, preserve ORCH-1092 provider-neutral payout copy and native-module quarantine.

## Inputs Read

- `Mingla_Artifacts/reports/RUNTIME_PROOF_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`
- ORCH-1083 investigation/spec/implementation/QA/close artifacts for the original 9.24 MB business web load failure
- ORCH-1085 code-splitting spec and route-family inventory
- ORCH-1087 route-gate investigation/spec/QA/close
- ORCH-1089, ORCH-1090, ORCH-1091 Create/auth/cache repair artifacts
- ORCH-1092 investigation/spec/implementation/QA/retest/close artifacts
- Authoritative source paths named in the dispatch, including root layout, tab layout, `/hub/trips`, static Home, Vercel, Metro, injection, chunk reload guard, and CI guards
- Current official docs checks:
  - Expo async routes: https://docs.expo.dev/router/web/async-routes/
  - Expo static rendering: https://docs.expo.dev/router/web/static-rendering/
  - Chrome page crash help: https://support.google.com/chrome/answer/95669
  - Chromium OOM investigation: https://chromium.googlesource.com/chromium/src/+/main/docs/memory/oom.md

## Runtime Evidence

Primary runtime proof from ORCH-1093:

| Surface | Device/browser | Result |
| --- | --- | --- |
| `/home` | Samsung Galaxy A72 Chrome 148.0.7778.215, signed in as `sethogieva@gmail.com` | Renders signed-in static Home with tabs |
| `/hub/trips` | Same device/browser/session | Chrome `Aw, Snap!`, blank/crash |
| logcat | Same attempt | `V8 javascript OOM`, `CrRendererMain`, sandboxed renderer death |

The Chrome support page classifies `Aw, Snap!` as a page loading failure/crash. Chromium OOM docs describe renderer OOM as a process-level failure that can come from V8/rendering memory pressure rather than the exact final allocation site being the root culprit. That matches the observed `CrRendererMain` plus V8 OOM pattern.

## Build and Chunk Evidence

Production direct Expo routes currently load these eager scripts before route code:

| Script | Raw bytes |
| --- | ---: |
| `__expo-metro-runtime-0c48b0beee2d3ce6030b475fcc5b1846.js` | 3,802 |
| `__common-601546bb2451b3635cff8126e8ea20a5.js` | 1,881,365 |
| `index-673ede93709fe16629641db487c64add.js` | 998,981 |
| Total before route chunk | 2,884,148 |

Dynamic route chunks found from the current production route map:

| Route family | Chunk | Raw bytes | Meaning |
| --- | --- | ---: | --- |
| `/hub/trips` | `trips-cb88df3c5fc3fa418bee5b8f1628e6b2.js` | 12,305 | Trips leaf route is not the large payload |
| `/(tabs)/hub/_layout` | `_layout-a78b8c6c40b7abde401dd8320c62f3c9.js` | 8,033 | Hub layout is small |
| `/(tabs)/_layout` | `_layout-0077ed0b6cef8c8047b2b5b89c89689b.js` | route-shell chunk | Shared tab shell still pulls common dependencies |
| `/hub/events` | `events-eed...js` | 18,456 | Small leaf route |
| `/account` | `account-09656...js` | 8,582 | Small leaf route |
| `/marketing` | `index-2957...js` | 37,950 | Small/moderate overview |
| `/marketing/campaigns/compose` | `compose-29cc...js` | 570,302 | Large restored route, needs stricter proof |
| `/ari` | `ari-1e960...js` | 44,354 | Not restored by ORCH-1092 |
| `/event/create` | `create-648...js` | 4,522 | Create entry route is small |

Static analysis of fetched production chunks found that `__common` contains shared app chrome/action surfaces such as `BottomNav`, `GlobalSearchSheet`, global search indexing code, `BrandSwitcherSheet`, `UniversalCreatorSheet`, `ShareModal`, `OfferingManageSheet`, public events/trips services, and theme font thunks. The route chunk for Trips contains the expected Trips list code and no evidence that Trips itself is the heavy chunk.

## Source Evidence

| Source | Evidence |
| --- | --- |
| `mingla-business/app.json` | `web.output` remains `"single"` and Expo Router `asyncRoutes.web` is enabled. This preserves Expo Web and route splitting, but production direct routes still include eager root/common/index scripts. |
| `mingla-business/app/_layout.tsx:116-151` | ORCH-1092 signed-out recovery only protects `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, and `/account`, and only when no stored Supabase session token is present. `/hub/trips` is absent. |
| `mingla-business/app/_layout.tsx:523-584` | Any signed-in direct route bypasses the outer recovery and mounts the full provider tree: gesture/safe-area, error boundary, query client, auth provider, keyboard root, then `RootLayoutInner`. |
| `mingla-business/app/(tabs)/_layout.tsx:19-49` | Tab layout statically imports `BottomNav`, `DesktopCanvas`, `CommandPalette`, and `GlobalSearchSheet`. Even when `CommandPalette` only renders on wide desktop, the static import can contribute to web shared/eager chunks. |
| `mingla-business/app/(tabs)/_layout.tsx:137-148` | `GlobalSearchSheet` mounts once for every tab route. This is useful product behavior but expensive for phone route entry because it makes global search available before the user asks for it. |
| `mingla-business/app/(tabs)/hub/trips.tsx:38-43` | Trips statically imports `ShareModal` and `OfferingManageSheet`, which are only needed after tapping manage/share actions. They should not be part of first entry for a Trips list. |
| `mingla-business/public/home.html` | `/hub/trips`, `/hub/experiences`, `/ari`, and payout remain shelled from static Home. Direct URL access can still hit full Expo route outside static Home protections. |
| `mingla-business/scripts/inject-mobile-blur-css.mjs` | ORCH-1091 chunk recovery/cache-bust markers are present and must remain untouched. |
| `mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs` | Current guard checks static Home restoration, signed-out recovery, cache headers, forbidden native modules, and ORCH-1092 markers, but it does not enforce a signed-in phone-route boot budget or a physical-device memory gate. |

## Candidate Causes

### C1 - Confirmed root cause: signed-in Expo route boot/shared shell exceeds phone renderer memory headroom

Evidence:

- Physical Android Chrome crashes with `V8 javascript OOM` on direct signed-in `/hub/trips`.
- Direct Expo route eager payload is about 2.88 MB raw before route work.
- `/hub/trips` route chunk is only about 12 KB raw, so the leaf route cannot explain the memory blow-up by size.
- `__common` contains shared shell/action/global-search modules unrelated to first paint of a Trips list.
- Expo async routes docs confirm route files are split and loaded asynchronously, but static rendering/server navigations include layout routes leading to the leaf route in the initial response. This explains why leaf chunks are split while the root/common/tab shell still matters.

### C2 - Confirmed contributing cause: signed-in session bypasses the ORCH-1092 outer recovery and mounts the full provider tree

Evidence:

- `app/_layout.tsx` only shows `Orch1092SignedOutRecovery` when the normalized path is in `ORCH_1092_SIGNED_OUT_ROUTES` and `hasStoredSupabaseWebSession()` is false.
- A stored `sb-*-auth-token` containing `access_token` is enough to bypass the recovery path.
- The ORCH-1092 QA close explicitly left signed-in useful first screens as a manual gate. ORCH-1093 now proves that gate is not globally satisfied.
- The observed user is signed in on `/home`; therefore direct `/hub/trips` follows the expensive signed-in route path.

### C3 - Likely contributing cause: global search/command/action sheets are statically attached to all tab routes

Evidence:

- `(tabs)/_layout.tsx` statically imports `GlobalSearchSheet` and `CommandPalette`; `GlobalSearchSheet` mounts on every tab route.
- Production `__common` contains global search/sheet/index code.
- `/hub/trips.tsx` statically imports `ShareModal` and `OfferingManageSheet`, which are needed only after user action.
- The first useful Trips screen needs brand/session, trip list data, filters, list cards, and bottom nav. It does not need QR/share UI, offering manage sheet bodies, full global search index, desktop command palette, or account switcher/delete/create sheets at initial route entry.

### C4 - Lower-priority contributor: current CI budgets protect old regressions, not signed-in phone route entry

Evidence:

- ORCH-1083 guard allows the post-ORCH-1085 static Home case to have `__common` up to 2,250,000 bytes, which no longer proves signed-in direct routes are phone-safe.
- ORCH-1092 guard verifies signed-out recovery and native-module quarantine, but signed-in route memory safety is only a manual condition.

## Non-Causes Disproven

| Hypothesis | Disproof |
| --- | --- |
| Vercel route is missing or 404 | Production direct `/hub/trips` returns the Expo HTML with eager scripts; the crash happens in Chrome renderer after load begins. |
| Stale chunk cache is the primary issue | ORCH-1091 `?v=orch1091`, chunk recovery, and must-revalidate headers are present. The observed failure is `V8 javascript OOM`, not a missing/deleted chunk error. |
| Trips route chunk is too large | The Trips leaf chunk is about 12 KB raw; this is far below the eager root/common/index payload. |
| Forbidden native modules re-entered the eager path | ORCH-1092 guards currently inspect eager chunks for forbidden native module strings, and the production evidence points to V8 OOM rather than a native-module shim crash. |
| Static Home sign-in state is proof the Expo route is safe | Static Home can display signed-in state without mounting the signed-in Expo provider/tab route path that crashes on direct `/hub/trips`. |
| A static shell is an acceptable final fix | The dispatch explicitly forbids calling a static shell the final fix. Static Home shelling remains a fail-closed mechanism only; restored routes require real Expo Web route proof on physical Android Chrome plus mobile Safari. |

## Six-Field Root Cause Proof

### Proof 1 - Shared signed-in boot payload crashes before Trips work

1. File/line: `mingla-business/app/_layout.tsx:523-584`; `mingla-business/app/(tabs)/_layout.tsx:19-49,137-148`; production `index.html` eager scripts.
2. Current behavior: signed-in direct `/hub/trips` loads root providers plus shared tab shell/global surfaces and about 2.88 MB raw eager JS before route work.
3. Expected behavior: a signed-in phone route should reach a useful first screen or explicit fail-closed recovery without loading nonessential route action surfaces, desktop command UI, global search body, or unrelated sheet bodies.
4. Causal chain: stored Supabase session bypasses signed-out recovery -> root/provider/tree and tab layout mount -> eager/common JS and shared tab dependencies allocate in the renderer -> Samsung A72 Chrome renderer hits V8 OOM before Trips first screen can settle.
5. Proof: `/hub/trips` leaf chunk is only about 12 KB, while `__common` plus index is about 2.88 MB raw before route work; logcat confirms V8 OOM in `CrRendererMain`.
6. Validation: reduce eager phone-route payload and defer nonessential shared/action modules; rebuilt export must pass strict eager/common budgets, and physical Android Chrome plus mobile Safari must load signed-in `/hub/trips` without `Aw, Snap!`, blank screen, or OOM logs.

### Proof 2 - ORCH-1092 recovery was signed-out only and cannot certify signed-in routes

1. File/line: `mingla-business/app/_layout.tsx:116-151,529-548`; `mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs:124-165`.
2. Current behavior: ORCH-1092 recovery is only for four approved routes and only when no stored Supabase token exists; CI runtime smoke asserts signed-out recovery, not signed-in route memory.
3. Expected behavior: restored mobile-browser routes should have separate signed-out recovery, signed-in useful-screen proof, and fail-closed handling for unproven routes.
4. Causal chain: `/home` reads localStorage and shows a signed-in label -> direct `/hub/trips` has a stored token -> recovery path skipped -> full signed-in route tries to boot -> V8 OOM.
5. Proof: ORCH-1092 QA marked signed-in useful screens as a manual gate and instructed routing back if blank/crash/spin appears; ORCH-1093 supplies that crash proof.
6. Validation: add CI guards for signed-in route boot budgets and manual physical browser gates for every restored route; static Home may only reopen `/hub/trips` after both Android Chrome and mobile Safari signed-in evidence exist.

## Affected Surfaces

In scope for ORCH-1093:

- Business web production Expo route entry for signed-in phone browsers.
- `/hub/trips` direct route and eventual static Home restoration decision.
- Previously reopened ORCH-1092 direct routes that still need signed-in proof: `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, `/account`.
- `/event/create` because ORCH-1089/1091 made Create reachable and it shares the same signed-in route-entry risk pattern.
- Root providers, tab layout, shared search/command/action sheet surfaces, route chunk budgets, and CI/performance guards.

Not in scope for implementation in ORCH-1093:

- Abandoning Expo Web or switching to static output as the final fix.
- Deploying, merging, OTA publishing, or reaping branches.
- Provider-specific payout copy changes or Stripe-only language changes; preserve ORCH-1092 provider-neutral payout copy.
- Reopening `/hub/experiences`, `/ari`, or payout management from static Home without separate proof/spec.
- Changing backend/RLS/payment provider APIs.
- Treating a static shell as the final route restoration.

## Deterministic Validation Plan

1. Rebuild business web export after implementation from the ORCH-1093 branch.
2. Run the existing chain through `npm run test:orch-1092` to preserve ORCH-1089/1091/1092 guarantees.
3. Add and run `npm run test:orch-1093` with strict checks:
   - direct-route eager payload raw bytes <= 2,100,000;
   - eager `__common` raw bytes <= 1,200,000;
   - `/hub/trips`, `/hub/events`, `/account`, `/marketing`, and `/event/create` leaf chunks stay within route budgets;
   - composer remains explicitly budgeted and gated because it is currently about 570 KB raw;
   - eager chunks do not contain forbidden native modules or newly forbidden first-entry modules such as global search sheet body, desktop command palette, QR renderer, Stripe/Paystack/connect SDK bodies, media picker/file system, offering manage sheet body, and account destructive/switcher sheet bodies.
4. Run local Playwright mobile-profile smokes against the exported `dist` for signed-out recovery and seeded-session route entry. This catches blank screens and hard JS errors but is not sufficient as final memory proof.
5. Physical Android Chrome proof:
   - sign in as a real business account;
   - load `/home`;
   - direct-load `/hub/trips`, `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, `/account`, and `/event/create`;
   - verify useful first screen or intentional fail-closed route recovery within 8 seconds;
   - capture logcat and confirm no `V8 javascript OOM`, `Aw, Snap!`, or renderer death.
6. Mobile Safari proof:
   - repeat the signed-in direct-route sequence on mobile Safari;
   - verify no blank screen, crash, infinite spinner, or broken recovery.
7. Only after both physical Android Chrome and mobile Safari proof may a route be marked restored or linked from static Home.

## Final Finding

The stable fix is a signed-in route-entry boot diet plus proof gates, not another static shell and not a wholesale Expo Web retreat. The implementation must reduce shared eager JS, lazy-load nonessential tab/action/global surfaces, add signed-in route budgets, and require physical Android Chrome plus mobile Safari proof before `/hub/trips` or any other risky route is considered restored.
