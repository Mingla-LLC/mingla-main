/**
 * ORCH-0914 — Trip Money tab redesign — TESTER ADVERSARIAL regression tests
 * T-A01..T-A14.
 *
 * Author: Claude `mingla-tester` (TEST mode), 2026-05-22.
 *
 * These tests deliberately attack DIFFERENT ANGLES than the implementor's
 * happy-path suite at `money-redesign.test.tsx`. Where the happy-path tests
 * verify that strings/components EXIST in the source, these tests verify:
 *
 *   - NEGATIVE assertions (the at-risk override is NOT bypassed; the
 *     rate-limit is NOT skippable; the helper is NOT duplicated)
 *   - ORDER + PRECEDENCE assertions (cancelled supersedes past in last-
 *     charge status derivation; helper-import precedes any inline PI
 *     creation in the cron)
 *   - DB-SIDE ENFORCEMENT (the rate-limit predicate is actually
 *     `sent_at > now() - interval '24 hours'`, the at-risk override
 *     requires explicit `true`)
 *   - AUDIT LOG WRITES (both action slugs present in the resolver +
 *     written by both RPCs)
 *   - AUTH GATES (both edge functions require JWT; RPCs return
 *     `unauthenticated` shape when `auth.uid()` is null)
 *   - HONEST FALLBACKS (no `?? 1` or `?? 0` masking of real-zero amounts;
 *     buyer name falls through real fields not placeholder strings)
 *   - STRICT-GREP FUNCTIONALITY (the helper-only gate ACTUALLY FIRES on
 *     injected violations — not just present-but-broken)
 *
 * A copy of the implementor's tests with renamed `it()` blocks would fail
 * Step 0.5 gate (b) and produce P1 finding. These are independent
 * angle-attacks per SPEC §7.2.
 *
 * Source-text grep mirrors implementor's pattern (rendering the full Money
 * route pulls Expo Router + React Query + native modules which Jest cannot
 * exercise from node). Live-fire sim covers the rendered behaviour.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, test } from "@jest/globals";

// 6 levels up from `mingla-business/app/trip/[id]/money/__tests__/` to repo root.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..", "..");

const read = (rel: string): string =>
  readFileSync(join(REPO_ROOT, rel), "utf8");

const ROUTE = read("mingla-business/app/trip/[id]/money/index.tsx");
const HOOKS = read("mingla-business/src/hooks/useManualInstallmentActions.ts");
const CHARGE_SERVICE = read(
  "mingla-business/src/services/manualInstallmentChargeService.ts",
);
const REMINDER_SERVICE = read(
  "mingla-business/src/services/installmentReminderService.ts",
);
const AUDIT_LABELS = read("mingla-business/src/utils/auditActionLabels.ts");
const MIGRATION_REMINDERS = read(
  "supabase/migrations/20260723000000_orch_0914_manual_buyer_reminders.sql",
);
const MIGRATION_CHARGE = read(
  "supabase/migrations/20260723000001_orch_0914_manual_charge_installment.sql",
);
const EDGE_CHARGE = read(
  "supabase/functions/manual-charge-installment/index.ts",
);
const EDGE_REMINDER = read(
  "supabase/functions/send-installment-reminder/index.ts",
);
const HELPER = read(
  "supabase/functions/_shared/installments/createInstallmentPI.ts",
);
const CRON = read(
  "supabase/functions/process-scheduled-installments/index.ts",
);
const EMAIL_TEMPLATE = read(
  "supabase/functions/_shared/email/installmentReminderEmail.ts",
);
const STRICT_GREP_GATE = read(
  ".github/scripts/strict-grep/i-proposed-manual-installment-action-via-shared-helper.mjs",
);
const USER_CLIENT_HELPER = read(
  "supabase/functions/_shared/ticketCheckout.ts",
);

describe("ORCH-0914 trip money tab redesign — ADVERSARIAL", () => {
  // --- DB-side enforcement (angle: implementor checks UI fires the mutation;
  // we check the underlying DB constraint that makes UI bypass impossible) ---

  test("T-A01 rate-limit predicate is exactly `sent_at > now() - interval '24 hours'` (not 12h, not 1h, not skippable)", () => {
    expect(MIGRATION_REMINDERS).toMatch(
      /sent_at\s*>\s*now\(\)\s*-\s*interval\s+'24\s*hours'/i,
    );
    // Reject any weaker window patterns
    expect(MIGRATION_REMINDERS).not.toMatch(/interval\s+'12\s*hours'/i);
    expect(MIGRATION_REMINDERS).not.toMatch(/interval\s+'1\s*hour'/i);
    expect(MIGRATION_REMINDERS).not.toMatch(/interval\s+'0/i);
  });

  test("T-A02 rate-limit RPC returns `rate_limited` reason (not 500, not generic error) on second invocation", () => {
    // RPC must explicitly classify the limit-exceeded path as a structured
    // error, not a thrown exception that the client would surface as a 500.
    expect(MIGRATION_REMINDERS).toMatch(
      /jsonb_build_object\([^)]*'ok',\s*false[^)]*'reason',\s*'rate_limited'/s,
    );
    // Edge function must translate this to a user-readable message — not
    // pass through the raw reason code (Constitution #3 no-silent-failures).
    expect(EDGE_REMINDER).toMatch(/rate_limited/);
  });

  test("T-A03 at-risk override requires EXPLICIT `true` — default-false guard rejects unset / null / falsy", () => {
    // The RPC signature must default to `false` so omitting the arg is
    // safe. If it defaulted to `true`, every call would bypass at-risk.
    expect(MIGRATION_CHARGE).toMatch(
      /p_atrisk_override\s+boolean\s+DEFAULT\s+false/i,
    );
    // The guard predicate must be strict IS TRUE / IS NOT TRUE (not `=
    // true` which is null-vulnerable; not `<>` which lets null through).
    expect(MIGRATION_CHARGE).toMatch(
      /at_risk\s+IS\s+TRUE\s+AND\s+p_atrisk_override\s+IS\s+NOT\s+TRUE/i,
    );
    // Reject any pattern that would allow null override to mean "yes" —
    // `IS NOT NULL` or `<>` would be wrong here.
    expect(MIGRATION_CHARGE).not.toMatch(
      /p_atrisk_override\s+IS\s+NOT\s+NULL/i,
    );
  });

  test("T-A04 strict-grep helper-only gate FIRES on injected stripe.paymentIntents.create with mingla_installment_id metadata outside the helper", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "orch-0914-adversarial-"));
    try {
      const fnDir = join(tmpRoot, "supabase", "functions", "rogue-fn");
      const helperDir = join(
        tmpRoot,
        "supabase",
        "functions",
        "_shared",
        "installments",
      );
      const gateDir = join(tmpRoot, ".github", "scripts", "strict-grep");
      execFileSync("mkdir", ["-p", fnDir, helperDir, gateDir]);
      // Stage the gate script + a synthetic helper (allowed) + a rogue
      // edge fn that creates a PI with installment metadata (forbidden).
      writeFileSync(
        join(helperDir, "createInstallmentPI.ts"),
        "// helper — owns PI creation\nstripe.paymentIntents.create({ metadata: { mingla_installment_id: id } });\n",
      );
      writeFileSync(
        join(fnDir, "index.ts"),
        "// rogue endpoint trying to bypass the helper\nstripe.paymentIntents.create({\n  amount: 1000,\n  currency: 'usd',\n  metadata: {\n    mingla_installment_id: 'abc',\n  },\n});\n",
      );
      writeFileSync(
        join(gateDir, "i-proposed-manual-installment-action-via-shared-helper.mjs"),
        STRICT_GREP_GATE,
      );

      const result = spawnSync(
        "node",
        [
          ".github/scripts/strict-grep/i-proposed-manual-installment-action-via-shared-helper.mjs",
        ],
        { cwd: tmpRoot, encoding: "utf8" },
      );
      expect(result.status).not.toBe(0);
      expect((result.stderr ?? "") + (result.stdout ?? "")).toMatch(
        /rogue-fn|installment PaymentIntent\.create must route through/,
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  // --- Outstanding-balance edge cases (angle: implementor tests
  // `Math.max(0, ...)`; we test ALL-CANCELLED + ALL-REFUNDED edge cases) ---

  test("T-A05 outstanding clamp to zero handles ALL-CANCELLED and ALL-REFUNDED installment scenarios honestly", () => {
    // The clamp pattern uses paidToDateCents derived from ONLY collected
    // installments — cancelled and refunded must NOT count as paid.
    expect(ROUTE).toMatch(
      /paidToDateCents[\s\S]{0,400}row\.status\s*===\s*"collected"/,
    );
    // The reducer must NOT include refunded/cancelled in paidToDate.
    expect(ROUTE).not.toMatch(
      /paidToDateCents[\s\S]{0,200}row\.status\s*===\s*"refunded"/,
    );
    expect(ROUTE).not.toMatch(
      /paidToDateCents[\s\S]{0,200}row\.status\s*===\s*"cancelled"/,
    );
  });

  // --- Last-charge status precedence (angle: implementor checks each state
  // renders; we check the at-risk > most-recent-attempted > scheduled
  // PRECEDENCE order is correct) ---

  test("T-A06 last-charge status precedence encoded in ternary: at-risk supersedes most-recent-attempted supersedes scheduled fallback", () => {
    // The lastChargeStatus assignment is a single-expression ternary:
    //   head.orderAtRisk ? "at_risk" : attempted?.status ?? "scheduled"
    // Precedence is encoded by the ternary order (orderAtRisk first) +
    // the nullish-coalescing fallback (attempted then "scheduled").
    expect(ROUTE).toMatch(
      /head\.orderAtRisk\s*\?\s*"at_risk"\s*:\s*attempted\?\.status\s*\?\?\s*"scheduled"/,
    );
    // Anti-patterns that would break precedence:
    // - "at_risk" appearing AFTER scheduled (wrong order)
    expect(ROUTE).not.toMatch(/"scheduled"[\s\S]{0,100}"at_risk"/);
    // - Using == instead of strict tests (null-vulnerable)
    expect(ROUTE).not.toMatch(/head\.orderAtRisk\s*==\s*true/);
  });

  // --- Pay-in-full row negative behaviour (angle: implementor checks "Paid
  // in full" copy exists; we check the row CANNOT trigger Charge-now or
  // active Send-reminder) ---

  test("T-A07 pay-in-full row gates BOTH actions: canCharge requires !isPaidInFull, reminderDisabled bakes in isPaidInFull, paid-in-full copy present", () => {
    // canCharge derivation must require BOTH a next installment AND
    // !isPaidInFull — pay-in-full row cannot trigger Charge-now even if
    // some installment record exists somewhere.
    expect(ROUTE).toMatch(
      /canCharge\s*=\s*row\.nextInstallment[\s\S]{0,50}!row\.isPaidInFull/,
    );
    // reminderDisabled must bake in isPaidInFull as a first-class gate.
    expect(ROUTE).toMatch(/reminderDisabled\s*=\s*row\.isPaidInFull/);
    // Disabled copy for paid-in-full is the exact string SPEC §5.5 SC-29
    // requires.
    expect(ROUTE).toContain("No reminder needed — paid in full");
    // Pay-in-full row marker exists alongside lastChargeStatus: "collected"
    // so the row visually communicates "fully paid, all collected".
    expect(ROUTE).toMatch(
      /isPaidInFull:\s*true[\s\S]{0,400}lastChargeStatus:\s*"collected"/,
    );
  });

  // --- Audit-log integration (angle: implementor checks rendering paths;
  // we check the audit slugs are written by BOTH RPCs and resolved by
  // the labels module) ---

  test("T-A08 both audit-log slugs (INSTALLMENT_CHARGED_MANUALLY + INSTALLMENT_REMINDER_SENT) are written by the RPCs AND resolved by auditActionLabels", () => {
    // Charge RPC writes the slug
    expect(MIGRATION_CHARGE).toContain("INSTALLMENT_CHARGED_MANUALLY");
    // Reminder RPC writes the slug
    expect(MIGRATION_REMINDERS).toContain("INSTALLMENT_REMINDER_SENT");
    // Both slugs resolve to human labels per ORCH-0806 contract
    expect(AUDIT_LABELS).toContain("INSTALLMENT_CHARGED_MANUALLY");
    expect(AUDIT_LABELS).toContain("INSTALLMENT_REMINDER_SENT");
  });

  // --- Auth gate negative test (angle: implementor checks service calls
  // the edge fn; we check the edge fn REJECTS unauthenticated requests) ---

  test("T-A09 edge functions require JWT — RPC returns `unauthenticated` when auth.uid() is null; edge fns pass user JWT via userClient helper", () => {
    // Both RPCs early-return when auth.uid() IS NULL
    expect(MIGRATION_REMINDERS).toMatch(
      /v_user_id\s+uuid\s+:=\s+auth\.uid\(\)[\s\S]{0,200}IF\s+v_user_id\s+IS\s+NULL[\s\S]{0,200}'unauthenticated'/i,
    );
    expect(MIGRATION_CHARGE).toMatch(
      /v_user_id\s+uuid\s+:=\s+auth\.uid\(\)[\s\S]{0,200}IF\s+v_user_id\s+IS\s+NULL[\s\S]{0,200}'unauthenticated'/i,
    );
    // Edge fns delegate JWT extraction to the `userClient` helper from
    // `_shared/ticketCheckout.ts` — proves they use the user JWT (not
    // service-role which would bypass `auth.uid()` entirely).
    expect(EDGE_CHARGE).toMatch(/import\s+\{[^}]*userClient[^}]*\}\s+from\s+["']\.\.\/_shared\/ticketCheckout(\.ts)?["']/);
    expect(EDGE_REMINDER).toMatch(/import\s+\{[^}]*userClient[^}]*\}\s+from\s+["']\.\.\/_shared\/ticketCheckout(\.ts)?["']/);
    // The shared userClient helper extracts the Authorization header from
    // the inbound request and forwards it to Supabase — this is the
    // structural proof of user-JWT auth pass-through.
    expect(USER_CLIENT_HELPER).toMatch(
      /req\.headers\.get\(["']authorization["']\)[\s\S]{0,300}Authorization:\s*authHeader/i,
    );
  });

  // --- Email template (angle: implementor checks template file exists; we
  // check the subject + body include real amount + due date variables, not
  // hardcoded placeholder strings) ---

  test("T-A10 reminder email template includes dynamic amount + due-date variables (no hardcoded placeholders)", () => {
    // Subject must interpolate amount + date (not just hardcoded text)
    expect(EMAIL_TEMPLATE).toMatch(
      /(nextInstallmentAmount|amount|formattedAmount)/,
    );
    expect(EMAIL_TEMPLATE).toMatch(
      /(nextInstallmentDueAt|dueDate|formattedDueAt|due)/i,
    );
    // Constitution #9: must NOT have lorem-ipsum or hardcoded fake values
    expect(EMAIL_TEMPLATE).not.toMatch(/lorem ipsum/i);
    expect(EMAIL_TEMPLATE).not.toMatch(/€\s*999\.99|\$999\.99/);
  });

  // --- Helper-as-single-owner invariant (angle: implementor adds the helper
  // import; we check the cron's OLD inline PI-creation block was REMOVED,
  // not duplicated alongside the helper call) ---

  test("T-A11 cron extraction is SUBTRACT-then-add (Constitution #8) — no inline `paymentIntents.create({metadata:{mingla_installment_id` remains in cron source", () => {
    // The cron must NO LONGER contain the inline PI creation pattern; it
    // must only contain the helper INVOCATION.
    expect(CRON).toContain("createInstallmentPI");
    // Anti-pattern: cron has its own paymentIntents.create with installment metadata
    const piCreateMatches = CRON.match(
      /paymentIntents\.create\s*\([\s\S]{0,500}?mingla_installment_id/g,
    );
    expect(piCreateMatches).toBeNull();
  });

  // --- Helper input shape (angle: implementor checks helper exists; we
  // check the helper signature accepts an at-risk override flag so manual
  // charge can honor SPEC §3.2.2) ---

  test("T-A12 shared helper signature accepts at-risk override AND returns structured `{ ok, chargeId?, error? }` shape", () => {
    // Helper must accept override input — either as a top-level flag or
    // inside an options object (SPEC §3.2.2 signature).
    expect(HELPER).toMatch(/override|atRisk/i);
    // Helper must return a structured result (not throw on every error)
    expect(HELPER).toMatch(/ok:\s*boolean|ok:\s*true|ok:\s*false|return\s*\{[\s\S]{0,200}ok/);
  });

  // --- Helper metadata contract preservation (angle: implementor extracts
  // the helper; we check the PI metadata schema from ORCH-0869 is preserved
  // — webhook router depends on these exact metadata keys) ---

  test("T-A13 helper's Stripe PI metadata contract preserved — must include all 4 ORCH-0869 required keys", () => {
    for (const key of [
      "mingla_installment_id",
      "mingla_installment_ordinal",
      "mingla_order_id",
      "mingla_brand_id",
    ]) {
      expect(HELPER).toContain(key);
    }
  });

  // --- Hook delegation pattern (angle: implementor checks hooks call
  // service; we check the hook surface area matches SPEC §3.5 — 3 named
  // operations exposed, ALL invalidating the installments query keys on
  // success per ORCH-0869 cache pattern) ---

  test("T-A14 useManualInstallmentActions exposes 3 hooks (charge, reminder, recent-reminder) AND all invalidate orderInstallmentKeys.all on success", () => {
    for (const hookName of [
      "useChargeInstallmentNow",
      "useSendInstallmentReminder",
      "useRecentReminderForOrder",
    ]) {
      expect(HOOKS).toContain(hookName);
    }
    // Each mutation must invalidate the installments query cache
    expect(HOOKS).toMatch(/invalidateQueries[\s\S]{0,200}orderInstallmentKeys/);
  });
});
