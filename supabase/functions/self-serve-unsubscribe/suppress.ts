/**
 * META-ORCH-1161 COMPLIANCE-PAGES — self-serve opt-out writer (pure-ish, injectable).
 *
 * This module contains the ONLY DB-write logic for the public self-serve
 * /unsubscribe page. It is factored out of index.ts so the behavioral test can
 * drive it with a fake supabase client and assert the EXACT rows produced for an
 * email, for a phone, and idempotently — without standing up a live edge runtime.
 *
 * It writes to BOTH suppression models so every downstream consumer honors it:
 *
 *   1. public.channel_suppressions — the META-ORCH-1161 §5.1 ledger that OVERRIDES
 *      preferences (a STOP/unsubscribe beats any toggle). One row per provided
 *      channel:
 *        - channel='email' when an email is given,
 *        - channel='sms'   when a phone  is given,
 *      with scope = the caller's choice ('marketing' | 'all'), reason='unsubscribe',
 *      brand_id NULL (global). `contact` holds the lowercased email or E.164 phone.
 *
 *   2. public.marketing_unsubscribes — the legacy ORCH-0815-B audience-resolver
 *      suppression the marketing send-path filters on. Its CHECK constraint allows
 *      exactly ONE of contact_email / contact_phone per row, channel IN
 *      ('email','sms','rcs','all'), scope IN ('account','brand','global'). Self-serve
 *      opt-out is a GLOBAL suppression, so we write scope='global', channel='all'
 *      (resolver expands 'all' → email+sms+rcs), one row per provided contact.
 *
 * Idempotency: both tables have unique indexes; a re-submit of the same contact
 * raises a 23505 unique violation which we tolerate (treat as success), mirroring
 * the ON CONFLICT DO NOTHING posture of the tokenized marketing-unsubscribe fn.
 */

/** Minimal structural contract of the supabase-js insert path we use. */
export interface InsertResult {
  error: { code?: string; message?: string } | null;
}
export interface SupabaseLike {
  from(table: string): {
    // supabase-js returns an awaitable PostgrestFilterBuilder, not a bare
    // Promise — PromiseLike keeps the contract honest for both the real client
    // and the fake test client (which returns a real Promise).
    insert(row: Record<string, unknown>): PromiseLike<InsertResult>;
  };
}

export type SuppressionScope = "marketing" | "all";

export interface SuppressInput {
  /** Lowercased email, or null. */
  email: string | null;
  /** E.164 phone, or null. */
  phone: string | null;
  /** The user's choice: marketing-only, or all messages. */
  scope: SuppressionScope;
}

export interface SuppressResult {
  channelSuppressionsWritten: number;
  marketingUnsubscribesWritten: number;
  /** Rows that hit a unique-violation (already suppressed) — counted as honored. */
  alreadySuppressed: number;
}

/** Postgres unique-violation detection (code 23505 or message text). */
export function isUniqueViolation(
  err: { code?: string; message?: string } | null,
): boolean {
  if (err === null) return false;
  if (err.code === "23505") return true;
  const m = err.message ?? "";
  return m.includes("duplicate key") || m.includes("unique constraint");
}

/**
 * Writes the suppression rows. Throws on any NON-unique-violation DB error so the
 * caller can surface a 500 (no silent failure — Constitution #3). A unique
 * violation is NOT an error: the contact is already suppressed, which is the
 * desired end-state, so it is counted in `alreadySuppressed`.
 */
export async function writeSuppressions(
  client: SupabaseLike,
  input: SuppressInput,
): Promise<SuppressResult> {
  const result: SuppressResult = {
    channelSuppressionsWritten: 0,
    marketingUnsubscribesWritten: 0,
    alreadySuppressed: 0,
  };

  // --- channel_suppressions: one row per provided channel, scope as chosen. ---
  const channelRows: Array<{ channel: "email" | "sms"; contact: string }> = [];
  if (input.email !== null) {
    channelRows.push({ channel: "email", contact: input.email });
  }
  if (input.phone !== null) {
    channelRows.push({ channel: "sms", contact: input.phone });
  }

  for (const { channel, contact } of channelRows) {
    const { error } = await client.from("channel_suppressions").insert({
      user_id: null,
      contact,
      channel,
      scope: input.scope, // 'marketing' | 'all' — both CHECK-valid
      reason: "unsubscribe", // CHECK-valid
      brand_id: null, // global
    });
    if (isUniqueViolation(error)) {
      result.alreadySuppressed += 1;
    } else if (error !== null) {
      throw new Error(
        `channel_suppressions insert failed (${channel}): ${error.message ?? "unknown"}`,
      );
    } else {
      result.channelSuppressionsWritten += 1;
    }
  }

  // --- marketing_unsubscribes: legacy global suppression, one row per contact. ---
  // CHECK allows exactly ONE of contact_email/contact_phone per row → split.
  const legacyRows: Array<Record<string, unknown>> = [];
  if (input.email !== null) {
    legacyRows.push({
      contact_email: input.email,
      contact_phone: null,
      channel: "all", // resolver expands 'all' → email+sms+rcs
      scope: "global",
      brand_id: null,
      account_id: null,
      reason: "self_serve_unsubscribe",
    });
  }
  if (input.phone !== null) {
    legacyRows.push({
      contact_email: null,
      contact_phone: input.phone,
      channel: "all",
      scope: "global",
      brand_id: null,
      account_id: null,
      reason: "self_serve_unsubscribe",
    });
  }

  for (const row of legacyRows) {
    const { error } = await client.from("marketing_unsubscribes").insert(row);
    if (isUniqueViolation(error)) {
      result.alreadySuppressed += 1;
    } else if (error !== null) {
      throw new Error(
        `marketing_unsubscribes insert failed: ${error.message ?? "unknown"}`,
      );
    } else {
      result.marketingUnsubscribesWritten += 1;
    }
  }

  return result;
}
