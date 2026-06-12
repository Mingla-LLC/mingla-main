# SPEC — ORCH-1122 [Cover-picker GIF provider: move the GIPHY key off the build, deliver it server-side]

**Skill:** mingla-forensics · **Phase:** SPEC · **Date:** 2026-06-12
**Branch context:** authored read-only against anchor `/Users/sethogieva/Desktop/mingla-main` on `main`. No product code touched. Implementor worktree to attach: `~/Desktop/mingla-orchs/ORCH-1116-[gif-cover-key]` (rename branch/worktree to `ORCH-1122-gif-cover-key` per COMMS-0024 before shipping).
**Investigation ingested (PROVEN):** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1122_COVER_PICKER_GIF_ROOTCAUSE.md` (SECOND CORRECTION = authoritative).
**Comms ledger:** read on entry. Acked **COMMS-0024** (WARN — three worktrees collided on ORCH-1116; this work renumbered 1116→1122; rename branch/worktree/artifacts before shipping) and **COMMS-0026** (WARN — proven GIF root cause = the 2026-05-25 channel flip `4c3bdfe8f`; the "June-3 runtime regression / OTA var-rename" theory is KILLED). **This SPEC SUPERSEDES the `gif-cover-key` session's in-flight "provision key into dev channel + rebuild" approach** per Seth's 2026-06-12 directive ("move the key to server side; no need to bake in the key") — see §2 + §10 O-1 for the conflict-resolution gate.

---

## 1. Executive summary

The business-app cover picker's **GIFs** tab shows "This source is taking a break." on Seth's everyday dev build because GIPHY is called **client-direct with a build-time-baked public key** (`EXPO_PUBLIC_GIPHY_API_KEY`), and a 2026-05-25 EAS channel flip (`4c3bdfe8f`) left the `development` build profile pointed at an environment that carries no GIPHY key → `publicGiphyKey()` resolves `null` → `not_configured`. Seth's directive: **stop baking the key into the client; deliver it from the server.**

This SPEC verifies the legal constraint first. **GIPHY's API Terms of Service forbid proxying API calls or media through a server** — every request must be made client-side. That **rules out a Pexels-style edge proxy (ARCH-A) for GIPHY.** The ToS-compliant way to satisfy "no baked key" is **ARCH-B: deliver the GIPHY key to the client at runtime from a Mingla endpoint** (a tiny config edge function), and keep the GIPHY trending/search calls client-direct. This removes the build-time key dependency entirely (fixing the channel-flip regression class for GIPHY) while honoring GIPHY's client-direct mandate.

Scope is the **GIF cover provider only**, **business-app authoring only** (consumer app has zero GIPHY code; Pexels and Library tabs are untouched).

---

## 2. Scope & non-goals

### In scope
- A new tiny edge function that returns the GIPHY public key to an **authenticated** business caller at runtime (key held as a Supabase secret, never baked into the client bundle).
- A client-side runtime key resolver that fetches + caches the key from that endpoint, replacing the two `publicGiphyKey()` build-time `EXPO_PUBLIC_GIPHY_*` reads.
- Wiring both GIPHY call sites (`coverProviderBrowseService.ts` `trendingGiphyCovers`, `giphyEventCoverService.ts` `searchGiphyEventCovers`) to await the runtime key.
- Removing the `EXPO_PUBLIC_GIPHY_*` reads from client code; the GIPHY calls themselves stay client-direct (ToS-mandated).
- "Powered by GIPHY" attribution preserved (already present at both call sites' grids — verified, see §4 Component).
- A fails-on-revert CI grep gate asserting no `EXPO_PUBLIC_GIPHY*` read remains in client `src/`.
- Secret-ops: set `GIPHY_API_KEY` as a Supabase secret.

### Non-goals (explicit)
- **NOT a full edge proxy of GIPHY trending/search/media (ARCH-A).** Forbidden by GIPHY ToS (§3 Gate 1). Do not route GIPHY API calls or media URLs through Mingla's server.
- **NOT** the `gif-cover-key` session's "provision the key into the development/preview EAS env + rebuild" fix. Seth's directive supersedes it. **The two approaches must NOT both ship** (see O-1). If this SPEC ships, the EXPO_PUBLIC_GIPHY env vars become dead and should be left unprovisioned (or removed) — NOT added to dev/preview.
- **NOT** a CoverPicker redesign, not the Pexels path, not the Library path, not the consumer app.
- **NOT** re-caching/storing GIPHY media — ToS forbids it; the existing DB rows store `cover_media_source_url` (the giphy.com page URL) + the media URL as the chosen cover, which is the rendered-asset case GIPHY permits (loaded directly from GIPHY media URLs); this SPEC does not change persistence (see §3 Gate 1c).
- **NOT** the broader "every prod-only EXPO_PUBLIC key" hygiene sweep (Sentry DSN etc. — investigation D-1/D-2); out of scope, flagged for a future ORCH.

### Assumptions
- The GIPHY production key (`besogftLvXwocfEHqqkfSEz8kwQyZkxb`, proven live HTTP-200 in the investigation) is the key to serve. O-1 decides whether to mint a separate key.
- All GIF authoring is behind the business sign-in wall → the runtime key endpoint can require auth (mirrors `event-cover-pexels-curated`'s `requireUser`).

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | none | none | — (no GIPHY code in consumer app) |
| 2 | Consumer Android (`app-mobile/`) | NO | none | none | — |
| 3 | Buyer/anon Web | NO | none | none | CoverPicker is an authoring surface, not buyer-facing |
| 4 | **Business iOS** | **YES** | GIF tab loads trending on open + search on query on ALL build profiles (dev/preview/prod) and local Metro, with "Powered by GIPHY" attribution | edge fn + 2 services + runtime-key resolver | **Automatic** — shared services/components |
| 5 | **Business Android** | **YES** | same as iOS | same shared files | **Automatic** — shared RN code |
| 6 | Admin Web | NO | none | none | no CoverPicker |
| 7 | Business Web preview | Incidental-YES | If business web build runs the same JS, GIF tab now works without a baked key (the runtime fetch works in-browser) | same shared files | Automatic; verify the fetch resolves under web bundle |

This is a **business-app-only** change. Consumer/admin/buyer surfaces have zero GIPHY code (investigation E-5: `app-mobile/` has zero GIPHY references) — the one-phrase reason for each NOT-covered surface is "no GIPHY code on this surface."

---

## 3-bis. MANDATORY GATE 1 — GIPHY ToS verdict (web-verified, cited)

**VERDICT: GIPHY FORBIDS PROXYING. Confidence: PROVEN (verbatim from GIPHY's own developer docs, corroborated by the GIPHY API ToS article).** The prior ORCH-1116 assertion that "GIPHY ToS forbids proxying" is **CONFIRMED CORRECT** on this point (it was falsified on timeline/data points, not on the proxy clause). ARCH-A (edge proxy) is therefore **off the table**.

### (a) Proxy — FORBIDDEN. Requests MUST be client-side.
Source: GIPHY API docs — https://developers.giphy.com/docs/api/ (fetched 2026-06-12):
> "Do not proxy requests to GIPHY, either API calls or media URL loads. All requests to GIPHY should be made directly from the client side (e.g. your app or web browser)."

And per-endpoint:
> "GIPHY requires the Trending API call be made from the client side." / "GIPHY requires the Search API call be made from the client side."

Corroborated by the GIPHY API Terms of Service article (https://support.giphy.com/hc/en-us/articles/360028134111-GIPHY-API-Terms-of-Service, via web search; the page itself 403s to automated fetch): "GIPHY prohibits proxying requests to GIPHY, either API calls or media URL loads, with all requests to GIPHY required to be made directly from the client side."

⇒ **ARCH-A (client → Mingla edge fn → GIPHY trending/search → client) VIOLATES the ToS.** Do not build it.

### (b) Attribution — REQUIRED ("Powered By GIPHY").
Source: https://developers.giphy.com/docs/api/ :
> "We require all apps that use the GIPHY API to conspicuously display 'Powered By GIPHY' attribution marks where the API is utilized."

⇒ Both call sites ALREADY render `"Powered by GIPHY"` in the grid footer (`CoverPicker.tsx:1200`, `ExperienceStopPhotoSheet.tsx:627-628`). **Preserve verbatim.** This SPEC adds no attribution debt; it must not remove it.

### (c) Caching / storage — RESTRICTED.
Source: https://developers.giphy.com/docs/api/ :
> "GIPHY media should be loaded directly from the media URLs returned by the API and should not be cached, proxied, rewritten, or stored by the partner." / "Do not strip or modify URLs returned by the API."
An approved exception exists ("partner-operated caching layer … requires prior written approval from GIPHY").

⇒ Mingla currently persists the chosen GIF's media URL + `cover_media_source_url` and renders the asset directly from the GIPHY media URL (not a re-hosted copy) — this is "loaded directly from the media URLs returned by the API," which is the permitted rendering path, NOT a prohibited cache/store of the asset bytes. **This SPEC does not change persistence and must not re-host or rewrite GIPHY URLs.** (Flag for a separate compliance review if Mingla ever wants to mirror GIFs to its own storage — out of scope here.)

### (d) Client vs server key distinction.
GIPHY does not issue a separate "server key" class; it distinguishes **beta keys** (rate-limited 100 calls/hour) from **production keys** (approved, higher limits). The key is a public API key intended for **client-side** use (consistent with (a)). ⇒ Serving the SAME public key to the client at runtime is exactly its intended use; we are only changing the *delivery mechanism* (runtime fetch vs build-time inline), not turning it into a server-only credential.

**Ambiguity note:** none material. The proxy prohibition is explicit and appears in both the developer docs and the ToS article. ARCH-B is the only architecture that satisfies BOTH Seth's "no baked key" directive AND GIPHY's "client-direct" mandate.

**Sources:**
- https://developers.giphy.com/docs/api/ (proxy prohibition, attribution, caching, key tiers — verbatim above)
- https://support.giphy.com/hc/en-us/articles/360028134111-GIPHY-API-Terms-of-Service (GIPHY API ToS — corroborating proxy prohibition)
- https://developers.giphy.com/docs/api/#design-guidelines-and-requirements (attribution design guidelines, already cited in `coverProviderBrowseService.ts:22-23`)

---

## 3-ter. Architecture decision

| | ARCH-A (edge proxy, mirrors Pexels) | **ARCH-B (runtime key delivery)** ✅ RECOMMENDED |
|---|---|---|
| Client → Mingla edge fn → GIPHY → client | YES | NO (key fetch only) |
| GIPHY trending/search called from | server | **client (ToS-compliant)** |
| Removes baked key from client | YES | **YES** |
| ToS-compliant | **NO — proxying forbidden** | **YES** |
| Verdict | **REJECTED** (ToS) | **ADOPT** |

**Recommendation: ARCH-B.** A new edge function (`giphy-public-key`) returns the GIPHY public key to an authenticated business caller at runtime; the client fetches + caches it and continues to call `api.giphy.com/v1/gifs/{trending,search}` **directly** (unchanged endpoints, ToS-compliant). The key is held as a Supabase secret — **never baked into the build** (satisfies Seth's directive) and **never proxied through Mingla for the GIPHY API/media calls** (satisfies GIPHY ToS).

---

## 4. Layered specification

### Database
**None.** No schema, no RLS, no migration. (The GIPHY key lives as a Supabase **secret**, not a table — see §5 Secret-ops.)

### Edge function — `giphy-public-key` (NEW)
- **Path:** `supabase/functions/giphy-public-key/index.ts`
- **Method:** `POST` (also handle `OPTIONS` for CORS; reject other methods 405). (POST mirrors `event-cover-pexels-curated`; a GET would also be acceptable but keep parity.)
- **Auth:** **required.** Mirror `event-cover-pexels-curated`'s `requireUser(req)` exactly — bearer token → `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { global: { headers: { Authorization } } })` → `client.auth.getUser(token)`; on missing/invalid token return `{ error: "auth_required" }` 401. Rationale: all GIF authoring is behind the business sign-in wall; gating the key behind auth limits key exposure to signed-in business users (defense-in-depth; the key is still a public key by GIPHY's design).
- **`verify_jwt`:** Do **NOT** add an entry to `supabase/config.toml` (the curated fn has none → it defaults to `verify_jwt = true`, and additionally does its own `requireUser` bearer check). Match that: rely on the platform default + the explicit `requireUser` check. (If a config.toml entry is added for any reason, it must be `verify_jwt = true`.)
- **Secret read:** `Deno.env.get("GIPHY_API_KEY")`. If unset → return `{ error: "giphy_not_configured" }` **500** (mirrors `pexels_not_configured`). This is the server-side equivalent of the old `not_configured`.
- **Response (200):** `{ "apiKey": "<the giphy public key>" }`. No other fields. CORS headers identical to the curated fn (`Access-Control-Allow-Origin: *`, allow `authorization, x-client-info, apikey, content-type`).
- **No external call, no timeout needed** (it only reads a secret). No GIPHY call happens here — that stays client-direct.
- **Illustrative skeleton (≤3 lines, NOT an implementation):**
  ```
  const authError = await requireUser(req); if (authError) return authError;
  const key = Deno.env.get("GIPHY_API_KEY"); if (!key) return jsonResponse({ error: "giphy_not_configured" }, 500);
  return jsonResponse({ apiKey: key });
  ```

### Service — runtime key resolver (NEW shared module) + 2 edited services
- **New module:** `mingla-business/src/services/giphyRuntimeKey.ts`
  - Export `getGiphyApiKey(): Promise<string>`.
  - Implementation contract: call `supabase.functions.invoke("giphy-public-key", { body: {} })`; on `error`, map to `EventCoverProviderError`:
    - edge `{ error: "giphy_not_configured" }` (500) → `EventCoverProviderError("not_configured", "GIPHY is not configured yet.")` — **preserves the existing `not_configured` error code → existing CoverPicker copy "This source is taking a break." unchanged** (so a genuinely-unprovisioned server still degrades gracefully, no UI churn).
    - edge `{ error: "auth_required" }` (401) → `EventCoverProviderError("auth_required", ...)` (existing copy "Sign in again." exists at both call sites).
    - any other transport/error → `EventCoverProviderError("provider_unavailable", ...)`.
  - **Cache the resolved key in-module** (module-level `let cachedKey: string | null`) for the app session so the picker doesn't round-trip on every tab open / keystroke. A simple memoized promise is sufficient; no persistence to AsyncStorage required (the key is non-secret-by-design but there's no value in persisting it). On a thrown error, do NOT cache (allow retry).
  - Return type: `Promise<string>` (throws `EventCoverProviderError` on failure — matches the existing throw contract of the call sites).
- **Edit `mingla-business/src/services/coverProviderBrowseService.ts`:**
  - DELETE the `envValue` helper (lines ~56-64) and `publicGiphyKey` (lines ~66-67) — IF `envValue` is used by nothing else in the file (verified: it is only used by `publicGiphyKey` here). Pexels path does not use it.
  - In `trendingGiphyCovers`: replace `const apiKey = publicGiphyKey(); if (apiKey === null) throw … "not_configured" …` with `const apiKey = await getGiphyApiKey();` (the resolver throws `not_configured` itself when the server is unprovisioned — preserving the exact existing error semantics). Everything downstream (URLSearchParams, the `fetch` to `api.giphy.com/v1/gifs/trending`, the 429/!ok/normalize handling) is **UNCHANGED** — GIPHY stays client-direct.
  - Update the file's header docstring (lines 5-6, 18-19): GIPHY is still client-direct, but the key now comes from the `giphy-public-key` edge fn at runtime (NOT `EXPO_PUBLIC_GIPHY_API_KEY`). Keep the "proxying forbidden" citation (it's why we DIDN'T build ARCH-A).
- **Edit `mingla-business/src/services/giphyEventCoverService.ts`:**
  - DELETE `envValue` (lines ~29-37) and `publicGiphyKey` (lines ~39-40).
  - In `searchGiphyEventCovers`: keep the `trimmed.length < 2` guard; replace `const apiKey = publicGiphyKey(); if (apiKey === null) throw … "not_configured" …` with `const apiKey = await getGiphyApiKey();`. Everything downstream UNCHANGED.
  - `import { getGiphyApiKey } from "./giphyRuntimeKey";`

### Hook
**None new.** Both call sites manage their own local `status`/`errorCode` state and call the services directly (no React Query hook wraps the GIF provider). The async key fetch is absorbed into the existing `await trendingGiphyCovers(...)` / `await searchGiphyEventCovers(...)` calls — they were already `async` and already inside try/catch that maps `EventCoverProviderError.code` → grid `errorCode`. **No call-site signature changes.**

### Component — both GIF call sites (NO behavioral change, verify only)
- `mingla-business/src/components/ui/CoverPicker.tsx` — `trendingGiphyCovers` at :586, `searchGiphyEventCovers` at :636, both already `await`ed in try/catch that sets `errorCode` from `EventCoverProviderError`. Error copy map at :1153-1159 (incl. `not_configured` "This source is taking a break.") and "Powered by GIPHY" attribution at :1200 are **PRESERVED UNCHANGED**.
- `mingla-business/src/components/experience/ExperienceStopPhotoSheet.tsx` — `trendingGiphyCovers` at :156, `searchGiphyEventCovers` at :215, same error-mapping pattern; `not_configured` copy at :561/:583, "Powered by GIPHY" at :627-628 — **PRESERVED UNCHANGED.**
- All grid states (loading/error/empty/populated, retry vs "Use Library" on `not_configured`) are unaffected — the error codes are identical; only the key's *origin* changes.

### Realtime
N/A.

---

## 5. Success criteria

- **SC-1-iOS / SC-1-Android:** On a **development**-profile business build (the exact build class that is currently broken), open the cover picker → GIF tab → trending GIFs load (no "This source is taking a break."). Typing a 2+ char query loads search results. (This is the regression fix: dev builds no longer depend on a baked key.)
- **SC-2-iOS / SC-2-Android:** Selecting a GIF sets it as the cover and persists exactly as before (provider `giphy`, `cover_media_source_url` set) — no persistence change.
- **SC-3 (all surfaces):** The grid footer shows **"Powered by GIPHY"** on the GIF tab in both `CoverPicker` and `ExperienceStopPhotoSheet`.
- **SC-4 (security/config):** No `EXPO_PUBLIC_GIPHY_API_KEY` / `EXPO_PUBLIC_GIPHY_KEY` read remains anywhere in `mingla-business/src/**` non-test code (the key is no longer baked at build). Grep gate (§9) FAILS if any reappears.
- **SC-5 (server fail-safe):** With `GIPHY_API_KEY` secret UNSET, the edge fn returns 500 `giphy_not_configured` → the client renders the existing `not_configured` state ("This source is taking a break." + "Use Library", no retry). I.e. graceful degradation preserved, just relocated to the server.
- **SC-6 (auth):** An unauthenticated call to `giphy-public-key` returns 401 `auth_required` (the key is not served to anonymous callers).
- **SC-7 (ToS):** GIPHY trending/search are still called **directly** from `api.giphy.com` by the client (NOT proxied through any Mingla edge fn). Verifiable by grepping the services: the `fetch("https://api.giphy.com/...")` calls remain in client code.

---

## 6. Invariants

### Preserved
- **I-NO-SILENT-FAILURES** — the `not_configured`/`auth_required`/`provider_unavailable` error contract is preserved end-to-end (server now emits `giphy_not_configured`/`auth_required`; the resolver maps back to the same client codes). No new silent path.
- **GIPHY-CLIENT-DIRECT (ToS) [implicit invariant, now explicit]** — GIPHY API + media calls MUST be made client-direct, never proxied through Mingla. This SPEC preserves it (only the *key delivery* moves server-side, not the GIPHY calls).
- **EXPO_PUBLIC inlining contract** — by REMOVING the GIPHY `EXPO_PUBLIC_*` reads, the GIF provider no longer participates in the build-time-inline-per-channel hazard that caused this bug. This is the structural cure.

### Proposed NEW (DRAFT — orchestrator flips ACTIVE on CLOSE)
- **I-PROPOSED-GIPHY-NO-BUILD-KEY (DRAFT):** No client code under `mingla-business/src/` may read `EXPO_PUBLIC_GIPHY_API_KEY` or `EXPO_PUBLIC_GIPHY_KEY`. The GIPHY public key is delivered at runtime via the `giphy-public-key` edge fn (Supabase secret `GIPHY_API_KEY`). Enforced by the §9 grep gate. Rationale + recurrence prevention: mirrors `feedback_mingla_business_pk_live_in_production`'s "fail on bad client key provisioning," but inverts it — the cure is to STOP baking client-direct third-party public keys whose absence-per-channel is invisible to CI.
- **I-PROPOSED-GIPHY-NOT-PROXIED (DRAFT):** The GIPHY API endpoints (`api.giphy.com/v1/gifs/*`) and GIPHY media URLs MUST NOT be fetched from any `supabase/functions/**` edge function (ToS compliance). Enforced by a grep gate asserting no `api.giphy.com` string exists under `supabase/functions/`.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | Edge fn returns key to authed caller | valid bearer + secret set | 200 `{ apiKey }` | edge |
| T-2 | Edge fn rejects anon | no/invalid bearer | 401 `{ error: "auth_required" }` | edge |
| T-3 | Edge fn secret unset | secret missing | 500 `{ error: "giphy_not_configured" }` | edge |
| T-4 | Resolver maps 500 → not_configured | edge returns `giphy_not_configured` | throws `EventCoverProviderError("not_configured")` | service |
| T-5 | Resolver maps 401 → auth_required | edge returns `auth_required` | throws `EventCoverProviderError("auth_required")` | service |
| T-6 | Resolver caches within session | two calls | one `functions.invoke`, second served from cache | service |
| T-7 | Resolver does NOT cache on error | error then success | second call re-invokes (no poisoned cache) | service |
| T-8 | trending uses runtime key | resolver returns "K" | `fetch` URL contains `api_key=K`, host `api.giphy.com` | service |
| T-9 | search uses runtime key | resolver returns "K", q="party" | `fetch` to `api.giphy.com/v1/gifs/search` with `api_key=K&q=party` | service |
| T-10 (regression) | No EXPO_PUBLIC_GIPHY read in client src | grep `mingla-business/src` non-test | zero matches (fails on revert) | CI/grep |
| T-11 (regression) | GIPHY not proxied | grep `supabase/functions` for `api.giphy.com` | zero matches | CI/grep |
| T-12 (happy, device) | GIF tab on dev build | open picker → GIF | trending loads, "Powered by GIPHY" shown | UI/device |

The existing `giphyEventCoverService.test.ts` (7 tests) and `coverProviderBrowseService.test.ts` currently delete `process.env.EXPO_PUBLIC_GIPHY_*` and assert `not_configured`. **These tests must be rewritten** to mock `getGiphyApiKey` (resolve → key; reject → `not_configured`) instead of mocking `process.env`. Tag the change `[TEST-MOD-APPROVED ORCH-1122]`. The `not_configured` assertion stays (now driven by the resolver, not the env), preserving T-4 semantics.

---

## 8. Implementation order

1. **Edge fn:** create `supabase/functions/giphy-public-key/index.ts` (copy `event-cover-pexels-curated`'s `corsHeaders` + `requireUser` + `jsonResponse`; read `GIPHY_API_KEY` secret; return `{ apiKey }`). Do NOT add a `config.toml` entry (default verify_jwt=true + requireUser).
2. **Secret-ops:** set the Supabase secret `GIPHY_API_KEY` (§5 below). Deploy the edge fn **from merged main** (per `feedback_edge_deploy_and_migration_apply_hazards` — never from a stale worktree).
3. **Resolver:** create `mingla-business/src/services/giphyRuntimeKey.ts` (`getGiphyApiKey()` + session cache + error mapping).
4. **Service edits:** `coverProviderBrowseService.ts` + `giphyEventCoverService.ts` — delete `envValue`/`publicGiphyKey`, `await getGiphyApiKey()`, update docstrings.
5. **Tests:** rewrite the two service test files to mock the resolver; add edge-fn tests (T-1..T-3) and resolver tests (T-4..T-9).
6. **CI grep gates:** add T-10 + T-11 (see §9).
7. **Device proof:** build/run a **development**-profile business build (this is mandatory — the installed May-30 binary has the null key baked in; only a new build proves the cure) and verify SC-1..SC-3 on iOS + Android. Per `feedback_interactive_elements_must_fire_runtime_proof` + `feedback_always_simulator_repro_described_behaviour`, this is runtime/device proof, not source-wiring.

### Secret-ops notes (§5)
- Set `GIPHY_API_KEY` (value = the proven-live production key `besogftLvXwocfEHqqkfSEz8kwQyZkxb`, OR a freshly-minted key per O-1) as a **Supabase Edge Function secret** (`supabase secrets set GIPHY_API_KEY=...`, or via the dashboard / Management API per `reference_supabase_db_write_paths`). This is a server secret; it is NOT an EAS env var and NOT in any `.env`.
- **Do NOT** provision `EXPO_PUBLIC_GIPHY_*` into the development/preview EAS environments (that is the superseded `gif-cover-key` fix — O-1). After this ships, those EAS vars are dead; recommend deleting them from the `production` EAS env in a follow-up to avoid confusion (out of scope here — flag only).

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** the GIPHY public key is no longer build-time-inlined anywhere in client code; its sole client source is the runtime edge fetch. Reverting any service edit reintroduces an `EXPO_PUBLIC_GIPHY` read, which the gate catches.

**Gate (add to the business-app strict-grep CI suite, e.g. `mingla-business/scripts/` alongside existing gates, or a jest structural test):**
- **G-1 (no baked GIPHY key):** assert `grep -rn "EXPO_PUBLIC_GIPHY" mingla-business/src --exclude-dir=__tests__` returns **zero** non-test matches. MUST FAIL when a service edit is reverted (the old `publicGiphyKey` line returns) and PASS when restored. Protective comment: `// ORCH-1122: GIPHY key is runtime-delivered via giphy-public-key edge fn, NEVER baked (EXPO_PUBLIC inlining per-channel caused the 2026-05-25 4c3bdfe8f regression).`
- **G-2 (GIPHY not proxied — ToS):** assert `grep -rn "api.giphy.com" supabase/functions` returns **zero** matches. MUST FAIL if someone builds the forbidden ARCH-A proxy. Protective comment: `// ORCH-1122: GIPHY ToS forbids proxying API/media through a server — client-direct only.`

Both gates are cheap, deterministic, and directly fail-on-revert for the two failure modes (baked key returns / forbidden proxy added).

---

## 10. Open questions

- **O-1 (key hygiene — Seth/operator):** Serve the existing proven-live production key, or mint a **separate** GIPHY key for the runtime-served path? (No security delta — it's a public client key either way; minting a fresh one only helps rate-limit isolation / future revocation.) Default if no answer: reuse the existing production key.
- **O-2 (SUPERSESSION — Seth, BLOCKING coordination):** The `gif-cover-key` worktree session (COMMS-0024/0026) was speccing the **"provision key into dev/preview EAS env + rebuild"** fix. Seth's server-side directive **supersedes** it. **Confirm only ONE approach ships.** If this SPEC (ARCH-B) ships, the EAS-env-provisioning fix must be **abandoned** (do not also add the EXPO_PUBLIC key to dev/preview — it would be dead config and would re-introduce the baked-key class the gate forbids). Recommend: this SPEC owns the fix; the `gif-cover-key` session's EAS-env work is dropped.
- **O-3 (auth gating):** Confirm the runtime key endpoint should require auth (this SPEC says yes — all GIF authoring is signed-in). If an anonymous authoring surface is ever added, revisit. Default: auth required.
- **O-4 (web preview):** Verify the `supabase.functions.invoke` resolver works under the business **web** bundle (surface 7) — expected yes (same supabase client), but confirm during device/web proof. Non-blocking.

---

## 11. Downstream routing

**Next = mingla-implementor (business side).** Then mingla-tester (business iOS + Android device proof of SC-1..SC-7, with the mandatory dev-build rebuild). Then mingla-orchestrator CLOSE (flip the two DRAFT invariants ACTIVE, reap the worktree, deploy the edge fn from merged main, set the Supabase secret, OTA the business app per `project_ota_deferred_until_new_build` — note a **new build is required** for the currently-installed dev binary regardless of OTA, because the cure removes a build-time read; an OTA refreshes the JS bundle that now does the runtime fetch, which is sufficient for builds made AFTER this lands, but Seth's existing May-30 binary needs a rebuild to drop the baked-null path).

### Scoped allowlist (implementor MAY change)
- `supabase/functions/giphy-public-key/index.ts` (NEW)
- `mingla-business/src/services/giphyRuntimeKey.ts` (NEW)
- `mingla-business/src/services/coverProviderBrowseService.ts`
- `mingla-business/src/services/giphyEventCoverService.ts`
- `mingla-business/src/services/__tests__/coverProviderBrowseService.test.ts`
- `mingla-business/src/services/__tests__/giphyEventCoverService.test.ts`
- NEW edge-fn + resolver test files
- CI grep gate file(s) under `mingla-business/scripts/` (or the established structural-test location)

### DO-NOT-TOUCH
- `mingla-business/src/components/ui/CoverPicker.tsx` (error copy, attribution, grid states — verify-only, NO edits unless a strictly-mechanical import change is unavoidable)
- `mingla-business/src/components/experience/ExperienceStopPhotoSheet.tsx` (same)
- `supabase/functions/event-cover-pexels-curated/index.ts` + `event-cover-pexels-search/index.ts` (Pexels path — template only, do not modify)
- The Pexels services / `pexelsEventCoverService.ts`, all consumer `app-mobile/` code, admin web, buyer web
- DB / migrations / RLS (none in scope)
- `mingla-business/eas.json` — do **NOT** add EXPO_PUBLIC_GIPHY to any profile (that's the superseded fix)

The implementor must **stop-and-amend** before touching anything outside the allowlist.

**Working tree:** `~/Desktop/mingla-orchs/ORCH-1116-[gif-cover-key]/` — rename to `ORCH-1122-gif-cover-key` (branch + worktree + retag artifacts) per COMMS-0024 BEFORE shipping; `git fetch origin && git rebase origin/main` first (spawn-from-stale-anchor).
