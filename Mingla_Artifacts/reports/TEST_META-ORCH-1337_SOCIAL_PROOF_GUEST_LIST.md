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
