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
 * The probe itself lives in `packages/offering-rendering/planV2Schema.ts`, so
 * the Host app asks the same question the same way (one owner): the switch
 * function first, then `order_installments.kind` with no rows (T3-8); only
 * "does not exist" codes mean "not yet"; a yes is remembered for the
 * isolate's life, a no for at most NOT_YET_TTL_MS; a real outage throws.
 */
// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isMissingSchemaError,
  NOT_YET_TTL_MS,
  planV2SchemaAvailable as sharedPlanV2SchemaAvailable,
  type PlanV2ProbeClient,
  type PostgrestLikeError,
  resetPlanV2SchemaProbeForTests,
} from "../../../../packages/offering-rendering/planV2Schema.ts";

export { isMissingSchemaError, NOT_YET_TTL_MS, resetPlanV2SchemaProbeForTests };
export type { PostgrestLikeError };

/** Whether the #4522 schema exists (see the module comment). */
export function planV2SchemaAvailable(
  supabase: SupabaseClient | PlanV2ProbeClient,
  now: () => number = Date.now,
): Promise<boolean> {
  return sharedPlanV2SchemaAvailable(supabase as PlanV2ProbeClient, now);
}
