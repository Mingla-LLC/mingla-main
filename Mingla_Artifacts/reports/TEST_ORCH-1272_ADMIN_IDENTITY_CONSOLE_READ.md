# TEST — ORCH-1272 [Admin Identity console — READ-ONLY]

**Phase:** TEST (production gatekeeper). **Author:** mingla-tester.
**Verdict:** **CONDITIONAL PASS** — 0 P0, 0 P1, 1 P2, 2 P3, 1 P4. The one condition is a **data-availability gap** (no `admin_subscription_overrides` rows exist in post-wipe prod, so the override-render path AC-3.3 cannot be live-proven — the *mechanism* is proven), not a code defect. Backend/RLS/RPC fully live-fire proven; admin-web UI capped at `suspected` per the authed-runtime-unreachable rule.
**Branch/HEAD tested:** `1272-admin-identity-console` @ `089a25b64` (impl) + tester adversarial test `9a2e878e9` (pushed).
**Backend:** LIVE PROD `gqnoajqerqhnvulmnyvv`, verified read-only via MCP `execute_sql` on 2026-07-03. Deploy state confirmed live (4 RLS policies + RPC present).
**COMMS ledger:** scanned on entry. No OPEN BLOCK targets tester/1272/ALL (COMMS-0052 BLOCK is ACKNOWLEDGED, business-OTA — not my scope; COMMS-0006 → ORCH-0980). COMMS-0061 (WARN→ALL: `gqnoajqerqhnvulmnyvv` is LIVE PROD, clone-only drills) honored by construction — every probe was read-only `SELECT`/RPC-call inside `BEGIN…ROLLBACK`; zero mutation, zero migration, zero deploy. Factored; no ack-write (WARN, honored read-only).

---

## Real prod targets used (row ids)

| Role / shape | uid / id | Notes |
|---|---|---|
| **Active admin** | `63835860-56bc-4ac9-a643-630558e111b5` | seth@usemingla.com, `admin_users.status='active'`. **Owns 0 brands** → every membership row is cross-brand. |
| **Non-admin sim** | `04607d31-9d05-448d-b3c3-50ca2182e4c3` | w888…@privaterelay, `is_admin=false`, 0 brands / 0 memberships → clean negative (no self-policy grants it the targets). |
| **Soft-deleted account** (AC-1.4a) | `691e6d17-e91c-4416-8d3a-3235e5e1aaf0` | `deleted_at=2026-07-02`. |
| **Cross-brand membership** (AC-1.4b) | `4d8d554a-9766-4d73-92ce-28eb14b7471e` | user `6c61590c` · brand `1ce63bf4` "Smoke & Rhythm" (live). Admin neither owns nor is a member. |
| **Soft-deleted brand** (AC-1.4c/4.4) | `9fed1398-61dc-42f1-a07c-691d03d1710f` | "ORCH-1256 QA 702", `deleted_at=2026-07-02`, owner `8313d091`. |
| **Rich business bundle** (AC-1.2) | `8313d091-2a34-44fc-985d-9cefb5d80781` | "Mingla Demo", 6 brands, 7 memberships, 1 sub, 0 tickets. |
| **Ticketed business** (AC-3.1 tickets) | `b17e3e15-218d-475b-8c80-32d4948d6905` | 1 brand, 1 membership, 1 sub, **1 ticket**. |
| **Consumer-only** (AC-3.1 empty-state) | `756c746c-3d25-4aa9-b35b-979ea13282d3` | profiles row, **no** creator_accounts. |
| **Bogus** (AC-1.3 not_found) | `00000000-0000-0000-0000-000000000000` | — |

---

## 1. Verdict + finding counts

**CONDITIONAL PASS** · P0 = 0 · P1 = 0 · P2 = 1 · P3 = 2 · P4 = 1.
Regression gate SATISFIED (implementor happy-path fails-on-revert re-run + tester adversarial, both on-branch, both in the closing diff). The CONDITIONAL is solely AC-3.3's override-render (0 override rows exist in prod to render) — the sensitive-data-via-RPC *mechanism* IS proven. No blocking issue.

---

## 2. AC-by-AC matrix (live evidence)

| AC | Verdict | Evidence (live, prod `gqnoajqerqhnvulmnyvv`) |
|---|---|---|
| **AC-1.1** RLS policies + RPC deployed | **PASS (proven)** | `pg_policies`: `creator_accounts / brand_team_members / brand_invitations / partner_brand_links admin can read` all `SELECT USING is_admin_user()` + reused `brands admin can read`. `pg_proc`: `admin_get_person(p_user_id uuid)` `prosecdef=true`, `proconfig={search_path=public}`. |
| **AC-1.2** bundle joins both halves + brands + subscription | **PASS (proven)** | admin `admin_get_person('8313d091')` → `nkeys=7`, keys=`[account,active_override,brands_member,brands_owned,person,subscription,tickets]`, `person.id=8313d091` (profiles half) + `account.business_name="Mingla Demo"` (creator_accounts half, shared PK), `brands_owned=6`, `brands_member=7`, `subscription.effective_tier="free"` (`get_effective_tier` reused), `subscription.raw` non-null, `segment="business"` (`derive_user_segment` reused). |
| **AC-1.3** guard: non-admin→not_authorized, bogus→not_found, guard-first | **PASS (proven)** | non-admin `04607d31` calling RPC on another user → `ERROR P0001: not_authorized` **at line 4 (the guard)**; on their **OWN** id → still `not_authorized` at line 4 (proves guard fires **before** any read). admin on bogus uuid → `not_found` at line 6. |
| **AC-1.4 — THE CORE cross-row proof** | **PASS (proven)** | **ADMIN** (RLS-enforced, `role=authenticated`, sub=admin): soft-del acct=**1**, cross-brand member=**1**, soft-del brand=**1**, all memberships=**12**. **NON-ADMIN** (sub=`04607d31`): soft-del acct=**0**, cross-brand member=**0**, soft-del brand=**0**, memberships=**0**, accounts-visible=**3** (own+public organiser only, NOT all 13). **ANON** (`role=anon`): all three targets=**0**. The admin policy is load-bearing and non-admin/anon are blind. |
| **AC-1.5** strict-grep fails-on-revert + gate-first | **PASS (proven)** | `i-1272-identity-admin-read.mjs` real-run PASS + `--self-test` 4/4 PASS; deleting the `creator_accounts` policy → implementor suite RED (24/25), restore → 25/25. `admin_get_person` in `i-admin-gate-first-statement.mjs` registry. |
| **AC-2.1** People list | **PASS (suspected — UI)** | `PeopleConsolePage` uses `EntityListView` + `listAccounts` (`creator_accounts` select w/ business_name/email/phone/partner/status cols + `count:exact` + server order/range). Data layer: admin sees all accounts (12+). Authed admin runtime unreachable headlessly → source-verified. |
| **AC-2.2** search / filter / CSV / soft-del under Deleted | **PASS (suspected — UI)** | Service: debounced `.or(ilike)` on 4 cols (escapeLike); partner `.eq`; status `active→.is(deleted_at,null)` / `deleted→.not(...is null)`; CSV cols+filename `accounts`. Soft-del acct visible to admin (proven) → surfaces under Status=Deleted. |
| **AC-2.3** row→unified Person detail; silent-empty guard | **PASS (data proven) / suspected (UI)** | `onRowClick→openUser(row.id)` → `getPerson` RPC → `buildPersonSections` (both halves). Silent-empty guard **proven live**: the `creator_accounts` admin policy is load-bearing (non-admin browser read = 3 vs admin = all; revert → implementor suite RED). |
| **AC-3.1** sections / consumer-only empty-state / no crash | **PASS (proven data) / suspected (UI)** | RPC returns 7-key bundle for all shapes: consumer-only `756c746c` → `account:null` (JSON null → "No business account — consumer-only user." branch), business `b17e3e15` → account object + brands + tickets=1. No crash path. Page renders `account? businessSection : emptyState`. |
| **AC-3.2** deep-link `?userId=` | **PASS (suspected — UI)** | `userIdFromHash()` + `hashchange` listener + initial `useState(()=>userIdFromHash())`; `openUser` sets `#/business-people?userId=`. Source-verified. |
| **AC-3.3** override tier + expiry render | **CONDITIONAL (mechanism proven; render not live-provable)** | **P2 — data availability:** `admin_subscription_overrides` has **0 rows total** in post-wipe prod → no override to render. *Mechanism proven:* `subscriptions`/`admin_subscription_overrides` expose ONLY `auth.uid()=user_id` self-read (no admin browser policy) → an admin's browser read of another user's money data returns []; the RPC (`SECURITY DEFINER`) is the **only** admin path, and `subscription.raw` flows through it (`raw_sub_present=true` for 8313d091). Page renders `if(override){...}` (source). Re-test once any override row exists. |
| **AC-4.1** Brands list; pricing_currency primary; take-rate % | **PASS (suspected — UI)** | `BrandsConsolePage` `EntityListView`+`listBrands`; Currency col = `pricing_currency` primary + `default_currency` dim-secondary only when different (lines 102-111); `takeRate(bps)= bps/100+"%"` else `"default"` (line 34-37). Matches ORCH-1034/1236 currency-tracks-default. |
| **AC-4.2** Brand detail composition + owner link | **PASS (suspected — UI)** | `getBrandDetail` composes brand + owner + team + invites + partner + tickets (all by `brand_id`, `Promise.all`); empty sub-sections → explicit "None"/"No invitations"; owner button → `#/business-people?userId=account_id`. |
| **AC-4.3** cross-brand team/invites visible to admin, blind to non-admin | **PASS (proven)** | Admin sees all 12 memberships (incl. cross-brand `4d8d554a`); non-admin/anon see 0. Invites=0 in prod → policy PRESENT (`pg_policies`) + non-admin/anon denial proven; empty-state renders "No invitations". |
| **AC-4.4** soft-deleted brand in admin list + detail; non-admin can't | **PASS (proven)** | Admin reads soft-del brand `9fed1398`=1; non-admin=0; anon=0. `listBrands` reuses `brands admin can read` which exposes soft-deleted; "Public can read non-deleted brands" excludes it. |
| **AC-5.1** build clean; nav repointed; placeholder gone | **PASS (structural proven; build CI-gated)** | `BusinessConsolePage.jsx` deleted; `constants.js` → `business-people`(Users)+`business-brands`(Building2), no `business-console`; `App.jsx` routes both. Build not independently re-run (implementor `✓ built in 3.41s`; net-new lint 0) — CI `strict-grep`/build gates cover. |
| **AC-5.2** read-only held (0 mutation) | **PASS (proven)** | Exact-paren grep of `identityReadService.js` + both pages: **0** `.update(`/`.insert(`/`.delete(`/`.upsert(`/`admin_write_audit`/`rpc('admin_update|set|reassign` (only doc-comment mentions). Both migrations: **no** `ALTER/UPDATE/INSERT/DELETE` — `CREATE POLICY`/`CREATE FUNCTION`/`REVOKE`/`GRANT` only. |
| **AC-5.3** UserManagementPage / SubscriptionManagementPage byte-unchanged | **PASS (proven)** | Neither file appears in `git diff origin/main...HEAD --name-only`. |
| **AC-6.1** DRAFT invariant + gate + workflow job + registry append | **PASS (proven)** | `I-PROPOSED-1272-IDENTITY-ADMIN-READ (DRAFT)` in `INVARIANT_REGISTRY.md`; `i-1272` gate + `__tests__` fixture PASS; job `orch-1272-identity-admin-read` in `strict-grep-mingla-business.yml`; `admin_get_person` in gate-first registry, **absent** from write-RPC registry (`i-admin-write-audited.mjs`). |

---

## 3. Findings

**P2-1 (data availability, not a defect) — AC-3.3 override-render not live-provable.** `admin_subscription_overrides` has 0 rows in post-wipe prod. Evidence: `SELECT count(*)=0`. Impact: cannot live-fire the "Person detail shows override tier + expiry" render; the *containment mechanism* (money data reachable only via the SECURITY DEFINER RPC, never a browser read) IS proven (subscriptions/overrides have only `auth.uid()=user_id` self-policies; `subscription.raw` flows via RPC). Required fix: none (code correct — `if(override){ Override tier/reason/expires }` present). Retest: re-run `admin_get_person` against any user with an active override once one exists; expect `active_override` non-null + the three override fields to render.

**P3-1 (UX, suspected) — cross-page nav depends on hash-router remount.** `PeopleConsolePage.openBrand` sets `#/business-brands?brandId=` and `BrandsConsolePage.openOwner` sets `#/business-people?userId=`; both rely on the App hash-router switching the active page AND the target page's `hashchange`/initial-state reading the param. Source path is correct but unverified at runtime (authed admin runtime unreachable). Retest: click a brand from a Person view and an owner from a Brand view on the live admin site; confirm the target detail loads.

**P3-2 (robustness, suspected) — orphan `brand_team_members.user_id` renders raw uuid.** By design (D-3: no FK). `resolveProfiles`/`resolveAccountNames` fall back to the uuid string when a member has no profile/account — acceptable, non-fabricated, logged. Note only.

**P4-1 (praise) — silent-failure discipline is exemplary.** Every sub-read degrades to `[]`/`null` **with `console.warn`** (never silent), empty sub-lists render explicit "None"/"No invitations" (never a fabricated 0/row), and the RPC's `not_found`/`not_authorized` map to distinct user-facing strings with retry. Constitution rules 3 + 9 upheld strongly.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert

- Checked out branch HEAD `089a25b646c34ff0b5f242d86c48535409c5cd64`, worktree `~/Desktop/mingla-orchs/1272-[admin-identity-console]`.
- Ran the implementor happy-path `mingla-admin/src/__tests__/orch1272_identity_console_read.test.js` → **25 pass / 0 fail**.
- True line-deletion of the `creator_accounts admin can read` `CREATE POLICY` block in `20261205000001_..._rls.sql` → re-run → **24 pass / 1 fail** (suite "ORCH-1272 — identity admin-read RLS migration" RED, exact assertion: the `creator_accounts` `is_admin_user()` SELECT policy regex no longer matches).
- `git checkout` restore → **25 pass / 0 fail**. Implementor fails-on-revert **independently confirmed at `089a25b64`**.

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-admin/src/__tests__/orch1272_identity_deny_containment.test.js`
- **Commit:** `9a2e878e9` on `1272-admin-identity-console` (pushed `--force-with-lease`; `089a25b64..9a2e878e9`).
- **Angle (distinct from the happy-path's "wiring exists"):** the **deny-by-default + money-table containment** invariant — encoding the live-fire runtime facts as CI-enforceable source invariants the happy-path never checks: (A) the `is_admin_user()` **negation** guard raising `not_authorized` precedes **every** `FROM public.*` read (strict ordering, catches guard deletion or a `IF NOT`→`IF` flip); (B) the `not_found` safety exists (bogus-uid never returns a hollow bundle); (C) the RLS migration adds **no** browser SELECT policy on `subscriptions`/`admin_subscription_overrides` (money data stays RPC-only) + the RPC is the crossing point; (D) neither migration `GRANT`s to `anon`/`PUBLIC` and the RPC `REVOKE`s both; (E) `PeopleConsolePage` surfaces `not_authorized`/`not_found` with retry (no silent swallow).
- **fails-on-revert verified at `089a25b64`:** deleting the guard line from `20261205000002_..._admin_get_person.sql` → assertion (A) RED ("guard-first negation raising not_authorized must be present"), suite **5 pass / 1 fail**; `git checkout` restore → **6 pass / 0 fail**.
- **Both tests in the closing diff:** `git diff origin/main...HEAD --name-only` shows `orch1272_identity_console_read.test.js` **and** `orch1272_identity_deny_containment.test.js`. Combined run: **31 pass / 0 fail**. Append-only respected (NEW file only; no existing test modified).

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS (suspected UI) | `onRowClick`, brand/owner buttons, deep-links wired in source; runtime capped suspected. |
| 2 | One owner per truth | PASS | `identityReadService` is the single read authority. |
| 3 | No silent failures | PASS | sub-reads degrade with `console.warn`; RPC errors surface to `EntityDetailView` error+retry. |
| 4 | One query key per entity | N/A | Admin uses local `useState`/`useEffect`, not the RQ factory. |
| 5 | Server state stays server-side | PASS | No Zustand persist of server data. |
| 6 | Logout clears everything | N/A | No new session/auth state. |
| 7 | `[TRANSITIONAL]` labelled | N/A | None introduced. |
| 8 | Subtract before adding | PASS | Deletes `BusinessConsolePage` placeholder; repoints nav. |
| 9 | No fabricated data | PASS | Empty → "None"/"No invitations"/"—"; never a fake 0/row. |
| 10 | Currency-aware | PASS | `pricing_currency` primary, `default_currency` dim-secondary; take-rate bps→%. |
| 11 | One auth instance | PASS | Reuses existing `supabase` client. |
| 12 | Validate at right time | N/A | Read-only, no datetime input. |
| 13 | Exclusion consistency | PASS | Admin includes soft-deleted; non-admin/anon excluded via existing policies — consistent. |
| 14 | Persisted-state startup gate | N/A | No Zustand persist. |

No violations.

---

## 7. Device / parity matrix

| Surface | Verdict | Note |
|---|---|---|
| Consumer iOS / Android | N/A | No shipping-app change. |
| Buyer/anon Web | N/A | No buyer-route change. |
| Business iOS / Android | N/A | No shipping-app change. |
| **Admin Web (`mingla-admin/`)** | **PASS (data proven) / suspected (UI)** | The only UI surface. Backend/RLS/RPC live-fire proven; authed admin runtime unreachable headlessly → UI source-verified, capped `suspected` per `feedback_biz_web_authed_runtime_unreachable_cap_claims`. |
| Business Web preview | N/A | Untouched. |
| Backend RLS/RPC (LIVE PROD) | **PASS (proven)** | 4 policies + RPC deployed and behavior-verified against `gqnoajqerqhnvulmnyvv`. |

Physical iPhone HITL: N/A (admin-web-only, no mobile surface). Edge functions: none in scope.

---

## 8. Discoveries for Orchestrator

- **D-1 — AC-3.3 override render is untestable until a real `admin_subscription_overrides` row exists** (0 in post-wipe prod). Fold a one-line re-verify into the ORCH-1272 CLOSE or the first Wave-2 override action: call `admin_get_person` for a user with an active override and confirm `active_override` renders. Not a blocker.
- **D-2 — 19 pre-existing red admin `node --test` suites** (ORCH-1008/1013/1014/1015 intelligence-overview + sidebar), independent of 1272 (identical on origin/main). Candidate housekeeping ORCH. (Confirms implementor D-2.)
- **D-3 — the read-authz pattern is clean and reusable** for the sibling ORCH-1273 (offerings) / ORCH-1274 (money): guard-first SECURITY DEFINER RPC for cross-sensitive bundles + `is_admin_user()` SELECT RLS for whole-row reads, with the money-table-containment invariant now encoded as a tester regression.

---

## 9. Accepted conditions (CONDITIONAL PASS)

- **AC-3.3 override-render deferral** — the sole condition. It is a **prod data-availability gap** (no override rows to render), NOT an unaccepted P1: the security/containment mechanism it guards is fully proven live. Zero P0, zero P1. If the orchestrator requires PASS rather than CONDITIONAL PASS, seed/await one override row and re-run the single AC-3.3 probe; the code path is already source-correct.

**Report path:** `/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/reports/TEST_ORCH-1272_ADMIN_IDENTITY_CONSOLE_READ.md`
