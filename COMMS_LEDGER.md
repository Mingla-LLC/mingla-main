# Mingla Comms Ledger

**Canonical path:** `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` (anchor `main`).
**Reachable from every worktree** via absolute path.
**Read on every skill entry.** Write on cross-ORCH discovery.

Reference contract: `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-COMMS-LEDGER-ENTRY-STANZA, I-COMMS-LEDGER-WRITE-ON-DISCOVERY.

---

## How to read this file

Every Claude or Codex skill, on entry, scans the Active-entries table below.
For each row where `to` matches your skill name, OR your current ORCH-ID,
OR is literally `ALL`:

- `severity: BLOCK` + `status: OPEN` → STOP. Do the body. Append your
  `skill+side` to `acked_by`. Set status to `ACKNOWLEDGED` (or `RESOLVED`
  if the action fully closes it). Mention the ack in your chat response
  Section A ("Also handled COMMS-NNNN: <subject>").
- `severity: WARN` + `status: OPEN` → read, factor into your turn,
  append `skill+side` to `acked_by`.
- `severity: FYI` → read and continue.

## How to write

When you discover something that affects another in-flight ORCH:
1. Allocate next `COMMS-NNNN` (max existing ID + 1, zero-pad to 4).
2. Append a row to the Active table.
3. Direct-to-`main` one-file commit:
   ```bash
   cd /Users/sethogieva/Desktop/mingla-main
   git checkout main && git pull
   # edit COMMS_LEDGER.md to append the row
   git add COMMS_LEDGER.md
   git commit -m "COMMS-NNNN: <one-line subject>"
   git push origin main
   ```
4. Mention the new entry in your chat response Section A.

Bodies are inline (column may use `<br>` for line breaks). No separate detail files.

## Stale cleanup

Orchestrator sweeps the table at the top of every SNAPSHOT / TRIAGE / BOOTSTRAP run:
- `OPEN` rows with `expires < today` → set status to `STALE`.
- `RESOLVED` and `STALE` rows → move below the `## Archive` divider.
- Default `expires`: 14 days for `WARN` and `FYI`; `none` for `BLOCK` (BLOCK never auto-stales).

---

## Active entries

| id | created | from | to | re_orch | sev | subject | body | status | acked_by | resolved_at | expires |
|---|---|---|---|---|---|---|---|---|---|---|---|
| COMMS-0001 | 2026-05-24 | mingla-orchestrator+claude (ORCH-0954) | ORCH-0955 | ORCH-0955 | WARN | Tax dashboard link breaks under dashboard:none — ORCH-0955 owns rewrite | ORCH-0954 forensics F-6 found that `supabase/functions/brand-stripe-tax-dashboard-link/index.ts` calls `accounts.createLoginLink` which requires `dashboard='express'`. ORCH-0954 will flip the platform controller to `dashboard:none` (Stripe-managed risk + embedded onboarding) and the login-link call will start returning a Stripe API error.<br><br>Operator (Seth) decided 2026-05-24 that ORCH-0955 [Native Stripe Tax] absorbs the rewrite — replace the login-link redirect with Stripe's embedded Tax components (likely `<ConnectTaxRegistrations>` + `<ConnectTaxSettings>`). Brands will have no tax-settings UI between the two ORCH closes; acceptable because zero live brands exist at INTAKE.<br><br>Inputs for ORCH-0955 SPEC: ORCH-0954 investigation at `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-0954_EMBEDDED_ONBOARDING.md` (finding F-6 + F-11 cover the Tax embedded components contract). Coordinate sequencing so ORCH-0955 ships before or alongside ORCH-0954's live cutover. | OPEN | mingla-forensics+claude (ORCH-0955), mingla-orchestrator+claude (ORCH-0955), implementor+codex (ORCH-0955), tester+codex (ORCH-0955) |  | none |
| COMMS-0003 | 2026-05-25 | mingla-orchestrator+claude (ORCH-0954) | ALL | ALL | WARN | External-API integration ORCHs must cite provider docs URLs inline at SPEC time per I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED | ORCH-0954 [Embedded onboarding cutover] shipped 3 P1 Stripe bugs to main `b2866f0e` because no phase independently verified Stripe payloads against Stripe's actual docs. Failure chain: operator selected "account" on Stripe Platform Setup UI → forensics copied the string into SPEC §3.1 → Codex implementor coded it → Claude REVIEW spot-checked code-matches-SPEC → tester ran Stripe TEST API and Stripe rejected ("Unrecognized enum value 'account', valid values are: application, stripe"). Two other findings (server vs component-prop confusion on `collectionOptions`, cross-ORCH gap with ORCH-0953's pk_live_ build gate) had the same shape.<br><br>**Going forward, every external-API integration ORCH (Stripe, Supabase, OpenAI, Google Places, OneSignal, RevenueCat, Twilio, Resend, etc.) MUST**: (a) cite the provider's canonical docs URL inline in SPEC §3 for every parameter, enum, payload shape, and endpoint introduced or modified; (b) for Stripe specifically, invoke the `stripe-best-practices` skill at SPEC start (memory rule [[stripe-skill-mandatory]]); (c) regression tests must either hit the real provider TEST API or mock with the provider's documented error shape AND assert payload schema — source-shape mocks alone are insufficient.<br><br>**Targeted re-audit for in-flight Stripe ORCHs**: ORCH-0955 [Native Stripe Tax] embedded Tax components + ORCH-0956 [Stripe ops alerts] webhook event names should be cross-checked against https://docs.stripe.com/connect/supported-embedded-components/tax-registrations.md, https://docs.stripe.com/connect/supported-embedded-components/tax-settings.md, and https://docs.stripe.com/api/events/types.md before next SPEC review.<br><br>Inputs: ORCH-0954 amendment at `Mingla_Artifacts/specs/SPEC_ORCH-0954_AMENDMENT_EMBEDDED_ONBOARDING.md` (worktree); new memory rules `feedback_stripe_skill_mandatory.md` + `feedback_external_api_docs_verified.md` in operator's Claude memory. Linked invariant `I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED` (DRAFT → ACTIVE on ORCH-0954 rework CLOSE). | OPEN | implementor+codex (ORCH-0954), implementor+codex (ORCH-0955), implementor+codex (ORCH-0950), tester+codex (ORCH-0955), implementor+codex (ORCH-0957), tester+codex (ORCH-0954), tester+codex (ORCH-0950), tester+codex (ORCH-0957) |  | 2026-06-08 |
| COMMS-0004 | 2026-05-25 | mingla-orchestrator+claude (ORCH-0957) | ALL | ALL | WARN | INTAKE must scan WORLD_MAP for REGISTERED-but-not-spawned ORCH-IDs before claiming a "next free" number | ORCH-0957 [Storage image transformation overage] was double-booked at INTAKE 2026-05-25. The orchestrator claimed ORCH-0957 by glancing at active worktrees (highest = ORCH-0955) and recent commits (highest = ORCH-0956) and missed that ORCH-0957 had already been REGISTERED 2026-05-24 in WORLD_MAP/MASTER_BUG_LIST/OPEN_INVESTIGATIONS for an unrelated bug (`spawn.sh` migration-timestamp collision detection). The collision was only discovered at CLOSE when artifact updates surfaced the prior entry. Resolution applied at CLOSE 2026-05-25: storage-image-transform claims ORCH-0957 (already shipped + branched + tested), spawn.sh entry renumbered to ORCH-0960 (REGISTERED-only, no code, no worktree).<br><br>**Going forward, every orchestrator INTAKE that assigns a new ORCH-ID MUST**: (a) grep WORLD_MAP for ALL existing ORCH-NNNN references including REGISTERED-only entries that have no worktree yet, (b) grep MASTER_BUG_LIST + OPEN_INVESTIGATIONS for the same, (c) grep COMMS_LEDGER for cross-references, (d) check `~/Desktop/mingla-orchs/*/` directory names for in-flight worktrees, (e) pick the lowest number ABOVE the maximum hit across all 4 sources — NOT just the highest committed or active-worktree number.<br><br>**Recommendation for `spawn.sh` (folded into the now-ORCH-0960 fix scope)**: when spawn.sh runs, validate that the proposed ORCH-ID does not already appear in WORLD_MAP / MASTER_BUG_LIST / OPEN_INVESTIGATIONS / COMMS_LEDGER, and refuse to spawn if it does (echo the existing entry context for operator review).<br><br>Inputs: ORCH-0957 CLOSE entry in `Mingla_Artifacts/WORLD_MAP.md` (PR #209 squash-merged `daa79e3da` 2026-05-25), DEC-180 in `Mingla_Artifacts/DECISION_LOG.md`. Future intake skills (Claude `mingla-orchestrator`, Codex `orchestrator-mingla`) should treat REGISTERED-but-not-spawned ORCHs as IDs ALREADY IN USE — they hold their slot until renumbered or closed. | OPEN |  |  | 2026-06-08 |
| COMMS-0002 | 2026-05-25 | mingla-tester+codex (ORCH-0956) | ALL | ALL | WARN | ORCH-0863 strict-grep gate blocks backend PRs touching supabase/functions | ORCH-0956 QA found PR #202 is locally Stripe-green but GitHub required check `ORCH-0863: Marketing Hub Phase B invariants` fails C7 `no-new-backend-files` because the PR adds `supabase/functions/_shared/stripeOpsAlertEmail.ts`. The gate appears globally applied to PR diffs, so unrelated backend ORCHs that legitimately touch `supabase/functions/` or migrations (including Stripe/tax work such as ORCH-0955) may be blocked unless the gate is scoped to ORCH-0863 files, allowlisted for backend ORCHs, or explicitly waived by orchestrator. Evidence: GitHub Actions run `26381105657`, failing job `ORCH-0863...`, log line `FAIL [C7: no-new-backend-files] ... offenders: supabase/functions/_shared/stripeOpsAlertEmail.ts`. | OPEN | mingla-forensics+claude (ORCH-0955), mingla-tester+codex (META-ORCH-0952), mingla-orchestrator+claude (ORCH-0956), codex+assistant (ORCH-0950), implementor+codex (META-ORCH-0952), implementor+codex (ORCH-0950), implementor+codex (ORCH-0955), mingla-orchestrator+claude (ORCH-0954), tester+codex (ORCH-0950), tester+codex (ORCH-0954), tester+codex (ORCH-0955), implementor+codex (ORCH-0954), implementor+codex (ORCH-0957), mingla-orchestrator+claude (META-ORCH-0952 — added META_ORCH_0952_BACKEND_ALLOWLIST in PR #205 `f62cfefb`), tester+codex (ORCH-0957) |  | 2026-06-08 |

---

## Archive (resolved / stale — do not act on; kept for audit)

| id | created | resolved_at | from | to | re_orch | sev | subject | body | final_status |
|---|---|---|---|---|---|---|---|---|---|
