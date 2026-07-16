# WP2-867 — GOOGLE lane implementation report

**Issue:** #867 (child of #852 Full Rooms Ad Engine) — **WP2 = the GOOGLE lane ONLY** (Snapchat is WP5; its fail-close stub is untouched).
**Binding contract:** `SPEC_ISSUE-867_SNAPCHAT_GOOGLE_CHANNELS.md` body + **Amendment A1** (G-1…G-14 + the PROVEN G-P3 reference mutate body) · `SPEC_ISSUE-862` **Amendment A4** (the ChannelAdapter) · `PROOF_LOG.md` G-P1…G-P3 · merged `_shared/meta.ts` as the house adapter pattern.
**Worktree:** `~/Desktop/mingla-orchs/issue-867-snapchat-google-channels` on branch `issue-867-snapchat-google-channels`, rebased onto `origin/main` (carries the merged WP1 foundation, PR #893) — rebase was clean, zero conflicts.
**Author:** mingla-implementor+claude · **Date:** 2026-07-15
**Status label:** **implemented, partially verified** — every pure/wire-shape behavior is unit-verified (116/116 tests green incl. all merged WP1 suites); the LIVE Google legs (real mint, real validate-only mutate, real connect) are deliberately NOT exercised — the dispatch forbids live platform calls from this session; the tester owns them.

---

## 1. Summary (plain English)

The Ad Engine's Google lane is now real code, not a fail-close stub. With the seven `GOOGLE_ADS_*` secrets seeded, an admin can connect the live Google Ads account (`3623860476` under MCC `8284700017`, v24), and `admin-ad-create-campaign` will build a complete SEARCH campaign — budget, paused campaign, geo targeting, ad group, responsive search ad, keywords — in **one atomic Google request** that either fully succeeds or fully fails (no orphans possible, by Google's own guarantee). Every field the live battle-test proved necessary is encoded, including the v24-required EU-political-advertising declaration (G-14) that exists in no public spec. The sync function now also re-checks, on every sweep and for **every channel**, that the page an ad points at is still public and live, and auto-pauses the campaign with an audit trail if it is not — the single biggest account-level policy risk on Google.

## 2. SPEC success-criteria coverage (Google ACs, per A1.4)

| AC | Status | Where / how verified | Commit |
|---|---|---|---|
| **AC-G-1** — secrets unset → **409 `google_not_provisioned`**, zero Google calls | ✓ implemented + unit-verified | `resolveGoogleEnvConfig` throws `AdNotConnectedError("google_not_provisioned")` before any fetch; `admin-ad-connect`/create map it to 409; tests assert **zero fetch calls** on connect/setStatus/getStatus/setBudget with env unset | `a90ec252a` / tests `f9fcc65d7` |
| **AC-G-2** — connect validates via GAQL (customer `3623860476`, login-customer-id `8284700017`) + persists; create = ONE atomic `googleAds:mutate` (`partialFailure:false`) matching G-P3 incl. G-14, PRESENCE, country-scoped geo criterion, RSA 3×2 minima, keyword, everything PAUSED; budgets cents→micros | ✓ implemented; wire-shape unit-verified; **live leg UNVERIFIED (tester-owned)** | `googleFetchCustomer` (connect + preflight); `buildGoogleMutateOperations` asserted against the exact G-P3 shape (op order, temp-ID defined-before-referenced, G-14, PRESENCE, PAUSED, search-only networks, targetSpend, `partialFailure:false`); RT-5 money tests ($5→5,000,000 / $20→20,000,000); mocked-wire flow test asserts headers (Bearer + `developer-token` + digits-only `login-customer-id`) and parsed ids | `a90ec252a` |
| **AC-G-3** — destination re-checker: a campaign whose destination stops being public/live/future is auto-paused by the next sync + audit row | ✓ implemented (channel-generic — Meta benefits too); gate unit-verified; pause flow source-verified only | `destinationStillPublicLive` in `adChannel.ts` (exact create-time gate: `business_public_events_view` + `scheduled|live`, `business_public_brands_view`; unknown types fail-close) + the sync-loop auto-pause (`action='pause'`, `provider_response.reason='destination_not_public'`) | `a90ec252a` |
| **AC-G-4** — no launch/pause/sync path can emit `REMOVED`; the status writer only produces ENABLED\|PAUSED | ✓ implemented + unit-verified | `googleStatusForAdvertiserStatus` exhaustive switch (hostile cast throws); `buildGoogleStatusUpdateOperation` pins `updateMask:"status"`; whole-request blast checks assert `"REMOVED"` appears nowhere in any create/update body | `a90ec252a` |
| AC-S-1…S-13 (Snapchat) | **out of WP2 scope** — stub intact, untouched | — | — |

Also implemented per the dispatch scope beyond the lettered ACs: geo resolver (`suggestGeoTargetConstants`, countryCode-scoped, canonical-name disambiguation, resolved id + canonical name persisted into `targeting` jsonb), preflight google leg, registry wiring, `setBudget` cents×10,000→micros via the shared boundary helper, dual review vocabularies (G-3) into `ads.review_detail`.

## 3. Files changed

| File | Δ | What |
|---|---|---|
| `supabase/functions/_shared/google.ts` | **NEW ~1,090 lines** | The Google adapter: env config (fail-close), OAuth mint + module-scope cache, REST wrapper (Bearer/developer-token/login-customer-id headers, request-id capture), error normalization + ya29./1// scrubbing, RSA/keyword/final-URL validators, geo resolver (seed constants + suggest picker), the G-P3 mutate builder + atomic `googleCreateFullCampaign`, REMOVED-never status writer, GAQL status reads, `buildGoogleReviewDetail`, `googleFetchCustomer`, the `googleAdapter` |
| `supabase/functions/_shared/adChannel.ts` | +~80 | Registry `google` → live adapter; `destinationStillPublicLive` + minimal structural client types (GR-52) |
| `supabase/functions/admin-ad-connect/index.ts` | +~130 | Google branch: 409 provisioning gap / 424 broken token (+`invalid` row), GAQL validation, ENABLED-only connect, `dev_token_oauth` row (MCC → `external_org_id`); lane-correct default token env name |
| `supabase/functions/admin-ad-create-campaign/index.ts` | +~330 | Self-contained google branch (validators → 409/idempotency → destination → geo resolve → tracking template → atomic create/validateOnly → persist → audit) + `buildGoogleTrackingUrlTemplate`; **Meta path byte-identical** |
| `supabase/functions/admin-ad-campaign-sync/index.ts` | +~75 | GR-52 destination re-checker (channel-generic auto-pause + audit; fail-open on transient read errors) + per-platform `review_detail` (google → G-3 payload) |
| `supabase/functions/admin-ad-preflight/index.ts` | +~130 | `googlePreflight` (P1 mint+dev-token via one GAQL, P2 ENABLED+non-test, P4 n/a → #865, P5 BASIC, P6 geo-suggest London/GB) + routing; stub text updated |
| `supabase/functions/_shared/__tests__/google.test.ts` | **NEW, 34 tests** | See §6 |
| `supabase/functions/_shared/__tests__/issue867_wp2_google_flow.test.ts` | **NEW, 7 tests** | See §6 |
| `.github/workflows/supabase-migrations-and-stripe-deno.yml` | +~30 | Both test files appended to `ad-engine-deno-tests`; `GOOGLE_ADS_*` env pinned empty (fail-close assertions) |
| `COMMS_LEDGER.md` | acks | COMMS-0102 + COMMS-0101 WARN acks appended (see §12) |

## 4. Data-model changes applied

**NONE.** The WP1 five-table schema (`20261230000000_issue_862_ad_engine_foundation.sql`) covers everything WP2 needs: `external_ad_id` stores the `{ad_group_id}~{ad_id}` composite; `ads.review_detail` jsonb carries the G-3 dual-vocabulary payload; resolved geo (criterion id + canonical name) lives in the `targeting` jsonb. **No migration file, no `db push`, no drift risk** (COMMS-0102's duplicate-prefix hazard not touched).

## 5. Edge functions touched (deploy list — orchestrator/operator, from MERGED main)

All five `admin-ad-*` share `_shared/`; deploy the set together:

| Function | `verify_jwt` to preserve |
|---|---|
| `admin-ad-connect` | `true` |
| `admin-ad-create-campaign` | `true` |
| `admin-ad-campaign-action` | `true` (no source change; picks up `_shared` changes) |
| `admin-ad-campaign-sync` | `true` |
| `admin-ad-preflight` | `true` |

`supabase/config.toml` unchanged (WP1 blocks already correct).

## 6. Regression tests added (append-only — no existing test modified or deleted)

- `supabase/functions/_shared/__tests__/google.test.ts` — 34 tests: AC-G-1 fail-close with zero network calls; env dash-stripping + v24 default; G-P3 op ordering; temp-ID negative/unique/**defined-before-referenced**; **G-14** field; PAUSED+SEARCH+targetSpend+PRESENCE+search-only networks; PAUSED ad + ENABLED ad group; RT-5 money boundary (500¢→5,000,000 / 2,000¢→20,000,000; `amountMicros`/`cpcBidMicros` as int64 strings); finalUrls-vs-trackingUrlTemplate split (OneLink appears nowhere on the ad); RSA AdTextAsset shape; keyword PHRASE default + negative:true ops; `partialFailure:false` + validateOnly envelope; whole-request REMOVED blast check; `{ag}~{ad}` composite parsing; AC-G-4 status writer (hostile cast throws) + per-level update ops; GAQL-injection id hygiene; G-4 RSA validators (all boundaries); GR-15/GR-73 keyword rules; final-URL https/2,084-byte caps; GR-37 **London/Ontario hazard** + REMOVAL_PLANNED skip + seed constants; G-3 review detail; secret scrubbing; `normalizeGoogleError` (errorCode key + requestId); mint cache (1 HTTP call per window, re-mint after reset); mint-failure fail-close; registry wiring; sequential-create lockout + absent rollback hooks; setBudget level guard.
- `supabase/functions/_shared/__tests__/issue867_wp2_google_flow.test.ts` — 7 tests: atomic-create mocked-wire flow (exactly 2 calls: mint + ONE mutate; headers; `partialFailure:false`; parsed ids incl. the composite; request-id capture); validateOnly zero-fabrication; GR-52 gate (exact view names + `scheduled|live` filter, missing-slug fail-close with zero queries, brand view, unknown-type fail-close).

**Fails-on-revert verified at `a90ec252a` (tests in `f9fcc65d7`), by TRUE LINE DELETION:**
1. Deleted the `containsEuPoliticalAdvertising: GOOGLE_EU_POLITICAL_ADVERTISING_VALUE,` line → the G-14 test **FAILED** (`0 passed | 1 failed`); restored → green.
2. Deleted the campaign `status: "PAUSED",` line → the G-P3 PAUSED test **FAILED** (`0 passed | 1 failed`); restored → green.

**Full-suite result (all merged WP1 suites MUST stay green — they do):**
```
deno test --allow-env --allow-read --no-check \
  adChannel.test.ts meta.test.ts issue862_wp1_tester_adversarial.test.ts \
  issue862_wp1_rework.test.ts issue862_wp1_retest_adversarial.test.ts \
  google.test.ts issue867_wp2_google_flow.test.ts
ok | 116 passed | 0 failed (165ms)
```
`deno check` clean on all 7 touched/new TS modules. Strict-grep gates:
```
ISSUE-862 ad-token-env-server-only SELF-TEST passed.
ISSUE-862 ad-token-env-server-only gate passed (16 token names, 7 client trees clean).
ISSUE-862 reddit-configured-status gate: ... pass (gate armed).
```
(The RT-4 token gate already carried `GOOGLE_ADS_REFRESH_TOKEN` / `GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_OAUTH_CLIENT_SECRET` from WP1 — no gate change needed.)
Local Deno is 2.7.14; CI runs 1.46.x with `--no-check` — same flags used locally.

## 7. Old → New receipts

### supabase/functions/_shared/google.ts (NEW)
**Before:** did not exist; the registry served a fail-close stub (424 `google_not_connected`).
**Now:** the full A4 adapter. `connect` mints a real OAuth token (cached in memory, never persisted); `googleCreateFullCampaign` issues the ONE atomic G-P3 mutate; `setStatus`/`getStatus`/`setBudget` are per-level GAQL/mutate implementations; sequential `createX` methods fail-close on unprovisioned env FIRST, then throw a typed `google_atomic_create_only` error (the atomic request is the only create path — A1.1(4)); `rollbackCampaign`/`rollbackCreative` deliberately absent (native atomicity; REMOVED is permanent, no delete path exposed).
**Why:** WP2 dispatch (a)+(b); A1.3; PROOF G-P1…G-P3. **Lines:** ~1,090.

### supabase/functions/_shared/adChannel.ts
**Before:** `google: failCloseStub("google")`; no destination re-check helper.
**Now:** registry serves the live adapter; `destinationStillPublicLive` encodes the create-time destination gate for the sync re-checker, channel-generically.
**Why:** dispatch (c)+(d); GR-52. **Lines:** ~80 added; nothing removed except the stub registry line.

### supabase/functions/admin-ad-connect/index.ts
**Before:** every non-meta platform → 424 stub.
**Now:** google branch — secrets gap → **409** `google_not_provisioned` (checklist text, no row write); mint/API/suspended-account failure → **424** `google_not_connected` + `invalid` row upsert (QA P2-4 parity); success → GAQL-validated `connected` row (`auth_kind='dev_token_oauth'`, customer id → `external_account_id`, MCC → `external_org_id`, api_version/test_account in `extra`).
**Why:** AC-G-1/AC-G-2. **Lines:** ~130 added.

### supabase/functions/admin-ad-create-campaign/index.ts
**Before:** Meta-shaped end-to-end; google requests died on Meta validators (`invalid_objective` etc.) after a wrong 424.
**Now:** a self-contained google branch after the shared budget checks: RSA/keyword/cpc/targeting/destination validation (422s) → connection (409) → idempotent replay → destination resolve (`destination_not_public` 422) → final-URL policy check → geo resolve via suggest (resolved id + canonical name persisted) or verified country seeds → tracking template build → atomic create (or validateOnly) → best-effort delivery read-back → persist campaign/ad-set/ad rows → audit row with Google `request_id`. Meta path untouched.
**Why:** AC-G-2; A1.1(5); GR-37. **Lines:** ~330 added.

### supabase/functions/admin-ad-campaign-sync/index.ts
**Before:** status sync only; destination checked once at create; `review_detail` always Meta-built.
**Now:** every sweep re-asserts each campaign's destination (any platform); a dead destination auto-pauses an ACTIVE campaign on the platform + in the DB and appends `action='pause'` / `reason='destination_not_public'`; read errors fail-OPEN (never pause on a view hiccup — next sweep retries); google ads get the G-3 dual-vocabulary `review_detail`; the sync output rows carry `destination_ok`.
**Why:** dispatch (c); GR-52; G-3. **Lines:** ~75 added.

### supabase/functions/admin-ad-preflight/index.ts
**Before:** google → stub 424.
**Now:** `googlePreflight` — one GAQL SELECT customer answers P1 (mint + dev token) and P2 (ENABLED, non-test, billed); P5 pass-by-proof (BASIC); P6 = live geo-suggest London/GB (the G-P2 path); routing + sweep updated; other stubs intact.
**Why:** dispatch (d). **Lines:** ~130 added.

## 8. Cross-surface impact

| Surface | Affected? | Notes |
|---|---|---|
| Consumer iOS / Android | No | back-office engine only |
| Buyer/anonymous Web | Read-only reference | destination views read at create + re-check; no code change |
| Business iOS / Android | No | — |
| **Admin Web** (`mingla-admin`) | **No code change in WP2** | The dispatch scope is backend-only. The google tab still renders from the edge responses (409 checklist detail). The SC-7→connected UI flip is #864/admin-surface work — flagged in §10 |
| Business Web preview | No | — |
| **Backend** (`supabase/functions`) | **YES — the whole WP** | parity server-authoritative; no manual parity risk |

## 9. Smoke result

No simulator/device surface exists for this WP (backend only). Runtime evidence = the 116-test suite incl. the mocked-wire atomic-create flow (headers, body, id parsing) and the fail-close zero-network assertions. **No live Google call was made from this session** (hard guard) — not even validate-only; the tester owns the live legs: connect (GAQL against `3623860476`), a `validate_only=true` create (proven-clean shape, zero objects), then the live-fire per §8 of the spec.

## 10. Known issues / deferred (no `[TRANSITIONAL]` markers in code)

1. **Tracking-template semantics need live proof (#865 adjacency).** `buildGoogleTrackingUrlTemplate` emits `go.usemingla.com/w36m?pid=google_ads&af_c_id={campaignid}&af_ad={creative}&deep_link_value=…&af_r={lpurl}` — ValueTrack macros + AppsFlyer `af_r` redirect-to-final-URL. The exact AppsFlyer-sanctioned `pid`/param set for Google click-tracking is attribution work (#865); the template is stored + sent but should be verified in the tester's validate-only/live-fire leg before spend.
2. **Country-level targeting is limited to the verified seeds** (US 2840 / GB 2826 / NG 2566); any other bare country 422s `geo_not_resolvable` (named locations still resolve via suggest in ANY country). Deliberate — never guess a criterion id (GR-37).
3. **`cpc_bid_cents` is optional** — omitted, the ad group carries no `cpcBidMicros` (targetSpend needs none); provided, it converts ×10,000 at the boundary. G-P3 carried the field; the spec does not pin a default, so none was fabricated.
4. **DB-persist failure after a successful atomic create** leaves PAUSED objects on Google (zero spend risk) with a `create_failed` audit row carrying all ids + note — there is no delete path by design (REMOVED is permanent). Manual reconciliation from the audit row.
5. **`ad_sets` row stores `status='ACTIVE'`** for the ENABLED ad group (the proven G-P3 shape: paused parent gates delivery). Deviates from the everything-PAUSED row default but mirrors platform truth.
6. **`optimization_goal='MAXIMIZE_CLICKS'` / `bid_strategy='TARGET_SPEND'`** chosen for the NOT NULL `ad_sets` columns (Google search has no optimization_goal concept; targetSpend IS maximize-clicks — GR-55).
7. **Admin UI google tab** (SC-7 → connected states, create form with headlines/descriptions/keywords) not built here — backend contract is ready for #864.
8. **Review-poll cadence** (A1.2 item 9's 30–60-min cron) is not scheduled here; `admin-ad-campaign-sync` accepts admin-triggered sweeps (and its GR-52 re-check runs on every sweep). The cron wiring is the A1.2-9 upgrade, cross-channel, owned by the sync/cron work package.
9. **Business-lane env names** follow the house META_MINGLABIZ_ convention → `GOOGLE_ADS_MINGLABIZ_*` (unprovisioned; fail-close). The spec names only the consumer set — flagged for the conductor.

## 11. Operator action required

1. **Seed the seven Function Secrets** (A1.3-0; Supabase project `gqnoajqerqhnvulmnyvv`): `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID=8284700017`, `GOOGLE_ADS_CUSTOMER_ID=3623860476`, `GOOGLE_ADS_API_VERSION=v24`. Until seeded, everything correctly 409s `google_not_provisioned`.
2. **No migration** — nothing to `db push`.
3. **Edge deploys from MERGED main** (orchestrator-owned): the five `admin-ad-*` functions listed in §5, `verify_jwt=true` each.
4. **Calendar the v24 sunset (~2027-04)** + the quarterly version/geo-constant checkpoint (G-1 / GR-37) if not already registered from A1.

## 12. Comms-ledger activity

- **COMMS-0102 (WARN, OPEN)** acked: no new migrations (duplicate-prefix hazard untouched); the crawler-permissive-image constraint doesn't bind this lane (SEARCH+RSA is text-only; Google never fetches remote image URLs — G-12).
- **COMMS-0101 (WARN, OPEN)** acked: `minglabiz.onelink.me` is never used; finalUrls carry the canonical page; the OneLink rides only in `tracking_url_template`.

## 13. Discoveries for Orchestrator

1. **WP1's `admin-ad-create-campaign` validate-only path calls `adapter.createCreative` unconditionally when defined** — fine for Meta/Google (Google's is absent), but worth noting for WP5: Snapchat has no validate-only, so its `createCreative` must never be invoked from that block (a real media/creative would be created). The Snapchat WP needs to gate that path.
2. **The WP1 registry test** (`adChannel.test.ts` "the four unbuilt adapters fail-close") counts google among "unbuilt". It stays green because google's sequential `createX` fail-closes on unprovisioned env before the atomic-only error (correct precedence), and CI pins the GOOGLE env empty. When a future WP wants that test retitled/split, it needs a `[TEST-MOD-APPROVED]` ORCH — I did not touch it (append-only).
3. **`admin-ad-campaign-action`'s launch path sets ad_set + ad ACTIVE per-entity sequentially** — on Google each is a separate mutate; fine at WP2 scale (1 ad group, 1 ad), but a future multi-ad-group campaign would want a batched mutate.
4. **Preflight P6 and the create geo-resolve are live read-only Google calls** — cheap, but they count against the BASIC-tier daily op quota (15k ops/day); no metering exists yet across preflight sweeps.

## 14. Commits

| Hash | Content |
|---|---|
| `a90ec252a` | Product code: `_shared/google.ts` + registry + `destinationStillPublicLive` + the four edge-fn extensions |
| `f9fcc65d7` | Tests (append-only, 41 new) + CI wiring |
| (this commit) | Report + COMMS-0101/0102 acks |

**Route back to the orchestrator for REVIEW → tester dispatch** (live legs: connect, validate-only create, GR-52 pause behavior, then the spec-§8 live-fire). Not deployed, not merged, not pushed.
