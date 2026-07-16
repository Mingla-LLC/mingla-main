# INVESTIGATION — ORCH-1384 [partner Brands screen dead end — no 2nd-brand invite, no row detail, no cancel/disconnect]

- **Phase:** INVESTIGATE (missing-feature inventory across the Five-Truth-Layer). NO fix proposed.
- **Investigator:** mingla-forensics+claude
- **Date:** 2026-07-16
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1384-[partner-brand-management]/` on branch `ORCH-1384-partner-brand-management`, rebased on origin/main @ `e7ff70b4e`.
- **Dispatch inputs honored:** INTAKE stanza (WORLD_MAP § Issue Registry, 2026-07-16), all named code files read verbatim, full `partner_brand_links` migration chain read with latest-definition checks, prod reads via Supabase MCP (READ-ONLY), probes namespaced `/tmp/orch-1384/`, evidence in `Mingla_Artifacts/evidence/ORCH-1384/`.
- **Comms ledger:** COMMS-0089/0094/0099/0102/0105/0106/0107 read + acked (anchor commit `e7ff70b4e`). No BLOCK entries. No local `supabase start` (0102), no git stash (0105), no OneLink surface touched (0104/0107).

---

## 1. Symptom summary (expected vs actual)

**Expected (product intent, INTAKE):** a Mingla partner managing client brands can (i) start another client-brand setup at any time, (ii) inspect a row (who was invited, status, when, resend), (iii) cancel a pending invite, (iv) disconnect an active managed brand.

**Actual:** `/partner/brands` is a read-only list with exactly one verb — tap-through to `/brand/{id}`. With ≥1 link (even pending) there is NO path anywhere in the app to start a second client brand; rows show name + status chip + one-line subtext (never the invited email); no cancel/disconnect verb exists at ANY layer (no RPC, no edge fn, no RLS write policy). Live prod state matches the intake screenshot: 1 link, `awaiting_owner`, "Rockstar Vibes".

---

## 2. Investigation manifest (read in order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `Mingla_Artifacts/WORLD_MAP.md` § ORCH-1384 stanza (line 1338) | Docs | INTAKE record |
| 2 | `mingla-business/app/partner/brands.tsx` (400 lines, verbatim) | Code/UI | the dead-end screen |
| 3 | `mingla-business/src/services/partnerBrandLinksService.ts` (verbatim) | Code | read-only client rail |
| 4 | `mingla-business/src/hooks/usePartnerBrandLinks.ts` (verbatim) | Code | query hook |
| 5 | `supabase/functions/invite-brand-member/index.ts` (710 lines, verbatim) | Code/Edge | the ONLY link INSERT path |
| 6 | `supabase/migrations/20260920000000_orch_1081_partner_brand_links.sql` (verbatim) | Schema | table, partial unique index, RLS, triggers, accept-RPC v1 |
| 7 | `supabase/migrations/20260926000000_orch_1111_oauth_null_email_accept.sql` (verbatim) | Schema | LATEST accept-RPC definition (migration-chain rule; 20261208000001/-05 only reference, never redefine — grep-verified) |
| 8 | `supabase/migrations/20261228000000_orch_1331_partner_paystack_rail.sql` §4 | Schema | Paystack lifecycle trigger, column-freeze invariant |
| 9 | `supabase/migrations/20261205000001_orch_1272_identity_admin_read_rls.sql` (verbatim) | Schema | admin read RLS on the link table |
| 10 | `supabase/functions/accept-brand-invitation/index.ts` (499 lines, verbatim) | Code/Edge | accept path + partner notify |
| 11 | `mingla-business/src/services/brandInvitationsService.ts` (388 lines, verbatim) | Code | invitation verbs incl. the revoke writer |
| 12 | `supabase/migrations/20260820000000_orch_1050_brand_invite_flow.sql` (UPDATE policy §) | Schema | who may revoke invitations |
| 13 | `supabase/functions/_shared/partnerSplits.ts` (full) + `paystackPartnerSplits.ts` (resolution §) | Code/Money | what actually pays the partner |
| 14 | `supabase/migrations/20260823000000_orch_1054_partner_splits.sql` (resolver fn) | Schema | `resolve_partner_for_brand_at_time` — only definition |
| 15 | `mingla-business/app/partner/earnings.tsx` (nudge §§ 370–430, 555–600) | Code/UI | zero-links nudge |
| 16 | `mingla-business/src/components/brand/BrandCreationFlow.tsx` (partner path §§) | Code/UI | `partner_mode=client` wizard + step-5 invite |
| 17 | `mingla-business/app/brand/[id]/team.tsx` (§§ 80–260, 340–440) | Code/UI | pending-invite rows + revoke sheet + removal no-op |
| 18 | `mingla-business/app/brand/[id]/index.tsx` + `src/services/brandsService.ts` (§§ 545–625) | Code/UI | dashboard resolution for awaiting_owner/active brands |
| 19 | `mingla-business/app/(tabs)/account.tsx` (§§ 40–52, 180, 344–352) | Code/UI | entry point + count row |
| 20 | `mingla-admin/src/services/identityReadService.js` (§§ 43–196) | Code/Admin | admin reads of the link table |
| 21 | `supabase/functions/decline-brand-invitation/index.ts` (grep: zero link refs) | Code/Edge | decline path vs the link |
| 22 | `supabase/functions/invite-brand-member/__tests__/*` (harness shape) | Tests | existing coverage before probing |
| 23 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (ORCH-1331 §, lines 123–143) | Docs | binding invariants |
| 24 | Prod (READ-ONLY, Supabase MCP): link rows, invitation row, team rows, `pg_policies`, `pg_indexes`, trigger inventory, live fn definitions | Data | live truth |

---

## 3. Q-scorecard

### Q1 — Can a partner with ≥1 link invite ANOTHER client brand today? (scope a-i)
UI: **no** — the only two entry points render exclusively at zero links. `brands.tsx:147-165` empty-state CTA renders only when `sortedRows.length === 0`; the list header's right slot is an empty 36 px spacer (`brands.tsx:125`, styles `:331-333`); `earnings.tsx` `ReadyToEarnNudge` returns `null` when `links.length > 0`. Backend + route: **yes, fully** — `/brand/new?partner_mode=client` is not gated on link count (BrandCreationFlow gates only on partner status), and the edge fn handles a 2nd brand cleanly (probe P1: 201, both INSERTs fire).
**Verdict: the cap is 100% a missing UI affordance; every layer beneath it already supports N brands. — proven (code + handler-execution probe + schema).**

### Q2 — What row detail exists vs is missing? (scope a-ii)
`invited_owner_email` is fetched (`partnerBrandLinksService.ts:81`) and **never rendered** — `BrandLinkRow` shows brand name, status dot+label, one-line subtext only (`brands.tsx:180-233`). Timestamps `invited_at`/`accepted_at`/`owner_stripe_connected_at`/`first_split_at`/`cancelled_at` are all fetched; only relative forms leak into subtext. `personal_note` fetched, never shown. No expand/detail sheet exists. No resend verb exists at any layer (see Q7 for what a resend WOULD do).
**Verdict: data is already on the client; presentation + verbs are absent. — proven (code).**

### Q3 — Can a partner cancel a PENDING invite today? (scope a-iii)
On the link: **no** — zero write policies for any client role (live `pg_policies`: exactly two SELECT policies — self + `is_admin_user()`), no cancel RPC, no cancel edge fn, service "No writes exposed" by design. BUT a **side door exists**: the partner is the brand's current owner pre-accept (prod: `brands.account_id = partner_account_id`), so `/brand/{id}` → Team lists the pending `brand_owner` invitation with a revoke sheet (`team.tsx:132,240-249` → `revokeBrandInvitation` — direct UPDATE `status='revoked'` under the ORCH-1050 brand_admin+ RLS policy). Revoking there kills the token (accept RPC raises P0005) **but stamps NOTHING on `partner_brand_links`** → the Brands list shows "Awaiting Owner · invite sent Xd ago" forever.
**Verdict: no first-class cancel; a reachable side door revokes the invitation while permanently stranding the link row. — proven (code + schema + live RLS).**

### Q4 — Can a partner disconnect an ACTIVE managed brand? (scope a-iv)
**No, at every layer.** No UI verb, no link write path, and — decisive — the money does not even flow through the link: both rails resolve the paid partner via `resolve_partner_for_brand_at_time` (sole definition ORCH-1054; live-verified: reads `brand_team_members`, does NOT read `partner_brand_links`) = earliest-accepted non-removed `brand_admin` with `creator_accounts.partner_enabled=true` at charge time. There is also **no team-member-removal write path**: `team.tsx handleRemove` is an explicit no-op ("member removal lands in a follow-up ORCH — ORCH-1051"), and the only `removed_at` writer in the codebase is account deletion (`accountDeletionSides.ts:241`).
**Verdict: disconnect does not exist, and stamping `cancelled_at` alone would NOT stop the 10%-of-fee split — the money truth lives in `brand_team_members.removed_at`. — proven (code + live fn definition).**

### Q5 — What does `/brand/{id}` do TODAY for an `awaiting_owner` brand? (scope b)
Source + data trace: pre-accept the partner IS `brands.account_id` (prod-verified for Rockstar Vibes), and the dashboard resolves the brand from `useBrandList()` = `brand_team_members` membership (`removed_at IS NULL`) UNION owned brands (`brandsService.ts:545-620`, explicitly built in ORCH-1081 so partners keep post-handoff access). So the tap opens the **full owner dashboard** — real screen, not an error — with **zero partner/invite context** (no `partner_setup` reference exists in `BrandProfileView.tsx` / `brand/[id]/index.tsx`): no "invite pending" banner, no invited email, no resend/cancel. Post-transfer (active link) it resolves via the membership leg as `brand_admin`. NOT runtime-verified on a simulator: no booted sim, and signing into the partner account is credential-gated (recorded in Open Questions per NOTIFY-LIST; not a stall condition).
**Verdict: full owner dashboard with no invite context — probable (source-traced + prod-data-corroborated; sim leg blocked by credentials, blocker named).**

### Q6 — Cancel-semantics groundwork: what would stamping `cancelled_at` touch? (scope c — groundwork only, NO design decisions)
1. **Status derivation:** client `deriveLinkStatus` and DB `partner_brand_link_status` both put `cancelled_at IS NOT NULL` first → row becomes `cancelled` instantly and `listPartnerBrandLinks` hides it by default (`.is("cancelled_at", null)`, service:84).
2. **Every stamp path already excludes cancelled rows** — accept-RPC accepted_at stamp, first-split triggers (×2 on `partner_splits`), stripe-connected trigger (`stripe_connect_accounts`), paystack-connected trigger (`brands`) all filter `cancelled_at IS NULL`. A cancelled row is inert to the whole lifecycle machinery. (Live trigger inventory verified: 4 triggers present.)
3. **Money is INDEPENDENT of the link** (Q4). Cancel-pending: no team row for the invitee exists yet, invite dead only if the `brand_invitations` row is ALSO revoked — cancelling the link alone leaves a live token that still executes the FULL ownership transfer (accept RPC), it just skips the link stamp (matched `WHERE … cancelled_at IS NULL`). Cancel-active: splits keep paying until the partner's `brand_team_members` row is `removed_at`-stamped; the resolver is time-pinned (`removed_at > p_at`), so charges BEFORE removal still split — retroactive money is structurally protected.
4. **RLS today:** partner can UPDATE **nothing** (live `pg_policies`: SELECT-only). Any cancel write path must be a new service-role RPC/edge fn or a new tightly-scoped UPDATE policy (note `feedback_rls_returning_owner_gap` binds inline-predicate style).
5. **Re-invite-after-cancel is already schema-supported:** live partial unique index `(partner_account_id, brand_id) WHERE cancelled_at IS NULL` — two cancelled rows can coexist; a fresh INSERT after cancel succeeds (edge fn comment :670-672 anticipates exactly this).
6. **Brand survives the link:** the brand is an independent `brands` row (pre-accept: owned by the partner; stays in their switcher, `partner_setup=true` immutable). Cancelling a link deletes nothing.
7. **Owner-side visibility: none.** RLS exposes the link only to the partner (+admin). The owner would only notice a cancel if the invitation is revoked too (accept URL → `invite_revoked` 410).
8. **Column contract:** I-PROPOSED-1331-LINK-COLUMNS-FROZEN (ACTIVE) freezes the timestamp column NAMES (client reads them by name); stamping the existing `cancelled_at` is compatible; renames are not. `partnerBrandLinksService.ts` was on ORCH-1331's DO-NOT-TOUCH list — a SPEC touching it must note the invariant.
**Verdict: groundwork fully mapped; cancel is a MULTI-OBJECT semantic (link + brand_invitations revoke + [for active] brand_team_members.removed_at), not a one-column stamp. — proven (schema + live DB + code).**

### Q7 — Multi-link behavior, caps, re-invite mechanics? (scope d)
- **No cap** on links per partner exists anywhere (schema: only the per-(partner,brand) partial unique; edge fn: no count check).
- **2nd invite, DIFFERENT brand → works.** Probe P1 (real handler execution, mocked supabase-js via import map): 201, `brand_invitations` INSERT for the new brand + `partner_brand_links` INSERT `(partner, brand_B, new email)`.
- **Re-send, SAME brand + SAME email while pending+unexpired → blocked**: probe P2: 409 `already_invited`, zero inserts (guard `invite-brand-member/index.ts:525-545`, scoped brand+email+status=pending+expires_at>now).
- **After expiry (7 days) or revoke, same brand+email:** guard passes (source-proven by the guard's predicates); new invitation row + new email are created; the link INSERT hits the partial unique index → **23505 swallowed non-fatally** (`:683-688`) → the EXISTING link row survives **with its original `invited_at`** ("Invite sent…" subtext goes stale; no refresh mechanism).
- **SAME brand, DIFFERENT (corrected) email → silent data split.** Probe P3: 201; invitation carries the NEW email; link INSERT conflicts and is swallowed → link keeps the OLD email → the accept-RPC stamp (`WHERE lower(invited_owner_email)=lower(v_invitation.email)`) **can never fire** for the corrected owner; the row sticks at `awaiting_owner` until the payout-connect trigger (brand-matched, not email-matched) eventually flips it straight to `active`, skipping `awaiting_stripe`, with `accepted_at` forever NULL. Reachable TODAY via the team screen (any `brand_owner` invite on a `partner_setup` brand triggers the link insert — `effectivePartnerSetup` reads the brand flag, `:609-610`).
**Verdict: N-brand portfolios fully supported; same-brand re-invite mechanics are supported but leave the link row stale/stranded in two distinct ways. — proven (handler-execution probes P1–P3 + schema; evidence `Mingla_Artifacts/evidence/ORCH-1384/qd_edgefn_probe_output.txt`).**

### Q8 — Blast / parity: who else reads `partner_brand_links`? (scope e)
- **Consumer app (`app-mobile`):** ZERO references (grep) — out of scope confirmed.
- **mingla-admin:** `identityReadService.js:183-184` (ORCH-1272 Identity console, brand-detail bundle) selects the link table **including `cancelled_at` and with NO cancelled filter** under the `is_admin_user()` RLS — when cancel starts stamping rows, admin shows them as-is; nothing breaks.
- **mingla-business:** `account.tsx` "Partner brands · N active · N pending" meta (uses the same hook → cancelled rows excluded → counts self-consistent); `earnings.tsx` nudge + `PortfolioWelcomeToast` (dismissal persisted per link.id — a cancel+re-invite creates a NEW id → the toast can legitimately fire again; cosmetic); `brands.tsx` list.
- **Edge/backend:** `invite-brand-member` (INSERT), accept RPC (stamp), 4 DB triggers, both split rails' **first-split push only** (`.is("cancelled_at", null)` — a cancelled row silently suppresses the celebratory push while the transfer itself still pays, consistent with Q4/Q6), `accept-brand-invitation` partner notify (`.is("cancelled_at", null)`).
- `listPartnerBrandLinks` excludes cancelled rows **by default with no include option** — if product wants cancelled rows visible, the service contract must change (SPEC-level).
**Verdict: blast fully mapped; no surface breaks when cancel stamps rows; two soft behaviors (admin shows raw rows; first-split push suppressed) documented. — proven (grep + code).**

### Q9 — Open product questions (scope f) → § 8.

---

## 4. Findings (six-field evidence)

### F-1 — With ≥1 link there is no invite-another-brand affordance anywhere (answers Q1)
1. **Symptom:** partner with 1 pending link has no button/path to start brand #2 (intake screenshot: header shows only ✕ + title).
2. **Layer:** code (UI).
3. **Probe:** verbatim read `brands.tsx`; grep for `partner_mode=client` entry points repo-wide.
4. **Evidence:** `brands.tsx:147` `) : sortedRows.length === 0 ? (` gates the ONLY CTA (`:159 label="Set up your first partner brand"` → `:76 router.push("/brand/new?partner_mode=client")`); `:125 <View style={styles.headerRightSlot} />` with `:331-333 headerRightSlot:{width:36}` (empty spacer); `earnings.tsx` ReadyToEarnNudge: `if (links.length > 0) return null;`. Only these two entry points exist (grep).
5. **Mechanism:** both entry points condition on zero links → first link (even pending) removes them → structural 1-brand cap purely at the affordance layer; route + edge fn + schema support N (F-2).
6. **Severity:** CONFIRMED ROOT CAUSE (of the "can't invite a 2nd brand" symptom).

### F-2 — Every layer beneath the UI already supports N client brands (answers Q1, Q7)
1. **Symptom:** (absence-of-limitation proof for the SPEC).
2. **Layer:** code + schema + runtime(handler).
3. **Probe:** `deno test --no-check --import-map=/tmp/orch-1384/import_map.json /tmp/orch-1384/qd_invite_handler_probe.test.ts` (real handler, scripted supabase-js double); live `pg_indexes`.
4. **Evidence:** P1 output: `P1 PROOF: 201 + {"invPayload":{"brand_id":"99999999-…","email":"newowner@example.com",…},"linkPayload":{"partner_account_id":"6c61590c-…","brand_id":"99999999-…","invited_owner_email":"newowner@example.com",…}}` — 3/3 tests pass (`evidence/ORCH-1384/qd_edgefn_probe_output.txt`). Live index: `CREATE UNIQUE INDEX partner_brand_links_partner_brand_active_idx ON … (partner_account_id, brand_id) WHERE (cancelled_at IS NULL)` — per-pair, no per-partner cap. `BrandCreationFlow.tsx` gates on partner status only (`:253-307`), never on link count.
5. **Mechanism:** duplicate guard is brand+email-scoped; unique index is pair-scoped → a different brand sails through both.
6. **Severity:** CONFIRMED (supporting fact; bounds the fix to UI/affordance for verb (i)).

### F-3 — Row detail data is fetched but never rendered; no detail surface, no resend verb (answers Q2)
1. **Symptom:** rows show name+chip+subtext; Seth cannot see who was invited.
2. **Layer:** code.
3. **Probe:** verbatim reads of service + `BrandLinkRow`.
4. **Evidence:** service `:81` selects `invited_owner_email, personal_note, …` and every timestamp; `BrandLinkRow` (`brands.tsx:180-233`) renders `brandName`, `StatusDot`, `statusLabel(row.status)`, `subTextFor(row)` — no email, no note, no absolute dates; `onPress` → `/brand/{brand_id}` (`:68-73`). No resend function exists in any service (grep: no writer refreshes `invited_at`; no edge-fn resend route).
5. **Mechanism:** ORCH-1081 shipped list-only; detail/resend were never built.
6. **Severity:** CONFIRMED ROOT CAUSE (of the "no row detail" symptom).

### F-4 — No cancel/disconnect write path exists on the link; partner RLS is SELECT-only (answers Q3, Q4)
1. **Symptom:** no cancel/disconnect anywhere.
2. **Layer:** schema + data (live).
3. **Probe:** `SELECT policyname, cmd, roles, qual FROM pg_policies WHERE tablename='partner_brand_links';` (prod, read-only); grep migrations/functions for any `cancelled_at` writer.
4. **Evidence:** live policies: `partner_brand_links admin can read` (SELECT, `is_admin_user()`) + `partner_brand_links_self_select` (SELECT, `partner_account_id = auth.uid()`) — nothing else. Migration `20260920000000:90` "`-- No INSERT/UPDATE/DELETE policies → service role only.`" Zero `cancelled_at` writers repo-wide (the column is only ever read/filtered).
5. **Mechanism:** the schema anticipated cancel (`cancelled` status, `cancelled_at`, partial unique) but no verb was ever built; client is read-only by design.
6. **Severity:** CONFIRMED ROOT CAUSE (of the "no cancel/disconnect" symptom).

### F-5 — The split money path never reads the link table; disconnect-the-money = `brand_team_members.removed_at`, which has NO product write path (answers Q4, Q6)
1. **Symptom:** (groundwork) cancel-the-link would not stop payouts.
2. **Layer:** schema + data (live) + code.
3. **Probe:** `SELECT pg_get_functiondef(oid) LIKE '%brand_team_members%' / '%partner_brand_links%' … proname='resolve_partner_for_brand_at_time'` (prod).
4. **Evidence:** live: `resolver_reads_team_members: true, resolver_reads_links: false`. Definition (sole, ORCH-1054): `SELECT btm.user_id FROM brand_team_members btm JOIN creator_accounts a … WHERE btm.role='brand_admin' AND a.partner_enabled=true AND btm.accepted_at <= p_at AND (btm.removed_at IS NULL OR btm.removed_at > p_at) ORDER BY btm.accepted_at ASC LIMIT 1`. Both rails call it (`partnerSplits.ts:255-258`, `paystackPartnerSplits.ts:449`). Only `removed_at` writer: `accountDeletionSides.ts:241`; `team.tsx handleRemove` is a comment-documented no-op (`:251-259`, deferred to ORCH-1051 — never shipped).
5. **Mechanism:** link table = UI/lifecycle mirror; money truth = team membership + partner flag. Two parallel state machines that no existing verb keeps coherent.
6. **Severity:** CONFIRMED (load-bearing groundwork for disconnect semantics).

### F-6 — Live side door: team-screen revoke kills the invitation but strands the link forever (answers Q3; Discovery D-2)
1. **Symptom:** (latent today) a partner who finds Team → pending invite → revoke gets a Brands list that lies forever ("Awaiting Owner", stale "invite sent…").
2. **Layer:** code + schema.
3. **Probe:** verbatim reads `team.tsx`, `brandInvitationsService.ts:267-288`, ORCH-1050 UPDATE policy §.
4. **Evidence:** `revokeBrandInvitation` = direct `.update({status:"revoked", revoked_at:…}).eq("status","pending")`; RLS `brand_invitations_update_brand_admin_plus` USING/WITH CHECK = brand_admin+ member OR current `brands.account_id` — the partner qualifies both pre-accept (owner) and post-accept (demoted-to-admin). NOTHING in this path touches `partner_brand_links` (grep). Accept RPC then raises P0005 `invite_revoked` on the dead token.
5. **Mechanism:** invitation state machine advances; link state machine does not → permanent `awaiting_owner` ghost that also blocks nothing (unique index still occupied → wizard re-invite for the same brand would 23505-swallow, F-7).
6. **Severity:** SECONDARY ROOT CAUSE (incoherence any cancel design must subsume).

### F-7 — Re-invite mechanics strand or stale the link row (corrected-email split; stale `invited_at`) (answers Q7; Discovery D-1)
1. **Symptom:** (latent) after revoke/expiry, re-inviting the same brand — especially with a corrected email — leaves the link permanently wrong.
2. **Layer:** runtime (handler probe) + schema.
3. **Probe:** P3 in `/tmp/orch-1384/qd_invite_handler_probe.test.ts` (real handler; link INSERT scripted to return 23505 exactly as the live partial index would).
4. **Evidence:** P3: 201; invitation INSERT email `corrected-owner@example.com`; link INSERT attempted once, conflicted, swallowed (`index.ts:683-688` logs a warn, returns success). Accept-RPC stamp predicate `lower(invited_owner_email) = lower(v_invitation.email)` (20260926000000:110-113) can then never match. Payout-connect triggers are brand-matched (not email-matched) → row later jumps `awaiting_owner → active` skipping `awaiting_stripe`, `accepted_at` forever NULL. Same-email re-invite: identical 23505 swallow → original `invited_at` survives → "Invite sent Xd ago" grows stale with no refresh path.
5. **Mechanism:** plain INSERT + swallow (not an upsert) means the active link row is immutable through every re-invite; email is the only join key between the two tables.
6. **Severity:** SECONDARY ROOT CAUSE (data-integrity trap inside the missing resend verb's future path; reachable TODAY via the team screen because `effectivePartnerSetup` reads the persisted brand flag, `index.ts:609-610`).

### F-8 — Four lifecycle exits stamp nothing on the link: revoke, decline, expiry, brand soft-delete (answers Q6, Q8; Discoveries D-2..D-5)
1. **Symptom:** (latent) `awaiting_owner` is a roach motel — no terminal transition except accept.
2. **Layer:** code + schema.
3. **Probe:** grep `partner_brand_links|cancelled_at` in `decline-brand-invitation/index.ts` (zero hits); expiry is a time predicate on `brand_invitations.expires_at` only (no job, no trigger); `listPartnerBrandLinks` brand embed has no `deleted_at` filter.
4. **Evidence:** decline fn: 0 references; no cron/trigger touches the link on expiry (live trigger inventory = the 4 known lifecycle triggers only); prod row Rockstar Vibes expires 2026-07-21 — after that date the invite is dead (P0003) while the list still says "Awaiting Owner", and the empty-state CTA is still hidden (≥1 link) → **no UI path to re-invite even though the backend allows it**.
5. **Mechanism:** the link's only inbound stamps are accept/payout/first-split; every negative outcome is invisible.
6. **Severity:** SECONDARY ROOT CAUSE (defines the true state machine the SPEC must cover).

### F-9 — `/brand/{id}` on an `awaiting_owner` row = full owner dashboard, zero invite context (answers Q5)
1. **Symptom:** row tap is "of dubious value" (INTAKE) — it opens brand management, not link management.
2. **Layer:** code + data.
3. **Probe:** prod: `brands.account_id = 6c61590c… = partner_account_id` for Rockstar Vibes; verbatim `brandsService.ts:545-620` (membership UNION owned); grep `partner_setup` in `BrandProfileView.tsx`/`brand/[id]/index.tsx` (zero hits).
4. **Evidence:** as cited; plus ORCH-1081's own comment: partners keep switcher access post-handoff as brand_admin (`brandsService.ts:545-551`).
5. **Mechanism:** pre-accept the partner owns the brand → owner dashboard; post-accept membership keeps it reachable → no "Brand not found" dead end at either stage; but the dashboard carries no invite status/resend/cancel anywhere.
6. **Severity:** CONFIRMED (behavioral answer; runtime confidence: probable — see § 6).

### F-10 — Admin + celebration surfaces tolerate cancel stamps; service default hides cancelled rows (answers Q8)
1. **Symptom:** (blast check).
2. **Layer:** code.
3. **Probe:** verbatim `identityReadService.js:149-196`; service `:84`; `earnings.tsx` welcome-toast key.
4. **Evidence:** admin brand-detail selects the link incl. `cancelled_at`, no filter; `listPartnerBrandLinks` hard-codes `.is("cancelled_at", null)` (no include-cancelled option); toast dismissal persisted per `link.id`.
5. **Mechanism:** nothing breaks when cancel stamps rows; two soft behaviors (admin sees raw rows — fine; cancelled+re-invited link mints a new id → welcome toast may re-fire — cosmetic). `brands.tsx` already carries dead-code branches for `cancelled` (STATUS_RANK `:53`, label `:257-258`, subtext `:276-277`) — UI partially pre-wired if product ever shows cancelled rows.
6. **Severity:** RULED OUT (as a breakage risk) / noted for SPEC.

---

## 5. Five-Truth-Layer reconciliation

| Layer | Truth | Contradicts |
|---|---|---|
| **Docs** | Service header + ORCH-1081 migration: read-only client, INSERT via edge fn, stamps via triggers+RPC — list-only was the SHIPPED intent; INTAKE (product) now demands management verbs | Docs(product) vs Code — the ORCH itself |
| **Schema** | Cancel fully anticipated: `cancelled` status, `cancelled_at`, partial unique `WHERE cancelled_at IS NULL`, re-invite comment in the edge fn | Schema vs Code: no writer exists — the central gap |
| **Code** | UI handles `cancelled` rows (rank/label/subtext) that the service can never deliver; `invited_owner_email` fetched, never shown; invitation-revoke exists while link-cancel doesn't | Code vs Code (internal dead branches); Code vs Schema (F-6 side door) |
| **Runtime** | Handler probes P1–P3: 2nd brand 201; pending resend 409; corrected-email 201-with-stranded-link | Runtime vs Schema-intent: the swallow-23505 design makes the link row immutable through re-invites (F-7) |
| **Data** | Prod: 1 link (`awaiting_owner`, Rockstar Vibes), 1 pending invitation (expires 2026-07-21), 1 team row (partner=owner), 2 partner-enabled accounts, live policies/indexes/triggers/fn-defs all match latest migrations | Data vs Docs(UI copy): after 2026-07-21 the list will claim "Awaiting Owner" for a dead invite (F-8) |

Migration-chain checkpoint: accept RPC latest = `20260926000000` (live body carries the ORCH-1111 predicate — verified `LIKE '%cancelled_at IS NULL AND accepted_at IS NULL%'` → true); resolver latest = `20260823000000` (sole definition, live-verified); link schema/RLS latest = `20260920000000` + `20261205000001` (admin read) — live `pg_policies`/`pg_indexes` match exactly.

---

## 6. Repro / runtime evidence

- **Edge-fn control flow (Q7): PROVEN by execution.** Real `invite-brand-member` handler run under deno with an import-map double for `@supabase/supabase-js` (`evidence/ORCH-1384/{qd_invite_handler_probe.test.ts, mock_supabase.ts, import_map.json, qd_edgefn_probe_output.txt}`): 3/3 pass. This proves the handler's decisions (guards, inserts, swallow) — not PostgREST/DB behavior, which is separately proven by the live index/RLS/function reads.
- **Prod data (READ-ONLY, Supabase MCP `gqnoajqerqhnvulmnyvv`):** link rows, invitation row, team rows, `pg_policies`, `pg_indexes`, trigger + function-definition asserts — all quoted in §§ 3–5.
- **Simulator leg: NOT RUN (named blocker).** No booted simulator; exercising `/partner/brands` and the awaiting_owner dashboard requires signing into the partner-flagged account (credentials with Seth) plus a business dev build. Per dispatch NOTIFY-LIST this is recorded (OQ-8) and the affected verdicts are capped: Q5/F-9 = **probable**; UI-affordance absence (F-1, F-3) needs no runtime repro — the code structurally cannot render what does not exist, and the INTAKE screenshot is the live-user observation.

---

## 7. Blast radius / cross-surface map

**In scope (INTAKE-confirmed):** business iOS + business Android (shared RN code — parity automatic: `partner/brands.tsx`, `partner/earnings.tsx`, `BrandCreationFlow.tsx`, services/hooks) + backend (new cancel/disconnect write path; possible resend; lifecycle stamps).
**Adjacent, read-only:** admin web Identity console (reads the link table incl. `cancelled_at` — tolerates stamps, F-10); accept web flow (`accept-brand-invitation` route — token dies on revoke; ORCH-1373's fixed gate governs the logged-out path).
**Explicitly out of scope (INTAKE):** consumer iOS/Android (zero references — grep-proven), buyer-web (anon only), admin partner-console (rides META-1237).
**Recurring-pattern note:** "schema anticipates, verb never built" is the same class as `brand_invitations.status='revoked'` having had no writer until ORCH-1050's client-side revoke — state machines shipped ahead of their verbs.

---

## 8. Open product questions for Seth (recorded, NOT decided)

1. **OQ-1 Cancel-active money meaning:** does "disconnect" stop future splits only (team `removed_at` stamp; time-pinned resolver already protects money earned before), or should there be any settling/holdback for splits currently `pending`/retrying? (`partner_splits` rows in flight reference the partner directly — they'd still pay/retry unless explicitly addressed.)
2. **OQ-2 Cancel-pending semantics for the brand:** the partner still OWNS the pre-accept brand. On cancel, does the brand stay in their portfolio as a normal self-brand, get deleted, or stay parked for re-invite? (`partner_setup` is immutable-by-comment; the wizard is the only place it's set.)
3. **OQ-3 Cancelled-row visibility:** should cancelled links show in the Brands list (UI already has dead branches for it) or stay hidden (current service default)? Affects the service contract (no include-cancelled option exists).
4. **OQ-4 Resend cooldown/policy:** resend blocked while pending+unexpired (409 today). Should resend be allowed pre-expiry (requires revoke-then-reinvite semantics or a new resend path that reuses/refreshes the token), and with what cooldown? Note `invited_at` staleness (F-7) needs a decision: refresh on resend or track separately.
5. **OQ-5 Corrected-email flow:** when the partner typo'd the owner email, is the sanctioned flow cancel+re-invite (new link row via the partial index) — vs mutating the email on the live row? (F-7 shows the current accidental path silently splits the two tables.)
6. **OQ-6 Post-transfer partner powers:** the partner remains a permanent `brand_admin` (accept RPC demotes, never removes) with team-management powers incl. revoking invitations on the client's brand. Should "disconnect" also be owner-initiated, and should the partner's residual role be reduced? (Money resolver keys on exactly this row — any change here IS a money change.)
7. **OQ-7 Owner-side notice:** should the owner be notified when a pending invite is cancelled (email went out promising a claimable brand) — or silently 410?
8. **OQ-8 Runtime verification access (NOTIFY-LIST):** sim login for the partner-flagged account (the `6c61590c…` account) to runtime-verify Q5/F-9 and capture screen evidence — needed before TEST at the latest; investigation proceeded on source+data proof.

---

## 9. Invariant impact (flagged, not resolved)

- **I-PROPOSED-1331-LINK-COLUMNS-FROZEN (ACTIVE):** stamping existing `cancelled_at` is compatible; renames/new-name reads are not. `partnerBrandLinksService.ts` was ORCH-1331 DO-NOT-TOUCH; a SPEC adding verbs will touch it — must cite the invariant.
- **I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT + -SHARE-FROM-PLATFORM-FEE (ACTIVE, strict-grep-gated on `supabase/functions/**`):** any disconnect logic near the split path must keep split failure non-fatal to checkout and never duplicate the rate literal.
- **`feedback_rls_returning_owner_gap`:** any new UPDATE policy on `partner_brand_links` must use inline predicates.
- **ORCH-1373 accept-gate lineage (COMMS-0099/0106):** the accept route's auth gate is freshly fixed and covered by control-flow tests — a cancel design that touches accept-side behavior must not disturb it.
- **I-PROPOSED-1342-GATE-NEVER-NAMES-NEVER-REDIRECTS:** untouched (no external-link opener in scope).

---

## 10. Discoveries for Orchestrator (side issues, not widened into scope)

- **D-1 (F-7):** corrected-email re-invite on a `partner_setup` brand permanently splits invitation-email vs link-email; reachable TODAY via the team screen. Candidate future ORCH if not folded into 1384's SPEC.
- **D-2 (F-6):** team-screen revoke strands the link at `awaiting_owner` forever — live side door today.
- **D-3/D-4 (F-8):** owner decline and 7-day expiry likewise stamp nothing; post-expiry the partner has NO UI path to re-invite (empty-state CTA hidden at ≥1 link).
- **D-5:** soft-deleting the client brand (partner owns it pre-accept; BrandDeleteSheet exists on the dashboard) leaves the link row listed (brand embed has no `deleted_at` filter).
- **D-6:** dead `cancelled` UI branches in `brands.tsx` (rank/label/subtext) — unreachable code today.
- **D-7:** `team.tsx handleRemove` no-op — ORCH-1050's deferred "member removal (ORCH-1051)" never shipped; this is now load-bearing for disconnect (F-5).
- **D-8:** re-invites never refresh `invited_at` → "Invite sent Xd ago" is unfixably stale under the current swallow-INSERT design.

---

## 11. Confidence level

**Overall: proven** for the missing-feature inventory, schema/RLS/index/trigger truth, money-path independence, side-door incoherence, and edge-fn re-invite mechanics (source + live prod reads + handler-execution probes). **Probable** for the single runtime-flavored behavioral answer (Q5/F-9 dashboard-on-awaiting_owner) — source-traced and prod-data-corroborated, sim leg blocked by the named credential need (OQ-8). Nothing in this report rests on source-only reasoning where a stronger layer was available.

## 12. Recommended next phase + scope (direction only — no fix, no spec)

**REVIEW → SPEC (mingla-forensics), then DESIGN (mingla-designer — UI-heavy: list-header add CTA, row detail/expand surface, destructive-action pattern), then IMPLEMENT → TEST.** Recommended SPEC scope, bounded by this investigation: (1) invite-another-brand affordance (UI-only; backend proven ready); (2) row detail surface exposing already-fetched fields + the resend decision (OQ-4/5); (3) first-class cancel-pending = atomic {stamp `cancelled_at` + revoke the pending `brand_invitations` row} via a service-role write path (RLS groundwork in Q6); (4) disconnect-active = cancel + `brand_team_members.removed_at` stamp (money truth, F-5) pending OQ-1/6; (5) lifecycle-stamp coherence for the four unstamped exits (F-8) at least for the paths the new verbs create. Out of recommended scope: admin partner console (META-1237), consumer surfaces, `?next=` resume (ORCH-1375), team-member-removal UI beyond the disconnect stamp.

---

*Evidence directory: `Mingla_Artifacts/evidence/ORCH-1384/` (probe sources + output). Probes namespaced `/tmp/orch-1384/`. No product code, migrations, deploys, or prod writes were made.*
