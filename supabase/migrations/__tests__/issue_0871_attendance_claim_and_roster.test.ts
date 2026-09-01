import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../../../", import.meta.url);
const read = (path: string): string => Deno.readTextFileSync(new URL(path, root));
const foundation = read("supabase/migrations/20270302000871_issue_0871_attendance_claim_foundation.sql");
const roster = read("supabase/migrations/20270302000872_issue_0871_entitled_guest_roster.sql");
const helper = read("supabase/functions/_shared/attendanceClaim.ts");
const claim = read("supabase/functions/claim-attendance/index.ts");
const link = read("supabase/functions/attendance-claim-link/index.ts");
const rootRoute = read("app-mobile/app/index.tsx");
const hook = read("app-mobile/src/hooks/useEventGuestList.ts");
const socialProofService = read("app-mobile/src/services/socialProofService.ts");
const sheet = read("app-mobile/src/components/EventGuestListSheet.tsx");
const chatClaim = read("supabase/functions/claim-pending-trip-chat-participation/index.ts");
const config = read("supabase/config.toml");

Deno.test("#871 SC-1/2/3 roster is exact-attendance gated before pagination", () => {
  assertStringIncludes(roster, "r.user_id = v_viewer");
  assertStringIncludes(roster, "o.buyer_user_id = v_viewer");
  assertStringIncludes(roster, "RAISE EXCEPTION 'attendance_required'");
  assertStringIncludes(roster, "RAISE EXCEPTION 'guest_list_private'");
  assert(roster.indexOf("guest_list_private") < roster.indexOf("attendance_required"));
  assertStringIncludes(roster, "'nextOffset'");
});

Deno.test("#871 SC-5/6 global order and client pagination have no capped tail", () => {
  assertStringIncludes(roster, "WHEN p.is_named AND NULLIF(btrim(p.avatar_url), '') IS NOT NULL THEN 0");
  assertStringIncludes(hook, "useInfiniteQuery");
  assertStringIncludes(hook, "lastPage.nextOffset ?? undefined");
  assertStringIncludes(socialProofService, "p_offset: offset");
  assertStringIncludes(sheet, 'scrollMode="flatlist"');
  assert(!/and \$\{moreCount\} more/.test(sheet));
});

Deno.test("#871 SC-8/9/10 preserves RSVP SHA-256 and domain-separated order HMAC", () => {
  assert(!foundation.includes("ALTER TABLE public.event_rsvps"));
  assertStringIncludes(foundation, "pass_recovery_token_hash");
  assertStringIncludes(
    link,
    'import { resolveAttendanceClaimPepperRing } from "../_shared/governedAdSecret.ts";',
  );
  assertStringIncludes(link, "resolveAttendanceClaimPepperRing()");
  assertStringIncludes(link, "pepperRing.current.secret");
  assertStringIncludes(link, "issue_order_attendance_claim_proof_v2");
  assertStringIncludes(link, "p_generation: pepperRing.current.generation");
  assertStringIncludes(helper, 'crypto.subtle.sign("HMAC"');
  assertStringIncludes(foundation, "attendance_claim_token_digest bytea");
});

Deno.test("#871 SC-12/13 bearers stay fragments and registered scheme only", () => {
  assertStringIncludes(helper, "com.mingla.app.v2://attendance-claim#");
  assertStringIncludes(helper, "https://host.usemingla.com/attendance/claim#");
  assertEquals(helper.includes("mingla://"), false);
  assertEquals(claim.includes("console."), false);
  assertEquals(link.includes("console."), false);
});

Deno.test("#871 attempt ledger is service-only and always finalized", () => {
  assertStringIncludes(foundation, "ENABLE ROW LEVEL SECURITY");
  assertStringIncludes(foundation, "FROM PUBLIC, anon, authenticated");
  assertStringIncludes(claim, "finally");
  assertStringIncludes(claim, "retryAfterSeconds: 600");
  assertStringIncludes(claim, '"begin_attendance_claim_attempt"');
  assertStringIncludes(foundation, "LIMIT 100");
  assertStringIncludes(foundation, "pg_advisory_xact_lock");
  assertStringIncludes(foundation, "take_attendance_claim_link_attempt");
  assertStringIncludes(foundation, "attendance_claim_link_attempts >= 10");
  assertStringIncludes(link, 'error: "claim_link_rate_limited"');
  assertStringIncludes(link, "retryAfterSeconds: 600");
});

Deno.test("#871 native link intercept precedes Stripe and generic URL logging", () => {
  const intercept = rootRoute.indexOf("receiveAttendanceClaimUrl(url)");
  const stripe = rootRoute.indexOf("handleURLCallback(url)", intercept);
  const genericLog = rootRoute.indexOf('console.log("Deep link received:", url)');
  assert(intercept >= 0 && intercept < stripe && stripe < genericLog);
  assertStringIncludes(rootRoute, "InteractionManager.runAfterInteractions");
  assertStringIncludes(rootRoute, "requestAnimationFrame");
});

Deno.test("#871 edge JWT posture and legacy chat boundary stay explicit", () => {
  assertStringIncludes(config, "[functions.claim-attendance]\nverify_jwt = true");
  assertStringIncludes(config, "[functions.attendance-claim-link]\nverify_jwt = false");
  assert(!/from\(["'](?:orders|event_rsvps)["']\)\.update/.test(chatClaim));
  assert(!chatClaim.includes("buyer_user_id"));
  assert(!chatClaim.includes("event_rsvps.user_id"));
});
