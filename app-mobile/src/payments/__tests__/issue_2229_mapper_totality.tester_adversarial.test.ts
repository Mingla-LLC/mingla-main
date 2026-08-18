/**
 * issue #2229 [raw checkout error tokens] — TESTER ADVERSARIAL.
 *
 * DIFFERENT ANGLE FROM THE IMPLEMENTOR.
 * -------------------------------------
 * The implementor's T-3 walks a HAND-COPIED array of server tokens transcribed
 * out of the SPEC. That test can only ever be as complete as the day someone
 * typed the list, and it goes quietly vacuous the moment the edge function
 * grows a token nobody transcribed. This suite derives the token set FROM THE
 * LIVE SERVER SOURCE at test time, so a new `error: "<token>"` in
 * `ticket-checkout-create` is swept in automatically and the mapper is forced
 * to keep covering it.
 *
 * That difference is not theoretical: the SPEC's enumeration says 37 and the
 * live source emits more than that. `sign_in_required`
 * (`_shared/ticketCheckoutAccess.ts`) is a real 401 token that appears in NO
 * hand-written list in this repo, and `checkout_unavailable` is emitted by the
 * database rather than by an `error:` literal in `index.ts`. Both are derived
 * here.
 *
 * The other half of the angle is HOSTILE input rather than expected input:
 * prototype keys, the constants fed back in as tokens, whitespace, casing,
 * oversized strings and `undefined` reaching a parameter typed `string | null`.
 *
 * The failure mode this guards is exactly the one #2229 shipped: a token
 * falling through the mapper and onto a buyer's screen.
 *
 * Fails on revert: delete any routing rule in `nativeCheckoutErrorMessage`
 * (verified by true line deletion — see the QA report on #2227).
 */

import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  CHECKOUT_ALREADY_RESERVED_MESSAGE,
  CHECKOUT_BOOKINGS_CLOSED_MESSAGE,
  CHECKOUT_DATE_UNAVAILABLE_MESSAGE,
  CHECKOUT_DETAILS_INCOMPLETE_MESSAGE,
  CHECKOUT_FAILED_MESSAGE,
  CHECKOUT_IN_PROGRESS_MESSAGE,
  CHECKOUT_INTAKE_REQUIRED_MESSAGE,
  CHECKOUT_INTAKE_STALE_MESSAGE,
  CHECKOUT_RESTRICTED_MESSAGE,
  CHECKOUT_SIGN_IN_MESSAGE,
  CHECKOUT_UPDATE_APP_MESSAGE,
  NATIVE_CHECKOUT_MESSAGES,
  nativeCheckoutErrorMessage,
} from "../checkoutErrorMessages";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const CREATE_FN_DIR = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "ticket-checkout-create",
);
const ACCESS_MODULE = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "_shared",
  "ticketCheckoutAccess.ts",
);

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
};

/**
 * Every token `ticket-checkout-create` can put in `body.error`, read out of the
 * live source rather than transcribed. Three producers:
 *
 *  1. `error: "<token>"` literals in the function and in the shared access
 *     module it delegates to;
 *  2. `"<token>"` in the access module's own error union;
 *  3. `assertEquals(body.error, "<token>")` in the function's Deno tests —
 *     which is how DATABASE-produced tokens like `checkout_unavailable` are
 *     visible at all (index.ts only mentions that one in a comment).
 */
const deriveServerTokens = (): string[] => {
  const tokens = new Set<string>();
  const files = [...walk(CREATE_FN_DIR), ACCESS_MODULE];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/\berror:\s*"([a-z][a-z0-9_]*)"/g)) {
      tokens.add(m[1]);
    }
    for (const m of source.matchAll(
      /assertEquals\(\s*body\.error\s*,\s*"([a-z][a-z0-9_]*)"/g,
    )) {
      tokens.add(m[1]);
    }
    if (file === ACCESS_MODULE) {
      for (const m of source.matchAll(/\|\s*"([a-z][a-z0-9_]*)"/g)) {
        tokens.add(m[1]);
      }
    }
  }
  return [...tokens].sort();
};

const SERVER_TOKENS = deriveServerTokens();

/** Every status the client can actually observe on this path. */
const STATUSES: (number | null)[] = [
  null, 400, 401, 402, 403, 404, 409, 410, 422, 426, 429, 500, 502, 503, 504,
];

describe("#2229 adversarial — the token set is DERIVED, not transcribed", () => {
  it("the derivation is not vacuous and finds tokens no hand-written list carries", () => {
    // A floor, so a broken regex can never turn this whole suite green-by-empty.
    expect(SERVER_TOKENS.length).toBeGreaterThanOrEqual(38);

    // Anchors from every producer class.
    expect(SERVER_TOKENS).toContain("checkout_in_progress"); // index.ts literal
    expect(SERVER_TOKENS).toContain("sign_in_required"); // _shared access module
    expect(SERVER_TOKENS).toContain("checkout_unavailable"); // DB-produced
    expect(SERVER_TOKENS).toContain("paystack_initialize_failed"); // NGN rail
    expect(SERVER_TOKENS).toContain("internal_error"); // catch-all 5xx
  });

  it("every token the mapper NAMES is a token the server can still emit", () => {
    // Reverse-drift guard: a mapper rule for a token that no longer exists is
    // dead weight, and dead weight is how a rule outlives the fact behind it.
    const mapperSource = readFileSync(
      join(__dirname, "..", "checkoutErrorMessages.ts"),
      "utf8",
    );
    const named = new Set(
      [...mapperSource.matchAll(/"([a-z][a-z0-9_]{6,})"/g)].map((m) => m[1]),
    );
    const orphans = [...named].filter(
      (token) => !SERVER_TOKENS.includes(token),
    );
    expect(orphans).toEqual([]);
  });
});

describe("#2229 adversarial — totality over the LIVE token set", () => {
  it("returns an owned constant for every derived token at every status", () => {
    const escapes: string[] = [];
    for (const token of SERVER_TOKENS) {
      for (const status of STATUSES) {
        const out = nativeCheckoutErrorMessage(token, status);
        if (!NATIVE_CHECKOUT_MESSAGES.includes(out)) {
          escapes.push(`${token}@${String(status)} -> ${out}`);
        }
      }
    }
    expect(escapes).toEqual([]);
  });

  it("never returns its input, and never SMUGGLES the token inside the copy", () => {
    const leaks: string[] = [];
    for (const token of SERVER_TOKENS) {
      for (const status of STATUSES) {
        const out = nativeCheckoutErrorMessage(token, status);
        if (out === token) leaks.push(`identity: ${token}@${String(status)}`);
        if (out.includes(token)) leaks.push(`substring: ${token}@${String(status)}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("routes the token classes the SPEC pins, at a neutral status", () => {
    expect(nativeCheckoutErrorMessage("checkout_in_progress", 409)).toBe(
      CHECKOUT_IN_PROGRESS_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("bookings_closed", 400)).toBe(
      CHECKOUT_BOOKINGS_CLOSED_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("occurrence_not_available", 400)).toBe(
      CHECKOUT_DATE_UNAVAILABLE_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("buyer_email_invalid", 400)).toBe(
      CHECKOUT_DETAILS_INCOMPLETE_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("intake_form_required", 400)).toBe(
      CHECKOUT_INTAKE_REQUIRED_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("intake_schema_stale", 400)).toBe(
      CHECKOUT_INTAKE_STALE_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("free_reservation_already_exists", 409)).toBe(
      CHECKOUT_ALREADY_RESERVED_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("checkout_restricted", 403)).toBe(
      CHECKOUT_RESTRICTED_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("upgrade_required", 426)).toBe(
      CHECKOUT_UPDATE_APP_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage(null, 401)).toBe(CHECKOUT_SIGN_IN_MESSAGE);
  });

  it("every 5xx plumbing token is generalised, never explained to a buyer", () => {
    // These name Mingla's internals. A buyer must be told the payment did not
    // start, not that the QR pepper is missing.
    const plumbing = SERVER_TOKENS.filter((t) =>
      /(failed|missing|unavailable|internal_error|not_ready)$/.test(t),
    ).filter(
      (t) =>
        ![
          "checkout_unavailable",
          "event_date_lookup_failed",
          "occurrence_lookup_failed",
          "intake_schema_lookup_failed",
        ].includes(t),
    );
    expect(plumbing.length).toBeGreaterThan(5);
    for (const token of plumbing) {
      expect(nativeCheckoutErrorMessage(token, 500)).toBe(CHECKOUT_FAILED_MESSAGE);
    }
  });
});

describe("#2229 adversarial — hostile and degenerate inputs", () => {
  const HOSTILE: string[] = [
    "",
    " ",
    "\n",
    "\t\r\n ",
    "__proto__",
    "constructor",
    "prototype",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "CHECKOUT_IN_PROGRESS",
    "Checkout_In_Progress",
    "CHECKOUT_RESTRICTED",
    "checkout_in_progress ",
    " checkout_in_progress",
    "checkout_in_progress\n",
    "checkout-in-progress",
    "checkout_in_progress; DROP TABLE orders",
    '{"error":"checkout_in_progress"}',
    "<!doctype html><h1>502 Bad Gateway</h1>",
    "Edge Function returned a non-2xx status code",
    "x".repeat(10_000),
    "🙂",
    "0",
    "null",
    "undefined",
    "[object Object]",
  ];

  it("every hostile token still lands on an owned constant", () => {
    const escapes: string[] = [];
    for (const token of HOSTILE) {
      for (const status of STATUSES) {
        const out = nativeCheckoutErrorMessage(token, status);
        if (!NATIVE_CHECKOUT_MESSAGES.includes(out)) {
          escapes.push(`${token.slice(0, 24)}@${String(status)}`);
        }
        // Substring-leak only means something for inputs that LOOK like a
        // token; " " is a substring of every English sentence ever written.
        if (/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(token) && out.includes(token)) {
          escapes.push(`leak ${token.slice(0, 24)}@${String(status)}`);
        }
      }
    }
    expect(escapes).toEqual([]);
  });

  it("prototype keys resolve as data, not as inherited members", () => {
    // The token classes are Sets today. If anyone refactors them to plain
    // objects, `"constructor"` starts resolving to a function and the mapper
    // silently mis-routes. Pinned here so that refactor cannot land quietly.
    expect(nativeCheckoutErrorMessage("__proto__", null)).toBe(
      CHECKOUT_FAILED_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("constructor", null)).toBe(
      CHECKOUT_FAILED_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("toString", null)).toBe(
      CHECKOUT_FAILED_MESSAGE,
    );
  });

  it("survives `undefined` reaching parameters typed `string | null`", () => {
    // TypeScript says null. A JS runtime hands you undefined the first time an
    // optional chain misses, and this is a money path.
    const loose = nativeCheckoutErrorMessage as unknown as (
      t?: unknown,
      s?: unknown,
    ) => string;
    for (const args of [
      [undefined, undefined],
      [undefined, 409],
      ["checkout_in_progress", undefined],
      [null, undefined],
      [undefined, null],
    ]) {
      const out = loose(args[0], args[1]);
      expect(NATIVE_CHECKOUT_MESSAGES).toContain(out);
    }
    expect(loose(undefined, 401)).toBe(CHECKOUT_SIGN_IN_MESSAGE);
    expect(loose(undefined, 409)).toBe(CHECKOUT_IN_PROGRESS_MESSAGE);
  });

  it("feeding the mapper its OWN output still yields an owned constant", () => {
    // Defence against a caller that maps twice — a second pass must not turn a
    // sentence back into something else, or produce anything unowned.
    for (const message of NATIVE_CHECKOUT_MESSAGES) {
      const out = nativeCheckoutErrorMessage(message, null);
      expect(NATIVE_CHECKOUT_MESSAGES).toContain(out);
    }
  });
});

describe("#2229 adversarial — the #2188 money clause holds on every string", () => {
  it("each owned constant states whether the buyer was charged", () => {
    expect(NATIVE_CHECKOUT_MESSAGES).toHaveLength(13);
    for (const message of NATIVE_CHECKOUT_MESSAGES) {
      expect(message).toMatch(/charge/i);
      // ...and states it as a NEGATIVE or a NOT-TWICE, never an ambiguity.
      expect(message).toMatch(/not been charged/i);
    }
  });

  it("no owned constant reads like a machine token", () => {
    for (const message of NATIVE_CHECKOUT_MESSAGES) {
      expect(message).not.toMatch(/^[a-z0-9_]+$/);
      expect(message.length).toBeGreaterThan(30);
      expect(message).toMatch(/[.!]$/);
    }
  });
});
