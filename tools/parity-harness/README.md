# ORCH-1100 — Business-web parity baseline harness

DIAGNOSTIC tooling. **Nothing here is shipped product.** It measures the true
per-route boot/crash state of the `mingla-business` web app on a real phone
browser, with the mobile-web route firewall temporarily bypassed, so the parity
fix sweep knows exactly what to attack and in what order.

## Why this exists

`mingla-business/app/_layout.tsx` keeps a mobile-web route firewall
(`ORCH_1093_SIGNED_IN_ROUTE_STATUS`). Any route not explicitly promoted to
`"interactive"` defaults to `"static-section"` and renders the
`Orch1093MobileRouteRecovery` "return Home" stub on a phone browser. With ~12 of
~91 routes promoted, the REAL crash state of the other ~79 is hidden behind the
stub. This harness flips the firewall to "interactive for all" via a build-time
diagnostic flag and records what each route actually does.

## The diagnostic firewall-bypass toggle

`_layout.tsx` reads `process.env.EXPO_PUBLIC_ORCH1100_FIREWALL_BYPASS`. When it
equals `"1"` at **build time**, `orch1093RouteStatus()` returns `"interactive"`
for every route. The constant is clearly labelled:

> `ORCH-1100 DIAGNOSTIC — do not ship as default.`

This var MUST remain unset in every production / Vercel build. It is a throwaway
measurement toggle, NOT a product change. The production default
(`?? "static-section"`) is untouched.

## Pieces

- `enumerate-routes.mjs` — walks `mingla-business/app/`, converts each Expo
  Router screen file to its URL pathname (route groups stripped, `index`
  collapsed, `[param]` filled with sample values, `.web` variants de-duped).
  Emits `routes.manifest.json` (91 navigable routes).
- `routes.manifest.json` — the route list the driver reads.
- `run-parity-baseline.mjs` — the CDP driver: serves the web export locally
  (SPA fallback), wires `adb reverse`/`forward`, drives the phone's Chrome over
  the DevTools websocket, signs in once (re-injects the session before every
  nav so a renderer crash doesn't lose auth), then per route records: crash?,
  console errors, peak JS heap, rendered-content vs stub vs error-boundary, and
  a screenshot. Classifies each failure.

## Run it

```bash
# 1. Build the web export WITH the diagnostic bypass (from a real checkout):
cd mingla-business
EXPO_PUBLIC_ORCH1100_FIREWALL_BYPASS=1 \
  npx expo export -p web --output-dir web-build --clear

# 2. Enumerate routes (only needed when app/ routes change):
node ../tools/parity-harness/enumerate-routes.mjs

# 3. Wake the phone, open Chrome to http://127.0.0.1:56815/auth, then:
node ../tools/parity-harness/run-parity-baseline.mjs \
  --device R58R54YV7JT \
  --web-build mingla-business/web-build \
  --out Mingla_Artifacts/reports/orch1100_baseline

# The harness pauses and polls until you sign in once on the phone
# (Continue with Google -> sethogieva@gmail.com). Then it sweeps every route.
```

Outputs land in `Mingla_Artifacts/reports/orch1100_baseline/`:
`results.json`, `session.token.json`, and `NNN_<route>.png` screenshots.
The human-readable table is `PARITY_BASELINE_ORCH-1100.md`.

## Failure classes

`reanimated-gesture`, `reanimated-loop` (OOM), `native-module`,
`glass-transparency`, `fixed-height-layout`, `hydration/auth`, `dead-handler`,
`firewall-stub`, `other`. Cross-mapped to RC-1..RC-5 in the synthesis report.

## Teardown

The driver removes its own `adb reverse`/`forward` on exit. `web-build/` and
`orch1100_baseline/` artifacts are gitignored (see `.gitignore` here).
