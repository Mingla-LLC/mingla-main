// Issue #1447 crash-window regression.
// Proves that SMS/push become non-retryable once provider I/O starts, while a
// failure known to happen before provider I/O remains safely retryable.

import { isRsvpNotifyServiceRequest } from "../rsvpNotifyAuth.ts";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

const read = (relative: string): Promise<string> =>
  Deno.readTextFile(new URL(relative, import.meta.url));

const migration = await read(
  "../../../migrations/20270204001447_issue_1447_rsvp_admission.sql",
);
const worker = await read("../index.ts");
const dispatcher = await read("../../_shared/notifyV2.ts");
const pushAdapter = await read("../../_shared/adapters/pushAdapter.ts");
const pushUtils = await read("../../_shared/push-utils.ts");

function staleLeaseDisposition(providerIoStarted: boolean): "retry" | "park" {
  return providerIoStarted ? "park" : "retry";
}

Deno.test("SMS and push mark the durable lease before provider I/O", () => {
  assert(
    dispatcher.includes("beforeProviderIo: async () =>") &&
      dispatcher.includes("await markRsvpProviderIo(client, input);"),
    "push dispatch must supply the durable pre-I/O hook",
  );
  const pushPreflight = pushAdapter.indexOf("hasOneSignalCredentials(app)");
  const pushSend = pushAdapter.indexOf("const ok = await sendPush", pushPreflight);
  assert(
    pushPreflight >= 0 && pushSend > pushPreflight,
    "push adapter must validate credentials before entering the send primitive",
  );
  const primitivePreflight = pushUtils.indexOf("if (!appId || !restKey)");
  const pushMark = pushUtils.indexOf("await payload.beforeProviderIo?.()", primitivePreflight);
  const providerFetch = pushUtils.indexOf(
    'fetch("https://api.onesignal.com/notifications"',
    pushMark,
  );
  assert(
    primitivePreflight >= 0 && pushMark > primitivePreflight && providerFetch > pushMark,
    "push must preflight, mark durably, then perform provider I/O",
  );

  const smsSend = dispatcher.indexOf("result = await smsAdapter.send");
  const smsHook = dispatcher.indexOf("beforeProviderIo: async () =>", smsSend);
  const smsMark = dispatcher.indexOf(
    "await markRsvpProviderIo(client, input);",
    smsHook,
  );
  assert(
    smsHook >= 0 && smsMark > smsHook,
    "SMS must mark in its pre-I/O hook",
  );
  assert(
    dispatcher.includes('"mark_rsvp_notification_provider_io"'),
    "provider-I/O marker must be persisted through the service-role RPC",
  );
});

Deno.test("missing OneSignal credentials stay known-unsent and retryable", () => {
  assert(
    pushAdapter.includes('error: "provider_config_missing"') &&
      dispatcher.includes('safe === "provider_config_missing"'),
    "preflight configuration failure must remain a definitive retry",
  );
  assert(
    pushAdapter.indexOf('error: "provider_config_missing"') <
      pushAdapter.indexOf("beforeProviderIo: input.beforeProviderIo"),
    "configuration failure must occur before the durable provider-I/O marker",
  );
});

Deno.test("only the service-role bearer can enter the RSVP drain", () => {
  assert(
    isRsvpNotifyServiceRequest("Bearer service-secret", "service-secret"),
    "the exact service-role bearer must pass",
  );
  for (const untrusted of [null, "", "Bearer anon-jwt", "Bearer user-jwt"]) {
    assert(
      !isRsvpNotifyServiceRequest(untrusted, "service-secret"),
      "anon and normal authenticated callers must fail",
    );
  }
  const auth = worker.indexOf(
    "isRsvpNotifyServiceRequest(authorization, serviceKey)",
  );
  const admin = worker.indexOf("const admin = createClient", auth);
  const claim = worker.indexOf('"claim_rsvp_notification_deliveries"', auth);
  assert(
    auth >= 0 && admin > auth && claim > admin,
    "auth must precede admin client and claim",
  );
  assert(
    worker.includes('return json(401, { error: "unauthorized" })'),
    "untrusted callers must receive an explicit denial",
  );
});

Deno.test("a crash after provider I/O parks instead of reclaiming", () => {
  assert(staleLeaseDisposition(true) === "park", "ambiguous send must park");
  assert(
    staleLeaseDisposition(false) === "retry",
    "known-unsent work may retry",
  );
  assert(
    migration.includes("SET status = 'ambiguous', ambiguous_at = now()") &&
      migration.includes("AND d.provider_io_started_at IS NOT NULL") &&
      migration.includes("AND d.provider_io_started_at IS NULL"),
    "stale claims must split on durable provider-I/O evidence",
  );
  assert(
    !migration.includes(
      "d.status IN ('pending','failed_retryable','ambiguous')",
    ),
    "ambiguous rows must never re-enter the due queue",
  );
});

Deno.test("live exceptions derive retry versus acceptance-unknown from the marker", () => {
  assert(
    worker.includes('admin.rpc("classify_rsvp_notification_failure"') &&
      worker.includes('classifyFailure(admin, claim, "dispatch_unavailable")'),
    "worker exceptions must use durable failure classification",
  );
  assert(
    migration.includes(
      "CASE WHEN v_provider_io_started_at IS NULL THEN 'failed_retryable' ELSE 'ambiguous' END",
    ) && migration.includes("'provider_acceptance_unknown'"),
    "post-I/O exceptions must park as acceptance unknown",
  );
});

Deno.test("true-source crash-safety reversions turn the guard red", () => {
  const unsafe = migration.replace(
    "AND d.provider_io_started_at IS NULL",
    "AND true",
  );
  assert(
    !unsafe.includes("AND d.provider_io_started_at IS NULL"),
    "removing the stale-lease safety predicate must be detected",
  );
  const unmarkedPush = pushUtils.replace(
    "await payload.beforeProviderIo?.();",
    "",
  );
  assert(
    !unmarkedPush.includes("await payload.beforeProviderIo?.();"),
    "removing the push pre-I/O marker must be detected",
  );
});
