# TEST — ORCH-1111 (surface pending invites in-app) + ORCH-1112 (Ari reachable brand-less)

**Phase:** TEST. Discipline: mingla-tester (assume BROKEN until live-fire proven).
**Date:** 2026-06-10.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1111-1109-[partner-invite-surface-and-ari-gate]/` @ `d252669d4`.
**Backend:** project `gqnoajqerqhnvulmnyvv`, Stripe TEST mode. Migration + 3 edge fns already deployed.
**Comms ledger:** read on entry. No OPEN row addressed to tester/ORCH-1111/1109/ALL.

## VERDICT: **PASS** (2 non-blocking observations, 0 conditions)

Every success criterion (SC-1..SC-16) is satisfied. The critical OQ-1 decline-terminal
guarantee is proven LIVE against the deployed backend (web token replay of a declined
invite → 410, not accepted). The ORCH-1112 Ari gate matrix is correct and adversarially
hardened. Zero new test/typecheck failures in any touched file. Both implementor
fails-on-revert claims independently reproduced.

---

## 1. Live DB / deploy state verification

| Check | Result |
|-------|--------|
| `brand_invitations.declined_at` column | EXISTS (`timestamp with time zone`) |
| status CHECK constraint | `IN ('pending','accepted','revoked','expired','declined')` ✓ |
| RPC `accept_invite_and_transfer_brand_ownership` P0007 guard | PRESENT (`IF status='declined' RAISE invite_declined P0007`) |
| RPC ORCH-1081 transfer bypass | RETAINED (`set_config('app.allow_brand_owner_transfer','on',true)`) |
| Edge `list-my-pending-invites` | ACTIVE, verify_jwt=true |
| Edge `decline-brand-invitation` | ACTIVE, verify_jwt=true |
| Edge `accept-brand-invitation` | ACTIVE, verify_jwt=true (modified) |
| `invite-brand-member` lowercases email on write (`:100`) | CONFIRMED (`.trim().toLowerCase()`) |

## 2. ORCH-1111 — LIVE edge-fn fire (curl + SQL)

Test users (disposable, since DELETED): A=`orch1108-test+a@usemingla.com`,
B=`orch1108-test+b@usemingla.com`, C=`orch1108-test+owner@usemingla.com` (prior owner).
3 disposable brands + 7 invitations. JWTs minted via admin `generate_link` magiclink → verify
303 redirect.

### A — HAPPY
- **A.1 list (SC-1/SC-8):** `list-my-pending-invites` as A → **200**, 3 invites. Projection asserted
  exactly `{id, brand_id, brand_name, role, expires_at}` — **NO token_hash / invited_by / email** (SC-8 PASS).
- **A.2 accept team-member (SC-4/T7):** `accept {invitationId:22222222}` (event_manager) → **200**
  `{role:event_manager, transferred:false}`. SQL: invite status=accepted, `accepted_by_account_id`=A,
  `brand_team_members` row for A = event_manager. ✓
- **A.3 accept owner-transfer (SC-4/T6):** `accept {invitationId:11111111}` (brand_owner) → **200**
  `{transferred:true, previous_owner=C, new_owner=A}`. SQL: `brands.account_id` repointed C→A, A=brand_owner,
  **C demoted to brand_admin**, invite=accepted. The ORCH-1081 immutable-trigger bypass works live. ✓
- **SC-6 notification idempotency:** after TWO list calls, `notifications` has **exactly 1**
  `business.brand_invite_pending` per invite (idempotencyKey held). ✓

### B — OQ-1 DECLINE TERMINAL (the critical scenario) — PROVEN LIVE
1. `decline {invitationId:33333333}` as A → **200 {declined:true}**.
2. SQL: invite status=**declined**, `declined_at` SET, never accepted.
3. **WEB raw-token replay** `accept {token:<raw>}` → **410 `invite_declined`** ← RPC P0007 fires;
   the stale email link CANNOT resurrect a declined invite. **(OQ-1 SATISFIED.)**
4. In-app tokenless replay `accept {invitationId:33333333}` → **410 `invite_not_actionable`**.
5. SQL: decline-brand NOT joined (0 membership rows for A).
6. Double-decline → **410 `invite_not_actionable`** (idempotent). ✓

### C — ADVERSARIAL (live)
| Scenario | Result | Verdict |
|----------|--------|---------|
| B accepts A's invite `{invitationId:44444444}` | **403 invite_email_mismatch** | PASS |
| list as B (different email) | `{invites:[]}` 200 | PASS (B sees nothing) |
| accept REVOKED invite | **410 invite_not_actionable** | PASS |
| accept EXPIRED invite | **410 invite_expired** (in-app guard passes status=pending → RPC catches expiry) | PASS |
| tokenless accept NON-EXISTENT id | **404 invite_not_found** | PASS |
| decline NON-EXISTENT id | **404 invite_not_found** | PASS |
| list as A — revoked/expired/declined/accepted excluded | only the 1 pending invite returned | PASS (SC-7) |
| no Authorization header → list | **401** (platform `UNAUTHORIZED_NO_AUTH_HEADER`) | PASS |
| garbage JWT → decline | **401** (platform `UNAUTHORIZED_INVALID_JWT_FORMAT`) | PASS |
| decline non-UUID invitationId (valid JWT) | **400 validation** | PASS |
| GET on list | **405 method_not_allowed** | PASS |

### D — UI (source trace + dead-tap audit; runtime not driven on sim — capped "suspected" for on-device)
- `useBusinessTodos.ts`: flash-safe gate `inviteDetectionReady = isAuthReady && user.id && brandsQuery.isFetched && !isBrandResolving`; threads `pendingInvites` into `buildBusinessTodos` via `useMemo`. (SC-10 structurally enforced.)
- `businessTodos.ts`: invite rows emitted FIRST, before all brand-gate early-returns (brand-less invitee not stranded); exact copy `You've been invited to ${brandName}` / `Tap to accept or decline` (SC-2). Vanish = no per-row state.
- **Home AND Hub both mount the sheet (dead-tap audit PASS):** `home.tsx` + `hub/_layout.tsx` each have the `open_pending_invite` case → `setPendingInvite(...)` → conditional `<InvitePendingSheet>` rendered at the layout root (sibling of `<Slot/>`/content, NOT behind a conditional that unmounts the host). The Hub mount was the implementor's flagged allowlist-amendment fix; verified the case fires AND the sheet is reachable, not a dead tap.
- `InvitePendingSheet.tsx`: Accept (primary) + Decline (ghost), a11y labels, busy-disable, haptics, full toast/error map incl. `invite_not_actionable`/`invite_declined` → "This invite is no longer available". (SC-3/SC-9.)
- Service+hook: accept invalidates `myPending` + `brandKeys.list` (new brand in switcher) + role; decline invalidates `myPending` + notifications. (SC-4/SC-5.)
- **Cap:** business app NOT run on a sim/device in this pass; UI verdict is source-trace + dead-tap audit (the buttons FIRE the proven-live edge fns). On-device confirmation = "suspected-correct"; recommend a quick device smoke at CLOSE.
- **Minor:** Hub mount does NOT pass `onResolved` → no success toast on Hub (Home does). Row still vanishes. Cosmetic, non-blocking.

## 3. ORCH-1112 — gate matrix

| rank | role | Ari visible? | Expected | Result |
|------|------|--------------|----------|--------|
| 0 | brand-less | YES | YES | PASS (SC-11) |
| 10 | scanner | NO | NO | PASS (SC-12) |
| 20 | marketing_manager | NO | NO | PASS (SC-13) |
| 30 | finance_manager | YES | YES | PASS (SC-14) |
| 40/50/60 | event/admin/owner | YES | YES | PASS |

- `MIN_RANK_FOR_TAB.ari` stays a **scalar** (`BRAND_ROLE_RANK.finance_manager` = 30); non-monotonic logic lives ONLY in `visibleTabsForRank` (`rank===NO_MEMBERSHIP_RANK || rank>=min`). (SC-16.)
- Strict-grep `orch-1055-nav-tab-rank-gate.mjs` → **PASS** (exit 0, 5 tab ids, anchor intact).
- Strict-grep `orch-1050-brand-invite-functional.mjs` → **PASS** (exit 0).
- I-32 (`BRAND_ROLE_RANK`/`NO_MEMBERSHIP_RANK`) unchanged. SC-15 (`create_brand` tool needs only userId) unchanged server-side — no new gate.

## 4. Adversarial test authored by tester (append-only)

**`mingla-business/src/utils/__tests__/navTabGate.tester_adversarial.test.ts`** (NEW, tester-owned).
Different angle from the implementor: enumerates the FULL rank space (0,1,10,11,20,21,29,30,40,50,60,999)
and asserts the exact predicate `Ari ⇔ rank===0 || rank>=30`, plus the explicit ORCH-1055 mid-rank lockout.
- Result: **15 passed.**
- Fails-on-revert (monotonic `rank>=30`): rank-0 rows FAIL (2). ✓
- Fails-on-revert (naive `ari:0` scalar): 8 FAIL incl. the scanner/marketing lockout assertion. ✓
  → The carve-out is the ONLY shape passing the whole enumeration.

The seeded-row edge adversarial (SPEC §9(b) ORCH-1111) was proven STRONGER via the **live-fire** matrix in §2.C
(wrong-email 403, revoked/expired/declined exclusion, decline-terminal) against the deployed DB. The existing
source-seam stub `list-my-pending-invites/index.adversarial.test.ts` (5 Deno tests) passes and remains as the
in-repo regression seam.

## 5. Fails-on-revert (implementor claims independently reproduced)

- **ORCH-1112** — revert `navTabGate.ts` carve-out → monotonic → `navTabGate.test.ts` "surfaces ari for a brand-less rank-0 user" FAILS (1), scanner-lockout case STAYS green. Restored → 15 pass. ✓
- **ORCH-1111** — revert `businessTodos.ts` emit to `[]` → `businessTodos.invite.test.ts` 3 of 4 FAIL (FIRST-row, branded, multi-invite); "no invites" case stays green. Restored → 4 pass. ✓

## 6. Regression suite delta

| Suite | Result |
|-------|--------|
| Business jest (full) | **140 failed, 2753 passed** — matches implementor baseline (base 140/2747, +6 my new cases). **0 new failures.** |
| Failures referencing touched files | **0** (all 140 are pre-existing: trips/publicEvents/draftEvent/carousel/hydration — none import invite/navTab/businessTodos code) |
| typecheck (tsc) | **257 errors** (base 263 → 257; implementor matches). **0 reference any touched file**; new tester test typechecks clean. |
| Deno `list-my-pending-invites` | 5 passed / 0 failed |
| Deno `accept-brand-invitation` | 19 passed / 0 failed |
| navTabGate + invite + tester-adversarial | 34 passed / 0 failed |

## 7. Cross-surface matrix

| Surface | Covered | Verdict |
|---------|---------|---------|
| Business iOS | YES | PASS (shared RN; edge fns live-fired; UI source+dead-tap audit) |
| Business Android | YES | PASS (identical shared RN files; no `.ios`/`.android` split) |
| Business Web preview | YES (incidental) | shared `visibleTabsForRank` + To-Do list → parity automatic |
| Consumer iOS/Android, Buyer Web, Admin Web | N/A | untouched |

## 8. Non-blocking observations (NOT conditions)

1. **List vs accept/decline email-case asymmetry (cosmetic, not reachable in prod).** `list-my-pending-invites`
   uses `.eq("email", lower(jwt))` — case-SENSITIVE on the stored side — so a MIXED-CASE stored email would NOT
   surface in the list, while `accept`/`decline` lower BOTH sides and DO match (proven: a mixed-case fixture
   accepted → 200). This is harmless because `invite-brand-member:100` lowercases on write, so the stored side
   is always lowercase in production. Optional hardening: make the list use a `.ilike` / lowered comparison for
   defense-in-depth. Flagged for orchestrator; does NOT block CLOSE.
2. **Hub success-toast gap (cosmetic).** Home passes `onResolved` (success toast); Hub does not. Accept/decline
   still fires and the row vanishes on both. Optional polish.

## 9. Cleanup (all disposable data removed)

- Deleted: 7 brand_invitations, 3 brands, all brand_team_members + audit_log + notifications for the 3 disposable
  brands/users, 3 creator_accounts, **3 auth users** (HTTP 200 each). Verified: 0 `orch1108-test%` users, 0 test
  brands/invites/accounts remain. Real data (sethogieva's 30 brands, "the kisher"/"The Onus") untouched (read-only only).
- Scratch namespaced to `/tmp/orch-1108-1109/` (keys chmod 600).

## 10. Downstream

→ **mingla-orchestrator** CLOSE. At CLOSE: flip the 3 I-PROPOSED-* DRAFT invariants ACTIVE, record the
ORCH-1055 nav amendment in DECISION_LOG, log the sanctioned `navTabGate.test.ts` rank-0 edit + the new
`navTabGate.tester_adversarial.test.ts` append against tests-append-only. The new tester adversarial test file
is uncommitted in the worktree (append-only addition) — commit it with the close.
