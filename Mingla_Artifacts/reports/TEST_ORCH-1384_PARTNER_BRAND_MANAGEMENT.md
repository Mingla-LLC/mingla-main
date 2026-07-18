# TEST — ORCH-1384 [partner Brands screen dead end → partner brand-management verbs]

- **Phase:** TEST (independent gatekeeper). Joint contract under test:
  `specs/SPEC_ORCH-1384_PARTNER_BRAND_MANAGEMENT_VERBS.md` (SC-1..SC-17, A-1..A-6) +
  `design/DESIGN_ORCH-1384_PARTNER_BRAND_MANAGEMENT.md` (testID §10.2, copy §9) +
  `reports/IMPLEMENTATION_ORCH-1384_PARTNER_BRAND_MANAGEMENT.md` (claims).
- **Tester:** mingla-tester+claude, 2026-07-17.
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1384-[partner-brand-management]/` on branch `ORCH-1384-partner-brand-management`, **rebased onto origin/main** (was 27 behind: ORCH-1385/1386/1387/1388 landed). New HEAD `aea201b99`; real `npm ci` run in `mingla-business/`; pushed `--force-with-lease`.
- **Backend state under test:** migration `20270102000000` is LIVE on prod (`gqnoajqerqhnvulmnyvv`) — all 3 RPCs + trigger + owner-read RLS present (probe below). Edge fn `partner-reissue-invitation` **NOT deployed** (deploys from merged main only) → SC-4/5/16 edge-runtime legs capped at RPC-level + structural per dispatch.
- **Comms:** COMMS-0102/0105/0106/0107/0108/0109 acked on entry (anchor commit `883eb097d`).

---

## 1. VERDICT: **FAIL** — P0×1, P1×0, P2×2, P3×1, P4×2

One P0 security defect on the reissue RPC blocks release. Every other backend success criterion is
**proven live on prod** (ephemeral rolled-back transactions against the real deployed RPCs/trigger/RLS
— zero residue). Client-UI criteria are source-verified against the DESIGN registry; device-runtime UI
proof and the Seth-mandated device→browser E2E are **deferred to RETEST** on the fixed build (rationale
§7). Regression gate satisfied: implementor happy-path suite re-run with fails-on-revert (Step 0.5 §4),
plus a NEW tester adversarial test at a different angle that pins the P0 (§5).

Routes to **REWORK** (implementor). The fix is a one-line grant hardening + a new follow-up migration
(the current migration is already applied to prod, which is **currently exposed** — see P0-1).

---

## 2. SC-by-SC matrix

Evidence key: **LIVE-RPC** = fired against the real prod RPC/trigger/RLS inside a `DO`-block that seeds
ephemeral rows, calls the deployed object, captures state, then `RAISE`s to force full rollback (zero
residue); **SRC** = source-contract verified against the joint contract; **RT-DEV** = device runtime
(deferred, §7). Business iOS/Android parity is automatic (one shared RN codebase); per-surface split
only where it matters.

| SC | Verdict | Evidence |
|---|---|---|
| SC-1 header add-CTA all states; empty-state byte-identical | PASS (SRC) | `brands.tsx:246` IconChrome `testID=partner-brands-add-button` rendered ABOVE the `isLoading` branch (all states); empty-state CTA `handleSetUpFirst` unchanged (`:285`). 47/47 client jest green. RT-DEV deferred. |
| SC-2 detail sheet (email/note/absolute ts/honest status); dashboard = verb, non-cancelled only | PASS (SRC) | `PartnerLinkDetailSheet.tsx` facts card (email/note/TimelineRows), open-dashboard gated out of the cancelled branch (`:642` renders Close only). RT-DEV deferred. |
| SC-3 awaiting_owner verbs confirm-gated | PASS (SRC) | resend/correct/open-dashboard/cancel/close block (`:448-590`); destructive verbs route to `confirmCancel` step. |
| SC-4 resend same email — expire-now (not revoke), new insert, invited_at refresh, NO link INSERT, email unchanged | **PASS (LIVE-RPC)** | `partner_reissue_brand_invitation` fired: old invite `status=pending` + `expires_at<=now` (expire-now, NOT revoked); exactly 1 pending+future invite; `link.invited_at` refreshed; `link.cancelled_at` NULL (trigger did NOT fire); **link row count stayed 1**. Edge-fn 410-on-old-URL leg capped (fn not deployed). |
| SC-5 correct-email atomic dual-write; old token dies; accept-stamp matches | **PASS (LIVE-RPC)** | fired with `new_email`: new invite `email=correct@…` pending; old invite expire-now'd; `link.invited_owner_email` → `correct@…`; link uncancelled; accept-stamp predicate `lower(invited_owner_email)=lower(new)` now matches (F-7 cured). |
| SC-6 cancel quad-outcome, no partial state | **PASS (LIVE-RPC)** | `partner_cancel_pending_link` (caller=partner via `auth.uid()`): link→`partner_cancelled`, invitation→`revoked`+`revoked_at`, brand→`deleted_at` set, `default_brand_id`→NULL — all one tx; rpc returned `brand_deleted:true, invitation_revoked:true`. |
| SC-7 has_upcoming_events typed rejection + count + zero writes | **PASS (LIVE-RPC)** | with a future `scheduled` event: RPC raised `has_upcoming_events`, `PG_EXCEPTION_DETAIL="1"`; link/invitation/brand all untouched (zero writes). |
| SC-8 disconnect dual stamp; per-caller reason; stranger→forbidden | **PASS (LIVE-RPC)** | partner caller → `partner_disconnected` + `brand_team_members.removed_at` stamped same tx; owner caller → `owner_removed` + dual stamp; stranger authenticated uid → `forbidden`, link+team untouched. Money time-pin = A-2. |
| SC-9 owner-initiated disconnect; every OTHER remove inert | PASS (SRC) + LIVE-RPC(owner leg) | owner leg proven live (SC-8 owner row). Client: `MemberDetailSheet` "Disconnect partner" gated to owner+matched-partner row; `handleRemove` no-op byte-anchored for others (client suite 12/12). |
| SC-10 team revoke stamps link, zero client changes | **PASS (LIVE-RPC)** | invite-kill trigger: `UPDATE brand_invitations SET status='revoked'` → link `cancelled`/`invitation_revoked`. |
| SC-11 owner decline → owner_declined | **PASS (LIVE-RPC)** | `status='declined'` transition → link `cancelled`/`owner_declined`. |
| SC-12 expired renders honestly; Resend revives | PASS (SRC) | `isInviteExpired` + expired row/sheet treatment; T-5 boundary (±1min flip, `INVITE_EXPIRY_DAYS===7`) green. RT-DEV deferred. |
| SC-13 cancelled greyed/last/reason labels; counts exclude | PASS (SRC) | `brands.tsx` `usePartnerBrandLinks({includeCancelled:true})` (`:182`); `account.tsx` untouched (default exclude — empty diff); STATUS_RANK cancelled=last; reason labels per §9.1. RT-DEV visual deferred. |
| SC-14 deleted-brand embed renders; no dashboard nav | **PASS (LIVE-RLS + SRC)** | RLS `"Account owner can select own brands" = (account_id = auth.uid())` — **NO deleted_at gate** (A-4 live); service LINK_SELECT embed intentionally unfiltered on `deleted_at` (`partnerBrandLinksService.ts:124-131`); cancelled sheet branch has no dashboard verb. |
| SC-15 cancel-vs-accept race — exactly one side wins | **PASS (LIVE-RPC, outcome)** | accept-first: `accept_invite_and_transfer_brand_ownership` stamped link + transferred owner → cancel returned `link_not_pending`, **brand NOT deleted**, link still accepted/uncancelled. cancel-first: cancel succeeded → accept returned `invite_revoked`, link never accepted. Lock order (invitation `FOR UPDATE` first, link re-check after) verified in migration source (`:121`). Caveat: true wall-clock concurrency not driven (single-connection MCP); outcomes + lock-order = high confidence. |
| SC-16 send-failure: 502, DELETE (not revoke), link un-cancelled, retry cures | PASS (SRC) — edge capped | edge fn `index.ts:287,320` DELETE-by-id → 502 `email_send_failed` (never a status flip). Runtime leg blocked (fn not deployed); implementor T-4c handler-probe green. |
| SC-17 accept-side byte-identical | **PASS** | `git diff --name-only origin/main...HEAD` contains **no** accept/decline route files; accept RPC unmodified; live accept fired correctly in SC-15. |

**Backend contract: fully live-fired and correct.** The single defect is the reissue RPC's grant
boundary (below), not its logic.

---

## 3. Findings

### P0-1 — Reissue RPC `service_role`-ONLY grant is NOT enforced; anon + authenticated can EXECUTE it (auth bypass on a SECURITY DEFINER ownership-token minter)

- **Evidence (LIVE, prod `gqnoajqerqhnvulmnyvv`, 2026-07-17):**
  - `has_function_privilege('anon',          'public.partner_reissue_brand_invitation(uuid,uuid,text,text,timestamptz)','EXECUTE')` = **true**
  - `has_function_privilege('authenticated', …)` = **true** (`service_role` = true, expected).
  - Anonymous REST call executed the function BODY (raised `P0001 link_not_found` after running the
    SELECT) instead of returning `42501` permission-denied:
    `POST /rest/v1/rpc/partner_reissue_brand_invitation` (apikey = legacy anon) with a zero-UUID
    `p_link_id` → `HTTP 400 {"code":"P0001",…,"message":"link_not_found"}`.
  - `pg_proc` grants: `anon:EXECUTE, authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE`.
  - Migration lines 474-475: `REVOKE ALL ON FUNCTION … FROM PUBLIC;` + `GRANT EXECUTE … TO service_role;`.
    `REVOKE … FROM PUBLIC` does **not** strip the per-ROLE `anon`/`authenticated` grants that Supabase's
    default ACL (`pg_default_acl`: `anon=X,authenticated=X,service_role=X`) applies at function CREATE.
  - Probe SQL committed at `Mingla_Artifacts/evidence/ORCH-1384/runtime_grant_probe.sql`.
- **Contract violated:** SPEC §4.4 RPC-3 ("`GRANT EXECUTE TO service_role` ONLY — called by the edge
  fn, which owns JWT auth"); SPEC §7 **A-6** ("service-role-only grant on the reissue RPC holds
  (authenticated call fails)"). The implementor's own migration test *"T-4: reissue RPC grant —
  service_role ONLY"* is a **false-green**: it asserts the file TEXT contains `REVOKE ALL … FROM PUBLIC`
  + `GRANT … service_role` and calls that "ONLY", but never checks the effective privilege.
- **Why this is P0 (not defense-in-depth):** the reissue RPC has **no `auth.uid()` guard at all**
  (verified in the migration body, `:372-408`). Its ONLY authorization is (a) the service_role grant
  boundary — now bypassable — and (b) a **caller-SUPPLIED** `p_partner_account_id` parameter checked
  against the link's `partner_account_id`. So any anon/authenticated caller who knows a pending link's
  `(link_id, partner_account_id)` pair can call the RPC directly and pass **attacker-chosen**
  `p_token_hash`, `p_new_email`, and `p_expires_at`. Effect: expire the legitimate pending owner-invite,
  INSERT a fresh `brand_owner` invitation with a token whose preimage the attacker knows, then accept it
  → **seize brand ownership**. The pair is not RLS-enumerable, but `link.id` + `link.partner_account_id`
  are both returned to the partner's own client by `listPartnerBrandLinks`, so a malicious partner can
  self-seize a client's brand, and anyone who exfiltrates the pair (logs, session) can too. It also
  enables silent **denial** (expire a real pending invite — e.g. Seth's live Rockstar Vibes invite —
  if its pair leaks).
- **Recurrence:** identical root cause to the already-fixed **ORCH-1338 P2-1**
  (`supabase/migrations/__tests__/orch_1338_p2_revoke_anon_execute.test.ts` + migration
  `20261227000000_orch_1338_p2_revoke_anon_execute.sql`). The house remediation pattern was not applied
  to the new RPC.
- **Required fix (REWORK):** a **NEW** migration (the `20270102000000` file is already applied to prod —
  cannot be edited in place) that, per the ORCH-1338 pattern:
  ```sql
  REVOKE EXECUTE ON FUNCTION public.partner_reissue_brand_invitation(uuid, uuid, text, text, timestamptz)
    FROM PUBLIC, anon, authenticated;
  GRANT  EXECUTE ON FUNCTION public.partner_reissue_brand_invitation(uuid, uuid, text, text, timestamptz)
    TO service_role;
  NOTIFY pgrst, 'reload schema';
  ```
  Strengthen the T-4 grant test to assert the explicit `anon`/`authenticated` revoke (my adversarial
  test §5 already enforces this). **Prod is exposed until this lands + is applied** — recommend the
  orchestrator apply the REVOKE promptly even ahead of the full CLOSE.
- **Retest:** re-run the runtime probe → `anon_can_reissue=false`, `authenticated_can_reissue=false`,
  `service_can_reissue=true`; anon REST call → `401/403` (not a body-execution `P0001`); my adversarial
  test §A/§B green.

### P2-1 — `partner_cancel_pending_link` + `partner_disconnect_link` also retain anon + authenticated EXECUTE (harmless at runtime, but off-standard)

- **Evidence (LIVE):** `has_function_privilege('anon', partner_cancel_pending_link(uuid),'EXECUTE')=true`
  and same for disconnect. SPEC §4.4 asked for `GRANT authenticated` only.
- **Impact:** **non-exploitable** — both bodies do `v_caller := auth.uid(); IF NULL → forbidden`, so an
  anon call fail-closes (proven live: anon REST → `{"message":"forbidden"}`). But leaving anon with
  EXECUTE is exactly the default-ACL leak ORCH-1338 standardized against.
- **Required fix:** fold into the P0 migration: `REVOKE EXECUTE … FROM PUBLIC, anon;` (keep
  `authenticated`) for both RPCs.
- **Retest:** `has_function_privilege('anon', …)=false` for both; `authenticated` still true.

### P2-2 — implementor T-4 "service_role ONLY" grant test guards the file, not the invariant

- **Evidence:** `orch_1384_partner_link_lifecycle.test.ts` T-4 grant assertion passes on a migration
  whose runtime grant leaks to anon+authenticated (the P0). A green suite over a live authz hole — the
  COMMS-0106 "false-green" class, here at the grant layer.
- **Required fix:** T-4 must assert the explicit `REVOKE … FROM … anon, authenticated` (or an effective-
  privilege probe). Superseded by my adversarial test §5, which the REWORK must turn green.
- **Retest:** my adversarial suite 3/3 green after the fix.

### P3-1 — bracket-dir worktree breaks `.test.mjs` spawn harnesses (implementor D-IMPL-1384-1, confirmed)

- Confirmed while running gates: the `ORCH-1384-[label]` literal-bracket dir URL-encodes (`%5B/%5D`)
  into child argv for the three strict-grep `.test.mjs` harnesses; jest `testMatch` also treats `[id]`
  as a glob char-class (the team test lives beside `MemberDetailSheet` for this reason). Not branch-
  caused; hygiene candidate (decode `fileURLToPath` in orch-0931/0939/0943). Discovery, not a blocker.

### P4-1 (praise) — backend contract is exemplary

Lock order (invitation-first, link re-check-after) makes SC-15 hold under real accept contention;
expire-now-never-revoke keeps the reissue trigger-safe; the dual-stamp is genuinely one transaction;
every state transition I fired live matched the SPEC exactly. Clean, honest, well-commented SQL.

### P4-2 (praise) — client error discipline

Every mutation carries `onError`; `has_upcoming_events` is a Decision-11 workflow rejection (not a
swallow); typed error copy table wired; `useCancelPendingLink` mirrors `useSoftDeleteBrand` cache
surgery so the auto-deleted brand vanishes from the switcher identically to a manual delete.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- **Commit run:** HEAD `aea201b99` (rebased branch). Runner: `deno test --allow-read --no-check`.
- **Baseline:** `orch_1384_partner_link_lifecycle.test.ts` → **12 passed / 0 failed**.
- **Proof 3 (trigger `accepted_at IS NULL` guard):** deleted the `AND accepted_at IS NULL;` line from
  the trigger body (`20270102000000…sql:55`) → suite **11 passed / 1 failed**, exact failure
  `T-3c: trigger guard ignores accepted links (accepted_at IS NULL)` at test line 142. Restored via
  `git checkout --` → **12 passed / 0 failed**. Working tree clean.
- Client suites (`partnerBrandLinksService.orch1384`, `brands.orch1384.source`,
  `PartnerLinkDetailSheet.orch1384.source`, `orch_1384_team_partner_disconnect.source`) re-run:
  **47 passed / 47**. Implementor fails-on-revert proof independently reproduced.

## 5. Adversarial test added (different angle: effective-privilege / grant boundary)

- **Path (NEW file):** `supabase/migrations/__tests__/orch_1384_reissue_grant_hardening.tester.test.ts`.
- **Angle:** attacks the P0 the implementor's file-shape T-4 missed — asserts the migration EXPLICITLY
  revokes EXECUTE from `anon` AND `authenticated` on the reissue RPC (ORCH-1338 remediation shape),
  with a provenance-isolated REVOKE match and a no-widening companion (COMMS-0106 discipline). Carries
  the live `has_function_privilege` proof in its header.
- **Fails-on-revert (demonstrated, HEAD `aea201b99`):** RED on the current unfixed branch — §A/§B fail,
  §C passes (**1 passed / 2 failed**), pinning the P0. Applying the proposed fix
  (`REVOKE EXECUTE … FROM PUBLIC, anon, authenticated;`) → **3 passed / 0 failed**; removing it again →
  §A/§B fail. Product migration restored byte-identical afterward (only the new test file is added).
- **On-branch / in-diff:** `git diff --name-only origin/main...HEAD` includes both the implementor's
  happy-path suites and this new tester file. This test is **expected-RED until REWORK lands the grant
  fix** — it is the regression guard the fix must turn green.

## 6. Constitution 14-rule matrix (independent, against the diff)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS (SRC; RT-DEV deferred) | every Button has a live `onPress`; verbs state-gated; disabled uses `accessibilityState.disabled`. |
| 2 | One owner per truth | PASS | the 3 RPCs are the sole writers of their verbs; the invite-kill trigger is the single writer-independent lifecycle stamp. |
| 3 | No silent failures | PASS | `onError` on all mutations; `has_upcoming_events` → workflow rejection; typed error copy; RPC audit blocks swallow only audit inserts. |
| 4 | One query key per entity (factory) | PASS | `partnerBrandLinksKeys` factory; `includeCancelled` is part of the key. |
| 5 | Server state stays server-side | PASS | React Query throughout; no Zustand server snapshots. |
| 6 | Logout clears everything | N/A | no auth/logout changes. |
| 7 | `[TRANSITIONAL]` labels | N/A | none introduced. |
| 8 | Subtract before adding | PASS | move-only email extraction; invite-brand-member imports back; 38/38 its tests unmodified. |
| 9 | No fabricated data | PASS | timestamps rendered only when set; reason labels honest; no faked values. |
| 10 | Currency-aware | N/A | no currency display change (event-currency trigger is pre-existing). |
| 11 | One auth instance | N/A | none. |
| 12 | Validate at the right time | PASS | expiry is presentation-only; server P0003 enforces death; reissue refreshes `invited_at` atomically. |
| 13 | Exclusion consistency | PASS | cancelled excluded from counts consistently; `includeCancelled` default byte-compatible (T-2 live-equiv). |
| 14 | Persisted-state startup | N/A | none. |

**Security overlay (Automatic-P0 trigger):** the P0-1 auth bypass sits outside the 14 UI rules but is an
explicit "any auth bypass = P0" trigger and overrides all other severity — it is the sole reason for the
FAIL verdict.

## 7. Device / parity matrix

| Surface | Verdict | Note |
|---|---|---|
| Backend / DB / RLS / RPC / trigger (prod) | **PASS — LIVE** | every verb + the trigger + the race + RLS + authz fired against the real prod objects (rolled-back, zero residue). |
| Business iOS (client UI) | **SRC PASS / RT-DEV DEFERRED** | no iOS sim was booted; UI contract source-verified (testIDs, copy, state-gated verbs). Deferred to RETEST. |
| Business Android (client UI) | **SRC PASS / RT-DEV DEFERRED** | physical Samsung `R58R54YV7JT` IS connected (adb). Runtime UI drive deferred (rationale below). |
| Buyer/anon Web (accept flow) | PASS (unchanged) | SC-17: zero accept/decline files touched; ORCH-1373 lineage untouched; live accept RPC fired correctly. |
| Admin Web | N/A tolerant | additive column only; no file change. |
| Business Web preview | compiles (adjacent) | primitive self-forks; not a target. |

**Why device-runtime UI + the Seth-mandated device→browser E2E are deferred, not skipped:** (1) a P0
forces a follow-up migration + client rebuild, so the exact artifact a live E2E would exercise **will
change** — E2E-ing it now then again at RETEST tests a throwaway build and doubles prod residue;
(2) the E2E's NEW-code surface is the verb backend, which is **already fully live-fired on prod** (incl.
the accept transfer via `accept_invite_and_transfer_brand_ownership`), a stronger proof than one UI
pass; (3) the browser accept UI is explicitly out of scope (SC-17, ORCH-1373 untouched). The physical
Samsung is available and Gmail creds are in hand, so the full create→invite→browser-accept→disconnect
E2E + the iOS-sim/Android visual legs (greyed cancelled rows, expired dot, confirm steps, WCAG contrast
render) should run at **RETEST on the fixed build**. This deferral does not affect the FAIL verdict
(the P0 is backend authz, device-independent).

**WCAG/testID conformance (SRC):** all 18 static testIDs from DESIGN §10.2 present across the 4
components; verbatim non-negotiable copy present — deletion disclosure "This cancels the invite and
deletes the draft brand you built. This can't be undone." and money truth "You'll stop earning from
future sales for this brand. Money already earned still pays out." Numeric contrast render on device is
part of the deferred RT-DEV leg (design's §4.3 math was already transcribed/verified in DESIGN).

## 8. Live prod object probe (read-only, at test time)

```
link_policies=3 (self_select + owner_select + admin)   reason_col=true   kill_trigger=1
new_rpcs=3   partial_idx=1   status_fn=1 (frozen ORCH-1081 intact)   reason_check=1
brands SELECT owner policy qual = (account_id = auth.uid())  — NO deleted_at gate (A-4 PASS)
```

## 9. Adversarial angles A-1..A-6

- **A-1 cancel↔accept race:** outcomes proven both orderings (SC-15). Accept-win leaves the new owner's
  brand undeleted and the link `accepted`; cancel can never fire after (`link_not_pending`). Cancel-win
  → accept `invite_revoked`. Lock order verified in source. True wall-clock concurrency not driven
  (single MCP connection) — outcome + lock-order = high confidence.
- **A-2 disconnect boundary money:** the disconnect RPC writes **zero** `partner_splits` (grep-verified
  in source + the `NO partner_splits` migration test); the sole money gate is the untouched time-pinned
  resolver `removed_at > p_at` — a charge before the stamp resolves the partner, at/after does not.
  In-flight splits are never voided (SPEC OQ-1). Exact-microsecond boundary charge simulation is part of
  the deferred payments-adjacent leg but the resolver is untouched by this ORCH (SC-8 stamp proven live).
- **A-3 corrected-email vs 23505 swallow:** reissue path performs **no** link INSERT (proven live: link
  row count stayed 1) → the 23505 swallow class is structurally unreachable on this path; the raw
  team-screen re-invite swallow remains the registered residual D-1 (untouched, correctly).
- **A-4 deleted-brand embed:** RLS `(account_id = auth.uid())` has no `deleted_at` gate (live) → the
  partner keeps SELECT on the soft-deleted brand; service embed intentionally unfiltered (SC-14). PASS.
- **A-5 trigger provenance/control-flow:** trigger fired via real `UPDATE … SET status` write paths
  (revoke + decline both stamped correctly); reissue's expire-now did NOT stamp the link (status stayed
  `pending`, link uncancelled) — proven live. Migration tests carry uniqueness/provenance companions.
- **A-6 authz sweep:** **P0-1** (reissue anon/authenticated EXECUTE) + **P2-1** (cancel/disconnect anon
  EXECUTE, fail-closed). Owner-select policy leaks nothing cross-brand (inline `account_id=auth.uid()`);
  stranger authenticated uid → `forbidden` from cancel + disconnect (proven live). The pre-accept
  "owner calling cancel" case is moot: pre-accept the partner IS the draft-brand owner (Rockstar Vibes
  confirms `partner_account_id = brand.account_id`), so there is no distinct owner identity to reject.

## 10. Residue enumeration

**ZERO prod residue.** Every write-bearing probe ran inside a `DO`-block terminated by `RAISE` (full
rollback) or was read-only / an anon REST call with a zero-UUID (`link_not_found`, no write).
Post-test verification: `qa_brands=0, qa_links=0, qa_invitations=0, qa_team=0, qa_events=0`; the
partner's real `default_brand_id` intact (`1ce63bf4…`); `partner_link_count=1`; **Rockstar Vibes
(`5f2a091b…`) still pending, untouched** (fence honored throughout — no resend/cancel/tap on it).
Probe artifacts live in `/tmp/orch-1384/` + `Mingla_Artifacts/evidence/ORCH-1384/`.

## 11. Discoveries for Orchestrator

- **D-TEST-1384-1 (P0 remediation is orchestrator-adjacent):** prod is exposed NOW. Recommend applying
  the reissue+cancel+disconnect REVOKE hardening promptly (a new idempotent migration), even ahead of
  the full CLOSE, then re-deploy schema cache (`NOTIFY pgrst`).
- **D-TEST-1384-2:** the false-green grant-test class (P2-2) is generic — any future service_role-only
  RPC needs an effective-privilege guard, not a `REVOKE … FROM PUBLIC` file assertion. Candidate: a repo
  invariant / lint that flags `GRANT … TO service_role` without a matching `REVOKE … FROM … anon,
  authenticated`.
- **D-TEST-1384-3:** confirms implementor D-IMPL-1384-1 (bracket-dir harness/testMatch hazard).

## 12. Routing

**FAIL → REWORK (implementor).** Fix P0-1 (+ fold P2-1, P2-2) via a new grant-hardening migration and
strengthen T-4; turn the tester adversarial suite green. Then **RETEST**: re-run the runtime grant
probe + the device-runtime UI legs + the Seth-mandated create→invite→browser-accept→disconnect E2E on
the fixed build (Samsung available). CLOSE stays main-green-gated (main is green since `d4f0996df`;
edge fn `partner-reissue-invitation` deploys post-merge; OTA per-platform after merge).

Working tree: `~/Desktop/mingla-orchs/ORCH-1384-[partner-brand-management]/` on branch
`ORCH-1384-partner-brand-management`.
