import { assert, assertEquals } from "jsr:@std/assert@1";

const source = Deno.readTextFileSync(
  "supabase/functions/checkout-sale-revocation/index.ts",
);

Deno.test("#2079 paid identity is released to attention without provider mutation", () => {
  const guard = source.indexOf('row.reason.startsWith("paid_provider_")');
  const missing = source.indexOf("else if (!attempt)", guard);
  const providerStart = source.indexOf("stripeTicketCheckout()", guard);
  assert(guard >= 0 && missing > guard);
  assert(
    source.slice(guard, missing).includes(
      'throw new Error("paid_provider_identity_pending")',
    ),
  );
  assertEquals(
    providerStart >= guard && providerStart < missing,
    false,
    "paid evidence must perform zero provider I/O",
  );
});

Deno.test("#2079 paid identity retry releases only the exact lease", () => {
  const retry = source.indexOf('"issue_2079_record_paid_identity_retry"');
  const checked = source.indexOf("if (retryError)", retry);
  const ordinaryRecord = source.indexOf(
    '"issue_1930_record_revocation_result"',
    checked,
  );
  assert(retry >= 0 && checked > retry && ordinaryRecord > checked);
  assert(source.slice(retry - 120, checked).includes("error: retryError"));
  assert(
    source.slice(checked, ordinaryRecord).includes(
      'state: "provider_unknown"',
    ),
  );
});

Deno.test("#2079 revocation writeback errors are never ignored", () => {
  const record = source.indexOf('"issue_1930_record_revocation_result"');
  const checked = source.indexOf("if (recordError)", record);
  assert(record >= 0 && checked > record);
  assert(source.slice(record - 120, checked).includes("error: recordError"));
});
