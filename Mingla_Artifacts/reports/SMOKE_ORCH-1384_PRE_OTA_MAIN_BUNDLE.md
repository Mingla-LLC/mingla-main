# SMOKE — ORCH-1384 pre-OTA cumulative main-bundle health gate

**Verdict: GO** (0 P0, 0 P1, 0 P2 · 2 P4 cosmetic/observation)
**Tested sha:** `399682219` (origin/main HEAD, fetched 2026-07-18) — the dispatch cited `f551e7911`; main has since advanced with ORCH-1392 (SQL/edge-only grants, no JS-bundle impact).
**Runtime target:** business app 1.1.2 / expo 54 (matches the live store binary post-ORCH-1386 revert).
**Device:** physical Samsung SM-A725F `R58R54YV7JT`, Android 14, dev client `com.sethogieva.minglabusiness` versionCode 33 / versionName 1.1.2, built 2026-07-14 (same native layer as the store 1.1.2 binary), pointed at a local Metro serving current-main JS.
**Session:** `npm ci` in `mingla-business` (was empty); Metro `expo start --dev-client` with `MINGLA_STRIPE_MODE=live` + a **dummy** `pk_live_` publishable (prefix-only handshake guard — no real key, zero charge risk); driven over adb + uiautomator + logcat.

Merges in the cumulative bundle since the last native build: ORCH-1384 (partner UI), ORCH-1385 (workspace-dep declarations), ORCH-1386 (expo 57→54 revert), ORCH-1387 (wallet types), ORCH-1388 (backend reconciler), ORCH-1392 (SECURITY DEFINER grants).

---

## Per-item results

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | App boots + loads (no red-box / white-screen; home renders) | **GO** | `02_boot_after_pklive.png`; bundle "Android Bundled index.js (4894 modules)" with **zero "Unable to resolve"** (ORCH-1385 workspace-deps resolved) |
| 2 | Auth — partner session attaches, authed screens populate | **GO** | logcat `INITIAL_SESSION hasSession:true hasUser:true` + `boot-session-probe: session valid`; Home/Account/Hub/Notifications all populate |
| 3 | New ORCH-1384 Brands surface (add-CTA, lazy detail sheet loads on tap, verbs present) | **GO** | `04_partner_brands_list.png`, `05_detail_sheet_cancelled_lazy.png`, `06_detail_sheet_pending_verbs.png` |
| 4 | One payment-touching surface renders (no crash; no payment authorized) | **GO** | ORCH-1387 runtime change is transpile-erased (see below) + buyer public/checkout-adjacent route renders clean `13_public_page_checkout_adjacent.png` |
| 5 | Core screens render (Home, Hub, Ari, Account, notifications, event detail) | **GO** | `01`,`03`,`07`,`08`,`09`,`11`,`12`,`13` |
| 6 | Logcat clean during the walk | **GO** | only benign warnings (see Discoveries) — no FATAL, no red-box-triggering error |

### Item 1 — Boot
Two "Render Error" screens appeared BEFORE the correct session and are **not** code bugs: (a) a stale "Could not load bundle" from a dead Metro (cleared once Metro ran); (b) the intended **pk_live fail-close** `stripeModeHandshake.ts:34` — "Supabase backend is in live mode … app built with a pk_test_ key" — which cleared once the session used a `pk_live_` prefix. Both are environment/config, expected. After correction the app boots straight to the authed Home dashboard.

### Item 2 — Auth
Persisted partner session (`rambleawaypod@gmail.com`) survived the JS reload and attached cleanly. Observation (not a blocker): the `auth resolution-hard-ceiling` (7000ms, ORCH-1254 safety valve) fired despite a valid session, but the end state rendered correctly authed. Flagged as P4 discovery (slow cold-start auth resolution on this device).

### Item 3 — ORCH-1384 Brands surface
- Persistent header `[+]` add-CTA "Set up another partner brand" renders in the populated list state (F-1 fix).
- Rows in correct priority order: **Rockstar Vibes / Awaiting Owner** → **Cancelled** → **Disconnected**, each with status chip + reason subtext.
- The lazy `PartnerLinkDetailSheet` (`lazy(() => import(...))` under `<Suspense>`) **loads on tap with zero chunk-load errors** — verified on BOTH the cancelled read-only row AND the pending row.
- All verbs present and correctly styled: **Resend invite** (primary), **Correct email & resend**, **Open brand dashboard** (dashboard-nav-as-verb), **Cancel invite** (destructive), **Close**.
- **No verb tapped — Rockstar Vibes not mutated** (hard fence honored; sheets opened read-only for observation only).

### Item 4 — Payment surface
Definitive evidence: ORCH-1387's ONLY runtime-surface change (`packages/payments-native/StripeNativeProvider.tsx`) is a **transpile-erased type annotation** (`}: StripeNativeProviderProps)`, self-described "type-annotation-only + runtime-inert, Erased at transpile." → **zero runtime bytecode delta** across all payment paths. The native provider is route-scoped to `/checkout/*/payment` (all chunks compiled clean in the bundle). Live support: the buyer-facing public/checkout-adjacent anon route renders in-app without crash and without a `useAuth` violation. The actual Stripe PaymentSheet step was NOT mounted (would require a paid order = a write; the reachable Smoke & Rhythm event is free RSVP) — documented partial, covered by the transpile-erasure proof.

---

## OTA native-compatibility analysis (the decisive gate for COMMS-0063)

COMMS-0063/0052: a business-app `eas update` bricked launch on 2026-07-02 (stuck-on-splash) because the OTA bundle referenced a native module (`posthog-react-native`) the shipped runtime-1.0.0 binary lacked.

**That mechanism does NOT apply to this OTA.** Diffing the 1.1.2 build baseline (`83997ba44`, ~2026-07-14 cut) → current main, the ONLY net additions to `mingla-business/package.json` are:
- six `file:../packages/*` **local JS/TS workspace packages** (`@mingla/brand-rendering`, `location-input`, `offering-rendering`, `payments-native`, `phone-input`, `theme-animations`) — the ORCH-1385 declaration; these bundle into JS, they add no autolinked native code;
- two CI test scripts (`test:g3-sentry`, `test:orch-1387`).

No expo / react-native / stripe / reanimated version change; no `app.json` / native-plugin change. The current-main JS bundle references the **identical native-module set** as the shipped 1.1.2 store binary. Confirmed live: every screen + the lazy chunk loaded on the 1.1.2-era dev client with zero "native module not found" red-boxes. Residual risk is low; standard practice is to keep `eas update:roll-back-to-embedded` ready.

---

## Comms ledger (read on entry)
No BLOCK+OPEN entries for mingla-tester / ORCH-1384 / ALL. WARN entries factored: **COMMS-0063/0052** (business-OTA-bricks — addressed by the native-compat analysis above), **COMMS-0107** (Android narrow-width cosmetics — matches the notifications title wrap P4), **COMMS-0109** (CI rerun-red snapshot — N/A to a device smoke). No new cross-ORCH discovery warranting a new COMMS entry.

## Discoveries for the orchestrator (not fixed here)
- **P4** — Notifications screen title wraps awkwardly ("Notifi/cation/s") on the narrow Samsung width, crowded by "Mark all read"/"Clear read". Pre-existing Android-width cosmetic, not merge-caused.
- **P4** — Route warning `Route "./experience/snapOutcome.ts" is missing the required default export` (a non-component `.ts` sitting in the app/ route tree). Benign, pre-existing; worth a cleanup ticket.
- AppsFlyer/OneSignal "env missing — skipped/disabled" warnings are expected in a dev session (no EAS secrets); both SDKs no-op gracefully.

## Fences honored
Rockstar Vibes never mutated (read-only sheet views only); no payment authorized; no RSVP/order write; read-only DB not needed; no merges/deploys/OTA (orchestrator owns the OTA); no git stash; anchor git tree left CLEAN; Metro + adb reverse reaped; `mingla-business/node_modules` left as a valid `npm ci` install.

## Downstream routing
**GO** → orchestrator runs `eas update --branch production --platform ios` then `--platform android` from merged main (`399682219`), verifies with `eas update:list`, keeps roll-back-to-embedded ready, then reports the feature LIVE.
