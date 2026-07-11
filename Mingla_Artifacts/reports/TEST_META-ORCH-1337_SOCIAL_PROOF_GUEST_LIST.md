# TEST — META-ORCH-1337 [social-proof-guest-list]

**Phase:** TEST (mingla-tester, Claude side) · full-feature verification across all 5 legs + CI-guard
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on branch `META-ORCH-1337-social-proof-guest-list` at `214689801`
**Prod:** `gqnoajqerqhnvulmnyvv` (live-fire against deployed RPCs; migrations `20261225000000` + `20261226000000` confirmed applied + registered)
**Date:** 2026-07-10
**Adversarial test added:** `supabase/migrations/__tests__/orch_1337_guard_first_privilege.tester.adversarial.test.ts` (NEW; fails-on-revert proven — §Step-0.5)

---

## 0. OVERALL VERDICT

**CONDITIONAL PASS** — backend legs PROVEN by prod live-fire; UI-runtime legs CAPPED on a pre-existing native-build blocker (not a 1337 defect) + thin prod data, with all static/adversarial/CI evidence green and the security-critical data path proven at the source. **1 P2 finding (defense-in-depth grant gap, guard holds — no exposure). 0 P0, 0 P1.**

| Leg | Verdict | Basis |
|---|---|---|
| **ORCH-1338 backend read RPCs** | **PASS (proven, live-fire)** | Every SC live-fired on prod; anti-scrape + privacy matrix proven with a self-owned seed (torn down) |
| **ORCH-1339 write RPC (`biz_set_event_guest_privacy`)** | **PASS (proven, live-fire)** | Guards (anon/non-manager/host) + no-clobber partial write proven live |
| **ORCH-1339/1340 card runtime** | **CONDITIONAL PASS — runtime CAPPED** | Static+adversarial deno green; data-path proven live; sim red-screens on pre-existing `react-native-keyboard-controller` native drift (ORCH-1171/COMMS-0047), not a 1337 defect |
| **ORCH-1341 sheet (SC-R)** | **CONDITIONAL PASS — SC-R BLOCKED (operator)** | 27/27 suites + 11-class regression walk green; the Seth-mandated recorded open/close/z-index proof is not producible without a fresh app-mobile dev build (blocker below) |
| **ORCH-1342 web funnel** | **CONDITIONAL PASS — [NOW] core proven, interactive CAPPED** | Names-never-on-web + F-12 PROVEN from the served `expo export` artifact; SSOT/resolver/builder green; interactive gate + cold/warm sim capped; SC-10/11/12 capped per COMMS-0083 |
| **CI-guard registration** | **PASS** | 164 deno + 63 jest + 2 strict-grep gates green at HEAD; my adversarial suite added & fails-on-revert proven |

**Operator-unblock ask for full UI-runtime closure:** a fresh app-mobile iOS dev build (per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md`). NO app-mobile dev build on this machine includes ORCH-1171's `react-native-keyboard-controller` native module — every installed/DerivedData build red-screens the current JS bundle at `_layout.tsx:39` before any screen renders. This is a workspace-wide native/JS drift, independent of META-ORCH-1337.

---

## 1. ORCH-1338 [guest-read-backend] — PASS (proven, live-fire)

All probes against prod `gqnoajqerqhnvulmnyvv` via PostgREST (anon key) + `execute_sql` with `SET LOCAL role authenticated` + `request.jwt.claims` to simulate specific viewers. A self-owned fixture (prefix `zz1337` / event `eeee1337-…0001` / users `11111337-…`) was seeded across the full privacy matrix, live-fired, and **fully torn down (0 residual rows)**. The live host event `8b84539d…` (BBQ Pool Party) was **READ ONLY**.

| SC | Verdict | Live evidence (verbatim) |
|---|---|---|
| **SC-1** anon RSVP counts + sample whitelist | **PASS** | Seeded open event: `{"goingCount":7,"capacity":10,"privateGuestList":false,"hideRemainingCount":false,"sample":[{"avatarUrl":"…/g1.jpg","isMinglaUser":true},{"avatarUrl":"…/g2.jpg","isMinglaUser":true}]}` — going=Σ(1+plus_count)=7; sample keys are EXACTLY avatarUrl+isMinglaUser (no names/ids); order created_at ASC |
| **SC-2** ticketed absolute count (F-3 fix) | **PASS** | Real prod event `de1211d0…`: `{"entityType":"event","goingCount":2,"capacity":30,…,"sample":[]}` — goingCount is the absolute COUNT of valid/used/transferred tickets; capacity=Σ finite tiers (30). F-3 unlimited-hole closed. |
| **SC-3** privateGuestList gate | **PASS** | Live host `8b84539d…`: `{"privateGuestList":true,…,"sample":[]}`; FN-B on the same → `guest_list_private` (RAISE P0001) |
| **SC-4** sample privacy (private/no-avatar/blocked excluded) | **PASS** | anon sample = [G1(public+avatar), G2(friends+avatar)] — G3(private) EXCLUDED, G4(no-avatar) EXCLUDED, unlinked EXCLUDED. Authed-as-G5 (who blocks G1): sample = [G2] only → block exclusion proven both-directions |
| **SC-5** FN-B anon fail-closed | **PASS** | Anon PostgREST call → `{"message":"authentication_required"}` (P0001). Zero rows crossed the wire. |
| **SC-6** FN-B identity mapping | **PASS** | Authed-as-G5: rows = G2 named(partySize 2), G4 named(avatar null, public), G3 **anonymous**(all-null, isMinglaUser:true, isAnonymous:true), unlinked(isMinglaUser:**false**, partySize 2); G1 EXCLUDED(blocked); named-first ordering. Contact-leak scan: `leaks_name=f, leaks_email=f, leaks_phone=f, leaks_private_name=f` |
| **SC-7** row-cap scrape | **PASS** | Seeded 105 going rows: `p_limit=10000 → returned 100, hasMore true`; `p_limit=0 → 1`; `p_limit=-5 → 1`; offset walk deterministic (ofs0→G2, ofs1→G4, no dup/skip); `offset 100 → returned 4, hasMore false`. No combination exceeds 100. |
| **SC-8** draft/deleted → null / not_available | **PASS** | Draft event → FN-A `null`; ended event → FN-B `event_not_available` (P0001) |
| **SC-9** PostgREST reachability | **PASS** | Both functions callable post-apply; `NOTIFY pgrst` present; live calls succeed |
| **SC-10** RLS unchanged | **PASS** | Migration is functions-only (2 CREATE FUNCTION, zero policy/table DDL — static suite + `execute_sql` schema read) |
| **SC-11** ended answers FN-A | **PASS** | ended event → FN-A answers `{"goingCount":107,…,"sample":[G1,G2]}` (page parity); FN-B raises `event_not_available` |

**Adversarial angles beyond the implementor (all live-proven):** cross-event id confusion / random uuid → `null` (no oracle); malformed uuid → PostgREST `22P02` (no crash, no info leak); deleted/draft probe → `null`; concurrent flip-then-read (host set pgl=true via RPC, then anon FN-A immediately) → sample emptied server-side in one round-trip; contact-data seeded on the unlinked row (`SECRETNAME`/`zz1337-leak@…`/`+15550001337`) → **absent from every FN-B output** (raw-text scan).

---

## 2. ORCH-1339 write RPC + card gates — PASS (backend) / runtime CAPPED (card)

### 2a. `biz_set_event_guest_privacy` — PASS (proven, live-fire)

| SC (1339) | Verdict | Live evidence |
|---|---|---|
| **SC-9 guards** | **PASS** | anon → `authentication_required`; non-manager (G5) → `not_authorized` (P0001, line 28); host (G0, rank 60) → succeeds |
| no-clobber partial write | **PASS** | Host call `(pgl=true, hrc=NULL)` → echo `{"privateGuestList":true,"hideRemainingCount":false}`; theme AFTER: `hideAddressUntilTicket:true` **survived**, `hideRemainingCount:false` **preserved**, `privateGuestList:true` updated. ORCH-1172/1296 leaf-merge proven live. |
| gate propagation | **PASS** | After the flip, FN-A → `sample:[]` + `privateGuestList:true`; FN-B → `guest_list_private` |

### 2b. Card runtime (SC-1..SC-6, SC-13) — CONDITIONAL PASS, runtime CAPPED

- **Static/adversarial:** `orch_1339_momentum_cross_entity` (16) + `orch_1339_momentum_adversarial` (12) + `orch_1340_guest_identity_privacy`(8) + `_adversarial`(9) + rewritten `orch_1157_rsvp_momentum` — **all green** in the 164-test deno battery; business jest 63/63 (incl. trip/experience guest-privacy suites).
- **Data path proven live:** the payload the card renders (counts, gates, avatar sample keys) is exactly what the backend live-fire produced — so the card's inputs are correct.
- **Runtime dead-tap proof:** **CAPPED.** iOS sim red-screens on a pre-existing native drift (see §Blocker). The current worktree bundle **did compile & bundle clean** (`iOS Bundled 38597ms … (5315 modules)`, zero Metro errors) — a real full parse of every 1339/1340 file. Cross-platform screenshot-per-state (T-14) requires a fresh dev build.

---

## 3. ORCH-1341 [guest-list-sheet] — CONDITIONAL PASS; SC-R BLOCKED (operator)

- **Suites:** `orch_1341_guest_list_sheet` (19) + `_adversarial` (8) = 27/27 green; the 11-class sheet-regression walk (META-0991 sole-gorhom, COMMS-0084 no-second-Modal, 1043 header-sibling, 1064 stock-motion, 1138 fixed-snap, 1303 isInteraction, 1171 no-TextInput, …) is source-pinned; strict-grep `meta-orch-0991` + `i-bottomsheet-inline-scroll-binding` + `orch-1303` PASS.
- **Data path proven live:** `peer_list_event_guests` (the sheet's fetch) is fully live-fire proven in §1 — rows, anonymity, blocked-exclusion, cap, contact-safety all correct.
- **SC-R (the Seth-mandated recorded open/close/z-index proof): BLOCKED — needs operator.** Not producible: every app-mobile dev build on this machine predates ORCH-1171's `react-native-keyboard-controller` native module and red-screens the current bundle at the root layout before any sheet can mount (screenshot in evidence). Live add-friend/message live-fire (test-account pair) is likewise gated on a runnable dev build.
- **Verdict rationale:** no defect found (source + data path clean); SC-R is an environment-BLOCKED runtime proof, so this leg cannot reach PASS — it is CONDITIONAL PASS with the SC-R runtime deferred to the operator-unblock ask. Not a FAIL (no defect), not a false PASS (tester discipline forbids UI PASS without proven live-fire).

---

## 4. ORCH-1342 [web-funnel] — CONDITIONAL PASS; [NOW] core proven, interactive CAPPED

Proof from the **actual served `expo export -p web --clear` artifact** (`dist/`), not source:

| SC | Label | Verdict | Evidence (served bundle) |
|---|---|---|---|
| **SC-3** names never on web (D1) | [NOW] | **PASS** | `peer_list_event_guests` appears in **0** files of the entire web dist (names cannot be fetched); `pg_public_social_proof` (avatars-only) in exactly 1 — the only social-proof read on web, proven nameless in §1 |
| **SC-5** F-12 store URL | [NOW] | **PASS** | stale `apps.apple.com/app/mingla"` slug = **0 files**; only `id6760440898` (consumer, correct) + `id6768737367` (business, grandfathered discovery D-2) present; SSOT strict-grep gate PASS |
| gate ships | [NOW] | **PASS** | `SeeWhosGoingGate-….js` lazy chunk emitted; "See who's going" copy in the served bundle |
| SC-7 resolver/dispatcher | [NOW] | **PASS (unit)** | `oneLinkResolver.orch1342` 14/14 + `orch_1342_cold_seed_landing` 11/11 green |
| **SC-1/SC-2** phone panel / desktop QR interaction | [NOW] | **CAPPED (runtime-web)** | browser (Playwright) drive not performed; static + jest green; gate copy + QR builder unit-proven |
| **SC-8/SC-9** cold `/e/` + warm landing | [NOW] | **CAPPED (sim)** | consumer sim blocked by the native drift (§Blocker); mapper 8/8 + screen ladder source-pinned |
| **SC-10/11/12** OneLink deferred install | [NATIVE-GATED] | **CAPPED — "awaiting Seth's AppsFlyer go-live (COMMS-0083)"** | per dispatch: cap, never fail; URL composition unit-proven at T-4 |

Business-authed wizard runtime (trip/exp toggle steps): **standing cap** — biz-web authed runtime unreachable; structural + jest (63/63) evidence caps the claim.

---

## 5. P0/P1/P2 findings

### P2-1 — anon retains EXECUTE on the two authed-only RPCs (defense-in-depth gap; guard holds; NO exposure)

- **Evidence (live, prod):** `has_function_privilege('anon','public.peer_list_event_guests(uuid,integer,integer)','EXECUTE') = true` and `…biz_set_event_guest_privacy… = true`. `pg_proc.proacl` shows `anon=X` on both. The SPEC (SC-5) states "no anon grant (grant-layer denial)" and the ORCH-1338 impl report §10 claims anon "is rejected at the GRANT layer (permission denied) BEFORE the in-function guard runs" — **both are false on prod.** Root cause: Supabase's `ALTER DEFAULT PRIVILEGES` grants EXECUTE to `anon` on every function CREATE; the migration's `REVOKE ALL … FROM PUBLIC` does not strip a **role** grant, so anon keeps EXECUTE.
- **Impact:** the in-function `authentication_required` / `not_authorized` guard is the **sole** barrier — proven to hold (anon FN-B → `authentication_required`; anon write → `authentication_required`; zero rows/writes). No data leak, no unauthorized write. The observable SC-5 ("zero rows cross the wire unauthenticated") is **met**. This is a missing defense-in-depth layer, not an exposure — hence P2, not P0.
- **Required fix (follow-up ORCH, not this CLOSE):** add explicit `REVOKE EXECUTE ON FUNCTION public.peer_list_event_guests(uuid,integer,integer) FROM anon;` and the same for `biz_set_event_guest_privacy` to a NEW migration (do not edit the applied ones). Correct the impl-report §10 claim.
- **Retest:** re-run `has_function_privilege('anon', …, 'EXECUTE')` → expect `false`.

No P0. No P1.

---

## 6. Step-0.5 — regression evidence

### 6a. Independent re-run of an IMPLEMENTOR fails-on-revert (ORCH-1338 §9b)
Checked out the committed migration, deleted `RAISE EXCEPTION 'guest_list_private';` (true line deletion) → `orch_1338_social_proof_reads.antiScrape.adversarial.test.ts` → **`FAILED | 9 passed | 1 failed`** on exactly `§9b FN-B: guest_list_private gate precedes row reads`. `git checkout --` restore → **`ok | 10 passed | 0 failed`**. Migration left pristine. The implementor's fails-on-revert claim is **verified true** against the real committed file.

### 6b. Tester adversarial test (NEW, different angle, on-branch, fails-on-revert)
**File:** `supabase/migrations/__tests__/orch_1337_guard_first_privilege.tester.adversarial.test.ts` (8 tests, green). Attacks angles NONE of the three implementor suites cover:
- **(A) guard-truly-first:** the `authentication_required` RAISE precedes the *event-resolution* `FROM public.events` read (not merely the guest-table reads the implementor pinned) — in BOTH FN-B and the write RPC. Blocks a private-event existence oracle to anon.
- **(B) DEFINER escalation:** all three DEFINER functions pin `SET search_path = public` AND contain **zero dynamic `EXECUTE`** (injection/escalation vector).
- **(C) destructive-write:** the 1339 write RPC never assigns `theme` from a fresh object / `jsonb_build_object` (proven survivable by the live no-clobber test).
- **(D) contact-scan of the 1339 file** (the 1338 suite scans only its own).

**fails-on-revert verified at HEAD (`214689801`)** — 3 true-mutation reverts, each red on the targeted assertion, restored to green:
- delete write-RPC auth RAISE → `A2 … FAILED | 7 passed | 1 failed`
- `theme = jsonb_build_object(...)` overwrite → `C1 … FAILED | 7 passed | 1 failed`
- inject `EXECUTE 'SELECT 1'` → `B2 … FAILED | 7 passed | 1 failed`
- restored → `ok | 8 passed | 0 failed`; write migration `git status` clean.

Both the implementor happy-path suites and my new adversarial file are in `git diff origin/main...HEAD --name-only`.

---

## 7. CI-guard confirmation (final commit)

Ran the `meta-orch-1337-social-proof-tests.yml` job's EXACT commands at HEAD:
- Deno (15 CI-listed files + my new adversarial file): the CI 15-file command → **`ok | 164 passed | 0 failed`**; my adversarial file → **`ok | 8 passed | 0 failed`**.
- Jest (5 CI-listed business files, `--runInBand`) → **`Test Suites: 5 passed`, `Tests: 63 passed, 63 total`**.
- Strict-grep gates → `orch-1342-landing-single-parse` self-test 7/7 + real PASS; `orch-1342-store-links-ssot` self-test 10/10 + real PASS.

---

## 8. Constitution 14-rule matrix (against the diff)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | card affordance inert without handler (1340 design); sheet actions-only; web gate opens client-side |
| 2 | One owner per truth | PASS | RSVP vs ticketed derivations disjoint (COMMS-0057); guest privacy leaf-write single-owner |
| 3 | No silent failures | PASS | RPCs RAISE machine tokens; services throw; gated/error states designed |
| 4 | One query key per entity | PASS | `guestListKeys` + `socialProofKeys` factories (T-07 green) |
| 5 | Server state server-side | PASS | React Query only; no Zustand writes (A-5) |
| 6 | Logout clears | N/A | no auth-state change in this META |
| 7 | `[TRANSITIONAL]` labeled | PASS | none introduced (all impl reports confirm) |
| 8 | Subtract before adding | PASS | 1157 anon-invariant retired-with-successor, never silently |
| 9 | No fabricated data | PASS | glyph fallback honest; invisible at 0; **proven live** — private→anonymous, no synthesized names |
| 10 | Currency-aware | N/A | no pricing surface touched |
| 11 | One auth instance | PASS | untouched |
| 12 | Validate at right time | PASS | server-side gates read `events.theme`, never client params |
| 13 | Exclusion consistency | PASS | blocked-pair exclusion server-only, both directions (proven live); client never re-filters (A-2) |
| 14 | Persisted-state startup | N/A | no persisted store change |

---

## 9. Device / parity matrix

| Surface | Verdict | Note |
|---|---|---|
| Backend RPCs (prod) | **PASS (proven)** | live-fire, all SC |
| Consumer iOS | **CAPPED (runtime)** | pre-existing native drift red-screens the dev build; bundle compiled clean (5315 modules) |
| Consumer Android | **CAPPED (runtime)** | same code; not driven (same native-build class) |
| Buyer/anon Web | **PARTIAL PASS** | served-artifact proof for names-never (SC-3) + F-12 (SC-5); interactive gate capped (no browser drive) |
| Business iOS/Android | N/A / CAPPED | no gate on native (deliberate); F-12 arrives at next native build |
| Admin Web | N/A | zero offering-rendering mounts (F-2) |
| Business Web preview | N/A | goingCount 0 ⇒ affordance absent |
| Physical iPhone (HITL) | NOT REQUESTED | deferred with the sim runtime — same operator-unblock ask |

---

## 10. Discoveries for Orchestrator

1. **P2-1 (above):** anon retains EXECUTE on both authed-only RPCs on prod — add explicit `REVOKE … FROM anon` in a follow-up migration; correct impl-report §10.
2. **Native-build drift (workspace-wide):** no app-mobile dev build on this machine includes `react-native-keyboard-controller` (ORCH-1171/COMMS-0047); every build red-screens the current bundle. Blocks ALL consumer-app sim testing until a fresh dev build is produced. Recommend the orchestrator produce one build for the whole workspace.
3. **Pre-existing latent main-reds** (already logged by the 1340/1341/1342 impl reports; reproduced): `orch_1157_round8/9`, `orch_1163_r3 §6b`, several stale screen suites expecting retired components — the docs-only-CLOSE latent-red class; NOT registered in the META's explicit-list workflow (correctly excluded).
4. **`strict-grep-mingla-business.yml` at 327 jobs** — sharding watch item (CI-guard report §8).
5. Live host event `8b84539d…` untouched (read-only); test fixture fully torn down (0 residual).

---

## 11. Accepted conditions (CONDITIONAL PASS)

This verdict is CONDITIONAL because the UI-runtime proofs (card T-14, sheet SC-R recorded, web interactive + consumer cold/warm sim) are deferred to the operator-unblock ask (fresh app-mobile dev build) — NOT because of any accepted defect. The single finding (P2-1) is defense-in-depth with no exposure and is routed as a follow-up, not a blocker. If the orchestrator/Seth accepts shipping the backend + web-[NOW] halves now and running the consumer-app SC-R after a fresh dev build (or post-merge from the anchor), this is a clean CONDITIONAL PASS. The `[NATIVE-GATED]` SC-10/11/12 are capped per COMMS-0083 by dispatch and are not conditions.

---

# ADDENDUM — SC-R LIVE-SIM CLOSE-OUT (tester SC-R, 2026-07-10, second dispatch)

**Author:** mingla-tester (Claude), scoped SC-R dispatch · **Footer:** `[TEST-MOD-APPROVED ORCH-1340]` · `ORCH-1340 [card-real-avatars]` · `META-ORCH-1337 [tester SC-R]`

The native-build blocker that capped every UI-runtime leg above is **RESOLVED**. All capped UI criteria were driven LIVE on a booted iPhone 17 Pro simulator (iOS 26.4, UDID `17091E60`). Evidence: `Mingla_Artifacts/evidence/META-ORCH-1337/SCR_*.png` (18 screenshots, gitignored) + full-session `session_recording.mp4` (kept at `/tmp/orch-1337/evidence/`, 674 MB — too large to commit).

## R0. Blocker resolution (how the sim ran)

- **Build:** EAS `development-simulator` `86d66d8f-b6a6-48b5-8df4-34bb641b5dda`, commit `0589e1755`, runtime `1.1.1`, bundle id `com.mingla.app.v2`. This build **includes ORCH-1171's `react-native-keyboard-controller` native module** — the app boots and renders every 1337 screen with **NO red-screen** (the exact `_layout.tsx:39` red-screen that capped the first sweep is gone). Screenshot `SCR_06`.
- **Correction to the dispatch premise:** this build's JS is NOT actually embedded — the `.app` carries no `main.jsbundle` (0 app-JS strings in the debug dylib) and `EXUpdatesEnabled=true` points at the `development` channel, which has **only runtime-1.1.0 updates** (no 1.1.1 match). So the dev-client launcher had nothing to launch standalone. Resolved legitimately by connecting the fresh native build to the **existing worktree Metro on :8095** (same app-mobile worktree, `packager-status:running`, serves the current branch JS) via `com.mingla.app.v2://expo-development-client/?url=http://localhost:8095`. No second Metro started, no shared cache poisoned, no other sim/Metro touched.
- **Sign-in mechanism (Apple/Google-only welcome screen has no email path):** created three `zz1337` Supabase **Auth** users via the sanctioned `execute_sql` MCP (GoTrue-compatible `auth.users`+`auth.identities` rows, bcrypt password, token columns set to `''`), password-granted a real session with the **public anon key** (from app source), and injected it into the sim's AsyncStorage spill file (`sb-gqnoajqerqhnvulmnyvv-auth-token`, md5 `d71f7513…`). App booted authed as the zz1337 host on the consumer home (`SCR_06`). No master-key / service-role read (that path is classifier-blocked and was not used).

## R1. Fixture (zz1337-marked, self-owned, torn down — 0 residual proven)

- Host/viewer **H** `13371337-…0001` (owns creator_account + brand + event); guests **G1 "Ada"** `…00a1` (public, avatar, NOT friend of H → add-friend target), **G2 "Bex"** `…00a2` (public, avatar, friend of H → message target), plus one **unlinked anonymous** RSVP ("Cal", guest_email/phone set → the no-leak row). Self-owned public **RSVP** event `zz1337-rooftop-co/zz1337-rooftop-sundowner`, scheduled, cap 20. Later expanded to 11 going (8 extra anon RSVPs) to force sheet-scroll for the pinned-header proof.
- **Teardown:** every row deleted across 13 tables (friend_requests, friends, messages, conversation_participants, conversations, event_rsvps, event_dates, events, brands, creator_accounts, notification_preferences, profiles, auth.identities, auth.users). **Residual scan = all zeros.** Live host events `8b84539d…` (BBQ Pool Party, private) and `smokerhythm/fifa-grill-night` (ticketed) were **READ-ONLY** (navigation only, no writes). No messages/pushes sent to any real user (the one message action was H→Bex, both zz1337).

## R2. Capped-criteria verdicts (each upgraded from CAPPED)

| Criterion (was CAPPED) | New verdict | Live evidence |
|---|---|---|
| **SC-R** sheet opens at 70% + PINNED header | **PASS** | Tapping the cluster AND the "See who's going" link opens the roster sheet at 70% with a pinned "Who's going / N going" header; after scrolling 11 rows the named rows scroll off but the header stays fixed. `SCR_11`, `SCR_16`, `SCR_17` |
| **SC-R** close (swipe + scrim) | **PASS** | Swipe-down dismiss (`SCR_18`) and scrim-tap dismiss (`SCR_20`) both return to a clean, fully-interactive event detail — no stuck scrim |
| **SC-R** rapid open/close ×5, no ghost/dead-screen | **PASS** | 5 back-to-back open→swipe-close cycles → clean card, no ghost sheet, no stuck scrim, no dead screen (`SCR_19`); z-order clean (sheet above dimmed content) |
| **Card — RSVP branch, real avatars vs glyphs** | **PASS** | 3-going card: cluster = 2 real photos (Ada, Bex) + 1 glyph (anon Cal) + "See who's going" link (`SCR_09`); 11-going = 2 photos + glyph + "+8" overflow chip (`SCR_15`) |
| **Card — standard/ticketed branch** | **PASS** | FIFA Grill Night (event type, 2 going): same shared cluster, 2 glyph disks + "See who's going" (`SCR_28`) — cross-entity parity proven at runtime |
| **Card — private event (READ-ONLY)** | **PASS** | Live BBQ Pool Party (privateGuestList=true): "4 going / 16 spots left" + meter render, but **NO cluster, NO "See who's going" link** (`SCR_22`) |
| **Card — trip/experience** | **N/A (not reachable)** | Prod has 2 trips but **0 public+live**, so no consumer trip detail is navigable; the trip/experience RPC payload was already proven in §1/§2. Not a defect. |
| **Sheet action — add-friend on named non-friend** | **PASS** | Tapping add-friend on Ada flips the row to a "Requested" chip (`SCR_12`); a real `friend_requests` row (H→Ada, status `pending`) was persisted server-side and re-renders as "Requested" on sheet re-open (`SCR_16`) |
| **Sheet action — anonymous rows have NO actions** | **PASS** | The unlinked "Guest" row shows a glyph, no name, and **zero action buttons** (`SCR_11`) |
| **Sheet action — message on already-friends row** | **FAIL (P1-2, new)** | See below |
| **1342 landing — test event auto-opens ONCE** | **PASS** | `…?landing=guest-list` opens the event AND auto-opens the roster sheet (`SCR_23`); closing it does not re-open (fires exactly once, `SCR_24`) |
| **1342 landing — private event must NOT open** | **PASS** | Private BBQ Pool Party `…?landing=guest-list` opens the event but the sheet does **NOT** auto-open (`SCR_25`) |

## R3. NEW P1 finding

### P1-2 — Guest-sheet "Message" dead-ends: closes the sheet then errors instead of opening the DM (all 3 consumer detail screens)

- **Evidence (runtime + source + DB):** Tapping "Message" on the friend row (Bex) correctly ensures the conversation (`conversation_participants` row for conversation `c5264aa7…` with H+Bex was created — verified in the DB) and closes the sheet (SEALED close-before-navigate honored). Then it hits the fallback `void Linking.openURL(\`mingla://chat/${conversationId}?type=direct\`)` at `app-mobile/src/components/EventGuestListSheet.tsx:384`. The app's registered URL scheme is **`com.mingla.app.v2`** (app.json `scheme`; Info.plist `CFBundleURLSchemes` = `com.mingla.app.v2`,`exp+mingla` — **no `mingla`**), so iOS rejects the unregistered `mingla://` scheme → **"Uncaught (in promise) Error: Unable to open URL"** red toast, and the DM never opens (`SCR_13`). The DM is not reachable via `openURL` on either scheme: `com.mingla.app.v2://chat/…` opens the app but lands on expo-router **"Unmatched Route — Page could not be found"** (`SCR_14`), because `chat` is handled only by `deepLinkService.parseDeepLink` (notification-tap rail), not by any `app/chat/[id]` file route.
- **Root cause:** all three consumer detail screens mount `EventGuestListSheet` **without the `onOpenConversation` override** (`ConsumerEventDetailScreen.tsx:1184`, `ConsumerTripDetailScreen.tsx:1108`, `ConsumerExperienceDetailScreen.tsx:1054` — only `visible/onClose/eventId/goingCount`), so the sheet falls to the broken `Linking.openURL('mingla://chat/…')` default. The same `mingla://chat/…` openURL exists at `OnboardingCollaborationStep.tsx:318` but there it is wrapped in `.catch()` (fails silently); the guest sheet's `void` surfaces the rejection.
- **Impact:** From the guest list, "Message" on a friend is a dead-end on iOS — the user's sheet closes, an error toast appears, and they are left on the event detail, never reaching the conversation they just created. Reproducible in prod (the scheme mismatch is build-independent). P1 (feature broken + dead tap outcome), not P0 (no crash, no data loss, no security).
- **Required fix (REWORK):** open the conversation via the app's real in-app navigation instead of `Linking.openURL('mingla://…')` — e.g. pass an `onOpenConversation` from each detail screen that runs `executeDeepLink(parseDeepLink('mingla://chat/{id}?type=direct'), handlers)` (the notification rail) or the in-app MessageInterface open path used by the Messages tab; do NOT use `Linking.openURL` with an unregistered scheme.
- **Retest:** tap Message on a friend row → sheet closes → app lands on the DM conversation screen (no error toast, no Unmatched Route).

## R4. Verdict delta

The four legs the first sweep left CONDITIONAL/CAPPED on the native-build blocker are now runtime-proven: **ORCH-1339/1340 card runtime → PASS (proven)**, **ORCH-1341 sheet SC-R (open/close/z-order/pinned/rapid) → PASS (proven)**, **ORCH-1342 warm-landing auto-open (both branches) → PASS (proven)**. The add-friend action and anonymous-row suppression are PASS. **One new P1 (P1-2, message dead-end) is uncovered** and routes to REWORK (implementor) — it does not block the read/card/sheet/landing legs but must be fixed before the "Message from guest list" path ships. Backend legs (§1–§2) and CI-guard (§7) are unchanged (PASS). P2-1 (anon EXECUTE grant) unchanged. **Net: 0 P0, 1 P1 (new, message nav), 1 P2 (grant).**

## R5. P1-2 RESOLUTION (REWORK, mingla-implementor, 2026-07-10)

**Fix commit:** `c36ec7a10` on `META-ORCH-1337-social-proof-guest-list` · **Footer:** `[TEST-MOD-APPROVED ORCH-1340]` · `ORCH-1340 [card-real-avatars]` · `ORCH-1341 [guest-list-sheet-consumer P1 message-nav]`

### What changed

- **`EventGuestListSheet.tsx`** — the Message default no longer calls `Linking.openURL('mingla://chat/…')` (the P1-2 dead-end: `mingla` is not a registered scheme — app scheme is `com.mingla.app.v2` — and `chat` has no expo-router file route). It now checks `hasOpenDirectMessageSink()` BEFORE closing (a detached mount keeps the OPEN sheet as its §4.5 error surface), preserves the SEALED ensure → close → navigate order, and calls `openDirectMessageInApp(profileId)`. The `onOpenConversation` override seam is unchanged. `Linking` import removed.
- **`deepLinkService.ts`** — new open-DM sink (`registerOpenDirectMessageSink` / `hasOpenDirectMessageSink` / `openDirectMessageInApp`), mirroring the shipped ORCH-1318 OneLink sink registration pattern.
- **`app/index.tsx`** — registers the sink at mount: pops any pushed expo-router file route (`router.dismissAll()` guarded by `canGoBack`) then rides the PROVEN Discover-map Message idiom (`setPendingOpenDmUserId` + `setCurrentPage('connections')` — the exact `handleOpenChatWithUserFromDiscover` body), which ConnectionsPage resolves into an open MessageInterface thread with a cold-start DB fallback (`findExistingDirectConversation`) that finds the conversation `ensureConversation` just created.

**Why not `executeDeepLink({kind:'conversation'…})` (the R3-suggested notification rail):** implemented and runtime-driven FIRST — it delivered page+params correctly but landed on the Messages **LIST**, not the thread: a just-ensured, message-less DM is not yet in ConnectionsPage's `conversations` state, so the ORCH-1080 deep-link effect takes its unresolvable-conversation fallback (`ConnectionsPage.tsx:2070-2072` resolve-from-loaded-state → `:2132` land-on-tab). Screenshot `REWORK_R06/R07`. The Discover-map rail is the app's real "open a DM with user X" idiom and lands INSIDE the thread.

### Test-file edits (in-branch, sanctioned by the REWORK dispatch — both files are this branch's new suites)

`orch_1341_guest_list_sheet.test.ts` T-11 and `orch_1341_guest_list_sheet_adversarial.test.ts` A-1 had pinned the broken `openURL` idiom verbatim; repointed to the open-DM rail. NEW seals: T-11/A-9 BAN `Linking.openURL` and hand-built `mingla://` strings in the sheet; A-9 pins sink-check-before-rail-close; A-9b pins the shell registration onto the exact Discover idiom + route pop. Suites now 29 tests (19 happy + 10 adversarial).

### Static verification (verbatim summaries)

- 1341 pair: `ok | 29 passed | 0 failed`
- Full META-1337 CI deno battery + tester adversarial + deep-link suites (1030/1080/1318/1342): `ok | 213 passed | 0 failed`
- `orch_1187_posthog_native_consumer` (node --test, reads app/index.tsx): `# pass 1 / # fail 0`
- strict-grep `orch-1342-landing-single-parse` + `orch-1342-store-links-ssot`: PASS
- app-mobile `tsc --noEmit`: **0 errors in the three touched files** (repo-wide pre-existing sweep reds unchanged)
- **fails-on-revert verified at `c36ec7a10`** — two true line-deletion reverts: delete `openDirectMessageInApp(profileId);` → T-11 + A-1 + A-9 FAIL; delete the index registration block → A-9b FAIL (`9 passed | 1 failed`); restored → `ok | 29 passed | 0 failed`, tree clean.

### Runtime re-proof (the P1 was a runtime finding — re-proven live)

Same environment class as the SC-R addendum: booted iPhone 17 Pro sim `17091E60` (iOS 26.4), EAS dev-client `com.mingla.app.v2` connected to the worktree Metro on :8095. Fresh minimal zz1337 fixture re-seeded via sanctioned `execute_sql` (host H `13371337-…0001` signs in via GoTrue password-grant + AsyncStorage injection; friend G2 "Bex zz1337" `…00a2` public+avatar, accepted friendship both directions; self-owned public RSVP event `zz1337-rooftop-co/zz1337-rooftop-sundowner`, Bex going/approved).

Drive (evidence `Mingla_Artifacts/evidence/META-ORCH-1337/REWORK_R*.png`, gitignored):
1. `com.mingla.app.v2://e/zz1337-rooftop-co/zz1337-rooftop-sundowner` → event detail renders on the pushed /e/ route, RSVP branch, social-proof card with Bex's real avatar + "See who's going" (`REWORK_R08_card2`).
2. Tap cluster → sheet opens at 70%, pinned "Who's going / 1 going" header, Bex row with Message action (`REWORK_R09_sheet2`).
3. Tap Message on the friend row → **sheet closes → the pushed /e/ route pops → the DM conversation screen RENDERS**: MessageInterface thread with zz1337-bex header, "Start your conversation" body, live composer — **no "Unable to open URL" toast, no Unmatched Route** (`REWORK_R10_after_msg`). The retest criterion in R3 is met verbatim.
4. DB: `ensureConversation` created direct conversation `f8d3310c…` with 2 participants (verified server-side before teardown).

(The first-rail drive `REWORK_R06/R07` — Messages-list landing — is retained as the negative evidence that motivated the rail change.)

**Fixture teardown:** all zz1337 rows deleted across auth.users, auth.identities, profiles, notification_preferences, friends, friend_requests, creator_accounts, brands, events, event_dates, event_rsvps, conversations, conversation_participants, messages — **residual scan = all zeros (14/14 tables)**. No real user touched; no messages/pushes sent.

**Known incidental observations (pre-existing, NOT this REWORK's scope):** the COMMS-0066 OneSignal false "Open Settings" dialog fires repeatedly on this dev build (already ledgered); dev-env PostHog key toast (dev-only noise). `OnboardingCollaborationStep.tsx:318` still carries a silently-`.catch()`ed `mingla://chat/…` openURL (flagged in R3; separate surface, untouched per single-P1 scope — routes to the orchestrator).

### Verdict delta

**P1-2 → RESOLVED (runtime-proven).** The "Message from guest list" path now lands in the DM thread on all three consumer detail screens via the shared sheet default; the override seam remains for future hosts. Net for the META: **0 P0, 0 P1 open, 1 P2 (grant, unchanged)**.
