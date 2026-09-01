import { shouldIssueOrderAttendanceClaimForNotification } from "../../_shared/attendanceClaim.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("#2979 tester: confirmation ownership is runtime-strict, not type-only", () => {
  const fetchStart = source.indexOf("const { data: orderRaw");
  const fetchEnd = source.indexOf(".maybeSingle();", fetchStart);
  assert(fetchStart >= 0 && fetchEnd > fetchStart, "live order fetch missing");
  const liveFetch = source.slice(fetchStart, fetchEnd);
  assert(
    liveFetch.includes("buyer_user_id,"),
    "live order fetch omits ownership",
  );

  const base = {
    templateKey: "buyer_ticket_confirmation",
    channel: "email",
    paymentStatus: "paid",
  };
  assert(
    shouldIssueOrderAttendanceClaimForNotification({
      ...base,
      buyerUserId: null,
    }),
    "a genuinely unowned paid order must be eligible",
  );
  assert(
    !shouldIssueOrderAttendanceClaimForNotification({
      ...base,
      buyerUserId: undefined as unknown as null,
    }),
    "an omitted ownership field must fail closed",
  );
  assert(
    !shouldIssueOrderAttendanceClaimForNotification({
      ...base,
      buyerUserId: "already-owned",
    }),
    "an owned order must never receive another proof",
  );
});

Deno.test("#2979 tester: confirmation replay never rotates a possibly delivered proof", () => {
  const issueStart = source.indexOf('"issue_order_attendance_claim_proof_v2"');
  const providerStart = source.indexOf(
    "sendResendEmailWithAttachment",
    issueStart,
  );
  assert(
    issueStart >= 0 && providerStart > issueStart,
    "issuance/provider boundary missing",
  );
  const issuance = source.slice(issueStart, providerStart);
  assert(
    issuance.includes("p_generation: pepperRing.current.generation"),
    "confirmation issuance is not generation-tagged",
  );
  assert(
    issuance.includes("p_allow_retry_rotation: false"),
    "confirmation replay can rotate an already delivered proof",
  );
  assert(
    !issuance.includes("p_allow_retry_rotation: true"),
    "confirmation contains a competing rotating issuance path",
  );
});
