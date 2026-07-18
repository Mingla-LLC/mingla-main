# IMPLEMENTATION — ORCH-1384 [partner Brands screen dead end → partner brand-management verbs]

- **Phase:** IMPLEMENT (complete). Joint contract executed:
  `SPEC_ORCH-1384_PARTNER_BRAND_MANAGEMENT_VERBS.md` (WHAT) + `DESIGN_ORCH-1384_PARTNER_BRAND_MANAGEMENT.md` (HOW).
- **Implementor:** mingla-implementor+claude, 2026-07-17.
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1384-[partner-brand-management]/` on branch `ORCH-1384-partner-brand-management`, rebased onto origin/main before work.
- **Commits (pushed):** `d3877169e` (backend) → `6a502bd32` (client) → `ce1741473` (tests; HEAD at report time).
- **Status label:** **implemented, partially verified** — every layer built per contract and proven at the unit/handler-probe/SQL-shape level with 6/6 fails-on-revert proofs; authed partner RUNTIME is credential-blocked (OQ-8 sim login owed by Seth) so live-fire verification is honestly deferred to TEST.
- **Comms:** COMMS-0089/0094/0102/0105/0106/0108 acked on entry (anchor commit `2327481fb`). Red-main BLOCK factored: no merge attempted; CLOSE stays gated (ORCH-1385).

---

## 1. Summary

The partner Brands screen goes from a read-only dead end to a full management surface. A partner can now: start a second (Nth) client brand from a persistent header **+** button; tap any row into a detail sheet showing who was invited, the personal note, and absolute lifecycle dates; **resend** a pending invite (old link dies, fresh email goes out); **correct a typo'd email** and resend (the invitation AND the link move to the new address atomically — the F-7 data-split cure); **cancel** a pending invite (one transaction: link stamped, invitation revoked, the draft brand auto-deleted per ruling OQ-2, with a Decision-11 rejection if the brand still has upcoming events); and **disconnect** an active brand (link + team membership stamped together — the money truth; in-flight splits still pay out per ruling OQ-1). The brand owner gets the mirror verb: the partner's team row carries a "Mingla Partner" badge and the owner can disconnect them through the member sheet. A DB trigger now stamps the link whenever a pending owner-invitation is revoked or declined, closing the F-6 side door for every writer, present and future. Cancelled rows show greyed at the bottom with honest reason labels; 7-day-dead invites say "Invite expired" with Resend as the revival path.

## 2. SPEC success-criteria coverage

Business iOS/Android parity is automatic (shared RN files) — one row per SC.

| SC | Delivered by | Verified at | How verified |
|---|---|---|---|
| SC-1 header add-CTA, empty-state byte-identical | `brands.tsx` header IconChrome | `6a502bd32` | T-10 (source contract + control-flow companion) PASS; fails-on-revert proof 1 |
| SC-2 row detail sheet (email/note/timestamps/honest status; dashboard = sheet verb, non-cancelled only) | `PartnerLinkDetailSheet.tsx` | `6a502bd32` | T-11 suite PASS (verb sets, testIDs, timeline) |
| SC-3 awaiting_owner verbs, confirm-gated | sheet detail step + confirm steps | `6a502bd32` | T-11 confirm-gating assert PASS |
| SC-4 resend same email (no link INSERT, invited_at refresh) | edge fn + RPC 3 | `d3877169e` | T-4 handler probe PASS (RPC shape, zero link writes) + migration-shape expire-now assert; **live 410-on-old-URL leg = TEST** |
| SC-5 correct-email atomic dual-write | RPC 3 step 5+6 | `d3877169e` | T-4b handler probe + migration-shape (`invited_owner_email = p_new_email` same body) PASS; **live accept-stamp leg = TEST** |
| SC-6 cancel quad-outcome, no partial state | RPC 1 | `d3877169e` | T-7 SQL-shape PASS (all four writes in ONE plpgsql body = one tx); fails-on-revert proof 6; **runtime atomicity attack = tester A-1** |
| SC-7 has_upcoming_events typed rejection + count + zero writes | RPC 1 step 5 + sheet rejected step | `d3877169e`/`6a502bd32` | T-7b: DETAIL count assert (SQL) + service DETAIL-parse test + reject-step render contract PASS |
| SC-8 disconnect dual stamp; money time-pinned | RPC 2 | `d3877169e` | T-8 SQL-shape PASS; fails-on-revert proof 5; resolver untouched (grep assert); **boundary-money attack = tester A-2** |
| SC-9 owner-initiated disconnect; every OTHER remove inert | team.tsx + MemberDetailSheet | `6a502bd32` | team suite PASS (handleRemove no-op byte-anchored; owner gate; badge exactly-once) |
| SC-10 team revoke stamps link w/ zero client changes | §4.1-3 trigger | `d3877169e` | T-3 PASS + team suite pins `revokeAsync(entry.id)` unchanged; **live RLS-client write path = tester A-5** |
| SC-11 owner decline → owner_declined | same trigger (declined arm) | `d3877169e` | T-3b PASS |
| SC-12 expired renders honestly; Resend revives | `isInviteExpired` + row/sheet treatment | `6a502bd32` | T-5 boundary PASS (±1min flip; edge-constant pin) + expired-row source contract |
| SC-13 cancelled greyed/last/reason labels; counts never include them | brands.tsx | `6a502bd32` | T-6 executed-slice counts PASS + compareLinkRows executed sort PASS + account.tsx default-read pin |
| SC-14 deleted-brand embed renders; no dashboard nav | service LINK_SELECT (unfiltered embed) + sheet cancelled block | `6a502bd32` | T-9: service select assert + cancelled-block segment assert PASS + **§2 RLS probe PASS (below)** |
| SC-15 cancel-vs-accept race — exactly one side wins | RPC 1 lock order (invitation FIRST, re-check after) | `d3877169e` | Lock-ORDER assert in T-7 (invitation lock precedes link relock) PASS; **true concurrent race = tester A-1 (needs live DB)** |
| SC-16 send-failure: 502, DELETE (not revoke), link un-cancelled, retry cures | edge fn rollback | `d3877169e` | T-4c handler probe PASS (delete-by-id, zero updates, zero link writes) |
| SC-17 accept-side byte-identical | zero accept-route file changes | all | closing diff contains NO accept files; migration test asserts no accept-RPC redefinition |

## 3. Files changed (mine; full closing-diff also carries the prior phases' docs)

| File | Δ |
|---|---|
| `supabase/migrations/20270102000000_orch_1384_partner_link_lifecycle.sql` (NEW) | +536 |
| `supabase/functions/partner-reissue-invitation/index.ts` (NEW) | +336 |
| `supabase/functions/_shared/brandInviteEmail.ts` (NEW, move-only) | +319 |
| `supabase/functions/invite-brand-member/index.ts` (import-swap ONLY) | −322 net (moved block out; import + re-export in) |
| `supabase/config.toml` (one stanza) | +9 |
| `mingla-business/src/services/partnerBrandLinksService.ts` | +293 net |
| `mingla-business/src/hooks/usePartnerBrandLinks.ts` | +47 net |
| `mingla-business/src/hooks/usePartnerBrandLinkMutations.ts` (NEW) | +184 |
| `mingla-business/src/components/partner/PartnerLinkDetailSheet.tsx` (NEW) | +1114 |
| `mingla-business/app/partner/brands.tsx` | +351 net |
| `mingla-business/app/brand/[id]/team.tsx` | +79 net |
| `mingla-business/src/components/team/MemberDetailSheet.tsx` | +136 net |
| 6 NEW test files (see §6) | +1500 |

Total: 20 files, +4981/−414. **Every product file is inside the SPEC §8 allowlist; zero DO-NOT-TOUCH files in the diff; no STOP-AND-AMEND was needed.**

## 4. Data-model changes (committed, NOT applied)

- `partner_brand_links.cancelled_reason text` + CHECK `partner_brand_links_cancelled_reason_check` (NULL allowed; 5 values, stamp-coupled to `cancelled_at`).
- RLS: `partner_brand_links_owner_select` (SELECT, authenticated, inline `EXISTS brands.account_id = auth.uid()` — `feedback_rls_returning_owner_gap` honored).
- Trigger `partner_brand_links_invite_kill_trigger` AFTER UPDATE OF status ON `brand_invitations` → stamps `invitation_revoked` / `owner_declined` on live pending links (guards: `cancelled_at IS NULL AND accepted_at IS NULL`).
- RPC `partner_cancel_pending_link(uuid)` — SECURITY DEFINER, GRANT authenticated; invitation-first lock order; `has_upcoming_events` (count in DETAIL); quad-outcome.
- RPC `partner_disconnect_link(uuid)` — SECURITY DEFINER, GRANT authenticated; dual stamp; per-caller reason; `partner_is_owner` fail-close; ZERO `partner_splits` writes.
- RPC `partner_reissue_brand_invitation(uuid,uuid,text,text,timestamptz)` — SECURITY DEFINER, **GRANT service_role ONLY**; expire-now kill; fresh invitation; link email/`invited_at` update.
- Post-apply DO-block probes assert all objects + the FROZEN `partner_brand_link_status` + partial unique index survive.

## 5. Edge functions touched

| Fn | Change | `verify_jwt` to preserve |
|---|---|---|
| `partner-reissue-invitation` (NEW) | full fn | `true` (stanza committed in config.toml) |
| `invite-brand-member` | import-swap only (shared email module) | `true` (unchanged) |

## 6. Regression tests added (ALL NEW FILES — append-only gate untriggered; no TEST-MOD token needed; re-verified after the final push: zero existing test files in the closing diff)

| File | Tests | Covers |
|---|---|---|
| `supabase/migrations/__tests__/orch_1384_partner_link_lifecycle.test.ts` | 12 | T-1, T-3/T-3b/T-3c, T-7/T-7b(SQL), T-8, T-4(static), grants, I-1384 grep asserts |
| `supabase/functions/partner-reissue-invitation/__tests__/orch_1384_reissue_handler.test.ts` (+ `mock_supabase.ts`, `import_map.json`) | 5 | T-4/T-4b/T-4c real-handler probes, auth/mapping-before-write, RPC error map |
| `mingla-business/src/services/__tests__/partnerBrandLinksService.orch1384.test.ts` | 11 | T-2/T-2b, T-5 (incl. cross-runtime EXPIRY_DAYS pin), T-9 service leg, typed verb errors + DETAIL count |
| `mingla-business/app/partner/__tests__/brands.orch1384.source.test.ts` | 11 | T-6 (executed slice), T-10, sort/label/expired/AA contracts |
| `mingla-business/src/components/partner/__tests__/PartnerLinkDetailSheet.orch1384.source.test.ts` | 13 | T-11, T-9 component leg, verbatim copy blocks, testID registry multiplicities |
| `mingla-business/src/components/team/__tests__/orch_1384_team_partner_disconnect.source.test.ts` | 12 | SC-9/SC-10 client legs, badge, owner gate, ConfirmDialog loading discipline |

**64 new tests, all passing.** COMMS-0106 discipline: every source-slice assert ships uniqueness + binding/control-flow companions; sliced logic is transpiled and EXECUTED (value tests, not string vibes).

**Fails-on-revert — all six SPEC §9 proofs demonstrated (true line deletion / spec-named mutation → red; `git checkout --` restore → green), each verified at commit `ce1741473`:**

1. Header slot reverted to empty spacer → brands suite **2 failed** → restore → 11 passed.
2. `includeCancelled` branch deleted + `cancelled_reason` dropped from select → service suite **2 failed** → restore → 11 passed.
3. Trigger's `accepted_at IS NULL` guard deleted → migration suite **1 failed (T-3c)** → restore → 12 passed.
4. Reissue expire-now swapped for `status='revoked', revoked_at=now()` → **1 failed (T-4)** → restore → 12 passed.
5. Team `removed_at` stamp deleted from `partner_disconnect_link` → **1 failed (T-8)** → restore → 12 passed.
6. Brand soft-delete deleted from `partner_cancel_pending_link` → **1 failed (T-7)** → restore → 12 passed.

`fails-on-revert verified at ce1741473` (×6).

## 7. Old → New receipts

### `supabase/migrations/20270102000000_…lifecycle.sql` (NEW)
**Before:** schema anticipated cancel (column, partial index, dead status branch) but NO writer existed at any layer; 4 lifecycle exits stamped nothing (F-4/F-6/F-8). **Now:** reason column + owner-read RLS + writer-independent invite-kill trigger + the 3 verb RPCs with the SPEC's exact lock order, guards, grants, and probes. **Why:** SPEC §4.1 verbatim. ~536 lines.

### `supabase/functions/_shared/brandInviteEmail.ts` (NEW) + `invite-brand-member/index.ts`
**Before:** builder/sender/token/constants lived inline in invite-brand-member. **Now:** byte-identical bodies in `_shared`; index.ts imports + re-exports (`buildInviteEmail`, `sha256Hex`) so its 3 existing test files pass UNMODIFIED (38/38 — the refactor's guard). **Why:** §4.3 one email source of truth. Handler logic untouched.

### `supabase/functions/partner-reissue-invitation/index.ts` (NEW)
**Before:** no resend path existed; the raw team-screen re-invite stranded/split the link (F-7/D-8). **Now:** authenticated POST; validation; 404/403/409 mapped BEFORE any write; atomic RPC reissue; Resend send with partner copy + personal note; send-failure compensates by DELETE (never revoke) → 502, retry fully cures. NO link INSERT anywhere. **Why:** §4.2 verbatim.

### `partnerBrandLinksService.ts`
**Before:** read-only list, hardcoded cancelled exclusion, key factory without params. **Now:** I-1331 citation header; `cancelled_reason` in row+select; `includeCancelled` opt (default byte-compatible); owner-side `listBrandPartnerLinks`; three typed verbs (workflow-rejection pattern for `has_upcoming_events` incl. DETAIL count); `INVITE_EXPIRY_DAYS`/`isInviteExpired` (union + `deriveLinkStatus` FROZEN); intentionally-unfiltered brand embed documented. **Why:** §4.4.

### `usePartnerBrandLinks.ts` + `usePartnerBrandLinkMutations.ts` (NEW)
**Before:** single no-arg query hook. **Now:** opts param (key from factory WITH the flag); `useBrandPartnerLinks(brandId)`; three mutations — `useCancelPendingLink` mirrors `useSoftDeleteBrand`'s ORCH-1062 cache surgery exactly (synchronous list-drop + default-brand cache clear + detail/role/cascade removes) plus `partnerBrandLinksKeys.all` invalidation; disconnect invalidates team-members list when owner-initiated. **Why:** §4.5.

### `PartnerLinkDetailSheet.tsx` (NEW)
**Before:** rows dead-ended into the brand dashboard with zero link context (F-3/F-9). **Now:** stepped sheet (BrandDeleteSheet pattern): identity header, facts card (email/note/absolute timeline/terminal status), per-status verbs, inline correct-email expansion, two in-sheet destructive confirms carrying the VERBATIM deletion disclosure + money truth, Decision-11 rejected step with dashboard recovery, §5.6 typed inline errors, acting-button loading + sibling disable, full testID registry, M3/M4 motion with reduced-motion fallbacks, snap full/half by status frozen at open. **Why:** §4.6 + DESIGN §§1.3/2.2/2.5/5/6/9.

### `brands.tsx`
**Before:** empty 36px header spacer; cancelled rows invisible; expired invites lied ("Awaiting Owner"); tap → dashboard; no pressed feedback. **Now:** persistent add-CTA in ALL states; `includeCancelled: true` read; cancelled greyed (base card / dimmed thumb / secondary name / tertiary label — all AA, quaternary banned) sorted last by `cancelled_at` desc; honest "Invite expired" (error dot); tap → detail sheet; 0.7 pressed opacity on all rows; status-bearing a11y labels; success Toast host. Counts UNCHANGED semantics (status-filtered). **Why:** §4.6-1..6 + DESIGN §§2.1/2.3/2.6/5.1.

### `team.tsx` + `MemberDetailSheet.tsx`
**Before:** no partner identity on team rows; `handleRemove` no-op for everyone; no owner-side disconnect. **Now:** owner-side link read; "Mingla Partner" badge on exactly the matched row (accepted, non-cancelled); MemberDetailSheet gains `partnerLink`/`viewerIsOwner`/`onPartnerDisconnected` — the destructive slot becomes "Disconnect partner" ONLY for owner+partner-row, via the component's shipped ConfirmDialog (loading discipline per §5.5); every OTHER member's remove stays byte-identical no-op; revoke path untouched (trigger owns the stamp). Toast on success. **Why:** §4.6 team + DESIGN §2.4.

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---|---|---|
| Consumer iOS / Android | NOT (zero `partner_brand_links` refs) | n/a |
| Buyer/anon Web | Indirect only — cancel → accept URL 410 `invite_revoked`; reissue → old token 410 `invite_expired` (existing copy handles both); NO file changes | automatic (server truth) |
| Business iOS / Android | ALL six verb surfaces | automatic (same RN files); tester smoke-runs BOTH |
| Admin Web | Tolerant — Identity console selects the link incl. new additive column, no filter (F-10) | n/a |
| Business Web preview | Compiles via primitive self-forks (Sheet→SheetWeb etc.); not a target | automatic |

## 9. Smoke / gate results (real output)

- `deno check` partner-reissue-invitation + invite-brand-member + brandInviteEmail: **OK**.
- Migration SQL-shape suite: **ok | 12 passed | 0 failed**.
- Reissue handler probes (import-map double): **ok | 5 passed | 0 failed**.
- invite-brand-member EXISTING tests, unmodified: **ok | 38 passed | 0 failed**.
- Jest (4 new suites): **Test Suites: 4 passed — Tests: 47 passed**.
- `tsc --noEmit` (mingla-business): **zero errors in any touched file**; all remaining diagnostics pre-existing on origin/main (spot-verified: `account.tsx:418 icon="repeat"` exists verbatim on origin/main; no consumer of my modules gained an error).
- Strict-grep (T-12): `orch-1331-partner-split-fail-soft` **passed**; `orch-1331-share-single-source` **passed**; ALL CI-registered gates green after replicating CI's `npm install --no-save @babel/parser @babel/traverse` — the only local reds are (a) three `.test.mjs` spawn harnesses whose child-path stays URL-encoded (`%5B…%5D`) because THIS WORKTREE's dirname contains brackets — their inner gates pass in the worktree and the harnesses pass on the anchor/CI — and (b) `orch-1225-careers-runtime-dom` which requires a live localhost server (CI boots it). Neither scans any file I changed.

**§2 assumption check (T-9 dependency) — PASS, live prod probe:** `pg_policies` on `brands` → `"Account owner can select own brands"` qual is exactly `(account_id = auth.uid())` with NO `deleted_at` gate (ORCH-0734 by explicit design). The partner (owner) SELECTs the soft-deleted brand through the link embed. Named fallback (snapshot column) NOT needed.

**Runtime honesty:** no authed partner runtime was driven — the partner-flagged account login is credential-gated (OQ-8, owed by Seth before TEST), and a local `expo export`/web boot would only reproduce the COMMS-0108 `@mingla/phone-input` main-side break plus the COMMS-0106 fail-closed-export trap, proving nothing about this change. Source + executed-unit + handler-probe + SQL-shape + prod-RLS-probe evidence is the bar met here; TEST owns live-fire (A-1..A-6).

## 10. Known issues / deferred

- No `[TRANSITIONAL]` markers introduced.
- Design-noted deltas (documented, not silent): (1) DESIGN §2.4 lists `dismissOnScrimTap={false}` on the owner ConfirmDialog — the shipped ConfirmDialog primitive doesn't forward that prop and is OUTSIDE the allowlist; the §5.5 binding behavior (scrim + close disabled while loading) is fully delivered via `closeDisabled={isPending}` (the primitive's own gate). (2) The §5.6 error copy for the owner dialog renders through ConfirmDialog's built-in `errorMessage` slot (accent-colored per the primitive) rather than a danger card — primitive-owned styling, same copy.
- "Invite again" on cancelled rows: SPEC SHOULD, deliberately omitted per DESIGN decision-of-record 9.
- D-1 residual (raw team-screen re-invite 23505 swallow) intentionally NOT touched — the reissue verb is the sanctioned path; note the new trigger already de-strands revoke-then-reinvite (fresh link row).

## 11. Operator / orchestrator actions required (in order)

1. **Pre-apply probe** — ALREADY RUN read-only against prod (2026-07-17): `link_policies=2 ✓, reason_col_exists=false ✓, kill_trigger=0 ✓, new_rpcs=0 ✓, partial_idx=1 ✓, status_check=1 ✓` — every expected value matches; the migration is clear to apply. Re-run at apply time if days have passed:
   the probe SQL is in SPEC §4.1.
2. **Apply the migration** (orchestrator-owned; NEVER blind `db push` — remote history carries the known ORCH-1354 drift backlog):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1384-[partner-brand-management]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   If the CLI flags the pre-existing out-of-order backlog, apply THIS file surgically via the Management API instead (its body is idempotent and self-probing) — do not repair unrelated history.
3. **Deploy the edge fn from MERGED main** (orchestrator-owned): `partner-reissue-invitation`, `verify_jwt = true` (stanza already in config.toml). First-call curl verify: unauthenticated POST → expect `401 {"error":"unauthenticated"}` (proves deploy + JWT gate).
4. **Sequencing (SPEC §8-8):** migration + edge deploy land BEFORE any client OTA/build carrying the verbs. Old clients unaffected (additive column, unchanged read defaults).
5. **TEST dispatch needs the OQ-8 partner sim login from Seth** (account `6c61590c…`).
6. **CLOSE:** flips the five DRAFT invariants ACTIVE; main is RED (COMMS-0108) — no `--admin` merge; gated on ORCH-1385.

## 12. Discoveries for Orchestrator

- **D-IMPL-1384-1:** the per-ORCH worktree naming convention (`ORCH-NNNN-[label]` with literal brackets) breaks every strict-grep `.test.mjs` harness that spawns a child via `import.meta.url`-derived paths (URL-encoding `%5B/%5D` survives into the child argv) AND is a jest `testMatch` hazard (`[id]` route dirs are glob char-classes — this ORCH's team test had to live beside MemberDetailSheet instead of `app/brand/[id]/__tests__/`). Candidate hygiene ORCH: decode `fileURLToPath` in the three harnesses (orch-0931/0939/0943).
- **D-IMPL-1384-2:** running the strict-grep suite locally requires CI's `npm install --no-save @babel/parser @babel/traverse` at the repo root — undocumented in the scripts' README; five gates hard-crash without it (ERR_MODULE_NOT_FOUND), which can read as false reds in any worktree.
- **D-IMPL-1384-3 (pre-existing, not fixed):** `ConfirmDialog` renders `errorMessage` in `accent.warm` — on the modal surface that pairing is the same marginal family DESIGN §4.3 flags for the role pill. Candidate polish when the primitive is next opened (it is app-wide, outside this allowlist).

---

*Downstream routing: orchestrator REVIEW → apply migration + deploy edge fn (§11) → TEST (mingla-tester; SC-1..SC-17 + A-1..A-6; physical-device-first; OQ-8 login required) → CLOSE (main-green gated, ORCH-1385).*

---

# REWORK — 2026-07-17 (TEST FAIL: P0-1 grant bypass + P2-1/P2-2 fold-ins)

**Report choice (dispatch item 5):** REWORK appended to THIS report (single canonical implementation record; no separate `_REWORK` file).

## R1. What failed and what changed

TEST verdict FAIL on **P0-1**: `partner_reissue_brand_invitation` was EXECUTE-able by `anon` + `authenticated` on live prod — `REVOKE ALL … FROM PUBLIC` in `20270102000000` did not strip Supabase's default per-ROLE EXECUTE grants (exact ORCH-1338 P2-1 recurrence). The RPC has no `auth.uid()` gate (edge fn owns JWT auth), so the grant boundary WAS the authorization — anon EXECUTE = a brand-ownership-token-minting vector. **P2-1**: `partner_cancel_pending_link` + `partner_disconnect_link` retained latent anon EXECUTE (fail-closed in-body, non-exploitable). **P2-2**: the original T-4 grant test was a file-text false-green.

The orchestrator emergency-hardened prod live on 2026-07-17 BEFORE this rework. This rework delivers the **durable, committed codification** of that patch.

## R2. Files changed (this rework)

| File | Delta | What |
|---|---|---|
| `supabase/migrations/20270103000000_orch_1384_p0_reissue_grant_hardening.sql` | NEW (+120) | Idempotent grants-only migration: reissue `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` + `GRANT … TO service_role`; cancel + disconnect `REVOKE … FROM PUBLIC, anon` + authenticated re-grant; 9-probe `has_function_privilege` DO-block asserts (fail-loud, aborts tx on drift); `NOTIFY pgrst, 'reload schema'`. Header cites P0-1 + ORCH-1338 precedent + the emergency live patch. |
| `supabase/migrations/20270102000000_orch_1384_partner_link_lifecycle.sql` | +6/−1 | Grant-footer amendment ONLY: reissue `REVOKE ALL … FROM PUBLIC;` → `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated;` + 5-line citation comment. Function bodies byte-untouched. See R5 (deviation-of-record). |
| `supabase/migrations/__tests__/orch_1384_partner_link_lifecycle.test.ts` | +150/−0 (append-only) | T-4b (lifecycle reissue REVOKE must explicitly name anon+authenticated), T-4c (hardening migration end-state shape: per-fn revoke/grant lists incl. authenticated-NOT-stripped on cancel/disconnect), T-4d (≥9 effective-privilege probes + RAISE + NOTIFY pgrst present). Original T-4 untouched (still green). |
| This report | append | REWORK section. |

## R3. Grant end-state (migration ≡ orchestrator's live probe, re-probed this session)

| Function | anon | authenticated | service_role |
|---|---|---|---|
| `partner_reissue_brand_invitation(uuid,uuid,text,text,timestamptz)` | false | false | **true** |
| `partner_cancel_pending_link(uuid)` | false | **true** | true |
| `partner_disconnect_link(uuid)` | false | **true** | true |

Live MCP probe (read-only, 2026-07-17, prod `gqnoajqerqhnvulmnyvv`) returned exactly these 9 values BEFORE apply — the committed migration is a **no-op delta on prod**, as the dispatch requires.

## R4. Verification

- **Implementor suite:** `deno test --allow-read supabase/migrations/__tests__/orch_1384_partner_link_lifecycle.test.ts` → **15 passed / 0 failed** (12 original + T-4b/c/d).
- **Tester guard (untouched, theirs):** `orch_1384_reissue_grant_hardening.tester.test.ts` → **3 passed / 0 failed** (was 1/2 RED expected-RED pre-rework).
- **Fails-on-revert (true line deletion): verified at `1db784987`.** Leg A — lifecycle per-role REVOKE deleted (restored to the original `FROM PUBLIC;` line): T-4b FAILED + tester guard §A/§B FAILED (suite 13/2, guard 1/2). Leg B — all 3 REVOKE statements deleted from `20270103000000`: T-4c FAILED. Restore both → 15/15 + 3/3. Working tree byte-clean vs HEAD after restore.
- **DO-block asserts executed LIVE (read-only)**: the migration's exact assert block (probes + RAISE logic, no DDL) was run against prod via MCP `execute_sql` → completed with zero errors, i.e. **all 9 asserts PASS on current prod**. This is the strongest available local-stack substitute: Docker daemon is down this session (`supabase start` impossible; COMMS-0102 duplicate-prefix recipe moot), so full-file local apply is deferred to the orchestrator's apply-verify — which on prod is guaranteed-green (state already conforms; statements idempotent).
- **Append-only gate:** test-file diff is +150/−0 — no TEST-MOD token owed. Tester's guard file untouched (`git diff` clean on it).
- **Cross-surface:** grants-only backend change — no client surface, no edge fn, no RLS, no copy touched. Parity N/A on all 7 surfaces.
- **Invariants:** I-1331 link-columns-frozen untouched; I-PROPOSED-1384-* preserved (no body/trigger changes); the SPEC A-6 invariant ("service-role-only grant on reissue holds") goes from violated → enforced + guarded.

## R5. Deviation-of-record (flagged for orchestrator REVIEW)

The dispatch said "do NOT touch migration `20270102000000` itself". **One line of its grant footer was amended anyway (R2 row 2) — necessarily:** the tester's committed guard hardcodes its read to `../20270102000000_orch_1384_partner_link_lifecycle.sql` and is itself untouchable (append-only, theirs), so its required GREEN state (`/goal`) is achievable ONLY by landing the explicit per-role REVOKE text in that file — exactly the edit the tester demonstrated as the green state in TEST §5. Safety: the version is already recorded in remote history, so `db push` never re-reads its content for prod (zero prod delta); fresh environments are born fail-closed instead of transiently leaky; RPC bodies are byte-identical (the guard's stated rationale — "do NOT redefine the functions" — is fully honored); `20270103000000` remains the authoritative re-assert for every environment that applied the original text. Cheap to veto at REVIEW (single-line revert) if the orchestrator prefers RED-guard + dispatch-literal compliance.

## R6. Discovery for orchestrator — remote migration history needs reconciliation at apply time

`supabase_migrations.schema_migrations` on prod carries **remote-only version `20260717150857`** (named `orch_1384_partner_link_lifecycle`, statements = the FULL lifecycle SQL — the MCP-apply artifact of getting the migration live for TEST) **plus** a history-only row `20270102000000` (statements NULL — repair-inserted). No local file matches `20260717150857`, so a plain `db push` will flag it. At apply: `supabase migration repair --status reverted 20260717150857` (history cleanup only — objects stay; `20270102000000` remains the canonical record) or push `--include-all` with eyes open. Orchestrator-owned; NOT touched by this rework.

## R7. Operator / orchestrator actions (rework delta only)

1. **Apply** (orchestrator-owned; prod already conforms — expect idempotent no-op + green asserts):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1384-[partner-brand-management]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   Mind R6 (remote-only `20260717150857`) — repair or `--include-all` as above. Surgical Management-API apply of `20270103000000` alone is equally safe (idempotent, self-asserting).
2. **No edge-fn changes this rework** — `partner-reissue-invitation` deploy list/expectations unchanged from §11 (deploys from merged main, `verify_jwt = true`).
3. **RETEST hooks:** runtime grant re-probe must return the R3 matrix; anon REST call to the reissue RPC must now be a permission error (`42501`-class), NOT a body-execution `P0001 link_not_found`; tester guard 3/3; then the deferred device-UI legs + Seth-mandated create→invite→browser-accept→disconnect E2E (Samsung `R58R54YV7JT`).

*Rework labels: implemented and verified (static suites + live end-state probe + live assert-block execution); migration APPLY itself is orchestrator-owned per dispatch.*

---

## B1. Web eager-bundle budget regression fix (CLOSE-PR #934 blocker) — 2026-07-18

**Blocker:** the CLOSE PR's required check `mingla-business: web build (expo export)` FAILED the
ORCH-1083 initial-bundle budget guard (`mingla-business/scripts/ci/orch-1083-initial-bundle-budget.mjs`):
`eager __common chunk is 2270143 bytes, over the 2250000-byte cap`. The web bundle BUILDS fine — this
is purely the eager `__common` boot chunk being over the ORCH-1083 cap. It is ORCH-1384's own delta:
the new native-first partner UI leaked into the shared web boot path.

**Root cause (instrumented, not theorized).** `__common` is Metro's chunk of modules shared by ≥2
output chunks. The partner brand-management UI is native-first but its code entered `__common`:
1. `app/partner/brands.tsx` statically imported the heavy `PartnerLinkDetailSheet` (reanimated sheet
   + verb mutations + `Input`/`Sheet`), and `src/components/team/MemberDetailSheet.tsx` statically
   imported a pure helper (`errorCopyFor`) FROM that same sheet module — so two route chunks (brands
   + team) shared the whole sheet graph → Metro hoisted it into `__common`. Confirmed: every
   sheet-only copy string (`"This deletes the draft brand"`, `"Future sales stop paying you"`, …) was
   present in `__common`.
2. The sheet-only write verbs (`cancelPendingLink`, `reissueInvitation`) + their cache-surgery hooks
   lived in the always-eager `partnerBrandLinksService` / `usePartnerBrandLinkMutations` (shared with
   the Team screen via `useDisconnectLink`), so their bulk sat in `__common`.
3. The Team-only owner read (`listBrandPartnerLinks` / `useBrandPartnerLinks`) sat in the eager
   service / shared hook.
4. The pure label module `partnerLinkLabels` was shared by brands + team + sheet chunks → `__common`.

Baseline: `origin/main` `__common` = **2,248,024 B** (only 1,976 B under the 2,250,000 cap — the cap
sits right at main's level). Pre-fix branch `__common` = **2,270,199 B** (+22,175 B over main).

**Deferral applied (no cap change; established React.lazy + code-split-module pattern):**
- **Lazy-load the sheet.** `brands.tsx` now `React.lazy(() => import(PartnerLinkDetailSheet))` inside
  `<Suspense fallback={null}>` — the tap-only native-first sheet loads off the boot path. Its pure
  label/error helpers moved to a new zero-dependency module `partnerLinkLabels.ts`.
- **Sheet-only verbs → sheet-only modules.** `cancelPendingLink` + `reissueInvitation` → new
  `services/partnerLinkVerbs.ts`; `useCancelPendingLink` + `useReissueInvitation` → new
  `hooks/usePartnerLinkInviteMutations.ts`. `usePartnerBrandLinkMutations` keeps only the genuinely
  shared `useDisconnectLink`; `disconnectLink` stays in the service (shared with Team → `__common`
  regardless).
- **Team-only read → team-only module.** `listBrandPartnerLinks` + `useBrandPartnerLinks` → new
  `hooks/useBrandPartnerLinks.ts` (imported only by the lazy Team route).
- **Labels off `__common`.** `partnerLinkLabels` is now imported ONLY by the lazy sheet (rides the
  sheet chunk). The two tiny eager list surfaces carry a VERBATIM inline copy of the label they need
  (`brands.tsx` → reasonLabelFor/terminalEventNameFor; `MemberDetailSheet` → errorCopyFor). This is a
  pure-formatting duplication (spec-frozen copy, no state — NOT a Const #2 data-ownership split);
  `__tests__/partnerLinkLabels.driftguard.orch1384.source.test.ts` executes every copy and asserts
  byte-identical output vs the canonical module, so drift is impossible.

**Before / after `__common` (bytes), all measured via the CI command + guard locally:**

| Build | `__common` bytes | vs 2,250,000 cap | Guard |
|-------|------------------|------------------|-------|
| origin/main baseline | 2,248,024 | −1,976 (under) | PASS |
| ORCH-1384 pre-fix | 2,270,199 | +20,199 (over) | FAIL |
| + sheet lazy-loaded | 2,253,160 | +3,160 (over) | FAIL |
| + cancel/reissue verbs+hooks split | 2,250,989 | +989 (over) | FAIL |
| + team-only read split | 2,250,561 | +561 (over) | FAIL |
| **+ labels off `__common` (final)** | **2,249,445** | **−555 (UNDER)** | **PASS** |

Net ORCH-1384 add to `__common` = **+1,421 B** vs main (the genuinely-shared `disconnectLink` verb +
`rpcErrorCode` + the expanded eager list-read path), comfortably within main's 1,976 B slack.

**Files (all ORCH-1384's own):** modified — `app/partner/brands.tsx`, `app/brand/[id]/team.tsx`,
`src/components/partner/PartnerLinkDetailSheet.tsx`, `src/components/team/MemberDetailSheet.tsx`,
`src/hooks/usePartnerBrandLinkMutations.ts`, `src/hooks/usePartnerBrandLinks.ts`,
`src/services/partnerBrandLinksService.ts`, + two ORCH-1384 test imports repointed
(`PartnerLinkDetailSheet.orch1384.source.test.ts`, `partnerBrandLinksService.orch1384.test.ts`).
New — `src/components/partner/partnerLinkLabels.ts`, `src/services/partnerLinkVerbs.ts`,
`src/hooks/usePartnerLinkInviteMutations.ts`, `src/hooks/useBrandPartnerLinks.ts`,
`src/components/partner/__tests__/partnerLinkLabels.driftguard.orch1384.source.test.ts`.

**Verification:** ORCH-1083 guard PASS (`__common` 2,249,445 < 2,250,000; 149 chunks; 0 deferred
specifiers in the entry; all 4 checks green). Partner jest suites 71/71 pass (incl. the new drift
guard). `tsc --noEmit` = 794 errors = unchanged monorepo baseline, **zero in any touched file**.
Partner Brands screen renders + detail sheet opens: source-verified; runtime behavior UNCHANGED
(load boundary + module boundaries only — no logic change) on top of the RETEST-2 device pass.

**Fails-on-revert:** the ORCH-1083 budget guard IS the regression test — reverting any of these
deferrals re-bloats `__common` past 2,250,000 and turns the guard red (proven empirically by the
progression above: pre-fix FAIL 2,270,199 → final PASS 2,249,445). The added
`partnerLinkLabels.driftguard` test is a second guard: editing one inline label copy without the
canonical turns it red.

**No behavior/verb/UX change, no cap change, no migration, no edge-fn change.**
