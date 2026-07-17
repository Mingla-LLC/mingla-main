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
