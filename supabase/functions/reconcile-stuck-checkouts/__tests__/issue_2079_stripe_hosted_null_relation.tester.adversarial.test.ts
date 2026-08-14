import { assert } from "jsr:@std/assert@1";

const source = Deno.readTextFileSync(
  "supabase/functions/reconcile-stuck-checkouts/index.ts",
);

function between(sourceText: string, start: string, end: string): string {
  const from = sourceText.indexOf(start);
  const to = sourceText.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `missing bounded source region: ${start}`);
  return sourceText.slice(from, to);
}

Deno.test("#2079 retest: hosted reconciliation cannot trust a stored PI when Checkout Session has no PI", () => {
  const stripePi = between(
    source,
    'if (refClass === "STRIPE_PI")',
    '} else if (refClass === "STRIPE_CS")',
  );
  const relationResolution = between(
    stripePi,
    "const resolvedPiId =",
    "const retrievedPi = await retrievePaymentIntentReadOnly",
  );

  assert(
    /resolvedPiId\s*(?:===|==)\s*null|!resolvedPiId/.test(
      relationResolution,
    ),
    "a hosted cs_* with no payment_intent must be held/non-final before the persisted pi_* can be retrieved and finalized",
  );
});
