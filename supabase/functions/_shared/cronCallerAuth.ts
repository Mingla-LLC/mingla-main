/**
 * #3200 — who may invoke a scheduled edge function.
 *
 * WHAT WAS WRONG. `stripe-kyc-stall-reminder` authenticated its caller with
 *
 *     const cronSecret = Deno.env.get("CRON_SECRET");
 *     if (!cronSecret || auth !== cronSecret) return 401;
 *
 * and `CRON_SECRET` has never been set in production. `!cronSecret` was
 * therefore always true, so every call was refused whatever it presented — and
 * `cron.job` held no row that called it anyway. A switch with no caller, behind
 * a lock that would have refused one.
 *
 * WHAT A SCHEDULED CALLER ACTUALLY PRESENTS. Every pg_cron job in this repo
 * reads `service_role_key` from the vault and sends `Bearer <that>` (see
 * 20270423002290_issue_2290_brand_person_ingest_cron.sql). The healthy siblings
 * `brand-person-ingest-worker` and `competitor-intel-worker` accept exactly that,
 * with `CRON_SECRET` as an alternative. This helper is that rule, written once.
 *
 * An absent credential can never match: `constantTimeEqualSecret` returns false
 * when the expected value is empty, so an unset `CRON_SECRET` is simply not an
 * accepted credential — it no longer blocks the one that is.
 */
import { constantTimeEqualSecret } from "./contentShareProxyAuth.ts";

export interface CronCallerEnv {
  get: (name: string) => string | undefined;
}

// Literal reads, so the function-secret contract audit can attribute them.
function defaultCronCallerEnv(): CronCallerEnv {
  return {
    get(name: string) {
      if (name === "SUPABASE_SERVICE_ROLE_KEY") {
        return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      }
      if (name === "CRON_SECRET") return Deno.env.get("CRON_SECRET");
      return undefined;
    },
  };
}

export async function isAuthorizedCronCaller(
  authorization: string | null | undefined,
  env: CronCallerEnv = defaultCronCallerEnv(),
): Promise<boolean> {
  const bearer = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return false;
  const serviceKey = env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  const cronSecret = env.get("CRON_SECRET")?.trim() ?? "";
  // Both comparisons always run, so timing does not reveal which one matched.
  const [serviceMatch, cronMatch] = await Promise.all([
    constantTimeEqualSecret(bearer, serviceKey),
    constantTimeEqualSecret(bearer, cronSecret),
  ]);
  return serviceMatch || cronMatch;
}
