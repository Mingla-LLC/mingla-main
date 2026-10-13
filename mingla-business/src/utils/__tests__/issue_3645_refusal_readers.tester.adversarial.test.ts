/**
 * #3645 — TESTER adversarial suite for the event publish / unpublish refusal
 * readers.
 *
 * Different angles from
 * services/__tests__/issue_3645_publish_refusal_reason.happy.test.ts (which
 * drives the service with the four mapped guards and one unpublish refusal):
 *
 *  - every value a `catch` can be handed (null, undefined, numbers, strings,
 *    arrays, functions, Errors, Error subclasses, bare objects with and without
 *    a message, nested envelopes, non-string messages);
 *  - the organiser-facing sentence is always one of a CLOSED set, so no raw
 *    server code, "[object Object]" or provider name can ever be shown;
 *  - a decorated or prefixed refusal still reaches its guard;
 *  - the two unpublish callers own no private copy of the sentence and no
 *    private reader (one owner per truth);
 *  - the new payout-country copy for the same hostile inputs.
 *
 * FAILS ON REVERT (restore EventCreatorWizard.tsx, app/event/[id]/index.tsx and
 * app/(tabs)/hub/events.tsx from origin/main): the three "one owner" source
 * tests fail — each caller is back to its inline `instanceof Error` reader and
 * its own copy of the sentences.
 *
 *   cd mingla-business && npx jest \
 *     src/utils/__tests__/issue_3645_refusal_readers.tester.adversarial.test.ts --runInBand
 */

import { readFileSync } from "fs";
import path from "path";

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { readRpcFailureMessage } from "../../services/rsvpRpcFailure";
import {
  EVENT_UNPUBLISH_FAILED_COPY,
  EVENT_UNPUBLISH_HAS_COMMITMENTS_COPY,
  eventUnpublishFailureCopy,
} from "../eventUnpublishFailureCopy";
import {
  describeUnmappedPublishGuard,
  resolveProviderNeutralPaidPublishGuardCopy,
} from "../paidPublishGuards";
import {
  PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY,
  PAYOUT_COUNTRY_SWITCH_FAILED_COPY,
  payoutCountrySwitchErrorCopy,
} from "../payoutCountrySwitchCopy";

class CodedError extends Error {
  public readonly code: string;

  public constructor(message: string, code: string) {
    super(message);
    this.name = "CodedError";
    this.code = code;
  }
}

const postgrest = (message: unknown): Record<string, unknown> => ({
  message,
  code: "P0001",
  details: null,
  hint: null,
});

/** Things a `catch (error)` can really be handed, none carrying a reason. */
const REASONLESS: [string, unknown][] = [
  ["null", null],
  ["undefined", undefined],
  ["a number", 503],
  ["true", true],
  ["an empty string", ""],
  ["an empty object", {}],
  ["an array", ["event_unpublish_has_commitments_but_in_an_array"].slice(0, 0)],
  ["a function", (): string => "boom"],
  ["a symbol", Symbol("boom")],
  ["an object with a code but no message", { code: "P0001", details: null }],
  ["an object whose message is a number", { message: 42, code: "P0001" }],
  ["an object whose message is null", { message: null, code: "P0001" }],
  ["an object whose message is an object", { message: { text: "nope" } }],
  ["an Error with an empty message", new Error("")],
  // A double-wrapped envelope: the reason is NOT on the value's own message.
  [
    "a nested { error: { message } } envelope",
    { error: { message: "event_unpublish_has_commitments" } },
  ],
];

const INTERNALS =
  /\[object|undefined|null|P0001|PGRST|event_unpublish|stripe_|paystack|Stripe|Paystack|select_provider|clear_provider|disconnect_first|42883/;

const appSource = (...segments: string[]): string =>
  readFileSync(path.join(__dirname, "..", "..", "..", ...segments), "utf8");

/** Code only, so a commented-out reader cannot satisfy (or trip) a pin. */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("#3645 tester — unpublish refusal copy is a closed set", () => {
  test.each(REASONLESS)(
    "%s yields the generic sentence and never throws",
    (_label, value) => {
      expect(eventUnpublishFailureCopy(value)).toBe(EVENT_UNPUBLISH_FAILED_COPY);
      expect(readRpcFailureMessage(value)).toBe("");
    },
  );

  test.each([
    ["a bare PostgREST object", postgrest("event_unpublish_has_commitments")],
    ["an Error", new Error("event_unpublish_has_commitments")],
    [
      "an Error subclass carrying a code",
      new CodedError("event_unpublish_has_commitments", "P0001"),
    ],
    ["a raw string", "event_unpublish_has_commitments"],
    [
      "a decorated message",
      postgrest('ERROR: P0001: event_unpublish_has_commitments (SQLSTATE P0001)'),
    ],
    [
      "an object with extra unrelated fields",
      { ...postgrest("event_unpublish_has_commitments"), status: 400, name: "x" },
    ],
  ])("buyer activity is recognised from %s", (_label, value) => {
    expect(eventUnpublishFailureCopy(value)).toBe(
      EVENT_UNPUBLISH_HAS_COMMITMENTS_COPY,
    );
  });

  test("the reason is read from the message only — a code or hint that merely mentions it does not switch the copy", () => {
    expect(
      eventUnpublishFailureCopy({
        message: "connection reset",
        code: "event_unpublish_has_commitments",
        hint: "event_unpublish_has_commitments",
      }),
    ).toBe(EVENT_UNPUBLISH_FAILED_COPY);
  });

  test.each([
    ["event_unpublish_not_future", postgrest("event_unpublish_not_future")],
    ["forbidden", postgrest("forbidden")],
    ["an unknown future guard", postgrest("event_unpublish_some_new_rule")],
    [
      "a 4 KB hostile message",
      postgrest(`<script>alert(1)</script>${"x".repeat(4096)}`),
    ],
  ])("%s never leaks its server text to the organiser", (_label, value) => {
    const copy = eventUnpublishFailureCopy(value);
    expect([
      EVENT_UNPUBLISH_FAILED_COPY,
      EVENT_UNPUBLISH_HAS_COMMITMENTS_COPY,
    ]).toContain(copy);
    expect(copy).toBe(EVENT_UNPUBLISH_FAILED_COPY);
    expect(copy).not.toMatch(INTERNALS);
    expect(copy).not.toContain("<");
  });

  test("both sentences are plain words with no code, provider or placeholder", () => {
    for (const copy of [
      EVENT_UNPUBLISH_FAILED_COPY,
      EVENT_UNPUBLISH_HAS_COMMITMENTS_COPY,
    ]) {
      expect(copy).not.toMatch(INTERNALS);
      expect(copy).not.toMatch(/_/);
      expect(copy.trim()).toBe(copy);
      expect(copy.endsWith(".")).toBe(true);
    }
  });
});

describe("#3645 tester — the wizard's publish reader, fed every shape", () => {
  let errorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    // describeUnmappedPublishGuard logs unconditionally; keep the run quiet.
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  /** Exactly what EventCreatorWizard's publish catch computes and shows. */
  const wizardToast = (
    thrown: unknown,
  ): { action: string | null; toast: string } => {
    const code = readRpcFailureMessage(thrown);
    const guard = resolveProviderNeutralPaidPublishGuardCopy(code);
    return guard !== null
      ? { action: guard.action, toast: guard.body }
      : { action: null, toast: describeUnmappedPublishGuard(code) };
  };

  const GUARDS: [string, string][] = [
    ["stripe_charges_disabled", "payment_onboarding"],
    ["payment_collection_unavailable", "payment_onboarding"],
    ["event_currency_required", "payment_onboarding"],
    ["offering_date_past", "edit_date"],
    ["city_required", "edit_where"],
  ];

  test.each(GUARDS)(
    "%s routes to %s whether it arrives as an object, an Error, a subclass, a string or decorated",
    (code, action) => {
      const shapes: unknown[] = [
        postgrest(code),
        new Error(code),
        new CodedError(code, "P0001"),
        code,
        postgrest(`P0001: ${code} (SQLSTATE P0001)`),
        { message: code },
      ];
      for (const shape of shapes) {
        const result = wizardToast(shape);
        expect(result.action).toBe(action);
        // The mapped sentence is shown, never the token that selected it.
        expect(result.toast).not.toContain(code);
        expect(result.toast).not.toMatch(/\[object|Stripe|Paystack/);
      }
    },
  );

  test("a guard token inside a longer identifier does not hijack the Where step", () => {
    expect(wizardToast(postgrest("venue_city_required_v2")).action).toBeNull();
  });

  test.each(REASONLESS)(
    "%s falls to the honest fallback: no step jump, no '[object Object]', no invitation to retry",
    (_label, value) => {
      const result = wizardToast(value);
      expect(result.action).toBeNull();
      expect(result.toast).not.toMatch(/\[object|undefined|null/);
      expect(result.toast).not.toMatch(/try again/i);
      expect(result.toast.length).toBeGreaterThan(20);
    },
  );

  test("hostile server text is described, never quoted", () => {
    const hostile = postgrest('<img src=x onerror="alert(1)"> DROP TABLE brands;');
    const result = wizardToast(hostile);
    expect(result.action).toBeNull();
    expect(result.toast).not.toMatch(/<img|DROP TABLE|onerror/);
  });
});

describe("#3645 tester — each caller has ONE reader and owns no copy of the sentence", () => {
  const CALLERS: [string, string[]][] = [
    ["event dashboard", ["app", "event", "[id]", "index.tsx"]],
    ["events hub", ["app", "(tabs)", "hub", "events.tsx"]],
  ];

  test.each(CALLERS)(
    "the %s shows eventUnpublishFailureCopy(error) and nothing home-made",
    (_label, segments) => {
      const code = codeOnly(appSource(...segments));

      // The sentences live in one module; a caller that re-types them will
      // drift the next time the copy changes.
      expect(code).not.toContain(EVENT_UNPUBLISH_HAS_COMMITMENTS_COPY);
      expect(code).not.toContain(EVENT_UNPUBLISH_FAILED_COPY);
      // The legacy sentinel and the legacy substring probe are both gone.
      expect(code).not.toContain('"unpublish_failed"');
      expect(code).not.toContain("event_unpublish_has_commitments");

      // The unpublish catch binds the error and hands it straight to the helper.
      const call = code.indexOf("await unpublishBusinessEventToDraft(");
      expect(call).toBeGreaterThanOrEqual(0);
      expect(code.indexOf("await unpublishBusinessEventToDraft(", call + 1)).toBe(-1);
      const catchAt = code.indexOf("catch", call);
      expect(catchAt).toBeGreaterThan(call);
      const arm = code.slice(catchAt, code.indexOf("}, [", catchAt));
      expect(arm).toMatch(/^catch \(error\)/);
      expect(arm.match(/eventUnpublishFailureCopy\(error\)/g)).toHaveLength(1);
      expect(arm).not.toMatch(/instanceof Error|String\(error|\.message/);
      // Exactly one import of the helper, from the shared module.
      expect(
        code.match(/import \{ eventUnpublishFailureCopy \} from "[^"]*\/src\/utils\/eventUnpublishFailureCopy";/g),
      ).toHaveLength(1);
    },
  );

  test("EventCreatorWizard's publish catch has no stringifying reader left anywhere in it", () => {
    const code = codeOnly(
      appSource("src", "components", "event", "EventCreatorWizard.tsx"),
    );
    const start = code.indexOf("const slug = await onPublishDraft(");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = code.indexOf("const handleFixJump", start);
    expect(end).toBeGreaterThan(start);
    const arm = code.slice(start, end);

    expect(arm).not.toMatch(/String\(error/);
    expect(arm).not.toMatch(/error instanceof Error \?/);
    // One reader feeds BOTH the mapped guards and the unmapped fallback.
    expect(arm.match(/readRpcFailureMessage\(error\)/g)).toHaveLength(1);
    expect(arm).toContain("resolveProviderNeutralPaidPublishGuardCopy(code)");
    expect(arm).toContain("describeUnmappedPublishGuard(code)");
    // The typed refund-terms error is still handled before the generic reader.
    expect(arm.indexOf("error instanceof OfferingRefundTermsError")).toBeLessThan(
      arm.indexOf("readRpcFailureMessage(error)"),
    );
    // Each guard still jumps to its own step.
    expect(arm).toMatch(/case "edit_date":[\s\S]*?setCurrentStep\(1\)/);
    expect(arm).toMatch(/case "edit_where":[\s\S]*?setCurrentStep\(2\)/);
    expect(arm).toMatch(/case "payment_onboarding":[\s\S]*?onOpenPaymentOnboarding\(\)/);
  });
});

describe("#3645 tester — payout-country switch copy is a closed, provider-free set", () => {
  const CLOSED = [
    PAYOUT_COUNTRY_SWITCH_FAILED_COPY,
    PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY,
  ];

  test.each([
    ...REASONLESS,
    ["a raw service error", new Error("selectPaystackProvider: forbidden (permission_denied)")],
    ["a provider-named string", "Paystack said no; Stripe is wired"],
    ["a bare object naming the conflict", { message: "disconnect_first", detail: "disconnect_first" }],
    ["a transport TypeError", new TypeError("Failed to fetch")],
  ] as [string, unknown][])("%s maps into the closed set", (_label, value) => {
    const copy = payoutCountrySwitchErrorCopy(value);
    expect(CLOSED).toContain(copy);
    expect(copy).not.toMatch(/stripe|paystack|provider|_|\[object/i);
  });

  test("only a real 'bank already connected' refusal gets the bank sentence", () => {
    expect(
      payoutCountrySwitchErrorCopy(
        new Error("clearPaystackProvider: conflict (disconnect_first)"),
      ),
    ).toBe(PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY);
    expect(payoutCountrySwitchErrorCopy("disconnect_first")).toBe(
      PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY,
    );
    expect(
      payoutCountrySwitchErrorCopy(new Error("clearPaystackProvider: conflict")),
    ).toBe(PAYOUT_COUNTRY_SWITCH_FAILED_COPY);
  });

  test("no organiser-facing string added to the web payout screen's switch states names a provider", () => {
    const web = appSource(
      "src",
      "components",
      "brand",
      "BrandBankConnectBody.web.tsx",
    );
    const start = web.indexOf("{railSwitchPending ? (");
    const end = web.indexOf(') : selectedProvider === "paystack" ? (', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const region = web.slice(start, end);
    expect(region).toContain("bank-connect-rail-switching");
    expect(region).toContain("bank-connect-rail-retry");
    expect(region).not.toMatch(/stripe|paystack/i);
  });
});
