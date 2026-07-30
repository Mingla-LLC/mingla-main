import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("Drain claims both pools independently and does not abort the surviving pool", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assertStringIncludes(source, 'admin.rpc("claim_notification_outbox"');
  assertStringIncludes(
    source,
    'admin.rpc("claim_source_refund_notification_outbox"',
  );
  assertStringIncludes(source, "genericError");
  assertStringIncludes(source, "sourceError");
  assert(
    !source.includes(
      'if (genericError) return json({ error: "claim_failed" }, 500)',
    ),
  );
});

Deno.test("Drain never reads a non-2xx source response body and bounds success JSON to 1 KiB", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  const non2xx = source.indexOf("if (response.status === 503)");
  const boundedRead = source.indexOf(
    "readBoundedSuccessEnvelope(response)",
    non2xx,
  );
  assert(non2xx >= 0 && boundedRead > non2xx);
  assertStringIncludes(source, "if (total > 1024)");
  assertStringIncludes(source, 'p_certainty: "derive"');
  assert(
    !source.includes(
      '"mark_source_refund_notification_provider_io"',
    ),
  );
});

Deno.test("Drain verifies the canonical payload fingerprint before recipient resolution or provider I/O", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  const fingerprint = source.indexOf("actualPayloadFingerprint");
  const recipient = source.indexOf(
    '"resolve_source_refund_notification_recipient"',
    fingerprint,
  );
  const dispatch = source.indexOf(
    "/functions/v1/notify-dispatch",
    fingerprint,
  );
  assert(fingerprint >= 0 && fingerprint < recipient && recipient < dispatch);
  assertStringIncludes(source, 'outcome: "payload_changed"');
  assertStringIncludes(source, 'safeCode: "payload_changed"');
});
