/**
 * META-ORCH-1174 Leg B1 [multi-package trip installments] — pure money math.
 *
 * This module is the EXECUTABLE SPECIFICATION of the per-line installment
 * computation that `biz_ticket_checkout_create_session`
 * (supabase/migrations/20261101000000_meta_orch_1174_b1_multiline_installments.sql)
 * performs in SQL. Postgres cannot call TypeScript, so the SQL RPC re-implements
 * this exact algorithm; the adversarial unit tests pin THIS helper and a
 * separate source-assertion test pins that the RPC body contains the matching
 * per-line logic. The two MUST stay in lockstep — if you change the algorithm
 * here, change the SQL, and vice-versa.
 *
 * CONTRACT (DEC-1174-F — FULL multi-package installments):
 *   A trip cart may contain N lines. Each line maps to one ticket_type (a trip
 *   "package"). A line MAY carry an installment template (the package's
 *   tier_metadata.installments). Lines WITHOUT a template charge in full now.
 *
 *   "Due today" (the deposit charged at booking) =
 *       Σ(each plan line's per-line deposit)
 *     + Σ(each non-plan line's full line total)
 *
 *   The scheduled future payments = the UNION of every plan line's own schedule,
 *   re-numbered ordinal 1..M (sorted by dueAt asc, then by line order) so the
 *   order_installments UNIQUE(order_id, ordinal) constraint holds at finalize.
 *
 *   MONEY CONSERVATION (the load-bearing invariant):
 *       dueTodayCents + Σ(scheduled.amountCents) === Σ(line totals)
 *   Proven per-line: each plan line's (deposit + Σ its installments) === its
 *   own line total by the last-absorbs-rounding rule; non-plan lines contribute
 *   their full total to dueToday and nothing to the schedule. The union only
 *   relabels ordinals; it never changes an amount.
 *
 * SINGLE-LINE PRESERVATION (no regression): for exactly one plan line and no
 * other lines, this reduces to the ORCH-0869 single-line algorithm byte-for-byte
 * (same floor() formula, same last-installment-absorbs-remainder rule, same
 * schedule shape) — verified by the (a) test case.
 *
 * Rounding rule (integer cents, identical to ORCH-0869):
 *   lineDeposit = floor(lineTotal * deposit_pct / 100)
 *   installment i (1..N-1) = floor(lineTotal * pct_i / 100)
 *   installment N absorbs the remainder so deposit + Σ installments = lineTotal.
 */

export interface InstallmentTemplateEntry {
  ordinal: number;
  pct: number;
  /** Exactly one of days_after_booking | fixed_date is set (validated upstream). */
  days_after_booking?: number;
  fixed_date?: string;
}

export interface InstallmentTemplate {
  deposit_pct: number;
  installments: InstallmentTemplateEntry[];
}

export interface MultiLineInstallmentLine {
  ticketTypeId: string;
  /** quantity × unit price already folded in by the caller. */
  lineTotalCents: number;
  /** The package's payment plan; null/undefined ⇒ this line charges full now. */
  template: InstallmentTemplate | null | undefined;
}

export interface ComputedScheduledPayment {
  /** Sequential across the WHOLE union, 1..M. */
  ordinal: number;
  amountCents: number;
  /** ISO-8601 UTC instant the cron charges this installment. */
  dueAt: string;
  /** Provenance — which line this entry came from (audit / debugging only). */
  sourceTicketTypeId: string;
  /** The line-local ordinal before re-numbering (audit only). */
  sourceOrdinal: number;
}

export interface MultiLineInstallmentPlan {
  /** Sum the deposit PI charges at booking. */
  dueTodayCents: number;
  /** Unioned, ordinal-renumbered future payments (may be empty). */
  scheduled: ComputedScheduledPayment[];
  /** True when at least one line carries a plan (⇒ save PM off-session). */
  hasInstallments: boolean;
}

export class MultiLineInstallmentError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "MultiLineInstallmentError";
  }
}

/** Mirrors the SQL `to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`. */
function toUtcInstant(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Compute one plan line's deposit + its own (un-renumbered) installment amounts.
 * EXACT port of the ORCH-0869 single-line SQL math, scaled by THIS line's total.
 *
 * Throws MultiLineInstallmentError with the SAME error codes the SQL raises so
 * the failure surface is identical across the TS spec and the RPC.
 */
function computeLineSchedule(
  line: MultiLineInstallmentLine,
  template: InstallmentTemplate,
  bookedAt: Date,
): { depositCents: number; entries: ComputedScheduledPayment[] } {
  const depositPct = Number(template.deposit_pct);
  if (!(depositPct > 0) || depositPct > 100) {
    throw new MultiLineInstallmentError("installment_deposit_pct_out_of_range");
  }
  const installments = template.installments;
  if (!Array.isArray(installments)) {
    throw new MultiLineInstallmentError("installment_schedule_malformed");
  }
  const n = installments.length;
  if (n < 1 || n > 11) {
    throw new MultiLineInstallmentError("installment_count_out_of_range");
  }

  // First pass: validate every installment + accumulate the pct sum.
  let pctSum = depositPct;
  for (let i = 0; i < n; i++) {
    const inst = installments[i];
    const ord = Number(inst?.ordinal ?? -1);
    const pct = Number(inst?.pct ?? 0);
    const days = inst?.days_after_booking;
    const fixed = inst?.fixed_date;
    if (ord !== i + 1) {
      throw new MultiLineInstallmentError("installment_ordinal_invalid");
    }
    if (!(pct > 0) || pct >= 100) {
      throw new MultiLineInstallmentError("installment_pct_out_of_range");
    }
    const hasDays = days !== undefined && days !== null;
    const hasFixed = fixed !== undefined && fixed !== null && fixed !== "";
    if ((!hasDays && !hasFixed) || (hasDays && hasFixed)) {
      throw new MultiLineInstallmentError("installment_due_mode_invalid");
    }
    pctSum += pct;
  }
  if (Math.abs(pctSum - 100) > 0.01) {
    throw new MultiLineInstallmentError("installment_pct_sum_mismatch");
  }

  const full = line.lineTotalCents;
  const depositCents = Math.floor((full * depositPct) / 100);

  // Second pass: amounts (last absorbs remainder) + due dates.
  const entries: ComputedScheduledPayment[] = [];
  let runningInstallmentTotal = 0;
  for (let i = 0; i < n; i++) {
    const inst = installments[i];
    const pct = Number(inst.pct);
    const days = inst.days_after_booking;
    const fixed = inst.fixed_date;

    let dueDate: Date;
    if (days !== undefined && days !== null) {
      if (!(Number(days) >= 1)) {
        throw new MultiLineInstallmentError(
          "installment_days_after_booking_invalid",
        );
      }
      dueDate = new Date(bookedAt.getTime() + Number(days) * 86400_000);
    } else {
      dueDate = new Date(String(fixed));
      if (Number.isNaN(dueDate.getTime())) {
        throw new MultiLineInstallmentError("installment_due_mode_invalid");
      }
    }

    // First installment of THIS line must be in the future at booking time.
    if (i === 0 && dueDate.getTime() <= bookedAt.getTime()) {
      throw new MultiLineInstallmentError(
        "installment_schedule_past_due_at_booking",
      );
    }

    let amount: number;
    if (i < n - 1) {
      amount = Math.floor((full * pct) / 100);
      runningInstallmentTotal += amount;
    } else {
      amount = full - depositCents - runningInstallmentTotal;
      if (!(amount > 0)) {
        throw new MultiLineInstallmentError("installment_rounding_invalid");
      }
    }

    entries.push({
      ordinal: i + 1, // line-local; re-numbered after the union
      amountCents: amount,
      dueAt: toUtcInstant(dueDate),
      sourceTicketTypeId: line.ticketTypeId,
      sourceOrdinal: i + 1,
    });
  }

  return { depositCents, entries };
}

/**
 * The full multi-line plan. `payInFull=true` is the session-wide opt-out
 * (ORCH-0915 p_payment_plan_choice='full') — every line charges in full now and
 * the schedule is empty, regardless of any per-line templates.
 */
export function computeMultiLineInstallmentPlan(input: {
  lines: MultiLineInstallmentLine[];
  bookedAt: Date;
  payInFull?: boolean;
}): MultiLineInstallmentPlan {
  const { lines, bookedAt } = input;
  const payInFull = input.payInFull === true;

  let dueTodayCents = 0;
  const allEntries: ComputedScheduledPayment[] = [];

  for (const line of lines) {
    if (!(line.lineTotalCents >= 0)) {
      throw new MultiLineInstallmentError("line_total_invalid");
    }
    const hasTemplate = !payInFull && line.template != null &&
      Array.isArray(line.template.installments) &&
      line.template.installments.length > 0;

    if (!hasTemplate) {
      // Non-plan (or opted-full) line — full amount due today, nothing scheduled.
      dueTodayCents += line.lineTotalCents;
      continue;
    }

    const { depositCents, entries } = computeLineSchedule(
      line,
      line.template as InstallmentTemplate,
      bookedAt,
    );
    dueTodayCents += depositCents;
    for (const e of entries) allEntries.push(e);
  }

  // Union + re-number: sort by dueAt asc, then by source line order (stable),
  // then assign sequential ordinals 1..M. Sorting by dueAt keeps the buyer's
  // ledger chronological; ordinal uniqueness is what the DB requires.
  allEntries.sort((a, b) => {
    if (a.dueAt < b.dueAt) return -1;
    if (a.dueAt > b.dueAt) return 1;
    return 0; // stable: preserves source line order on ties
  });
  const scheduled = allEntries.map((e, idx) => ({ ...e, ordinal: idx + 1 }));

  return {
    dueTodayCents,
    scheduled,
    hasInstallments: scheduled.length > 0,
  };
}
