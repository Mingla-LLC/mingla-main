# IMPLEMENT — ORCH-1165 [Mapbox static map server-proxy]

- **Phase:** IMPLEMENT. Approach B (server proxy), per
  `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1162R_MAPBOX_RENDER_AND_STACK_HIDING.md`.
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1165-[mapbox-static-proxy]/` on branch
  `ORCH-1165-mapbox-static-proxy` (rebased onto origin/main).
- **Status:** implemented and verified (Deno gates green + fails-on-revert proven). The jest
  regression test is **implemented, unverified-locally** (worktree workspace symlink not installed —
  environment gap, not a code defect; the equivalent logic is Deno-proven). NOT deployed, NOT merged.
- **Comms:** read COMMS_LEDGER on entry. No BLOCK row addressed to me / ORCH-1165 / ALL. COMMS-0038
  (WARN) notes pre-existing RED gates on origin/main (realtime-publication / stripe-idempotency) —
  unrelated to my files; factored in (my strict-grep sweep failures are those pre-existing reds +
  local-env noise, never my files). No new comms entry warranted — the change is contained to the
  static-map feature already owned by the 1162/1165 line.

---

## 1. Summary (plain English)

The "Where you'll be"/"Where you'll start" static map has NEVER rendered on any surface because the
client Mapbox token was never provisioned. This builds a **server-proxy** so the map renders on ALL
surfaces (buyer-web, business app, consumer app) while HIDING the tech stack: no Mapbox token, no
`api.mapbox.com` host, and no Mapbox logo in any client network traffic.

- New edge function `mapbox-static` fetches the Mapbox Static Images tile server-side using the
  EXISTING `MAPBOX_ACCESS_TOKEN` secret (the same one `mapbox-geocode` uses — no new secret), with
  `logo=false&attribution=false`, and returns the image bytes from a `*.supabase.co` URL.
- The shared `buildStaticMapUrl` (single owner in `@mingla/event-rendering`) now composes a
  token-less proxy URL `<functionsBaseUrl>/mapbox-static?lat=…&lng=…&accent=…&w=…&h=…` instead of
  an `api.mapbox.com?access_token=…` URL. No new client env var, no `app.config.ts` change (the apps
  already ship `EXPO_PUBLIC_SUPABASE_URL` in `Constants.expoConfig.extra`).
- The rule-9 fail-safe is preserved: missing coords OR missing functions base → `null` → caller
  hides the map (honest text fallback); Mapbox non-200 → proxy non-200 → client `<Image>` hides.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence (commit + test) |
|----|-----------|--------|--------------------------|
| SC-1 | New edge fn `supabase/functions/mapbox-static/index.ts`, `verify_jwt=false`, fetches Static Images with `logo=false&attribution=false` using the env token | ✓ | `supabase/functions/mapbox-static/index.ts` + `config.toml` block; test `valid coords → … logo/attribution OFF` |
| SC-2 | STRICT validation: lat∈[-90,90], lng∈[-180,180] finite (else 400); clamp w/h≤1280; allowlist zoom; sanitize accent `^[0-9a-fA-F]{6}$`; allowlist style | ✓ | `validateStaticParams`; test `INVALID inputs → { error } (400 path)` + `clamp to 1280` |
| SC-3 | Returns image bytes + Mapbox Content-Type + `Cache-Control: public, max-age=43200`; Mapbox non-200 → non-200 | ✓ | `handler()` in index.ts (Response with bytes + headers; upstream non-200 → non-200) |
| SC-4 | Reuse existing `MAPBOX_ACCESS_TOKEN` — no new secret, no hardcoded token | ✓ | `Deno.env.get("MAPBOX_ACCESS_TOKEN")` in index.ts (same as mapbox-geocode v58); no literal token in repo |
| SC-5 | `buildStaticMapUrl` repointed to the proxy: NO `api.mapbox.com`, NO `access_token` client-side | ✓ | `packages/event-rendering/mapboxStaticImage.ts` + `mapboxStaticProxyUrl.ts`; test `client builder emits a token-less, mapbox-less proxy URL` |
| SC-6 | Same functions base URL the app already uses for mapbox-geocode; NO new client env, NO app.config.ts change | ✓ | `mapboxFunctionsBase.ts` reads `EXPO_PUBLIC_SUPABASE_URL` from `Constants.expoConfig.extra` (the existing supabase-client/stripe-handshake source); zero `app.config.ts` diff |
| SC-7 | Drop the static-map's `getPublicMapboxToken`/`mapboxToken.ts` dependency; keep rule-9 (no coords → null → hide) | ✓ | `buildStaticMapUrl` no longer reads the token; `getPublicMapboxToken` retained as backward-compat export only; rule-9 in `buildProxyStaticMapUrl` (coord + base guards) |
| SC-8 | Client URL has NO token and NO "mapbox" host string; logo suppressed | ✓ | proxy test asserts `!includes("api.mapbox.com")` + `!includes("access_token")` + `!includes("pk.")`; logo suppressed server-side |
| SC-9 | Single-owner invariant preserved (one `buildStaticMapUrl`, in packages, shims re-export) | ✓ | `orch-1162-map-single-owner.mjs` gate → "passed" |

---

## 3. Files changed

| File | Δ | Kind |
|------|---|------|
| `supabase/functions/mapbox-static/index.ts` | +258 (new) | new edge fn (proxy + validation + URL builder) |
| `supabase/functions/mapbox-static/__tests__/mapboxStatic.orch1165.test.ts` | +110 (new) | Deno edge-fn test |
| `supabase/config.toml` | +10 | `[functions.mapbox-static] verify_jwt = false` block |
| `packages/event-rendering/mapboxStaticProxyUrl.ts` | +110 (new) | PURE token-less proxy-URL builder (Deno-testable) |
| `packages/event-rendering/mapboxFunctionsBase.ts` | +35 (new) | runtime `EXPO_PUBLIC_SUPABASE_URL`→functions-base read (expo-constants, mirrors mapboxToken.ts) |
| `packages/event-rendering/mapboxStaticImage.ts` | ~+30/-15 | app-facing `buildStaticMapUrl` repointed to the proxy |
| `packages/event-rendering/mapboxStaticUrl.ts` | +12 | `StaticMapParams` gains `functionsBaseUrl`; pure Mapbox URL builder RETAINED as the server contract |
| `packages/event-rendering/index.ts` | ~+6/-2 | barrel exports `getSupabaseFunctionsBaseUrl`; `getPublicMapboxToken` re-sourced from `./mapboxToken` |
| `packages/event-rendering/__tests__/mapboxStaticProxyUrl.orch1165.test.ts` | +75 (new) | Deno client-builder test |
| `mingla-business/src/utils/__tests__/mapboxStaticImage.orch1138.test.ts` | ~+50/-44 | rewritten to the new proxy contract `[TEST-MOD-APPROVED ORCH-1165]` |

The two app-side shims (`mingla-business/src/utils/mapboxStaticImage.ts`,
`app-mobile/src/utils/mapboxStaticImage.ts`) are UNCHANGED — they re-export from
`@mingla/event-rendering`, so they inherit the proxy behavior automatically and the single-owner
gate stays green. No `app.config.ts` (either app) changed. No migration.

---

## 4. Data-model changes applied

None. No migration, no table/column/RLS change.

---

## 5. Edge functions touched

| Fn | `verify_jwt` | Note |
|----|-------------|------|
| `mapbox-static` (NEW) | **false** | public buyer-web is anonymous (same posture as the other public web fns); strict input validation + style/zoom/size allowlists are the abuse guard in lieu of auth. Reuses `MAPBOX_ACCESS_TOKEN`. |
| `mapbox-geocode` (untouched) | true | left exactly as-is per the DO-NOT-TOUCH constraint. |

**Deploy expectation (orchestrator/operator, from MERGED main):** deploy `mapbox-static`. No secret
to add — `MAPBOX_ACCESS_TOKEN` is already configured (mapbox-geocode uses it). After deploy, the
buyer-web export must re-run so the proxy URL is live (no Vercel env change needed).

---

## 6. Regression tests added

1. **Edge fn** — `supabase/functions/mapbox-static/__tests__/mapboxStatic.orch1165.test.ts`
   (5 Deno tests): valid coords → well-formed Mapbox fetch URL with the SERVER env token +
   `logo=false&attribution=false`; defaults; w/h clamp to 1280; invalid inputs → `{ error }` (400
   path); allowlisted style + accent lowercasing. **PASS: 5/5.**
   - **fails-on-revert verified at HEAD (pre-commit working tree):** true line-deletion of
     `?logo=false&attribution=false&access_token=…` → `?access_token=…` made the "logo/attribution
     OFF" test FAIL (`Expected … to contain: "logo=false"`); restored → 5/5 PASS.
2. **Client builder** — `packages/event-rendering/__tests__/mapboxStaticProxyUrl.orch1165.test.ts`
   (4 Deno tests): proxy URL is token-less + mapbox-less (`!api.mapbox.com`, `!access_token`,
   `!pk.`); invalid accent → default pin; rule-9 null (missing coords OR missing base); trailing-slash
   normalization. **PASS: 4/4.**
   - **fails-on-revert verified:** true line-deletion of the functions-base null guard made the
     rule-9 case FAIL (both type-check and runtime); restored → 4/4 PASS.
3. **Existing ORCH-1162 test** (`mapboxStaticUrl.orch1162.test.ts`) — UNCHANGED, still **PASS 4/4**
   (the pure Mapbox URL builder is retained as the server contract).
4. **ORCH-1138 jest test** rewritten to the new proxy contract under `[TEST-MOD-APPROVED ORCH-1165]`
   — **implemented, unverified-locally**: bare `@mingla/event-rendering` does not resolve in this
   worktree (no workspace symlink installed; the barrel drags in RN components needing the full
   RN/react toolchain). A sibling pre-existing `@mingla/event-rendering` jest test that *mocks* the
   package passes, confirming the gap is the unlinked workspace, not my change. CI installs the
   workspace and will run it. The logic it covers is identical to the Deno proxy test (which passes
   + fails-on-revert).

Combined Deno run (all three Deno suites): **13 passed | 0 failed.**

---

## 7. Old → New receipts

### packages/event-rendering/mapboxStaticImage.ts
- **Before:** `buildStaticMapUrl` read the client `pk.*` token (`getPublicMapboxToken()`) and
  delegated to `buildStaticMapUrlWithToken` → an `api.mapbox.com/...?access_token=pk.…` URL. Token
  was never provisioned → returned null → map never rendered.
- **Now:** reads the Supabase functions base URL (`getSupabaseFunctionsBaseUrl()`) and delegates to
  `buildProxyStaticMapUrl` → a `<base>/mapbox-static?lat=…&lng=…` proxy URL with NO token and NO
  Mapbox host. `functionsBaseUrl` override param supported for tests.
- **Why:** SC-5/6/7 — render on all surfaces while hiding the stack, with no client token.
- **Lines:** ~45.

### packages/event-rendering/mapboxStaticProxyUrl.ts (new) + mapboxFunctionsBase.ts (new)
- **Before:** did not exist (the static map was a single token-based builder).
- **Now:** `mapboxStaticProxyUrl.ts` is the PURE proxy-URL assembly (no expo-constants → Deno-
  testable); `mapboxFunctionsBase.ts` is the runtime `EXPO_PUBLIC_SUPABASE_URL`→`/functions/v1` read
  (expo-constants, mirroring the existing `mapboxToken.ts` split exactly).
- **Why:** SC-5/6/8 + keep the pure logic Deno-unit-testable.
- **Lines:** +145.

### supabase/functions/mapbox-static/index.ts (new)
- **Before:** no static-image proxy existed (only `mapbox-geocode`).
- **Now:** GET proxy: validates/clamps inputs, builds the Mapbox Static Images URL server-side with
  `logo=false&attribution=false` using `MAPBOX_ACCESS_TOKEN`, returns image bytes + Content-Type +
  12h cache; non-200 from Mapbox → non-200. `validateStaticParams` + `buildMapboxStaticFetchUrl`
  exported pure for tests.
- **Why:** SC-1/2/3/4 — the server proxy that hides the token + host + logo.
- **Lines:** +258.

### supabase/config.toml
- **Before:** no `mapbox-static` entry.
- **Now:** `[functions.mapbox-static] verify_jwt = false` (mirrors the public web fns; the input
  allowlists are the abuse guard).
- **Why:** SC-1 — public buyer-web is anonymous.
- **Lines:** +10.

### packages/event-rendering/index.ts + mapboxStaticUrl.ts
- **Before:** barrel re-exported `getPublicMapboxToken` from `mapboxStaticImage`; `StaticMapParams`
  had `token`.
- **Now:** barrel exports `getSupabaseFunctionsBaseUrl`; `getPublicMapboxToken` re-sourced from
  `./mapboxToken` (still exported for backward-compat, no longer used by the static map);
  `StaticMapParams` gains `functionsBaseUrl`. `mapboxStaticUrl.ts` (the pure Mapbox URL builder)
  RETAINED as the server-side contract.
- **Why:** SC-5/7/9 — repoint without breaking importers or the single-owner gate.
- **Lines:** ~18.

### mingla-business/src/utils/__tests__/mapboxStaticImage.orch1138.test.ts
- **Before:** asserted the SUPERSEDED `api.mapbox.com` + `access_token` + client-token contract.
- **Now:** asserts the new token-less, mapbox-less proxy contract + retained rule-9 fail-safe +
  `getPublicMapboxToken` backward-compat read. `[TEST-MOD-APPROVED ORCH-1165]`.
- **Why:** the old assertions asserted a contract this ORCH intentionally replaces.
- **Lines:** ~50.

---

## 8. Cross-surface impact

| Surface | Affected? | What changes / why not |
|---------|-----------|------------------------|
| Consumer iOS | YES (parity AUTOMATIC) | imports `buildStaticMapUrl` via the shim → `@mingla/event-rendering`; the experience/trip "Where you'll start" map now renders through the proxy. |
| Consumer Android | YES (AUTOMATIC) | same shared code. |
| Buyer/anon Web | YES (AUTOMATIC) | `PublicEventPage`/`TripPreview`/`ExperiencePreview` static maps render via the proxy (the primary symptom surface). |
| Business iOS | YES (AUTOMATIC) | same components/shared builder. |
| Business Android | YES (AUTOMATIC) | same. |
| Admin Web (adjacent) | NO | does not render the offering static map. |
| Business Web preview (adjacent) | YES (AUTOMATIC) | renders the same components on web. |

Parity is **automatic** across all affected surfaces — they all consume the single shared
`buildStaticMapUrl` owner; no per-surface forks.

---

## 9. Smoke result

- Source/unit verification only this turn (no device/sim). The proxy URL composition + edge-fn
  validation + fail-safe are proven by 13 passing Deno tests with two fails-on-revert proofs.
- Live render is **unverified** until the edge fn is deployed + buyer-web re-exported (operator-
  owned). Expected: the `<Image>` paints a dark Mapbox tile with a brand-accent pin and no Mapbox
  logo; the device/browser network log shows a `*.supabase.co/functions/v1/mapbox-static?...`
  request (no `api.mapbox.com`, no `access_token`).

---

## 10. Known issues / deferred

- **OQ-1 (Mapbox ToS attribution):** `attribution=false` removes the on-image credit; Mapbox's
  standard terms generally require attribution to appear somewhere. A discreet text credit on a
  legal/about page may be needed to stay compliant while keeping the stack hidden from the map
  surface. **Flagged for Seth/legal — NOT resolved here.** (Documented inline in the edge fn header.)
- **ORCH-1138 jest test unverified-locally** — see §6.4 (workspace-link env gap, CI-covered).
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

- **Migration:** none.
- **Edge deploy (from MERGED main, after REVIEW + TEST):** deploy `mapbox-static`. `verify_jwt=false`.
  No secret to add (`MAPBOX_ACCESS_TOKEN` already set). Then re-run the buyer-web export so the proxy
  URL is live.
- **OQ-1 decision** before stripping attribution in production (above).

---

## 12. Discoveries for Orchestrator

- **D-1:** `app-mobile/app.config.ts` still does NOT emit `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` into
  `extra` (carried from the investigation). Approach B does not need it (uses the server secret), so
  no action — but if Approach A is ever revived, the consumer emission line must be added.
- **D-2:** the shared `getPublicMapboxToken` export is now DEAD for the static map (kept only for
  backward-compat / the ORCH-1138 token-read test). A future cleanup ORCH could remove it + the
  `mapboxToken.ts` file once no importer references it.
- **D-3 (pre-existing reds):** the local strict-grep sweep shows pre-existing RED gates
  (realtime-publication, stripe-idempotency per COMMS-0038/0039; RSVP GBP in `rsvp/[id]/preview.tsx`;
  safearea/route-by-event-type) and local-env noise (missing `@babel/parser`, the `[...]`-bracket
  worktree path breaking node URL resolution). NONE name my files; the governing
  `orch-1162-map-single-owner` gate passes.
