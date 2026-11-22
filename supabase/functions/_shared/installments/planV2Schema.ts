/**
 * issue #4522 (rework F6) — is the trip plan v2 schema in this database?
 *
 * Edge functions deploy when a pull request merges, before its migrations are
 * applied. In that window the database has no `order_installments.kind`,
 * `schedule_version`, `order_overpayments` or `issue_4522_*` functions, and
 * every instalment path must behave exactly as it did before #4522. Each
 * caller asks once, here, and takes the pre-#4522 path when the answer is
 * false.
 *
 * The probe is the server switch's own function (`issue_4522_plan_v2_enabled`,
 * created by the same migration as the new columns): answering at all means
 * the schema is there, whatever the switch says. Only "this column / function
 * / table does not exist" (42703, 42883, 42P01 and PostgREST's PGRST202,
 * PGRST204, PGRST205) means "not yet". T3-8: when that function call fails
 * any other way (it can keep failing while the tables are fine), the same
 * question is asked a second way — reading `order_installments.kind` with no
 * rows — so instalment charging keeps working on whichever path the schema
 * supports, on every run. Only when both fail is the error thrown, so a real
 * outage still fails loudly. A yes is remembered for the isolate's life (the
 * schema never goes away); a no for at most NOT_YET_TTL_MS, so the new paths
 * take over within seconds of the migrations being applied.
 */
// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const NOT_YET_TTL_MS = 30_000;

const MISSING_SCHEMA_CODES = new Set([
  "42703", // undefined_column
  "42883", // undefined_function
  "42P01", // undefined_table
  "PGRST202", // function not found in the schema cache
  "PGRST204", // column not found in the schema cache
  "PGRST205", // table not found in the schema cache
]);

export interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
}

/** True only for "this column, function or table does not exist". */
export function isMissingSchemaError(
  error: PostgrestLikeError | null | undefined,
): boolean {
  return typeof error?.code === "string" && MISSING_SCHEMA_CODES.has(error.code);
}

interface ProbeClient {
  rpc(fn: string): PromiseLike<{ data: unknown; error: PostgrestLikeError | null }>;
  from?(table: string): {
    select(columns: string): {
      limit(n: number): PromiseLike<{ data: unknown; error: PostgrestLikeError | null }>;
    };
  };
}

let knownAvailable = false;
let notYetCheckedAt = Number.NEGATIVE_INFINITY;

/** Whether the #4522 schema exists (see the module comment). */
export async function planV2SchemaAvailable(
  supabase: SupabaseClient | ProbeClient,
  now: () => number = Date.now,
): Promise<boolean> {
  if (knownAvailable) return true;
  if (now() - notYetCheckedAt < NOT_YET_TTL_MS) return false;
  const { error } = await (supabase as ProbeClient).rpc("issue_4522_plan_v2_enabled");
  if (error === null) {
    knownAvailable = true;
    return true;
  }
  if (isMissingSchemaError(error)) {
    notYetCheckedAt = now();
    console.warn(JSON.stringify({ event: "issue_4522_schema_not_yet_applied", code: error.code }));
    return false;
  }
  // T3-8 — the switch function failed for another reason: ask the table.
  const client = supabase as ProbeClient;
  if (typeof client.from === "function") {
    const read = await client.from("order_installments").select("kind").limit(0);
    if (read.error === null) {
      console.warn(JSON.stringify({
        event: "issue_4522_schema_probe_fallback",
        answer: "present",
        probeError: error.code ?? "unknown",
      }));
      knownAvailable = true;
      return true;
    }
    if (isMissingSchemaError(read.error)) {
      notYetCheckedAt = now();
      console.warn(JSON.stringify({ event: "issue_4522_schema_not_yet_applied", code: read.error.code }));
      return false;
    }
  }
  throw new Error(`issue_4522 schema probe failed: ${error.message ?? error.code ?? "unknown"}`);
}

/** Tests only: forget what the probe learned. */
export function resetPlanV2SchemaProbeForTests(): void {
  knownAvailable = false;
  notYetCheckedAt = Number.NEGATIVE_INFINITY;
}
