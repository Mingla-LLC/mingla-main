/**
 * issue #3645 — when the SERVER refuses a paid publish for want of the
 * Organiser Terms, every Host surface offers the acceptance sheet. No surface
 * shows the server's code or a generic failure.
 *
 * Before: events fell to "the server reported mingla_tos_not_accepted", trips
 * printed the code in the Review banner, experiences printed "Couldn't publish
 * experience: mingla_tos_not_accepted", and stays showed "We couldn't publish
 * this Stay. Review the blockers and try again."
 *
 * The pure decisions are executed here. That each publish surface asks the
 * terms question FIRST and hands the acceptance sheet the publish to resume is
 * checked against the shipped source below (the surfaces are wizard screens
 * whose full render needs the native stack).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import {
  describeUnmappedPublishGuard,
  eventPublishCarriesMoney,
  isOrganiserTermsRefusalMessage,
  ORGANISER_TERMS_REFUSAL_CODE,
  ORGANISER_TERMS_REFUSAL_COPY,
  ORGANISER_TERMS_UNCONFIRMED_COPY,
  resolveOrganiserTermsRefusalCopy,
  resolveProviderNeutralPaidPublishGuardCopy,
  type PublishRefusalAction,
} from "../paidPublishGuards";
import { readRpcFailureMessage } from "../../services/rsvpRpcFailure";

const SRC = join(__dirname, "..", "..");
const source = (relative: string): string => readFileSync(join(SRC, relative), "utf8");

describe("#3645 — recognising the Organiser Terms refusal", () => {
  test("the bare code, as a publish function raises it", () => {
    expect(isOrganiserTermsRefusalMessage("mingla_tos_not_accepted")).toBe(true);
    expect(ORGANISER_TERMS_REFUSAL_CODE).toBe("mingla_tos_not_accepted");
  });

  test("a decorated message still counts", () => {
    expect(isOrganiserTermsRefusalMessage("P0001: mingla_tos_not_accepted")).toBe(true);
    expect(
      isOrganiserTermsRefusalMessage("issue_1719_publish_experience_with_poster: mingla_tos_not_accepted (detail)"),
    ).toBe(true);
  });

  test("the bare PostgREST object a publish RPC really rejects with", () => {
    const postgrest = {
      code: "P0001",
      message: "mingla_tos_not_accepted",
      details: "organiser_terms_version_required=1.0",
      hint: null,
    };
    // `String(object)` is "[object Object]"; the shared reader finds the message.
    expect(isOrganiserTermsRefusalMessage(String(postgrest))).toBe(false);
    expect(isOrganiserTermsRefusalMessage(readRpcFailureMessage(postgrest))).toBe(true);
    expect(isOrganiserTermsRefusalMessage(readRpcFailureMessage(new Error("mingla_tos_not_accepted")))).toBe(true);
  });

  test("other refusals, near misses and non-strings do not count", () => {
    for (const other of [
      "stripe_charges_disabled",
      "event_currency_required",
      "offering_date_past",
      "city_required",
      "price_reentry_required",
      "mingla_tos_not_accepted_v2",
      "x_mingla_tos_not_accepted",
      "",
      "   ",
    ]) {
      expect(isOrganiserTermsRefusalMessage(other)).toBe(false);
    }
    expect(isOrganiserTermsRefusalMessage(null)).toBe(false);
    expect(isOrganiserTermsRefusalMessage(undefined)).toBe(false);
    expect(isOrganiserTermsRefusalMessage(42 as unknown as string)).toBe(false);
  });

  test("it is its own action, not a payment or date guard", () => {
    const copy = resolveOrganiserTermsRefusalCopy("mingla_tos_not_accepted");
    expect(copy).toBe(ORGANISER_TERMS_REFUSAL_COPY);
    const action: PublishRefusalAction = (copy as typeof ORGANISER_TERMS_REFUSAL_COPY).action;
    expect(action).toBe("accept_terms");
    // The payment-guard resolver must NOT claim it (it would send the host to
    // bank setup or to the When step).
    expect(resolveProviderNeutralPaidPublishGuardCopy("mingla_tos_not_accepted")).toBeNull();
    expect(resolveOrganiserTermsRefusalCopy("stripe_charges_disabled")).toBeNull();
  });
});

describe("#3645 — what the host reads", () => {
  const sentences = [
    ORGANISER_TERMS_REFUSAL_COPY.title,
    ORGANISER_TERMS_REFUSAL_COPY.body,
    ORGANISER_TERMS_REFUSAL_COPY.actionLabel,
    ORGANISER_TERMS_UNCONFIRMED_COPY,
  ];

  test("plain words: no server code, no provider name", () => {
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/mingla_tos|not_accepted|P0001|_/);
      expect(sentence).not.toMatch(/stripe|paystack/i);
    }
    expect(ORGANISER_TERMS_REFUSAL_COPY.body).toMatch(/Organiser Terms/);
    expect(ORGANISER_TERMS_REFUSAL_COPY.body).toMatch(/draft is saved/);
  });

  test("the unresolved line does not invite a retry", () => {
    expect(ORGANISER_TERMS_UNCONFIRMED_COPY).not.toMatch(/try again|retry/i);
    expect(ORGANISER_TERMS_UNCONFIRMED_COPY).toMatch(/wasn't published/);
  });

  test("what an event host saw BEFORE: the last-resort copy quotes the code", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // This is why every surface asks the terms question first.
      expect(describeUnmappedPublishGuard("mingla_tos_not_accepted")).toContain("mingla_tos_not_accepted");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("#3645 — the event creator asks for terms exactly when the server will", () => {
  // business_publish_event_draft: money-bearing = ANY ticket whose
  // round(price x 100) > 0, online or door, whatever `isFree` says.
  test("a priced ticket", () => {
    expect(eventPublishCarriesMoney([{ priceGbp: 10 }])).toBe(true);
  });

  test("a ticket flagged free that still carries a price counts, as on the server", () => {
    const tickets = [{ isFree: true, priceGbp: 15 }];
    expect(eventPublishCarriesMoney(tickets)).toBe(true);
    // The mirror this replaces skipped it, so the server refused the publish.
    const olderMirror = tickets.some((t) => !t.isFree && (t.priceGbp ?? 0) > 0);
    expect(olderMirror).toBe(false);
  });

  test("a door-only priced ticket counts (terms are not online-only)", () => {
    expect(eventPublishCarriesMoney([{ priceGbp: 5, availableAt: "door" } as { priceGbp: number }])).toBe(true);
  });

  test("free, empty and sub-minor-unit prices do not", () => {
    expect(eventPublishCarriesMoney([])).toBe(false);
    expect(eventPublishCarriesMoney([{ priceGbp: null }, { priceGbp: 0 }, { priceGbp: undefined }])).toBe(false);
    // round(0.004 x 100) = 0 on the server too.
    expect(eventPublishCarriesMoney([{ priceGbp: 0.004 }])).toBe(false);
    expect(eventPublishCarriesMoney([{ priceGbp: 0.005 }])).toBe(true);
    expect(eventPublishCarriesMoney([{ priceGbp: Number.NaN }, { priceGbp: -3 }])).toBe(false);
  });

  test("one priced ticket among free ones is enough", () => {
    expect(eventPublishCarriesMoney([{ priceGbp: null }, { priceGbp: 0 }, { priceGbp: 2500 }])).toBe(true);
  });

  test("the event creator uses it", () => {
    const wizard = source("components/event/EventCreatorWizard.tsx");
    expect(wizard).toContain("const isPaidListing = eventPublishCarriesMoney(liveDraft.tickets);");
    expect(wizard).not.toContain("(t) => !t.isFree && (t.priceGbp ?? 0) > 0");
  });
});

describe("#3645 — every publish surface offers the sheet before anything else", () => {
  /** Index of each anchor in order; fails with the first anchor that is missing or out of order. */
  const inOrder = (text: string, anchors: string[]): void => {
    let from = 0;
    for (const anchor of anchors) {
      const at = text.indexOf(anchor, from);
      if (at === -1) throw new Error(`missing, or out of order: ${anchor}`);
      from = at + anchor.length;
    }
  };

  test("event: asked before the payment guards and before the last-resort copy", () => {
    const wizard = source("components/event/EventCreatorWizard.tsx");
    inOrder(wizard, [
      "const code = readRpcFailureMessage(error);",
      "if (isOrganiserTermsRefusalMessage(code)) {",
      "acceptTermsAfterServerRefusal(",
      "() => resumePublishRef.current(),",
      "() => handleShowToast(ORGANISER_TERMS_UNCONFIRMED_COPY),",
      "return;",
      "const guardCopy = resolveProviderNeutralPaidPublishGuardCopy(code);",
      "handleShowToast(describeUnmappedPublishGuard(code));",
    ]);
  });

  test("experience: asked before the paid guards and before the fallback that prints the code", () => {
    const wizard = source("components/experience/ExperienceCreatorWizard.tsx");
    inOrder(wizard, [
      'const code = (error.message ?? "").trim();',
      "if (publish && isOrganiserTermsRefusalMessage(code)) {",
      "acceptTermsAfterServerRefusal(",
      "() => resumePublishRef.current(),",
      "() => setToast(ORGANISER_TERMS_UNCONFIRMED_COPY),",
      "return;",
      "if (handlePaidPublishGuard(code)) {",
      "experience: ${code}`",
    ]);
  });

  test("trip: asked before the Review banner is given the server's message", () => {
    const wizard = source("components/trip/TripCreatorWizard.tsx");
    inOrder(wizard, [
      "const err = e as TripPublishValidationError;",
      "isOrganiserTermsRefusalMessage(err?.message) ||",
      "isOrganiserTermsRefusalMessage(readRpcFailureMessage(e))",
      "acceptTermsAfterServerRefusal(",
      "() => resumePublishRef.current(),",
      "() => showToast(ORGANISER_TERMS_UNCONFIRMED_COPY),",
      "return;",
      'setPublishError(mapPublishErrorToState(err.code ?? "publish_failed", err.message));',
    ]);
  });

  test("stay: the refused publish opens the sheet, and the line under the button is plain", () => {
    const shell = source("components/stay/StaySuiteShell.tsx");
    inOrder(shell, [
      "function publishErrorCopy(error: Error | null): string | null {",
      "if (isOrganiserTermsRefusalMessage(error.message)) {",
      'return "Accept the Organiser Terms to publish this Stay.";',
      'if (error.message.includes("stay_authoring_disabled")) {',
    ]);
    inOrder(shell, [
      "publish.mutate(",
      "{ expectedVersion: settings.version },",
      "onError: (error) => {",
      "if (!isOrganiserTermsRefusalMessage(error.message)) return;",
      "acceptTermsAfterServerRefusal(() => resumePublishStayRef.current());",
    ]);
  });

  test("the Stay service hands the typed code through as the error message", () => {
    const service = source("services/stayInventoryService.ts");
    inOrder(service, [
      'if (typeof body.code === "string") {',
      "return new Error(body.code);",
    ]);
  });

  test("the four surfaces take the sheet from the one shared gate", () => {
    for (const file of [
      "components/event/EventCreatorWizard.tsx",
      "components/experience/ExperienceCreatorWizard.tsx",
      "components/trip/TripCreatorWizard.tsx",
      "components/stay/StaySuiteShell.tsx",
    ]) {
      const text = source(file);
      inOrder(text, [
        "blockPaidPublishUntilAccepted,",
        "acceptTermsAfterServerRefusal,",
        "gateElement: organiserTermsGateElement,",
        "} = useOrganiserTermsPublishGate(",
      ]);
      // No surface builds its own sentence around the server's code.
      expect(text).not.toContain('"mingla_tos_not_accepted"');
    }
  });
});
