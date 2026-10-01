---
name: code-review
description: >-
  Principal-engineer code review for Mingla pull requests. Focuses on design
  flaws, breaking changes, and whether the change convolutes the codebase.
  Skips style and nitpicks. Use for Copilot code review and when reviewing PRs
  or diffs for merge readiness.
---

# Code review (principal engineer)

Review like a principal engineer: protect architecture, contracts, and
operability. Do **not** nitpick. Prefer fewer, higher-signal findings.

## Bar (what to report)

Report a finding only when it is one of:

1. **Design flaw** — wrong owner of truth, duplicated control planes, leaky
   abstractions, missing invariants, unsafe authz/money/data boundaries, or a
   change that fights the Architecture Constitution / domain ADRs.
2. **Breaking change** — broken callers, schema/API/contract mismatches,
   silent behavior changes for users or other surfaces, missing
   migration/backfill, or CI/test gaps that would let the break ship.
3. **Convolution** — the diff makes the system harder to reason about
   (tangled control flow, drive-by rewrites, unrelated refactors mixed into a
   fix, new indirection without a clear owner, or parallel paths that should
   have been subtracted first).

If none of the above apply, say so plainly (**Findings: None**) and stop.
Praise is optional and one sentence max.

## Explicitly out of scope (do not comment)

- Naming, formatting, import order, comment wording, emoji, and “prefer X
  style” unless they hide a real design or break risk.
- Micro-optimizations, alternate idioms, or “I would have written it
  differently” with no correctness or design impact.
- Test-file line-level style. Flag missing **regression coverage for the
  risk** only when the change can break money, auth, payouts, refunds, or
  public contracts.
- Restating what CI already enforces unless the PR bypasses or weakens a gate.

## Refactoring guidance

- Call out **refactor opportunities** that would *reduce* convolution: delete
  a stale path, extract one owner, collapse duplicates, restore a single
  source of truth.
- Do **not** demand large opportunistic cleanups in the same PR.
- Prefer: “subtract the competing path before adding the new one” over “add a
  wrapper around both.”
- If a small local cleanup clearly belongs with the fix and shrinks the blast
  radius, suggest it. If it is a separate initiative, say so once and move on.

## Mingla-specific load-bearing checks

Only when the diff touches the area:

- **Money / payouts / refunds / Stripe / Paystack** — maturity, idempotency,
  status machines, and “no double withhold / no silent skip” invariants.
  When a cap is raised from “one row” to an aggregate pool, require
  **remaining-capacity** math (subtract liabilities already booked on other
  origins in that scope) under a shared lock — not an independent per-caller
  read of the same total. Add a multi-origin regression.
- **Provider subject parity** — a new refund/dispute/chargeback path must
  resolve every subject the live charge webhook already finalizes (today:
  ticket `order`, `rsvp_contribution`, `venue_reservation`,
  `venue_menu_order`). Matching only a subset leaves money events unmatched
  and never reaches debt/hold.
- **Pending vs released payout liability** — looking up only `status =
  'released'` silently skips disputes/refunds that land inside the maturity
  window; the pending release then pays full value and a processed webhook
  will not replay. Pending rows need the existing hold plane
  (`disputed_cents` / recomputed net) with a merchant-win reversal; released
  rows need debt. Mirror the stay-dispute pattern rather than inventing a
  third path.
- **Debt growth ↔ postponement transfer** — growing an existing permanent
  debt by raising `principal_cents` alone double-withholds if an overlapping
  `post_release_postponement` debt remains. Initial create uses
  `convert_postponement_debt_to_permanent`; growth paths must perform the
  same overlap transfer (see multi-release refund growth).
- **Webhook soft-success traps** — a signature-valid money event that lacks
  parseable identity (or otherwise cannot persist) must fail the handler so
  the inbox stays retryable. Returning success after a warn logs the event
  as `processed` with no row, no alert, and no replay.
- **Auth / RLS / SECURITY DEFINER** — who can execute; anon/authenticated
  grants; admin gate-first patterns. Brand role literals must use the live
  vocabulary (`brand_owner`, never the retired `account_owner`); ORCH-1047
  greps new migrations for the dead label.
- **Fixture timelines match live CHECKs** — payout fixtures must satisfy
  `releasable_at = anchor_end_at + interval '1 day'` (payment+24h). Equal
  anchor/releasable timestamps (legacy same-day maturity) fail
  `brand_payout_release_anchor_order` and turn “migrations apply cleanly”
  red even when the migration SQL itself is fine.
- **Multi-surface truth** — consumer, business, buyer web, admin, Sites must
  not diverge on the same product fact without an explicit owner.
- **Migrations** — apply-clean from baseline; CHECK/constraint honesty;
  fixture timelines match new rules. New SQL fixtures must use valid
  hex UUIDs, legal enum/CHECK values (e.g. `events.status`), and otherwise
  parse — a test that dies at DO-block init or first INSERT is a silent
  coverage hole, not a green path.
- **New table grants (#1856 D-01)** — `CREATE TABLE` inherits over-broad
  default grants. After RLS/policies, `REVOKE ALL … FROM PUBLIC, anon,
  authenticated` and re-GRANT only the verbs the policies need (often
  `SELECT` to `authenticated`). Do not baseline-allowlist the defaults.
- **Money aggregates → integer columns** — `sum(integer)` is `bigint`; casting
  straight to `integer` overflows past ~2.1e9 cents. Clamp before cast when
  the result feeds integer debt/cap columns.
- **Substring / prefix error mapping** — when mapping RPC messages with
  `.includes()`, specific codes that contain a generic token (e.g.
  `run_not_found` vs `not_found`) must be checked before the generic
  branch, or the diagnostic is unreachable.
- **Operator-only money controls** — if the diff adds the only admin/UI
  path that unblocks refunds, payouts, or holds, require regression that
  pins the gate, audited call, confirm phrase, and success reload — not
  only the read RPC that feeds the banner.
- **CI workflow/MANIFEST seals** — editing a workflow or its `pathScope`
  requires rebanking `workflowMetadata.sourceSha256` (and matching inventory)
  in the same commit; stale seals fail class-A strict-grep closed.
- **Subtract before add** — replacement must remove the stale path, not leave
  two live ones.

Point at existing docs (`README.md` Architecture Constitution,
`docs/INVARIANT_REGISTRY.md`, domain ADRs) instead of inventing new policy.

## Review workflow

1. Read the PR intent (title, summary, linked issue). Judge the diff against
   that intent — not against an ideal rewrite.
2. Skim the full file set; deep-read only risk surfaces (money, auth, schema,
   shared contracts, fan-out/cron).
3. Ask: *What breaks if this ships?* *Who owns this truth after merge?* *Did
   this make the graph simpler or denser?*
4. Emit findings. Silence is a valid outcome.

## Finding format

Use severity sparingly:

- **Blocker** — design flaw or breaking change that should stop merge.
- **Should-fix** — real risk or convolution that belongs in this PR.
- **Refactor note** — optional follow-up that reduces complexity; never a
  merge blocker by itself.

Each finding: one short problem statement, evidence (file/symbol), and one
concrete remediation. No lecture. No alternate full rewrites.

## Anti-patterns for the reviewer

- Long checklists of “best practices” unrelated to the diff.
- Blocking on taste.
- Asking for more abstraction when the bug is a missing guard or wrong owner.
- Expanding scope (“while you’re here…”) beyond the PR’s stated intent.
