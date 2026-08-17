import { assert, assertEquals } from "jsr:@std/assert@1";

const source = Deno.readTextFileSync(
  "supabase/functions/checkout-sale-revocation/index.ts",
);

Deno.test("#2079 paid identity is released to attention without provider mutation", () => {
  const guard = source.indexOf('row.reason.startsWith("paid_provider_")');
  const missing = source.indexOf("else if (!attempt)", guard);
  const providerStart = source.indexOf("stripeTicketCheckout()", guard);
  assert(guard >= 0 && missing > guard);
  const branch = source.slice(guard, missing);
  // #2168 — this window is length-banded. Its end marker moving or vanishing
  // used to widen it to most of the file, and every negative assertion below
  // would then pass for the wrong reason (#2113 runaway-window).
  assert(
    branch.length > 200 && branch.length < 4000,
    `paid branch window is ${branch.length} chars — the boundary moved`,
  );
  // #2168 — the INVARIANT is "paid evidence is released to a human, with zero
  // provider mutation". It used to be carried by a bare throw; it is now the
  // attention handoff, which is what "released to attention" always meant. The
  // throw only ever satisfied this by never resolving, which is why #2168
  // exists: nothing created the attention row it was waiting for.
  assert(
    branch.includes("issue_2168_handoff_revocation_attention"),
    "paid evidence must be handed to the attention rail",
  );
  assertEquals(
    providerStart >= guard && providerStart < missing,
    false,
    "paid evidence must perform zero provider I/O",
  );
  assertEquals(
    branch.includes('state = "neutralized"'),
    false,
    "paid evidence must never be neutralized",
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
