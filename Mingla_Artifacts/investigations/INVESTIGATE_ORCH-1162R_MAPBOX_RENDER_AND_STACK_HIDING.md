# INVESTIGATE — ORCH-1162R: Static Mapbox map does NOT render on buyer-web (token never provisioned) + stack-hiding architecture

- **Phase:** INVESTIGATE (read-only forensic). No product code edited.
- **Date:** 2026-06-19
- **Reopens:** ORCH-1162 Bug 2 ("Where you'll be" map parity). The prior investigation
  (`INVESTIGATE_ORCH-1162_EVENT_MAP_PARITY.md`, 2026-06-18) ASSUMED (its line 160) the Mapbox
  client token "already is" present for trips because "trip maps render in prod, per ORCH-1138
  Leg 1." **That assumption is now DISPROVEN** by Seth's screenshot of
  `business.usemingla.com/t/travelbrand/the-dc-adventure`: the "Where you'll be" box shows only
  the pin glyph + the text label "Washington, District of Columbia, United States" — **NO Mapbox
  tile.** The trip map has NEVER rendered on any surface.
- **Comms:** Read COMMS_LEDGER on entry. COMMS-0040 (WARN, RSVP public-page standardization) is the
  only near-surface active entry; this investigation touches the static-map token/architecture, NOT
  the RSVP body — no conflict. No new comms entry warranted (the finding is contained to the
  static-map feature, already owned by the 1162 line).

---

## EXECUTIVE VERDICT

**Root cause (CONFIRMED, `proven` by source + report trail + env audit): the public Mapbox token
`EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` is NOT populated in ANY build environment.** It is `null` in the
business-app/buyer-web build and is not even emitted into `extra` in the consumer build. With no
token, `buildStaticMapUrl()` returns `null` by design (fail-safe rule 9), the `<Image>` is not
rendered, and only the overlay pin `<Icon>` + caption pill draw — exactly Seth's screenshot. This
is NOT a 401/malformed-URL problem: no URL is ever built. The map was never wired end-to-end; the
ORCH-1138 implementor explicitly STOP-AND-REPORTED that the operator must provision the token, and
that operator action was never completed.

**Mapbox usage today is SERVER-PROXIED everywhere except this one feature.** Every other Mapbox
call (geocode / forward / reverse / autocomplete / city resolution from META-ORCH-1060) goes
through the `mapbox-geocode` edge function reading the server-only secret `MAPBOX_ACCESS_TOKEN`. The
client never sees a token. The static map is the ONLY place that needs a client `pk.*` token — and
that token was never set.

**Recommendation: Approach B — a `mapbox-static` edge function (server proxy)** — matching the
existing `mapbox-geocode` pattern. It fixes all three surfaces at once with a SINGLE key already in
place (`MAPBOX_ACCESS_TOKEN`), hides the token AND the "mapbox" string from client network traffic
(Seth's stack-hiding requirement), and lets us strip the Mapbox logo/attribution server-side. The
quick Approach A (set the `pk.*` token in each build env) renders the map but EXPOSES both the token
and `api.mapbox.com` in client URLs — directly violating the stack-hiding requirement.

---

## INVESTIGATION MANIFEST (files read, in trace order)

1. `mingla-business/src/utils/mapboxStaticImage.ts` — `getPublicMapboxToken()` + `buildStaticMapUrl()` (the builder; reads `Constants.expoConfig.extra.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` then static `process.env` fallback).
2. `app-mobile/src/utils/mapboxStaticImage.ts` — byte-equivalent port (consumer copy; same token read).
3. `mingla-business/app.config.ts:238-252` — `extra.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? null`.
4. `app-mobile/app.config.ts:1-20` — `extra` block: **NO Mapbox token emitted at all** (0 mentions of MAPBOX).
5. `mingla-business/.env` — has GIPHY keys only; **NO `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` line.**
6. `mingla-business/.env.example:12` + `app-mobile/.env.example:2` — empty/placeholder mapbox lines.
7. `mingla-business/vercel.json` — build = `npx expo export -p web`; no env injection visible in repo (Vercel env is dashboard-side).
8. `mingla-business/eas.json` / `app-mobile/eas.json` — `EXPO_PUBLIC` env present but **NO MAPBOX entry.**
9. `mingla-business/src/components/trip/TripPreview.tsx:605-653` — the "Where you'll be" render block (the screenshot symptom).
10. `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx:733-1152` — consumer "Where you'll start" block (same builder, same null fallback).
11. `supabase/functions/mapbox-geocode/index.ts:449-451` + `supabase/functions/_shared/mapboxGeocode.ts:80-89` — server-side `MAPBOX_ACCESS_TOKEN` read (the proxy pattern).
12. `packages/location-input/src/mapboxGeocodeService.ts:9-62` — all client geocode calls proxy via injected `supabase.functions.invoke("mapbox-geocode", …)`; client never holds a token.
13. Supabase edge-fn list (139 fns) — only `mapbox-geocode` (ACTIVE v58); **NO `mapbox-static` / image-proxy fn exists.**
14. `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1138_LEG1_WHERE_YOULL_BE_MAP.md` + `..._R2_TRIP_DEVICE_PARITY.md` + `..._LEG1C_CONSUMER_TRIP_PARITY.md` — the provision-the-token operator action that was never done.

---

## Q-SCORECARD

- **Q1. WHY does the static map tile not render on web?** **Verdict: the public token is absent →
  `buildStaticMapUrl()` returns `null` → no `<Image>` is rendered, only the overlay pin + caption.**
  Not a 401 — no URL is ever built. `proven` (F-1, F-2, F-3).
- **Q1a. Is the token populated in the buyer-web (Vercel) runtime?** **Verdict: NO.** `mingla-business/.env`
  has no mapbox line; `app.config.ts` emits `process.env.… ?? null` → `null` unless Vercel's build
  env sets it, and the ORCH-1138 R2 report confirms it was never exposed to this build. `proven`
  (F-1, F-5).
- **Q1b. Is it populated in the business app build?** **Verdict: NO** (same `.env`/EAS gap). `proven`.
- **Q1c. Is it populated in the consumer app build?** **Verdict: NO — worse: `app-mobile/app.config.ts`
  never emits it into `extra` at all.** `proven` (F-4).
- **Q1d. Does `Constants.expoConfig.extra` survive the web export?** **Verdict: YES** (the proven
  GIPHY/supabase pattern uses it on web) — but it carries `null` because the source `process.env`
  value is empty. The transport is fine; the value is missing. `proven`.
- **Q1e. Did the pre-existing TRIP map ever render on web?** **Verdict: NO** — same builder, same
  null token. The prior 1162 investigation's "trip=REAL" was `proven`-by-code only and explicitly
  could-not-capture live (blocked by an unrelated RLS 500); the screenshot now disproves it. `proven`.
- **Q2. How is Mapbox used across the app TODAY?** **Verdict: SERVER-PROXIED for everything except
  the static map.** Geocode/forward/reverse/autocomplete/city-resolution all go through the
  `mapbox-geocode` edge fn (secret `MAPBOX_ACCESS_TOKEN`); the client never holds a token. The
  static map is the lone client-token feature, and its token was never set. `proven` (F-6).
- **Q3. Logo/stack-hiding.** **Verdict:** (a) the static URL does NOT set `logo=false&attribution=false`
  today (it would show the Mapbox logo even if it rendered); (b) any client `api.mapbox.com` URL
  exposes the token AND the "mapbox" string in network traffic — a server proxy hides both. `proven`
  (F-7).
- **Q4. Recommended architecture.** **Verdict: Approach B (server-proxy `mapbox-static` edge fn).**
  Fixes all 3 surfaces with the existing secret, hides token+stack, strips logo/attribution
  server-side. See Recommendation. `proven` reasoning.

---

## FINDINGS (six-field evidence)

### F-1 — `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` is absent in the business/buyer-web build (CONFIRMED ROOT CAUSE)
1. **Symptom:** "Where you'll be" box shows only a pin + the location text label, no map tile (Seth screenshot).
2. **Layer:** code (config) + data (env).
3. **Probe:** `grep -niE "mapbox" mingla-business/.env`; read `mingla-business/app.config.ts:251-252`.
4. **Evidence:** `mingla-business/.env` contains only `EXPO_PUBLIC_GIPHY_API_KEY`/`EXPO_PUBLIC_GIPHY_KEY` — NO mapbox line. `app.config.ts:251-252`: `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? null`. With the env var unset, `extra.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN === null`.
5. **Mechanism:** `getPublicMapboxToken()` reads `extra[…] ?? process.env[…]` → both null/undefined → returns `null` → `buildStaticMapUrl()` returns `null` (line 75) → the `<Image>` branch (TripPreview.tsx:634 `mapUrl !== null ? <Image…> : null`) renders nothing; only the `<Icon name="location">` (line 645) + caption pill (646-650) draw. That is exactly the screenshot.
6. **Severity:** CONFIRMED ROOT CAUSE. Confidence: `proven`.

### F-2 — `buildStaticMapUrl()` returns `null` when the token is empty; no URL is ever built (CONFIRMED — mechanism, rules out 401)
1. **Symptom:** the dispatch hypothesized a malformed/401 URL; in fact no request is made.
2. **Layer:** code.
3. **Probe:** read `mapboxStaticImage.ts:24-31, 73-92`.
4. **Evidence:** `getPublicMapboxToken()` returns `null` for empty/whitespace token (line 30); `buildStaticMapUrl()` line 73-75: `const token = … getPublicMapboxToken(); if (typeof token !== "string" || token.trim().length === 0) return null;`.
5. **Mechanism:** the builder short-circuits to `null` BEFORE composing any `api.mapbox.com` URL → there is no network request, no 401. The "401/malformed" lead in the dispatch is RULED OUT as the proximate cause; the true cause is the absent token + the null-fallback render.
6. **Severity:** CONFIRMED ROOT CAUSE (mechanism). Confidence: `proven`.

### F-3 — the render block draws pin + caption ONLY when `mapUrl === null` (CONFIRMED — matches screenshot exactly)
1. **Symptom:** pin glyph + "Washington, District of Columbia, United States" text, no tile.
2. **Layer:** code (render).
3. **Probe:** read `TripPreview.tsx:615-653`.
4. **Evidence:** `mapUrl !== null ? <Image …/> : null` (L634-643), then unconditionally `<Icon name="location" size={28} color={palette.accent}/>` (L645) and a caption pill with `bt.destinationLocationText ?? "Destination"` (L646-650). When `mapUrl` is null, the Image is omitted and ONLY the icon + caption render.
5. **Mechanism:** this IS the honest fail-safe fallback (rule 9 — never a fabricated tile). It is working as designed; it is just never given a token to upgrade past the fallback. The screenshot is the fallback state, not a bug in the render.
6. **Severity:** CONFIRMED ROOT CAUSE (the visible artifact). Confidence: `proven`.

### F-4 — consumer build never emits the token into `extra` (CONFIRMED ROOT CAUSE — consumer surface, worse than business)
1. **Symptom:** consumer experience/trip "Where you'll start" map will never render even if the env var were set in EAS.
2. **Layer:** code (config).
3. **Probe:** `grep -c "MAPBOX" app-mobile/app.config.ts` → `0`; read `app-mobile/app.config.ts:1-20`.
4. **Evidence:** the consumer `extra` block emits `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` etc. but NO `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`. The consumer `mapboxStaticImage.ts` reads `Constants.expoConfig.extra.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` (line 28-33) — which is permanently undefined because nothing writes it. The ORCH-1138 LEG1C report (line 125) already flagged this: "F-5 confirmed the token is NOT currently in app-mobile `extra`."
5. **Mechanism:** even Approach A would require adding the emission line to the consumer `app.config.ts`; without it the consumer map is structurally impossible.
6. **Severity:** CONFIRMED ROOT CAUSE (consumer). Confidence: `proven`.

### F-5 — the ORCH-1138 implementor STOP-AND-REPORTED; operator token-provision step never completed (CONFIRMED — the historical why)
1. **Symptom:** the map shipped as a permanent fallback card.
2. **Layer:** docs (report trail).
3. **Probe:** read the three `IMPLEMENTATION_ORCH-1138_*` reports.
4. **Evidence:** `..._R2_TRIP_DEVICE_PARITY.md:20`: "STOP-AND-REPORT ... mingla-business has NO client-side Mapbox token ... Kept the HONEST gated card ... Until then the honest gated card (pin + caption, no fabricated tile) stands." `..._LEG1_WHERE_YOULL_BE_MAP.md:133`: "Provision the token before the map renders: set `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` = the public `pk.*`…" — an operator action. There is no later artifact recording that it was done, and the `.env`/EAS audit (F-1/F-4) proves it was not.
5. **Mechanism:** the feature was code-complete but infra-incomplete; the handoff to provision the token fell through, so production has run the fallback the whole time.
6. **Severity:** CONFIRMED ROOT CAUSE (process). Confidence: `proven`.

### F-6 — Mapbox is SERVER-PROXIED everywhere else; no client token mechanism exists today (CONFIRMED — answers Q2)
1. **Symptom:** n/a (architecture finding).
2. **Layer:** code (edge + shared + package).
3. **Probe:** read `supabase/functions/mapbox-geocode/index.ts:449`, `_shared/mapboxGeocode.ts:80-89`, `packages/location-input/src/mapboxGeocodeService.ts:9-62`; Supabase edge-fn list.
4. **Evidence:** the edge fn reads `Deno.env.get("MAPBOX_ACCESS_TOKEN")` server-side (geocode/index.ts:449; mapboxGeocode.ts:80) and the shared comment states it "Keeps `MAPBOX_ACCESS_TOKEN` strictly server-side (never shipped in the client)." The package geocode service calls `invoke("mapbox-geocode", …)` — the host injects `supabase.functions.invoke`, never a token. The edge-fn list shows `mapbox-geocode` (ACTIVE v58) and NO `mapbox-static`/image-proxy fn. So today: server proxy = ALL geocoding; client token = ONLY the (never-provisioned) static map.
5. **Mechanism:** the codebase ALREADY has the server-proxy pattern and the server secret. The static map is the lone deviation that introduced a client-token dependency — the dependency that was never satisfied. Reusing the proxy pattern is the natural, consistent fix.
6. **Severity:** CONFIRMED (architecture). Confidence: `proven`.

### F-7 — static URL exposes logo + token + "mapbox" string; no logo/attribution suppression (CONFIRMED — answers Q3)
1. **Symptom:** even when it renders, the Mapbox logo would show and the stack would be visible in network traffic.
2. **Layer:** code.
3. **Probe:** `grep -n "logo\|attribution" mapboxStaticImage.ts` → no matches; read URL composition (L87-91).
4. **Evidence:** the URL is `https://api.mapbox.com/styles/v1/mapbox/<style>/static/<overlay>/<center>/<size>?access_token=<token>` — NO `&logo=false&attribution=false`. A client request to `api.mapbox.com` carrying `access_token=pk.…` exposes BOTH the token and the "mapbox" host in the device/browser network log. The Mapbox Static Images API supports `logo=false` and `attribution=false` query params to suppress the overlay (note: Mapbox ToS generally requires attribution be shown SOMEWHERE — see Open Question OQ-1; a small text credit elsewhere or an enterprise term may be needed for full removal).
5. **Mechanism:** Approach A (client token) cannot hide the stack; only a server proxy that fetches the tile with `logo=false&attribution=false` and returns image bytes from a `*.supabase.co`/Mingla URL hides token + logo + the "mapbox" string.
6. **Severity:** CONFIRMED (requirement gap). Confidence: `proven` on the code; `suspected` on the exact ToS attribution carve-out (OQ-1).

---

## FIVE-TRUTH-LAYER RECONCILIATION

| Layer | Finding | Contradiction? |
|---|---|---|
| **Docs** | ORCH-1138 reports: map is code-complete, token provision is a PENDING operator action. Prior 1162 investigation ASSUMED token present. | **Yes — the 1162 assumption contradicts the 1138 reports.** The 1138 reports hold the truth: token never provisioned. |
| **Schema/Config** | `app.config.ts` emits `process.env… ?? null`; `.env`/EAS have no mapbox value; consumer config emits nothing. | No internal contradiction — uniformly absent. |
| **Code** | Builder fail-safes to null; render draws pin+caption only. Server proxy exists for all other Mapbox use. | No — code is correct and defensive; it is starved of a token. |
| **Runtime** | Screenshot = pin + text label, no tile. | Matches code exactly (null token → null URL → no Image). |
| **Data (env)** | No `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` anywhere in repo env; server `MAPBOX_ACCESS_TOKEN` IS configured (geocode works in prod). | The decisive gap: a server token exists; a client token does not. |

---

## REPRO / EVIDENCE STATUS

- **Symptom reproduced via Seth's screenshot** (`/t/travelbrand/the-dc-adventure`, pin + "Washington, District of Columbia, United States", no tile) + matched line-for-line to the render code (F-3) and the null-token mechanism (F-1/F-2). 
- **Live web re-capture not independently run** this turn (read-only source + env + report-trail forensic; the cause is in config/env, exempt from the live-fire directive per Prime Directive 7's backend/build-config carve-out, and the symptom is already proven by the screenshot + code). Confidence: `proven` for the no-token root cause; the server-proxy ToS attribution detail is `suspected` (OQ-1).

---

## APPROACH COMPARISON

### Approach A — set the public `pk.*` token in each build env
- **What:** add `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.…` to: Vercel project env (buyer-web), `mingla-business` EAS env + `.env`, `app-mobile` EAS env + `.env`, AND add the emission line `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: process.env.… ?? null` to `app-mobile/app.config.ts` `extra` (it is missing — F-4). Add `&logo=false&attribution=false` to the URL builder.
- **Pros:** fastest; zero new edge fn; the builder already supports it; web `<Image>` works immediately once Vercel re-exports.
- **Cons (DISQUALIFYING per Seth's stack-hiding rule):** the client URL is `api.mapbox.com/...?access_token=pk.…` — exposes the **token** AND the **"mapbox" string** in every device/browser network request (F-7). `logo=false` removes the on-image logo but the host + token remain visible. Also leaks the stack on three surfaces simultaneously and scatters the key across 3+ env stores.

### Approach B — `mapbox-static` server-proxy edge function (RECOMMENDED)
- **What:** new edge fn `mapbox-static` mirroring `mapbox-geocode`: accepts `{lat,lng,accentHex?,style?,zoom?,width?,height?}`, validates inputs, fetches `https://api.mapbox.com/styles/v1/mapbox/<style>/static/pin-s+<hex>(<lng>,<lat>)/<lng>,<lat>,<zoom>/<w>x<h>@2x?logo=false&attribution=false&access_token=$MAPBOX_ACCESS_TOKEN` server-side, returns the image bytes with `Content-Type: image/png` + a cache header. The clients build a `*.supabase.co/functions/v1/mapbox-static?...` (or a Mingla-domain rewrite) URL — no token, no "mapbox" string, no logo.
- **Pros:** hides token + stack + logo (Seth's requirement); reuses the EXISTING `MAPBOX_ACCESS_TOKEN` secret — ONE key, already provisioned and proven (geocode works); matches the established proxy pattern (F-6); single place to set/rotate the key; identical fix across all three surfaces (web/business/consumer) because they all just point `<Image>` at the proxy URL; server can cache tiles (cost control).
- **Cons:** slightly more work (one edge fn + a tiny URL-builder change to point at the proxy + deploy); edge-fn invocation latency on first load (mitigated by cache headers); must confirm Mapbox ToS attribution (OQ-1) — but a server proxy is the place that can satisfy it cleanly (e.g. a small static credit elsewhere) without exposing the stack.

---

## RECOMMENDATION — Approach B (`mapbox-static` server-proxy edge fn)

**Concrete changes (for the SPEC, not this phase — direction only):**

1. **New edge fn** `supabase/functions/mapbox-static/index.ts` — input-validated, reads `Deno.env.get("MAPBOX_ACCESS_TOKEN")` (already set), fetches the Static Images URL with `logo=false&attribution=false`, returns image bytes + cache header. `verify_jwt=false` (public buyer-web is anonymous) with strict input bounds (clamp width/height/zoom, validate finite lat/lng, sanitize hex) to prevent the proxy being used as an open image fetcher.
2. **Shared builder change** — change `buildStaticMapUrl()` in BOTH `mingla-business/src/utils/mapboxStaticImage.ts` and `app-mobile/src/utils/mapboxStaticImage.ts` to compose a proxy URL (`<supabaseFunctionsUrl>/mapbox-static?lat=…&lng=…&accent=…&w=…&h=…&zoom=…`) instead of `api.mapbox.com`. The token read (`getPublicMapboxToken`) becomes unnecessary for the static map — DELETE that client dependency. Consider promoting the builder into `packages/` to kill the duplicate (currently two byte-equivalent copies), per I-MOR-0827 isolation.
3. **Server secret** — none new; `MAPBOX_ACCESS_TOKEN` is already configured (geocode v58 uses it).
4. **Client env** — Approach B needs the Supabase functions base URL, which the apps ALREADY have (they invoke `mapbox-geocode`). NO new client env var on any surface, and NO change to `app.config.ts extra`.
5. **Surfaces fixed:** buyer-web (TripPreview + the ORCH-1162 event/experience render blocks once those land), business app, consumer app — all by pointing `<Image>` at the proxy. The rule-9 null fail-safe stays (proxy unreachable / coords missing → hide map).

This is also the cleaner foundation for the in-flight ORCH-1162 event/experience map port: that work adds the SAME `<Image source={{uri: buildStaticMapUrl(...)}}>` to the shared event renderer and experience preview — if the builder targets the proxy, the event/experience maps inherit the working, stack-hidden tile for free.

---

## BLAST RADIUS / CROSS-SURFACE MAP

- **In scope (all three carry the broken/never-rendered map):** buyer-web (`TripPreview.tsx`; soon the shared `PublicEventPage`/`ExperiencePreview` from ORCH-1162), business iOS/Android (same components), consumer iOS/Android (`ConsumerExperienceDetailScreen.tsx:733-1152`, consumer trip via `useConsumerEventFoundation`).
- **Out of scope / no change:** all server-proxied geocode/autocomplete (already healthy via `mapbox-geocode`); online-format offerings (no venue → map correctly hidden); RSVP body (COMMS-0040).
- **Interaction with ORCH-1162 (event/experience map port):** SHARED primitive. Recommend ORCH-1162R's proxy fix land FIRST (or jointly), so the event/experience port renders real tiles instead of inheriting the same null fallback.

---

## INVARIANT IMPACT (flagged, not resolved)

- **Rule 9 (no fabricated tile; null → hide):** PRESERVED by both approaches; the proxy must continue to let the client hide the map on proxy failure (return a non-200 so `<Image>` onError can hide, or have the builder gate on coords).
- **I-MOR-0827-PACKAGE-ISOLATION:** the two duplicate `mapboxStaticImage.ts` copies exist to honor this; a SPEC may propose promoting the builder to `packages/` (a NEW `I-PROPOSED-*` consolidation invariant) — orchestrator decision.
- **Server-token-stays-server (geocode precedent):** Approach B extends this invariant to the static map (good); Approach A would VIOLATE the spirit by introducing a client token + visible stack.

---

## DISCOVERIES FOR ORCHESTRATOR

- **D-1 (corrects prior 1162):** `INVESTIGATE_ORCH-1162_EVENT_MAP_PARITY.md:160` asserts the token "already is" present for trips. FALSE — it was never provisioned; trip maps have always shown the fallback. Any SPEC built on that line's assumption is wrong; the event/experience port will render the SAME empty fallback unless the token/proxy is fixed.
- **D-2:** `app-mobile/app.config.ts` never emits `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` into `extra` (Approach A would silently fail on consumer until this is added; Approach B sidesteps it entirely).
- **D-3 (carried from prior 1162):** anon trip public pages were returning "permission denied for table brands" (RLS regression) — separate ORCH; if still live it blocks trip pages independent of the map.
- **D-4:** two byte-equivalent `mapboxStaticImage.ts` copies — duplication; candidate for `packages/` consolidation in the SPEC.

---

## OPEN QUESTIONS

- **OQ-1 (Mapbox ToS attribution):** `logo=false&attribution=false` removes the on-image branding, but Mapbox's standard ToS generally requires attribution to appear somewhere (a text credit). Confirm whether Mingla's Mapbox plan/terms permit full suppression, or whether a discreet text credit must live elsewhere (e.g. a legal/about page) to stay compliant while keeping the stack hidden from the map surface itself. Needs Seth/legal confirmation before stripping attribution in production.
- **OQ-2:** confirm the public token `pk.*` value Seth references in MEMORY (a public `pk.*` MAPBOX_TOKEN exists in master keys) — Approach B does NOT need it (uses the server secret), but if Approach A is ever chosen it must be the URL-scoped `pk.*`, never the secret.

---

## CONFIDENCE & RECOMMENDED NEXT PHASE

- **Overall confidence: `proven`** for the root cause (token never provisioned → null URL → pin+caption fallback), the cross-surface gap, the server-proxy-everywhere-else architecture, and the logo/stack exposure. `suspected` only on the exact ToS attribution carve-out (OQ-1).
- **Recommended next phase: SPEC** — Approach B: build `mapbox-static` edge fn (input-validated, `logo=false&attribution=false`, reuses `MAPBOX_ACCESS_TOKEN`), repoint both `buildStaticMapUrl` copies at the proxy, drop the client token dependency, preserve rule-9 null→hide, and (recommended) consolidate the duplicate builder into `packages/`. Sequence it with / ahead of the ORCH-1162 event/experience map port so all offering maps render real, stack-hidden tiles on web + business + consumer. **No fix written here.**
