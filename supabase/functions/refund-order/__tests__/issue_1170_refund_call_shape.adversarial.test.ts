import {
  assertEquals,
  assertMatch,
  assertNotMatch,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const SOURCE = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

function extractCallArguments(source: string, callee: string): string[] {
  const code = stripComments(source);
  const callOffsets = [...code.matchAll(
    new RegExp(
      callee.replaceAll(".", String.raw`\.`) + String.raw`\s*\(`,
      "g",
    ),
  )];
  assertEquals(
    callOffsets.length,
    1,
    `expected exactly one active ${callee} call`,
  );

  const match = callOffsets[0];
  const openParen = code.indexOf("(", match.index);
  const args: string[] = [];
  let start = openParen + 1;
  const stack = ["("];
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let index = openParen + 1; index < code.length; index += 1) {
    const char = code[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char === ")" || char === "}" || char === "]") {
      const expected = char === ")" ? "(" : char === "}" ? "{" : "[";
      assertEquals(stack.at(-1), expected, `unbalanced ${callee} call`);
      stack.pop();
      if (stack.length === 0) {
        const finalArg = code.slice(start, index).trim();
        if (finalArg) args.push(finalArg);
        return args;
      }
      continue;
    }
    if (char === "," && stack.length === 1) {
      args.push(code.slice(start, index).trim());
      start = index + 1;
    }
  }

  throw new Error(`unterminated ${callee} call`);
}

function assertDirectChargeRefundShape(source: string): void {
  const args = extractCallArguments(source, "stripe.refunds.create");
  assertEquals(
    args.length,
    2,
    "refunds.create must receive payload plus connected-account request options",
  );

  const [payload, requestOptions] = args;
  assertMatch(payload, /\bpayment_intent\s*:\s*paymentIntentId\b/);
  assertNotMatch(
    `${payload}\n${requestOptions}`,
    /\breverse_transfer\s*:/,
    "direct-charge refund must never include destination-charge reverse_transfer",
  );
  assertNotMatch(
    payload,
    /\bstripeAccount\s*:/,
    "stripeAccount belongs in Stripe request options, not the refund payload",
  );
  assertMatch(
    requestOptions,
    /\bstripeAccount\s*:\s*connectedAccountId\b/,
    "actual refunds.create request options must scope the call to the connected account",
  );
}

Deno.test("issue #1170 adversarial: actual refund call is connected-account scoped and cannot reverse a transfer", () => {
  assertDirectChargeRefundShape(SOURCE);
});

Deno.test("issue #1170 adversarial: guard rejects omitted request scoping even if a payload decoy exists", () => {
  const mutated = SOURCE
    .replace("stripeAccount: connectedAccountId,", "")
    .replace(
      "payment_intent: paymentIntentId,",
      "payment_intent: paymentIntentId,\n        stripeAccount: connectedAccountId,",
    );
  assertThrows(
    () => assertDirectChargeRefundShape(mutated),
    Error,
    "stripeAccount belongs in Stripe request options",
  );
});

Deno.test("issue #1170 adversarial: guard rejects reintroduced reverse_transfer", () => {
  const mutated = SOURCE.replace(
    "refund_application_fee: applicationFeeAmountCents > 0,",
    "reverse_transfer: true,\n        refund_application_fee: applicationFeeAmountCents > 0,",
  );
  assertThrows(
    () => assertDirectChargeRefundShape(mutated),
    Error,
    "direct-charge refund must never include destination-charge reverse_transfer",
  );
});
