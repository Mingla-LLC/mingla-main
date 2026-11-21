/**
 * issue #4522 C7 — buyer-web v2 plan disclosure.
 *
 * Fails on revert: the decoder, public package summary, server-availability
 * copy, loading state, selection callback, create/quote dual write, and the
 * legacy past-due refusal each have an independent assertion.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodeTicketQuotePlanV2 } from "@mingla/offering-rendering/ticketQuotePlanV2Contract";
import { decodeTripPaymentPlanV2 } from "@mingla/offering-rendering/tripPlanV2Contract";
import { tripPlanV2PublicSummary } from "@mingla/offering-rendering/TripPlanV2PublicSummary";
import type { TripOfferingTier } from "@mingla/offering-rendering/tripOfferingTypes";

import {
  TripPlanV2CheckoutChoice,
  tripPlanV2AvailabilityCopy,
} from "../../../../src/components/trip/TripPlanV2CheckoutChoice";
import { paidCheckoutErrorMessage } from "../../../../src/services/ticketCheckoutService";

type Rendered = {
  root: {
    findByProps: (props: Record<string, unknown>) => {
      props: Record<string, unknown>;
    };
  };
  toJSON: () => unknown;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports -- local types are absent; same runtime harness as the checkout contrast suite.
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Rendered;
  act: (work: () => void) => void;
};
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const mount = (element: React.ReactElement): Rendered => {
  let tree: Rendered | undefined;
  TestRenderer.act(() => {
    tree = TestRenderer.create(element);
  });
  return tree as Rendered;
};
const unmount = (tree: Rendered): void => {
  TestRenderer.act(() => tree.unmount());
};

const paymentRoute = readFileSync(join(__dirname, "..", "payment.tsx"), "utf8");
const publicHook = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "src",
    "hooks",
    "usePublicTripBySlug.ts",
  ),
  "utf8",
);
const componentSource = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "src",
    "components",
    "trip",
    "TripPlanV2CheckoutChoice.tsx",
  ),
  "utf8",
);
const ticketQuoteServiceSource = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "src",
    "services",
    "ticketQuoteService.ts",
  ),
  "utf8",
);
const cartSource = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "src",
    "components",
    "checkout",
    "CartContext.tsx",
  ),
  "utf8",
);
const sharedTripBody = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "packages",
    "offering-rendering",
    "TripOfferingBody.tsx",
  ),
  "utf8",
);

const RAW_PLAN = {
  availability: "plan",
  countOffered: 4,
  countGiven: 2,
  finalDueAt: "2027-05-01T13:00:00Z",
  installmentSchedule: {
    fullPriceCents: 100000,
    depositCents: 20000,
    currency: "usd",
    planVersion: 2,
    availability: "plan",
    countOffered: 4,
    countGiven: 2,
    finalDueAt: "2027-05-01T13:00:00Z",
    installments: [
      {
        ordinal: 2,
        pct: 40,
        amountCents: 40000,
        dueAt: "2027-05-01T13:00:00Z",
        addonPortionCents: 0,
        sourceTicketTypeId: "tier-a",
      },
      {
        ordinal: 1,
        pct: 40,
        amountCents: 40000,
        dueAt: "2027-03-01T14:00:00Z",
        addonPortionCents: 0,
        sourceTicketTypeId: "tier-a",
      },
    ],
  },
} as const;

describe("#4522 v2 quote truth", () => {
  test("decodes and orders the database schedule, but rejects contradictory truth", () => {
    const decoded = decodeTicketQuotePlanV2(RAW_PLAN);
    expect(decoded?.installmentSchedule?.currency).toBe("USD");
    expect(
      decoded?.installmentSchedule?.installments.map((row) => row.ordinal),
    ).toEqual([1, 2]);
    expect(
      decodeTicketQuotePlanV2({
        ...RAW_PLAN,
        countGiven: 3,
      }),
    ).toBeUndefined();
    expect(
      decodeTicketQuotePlanV2({
        ...RAW_PLAN,
        availability: "full_window",
      }),
    ).toBeUndefined();
    expect(
      decodeTicketQuotePlanV2({
        availability: "full_window",
        countOffered: 4,
        countGiven: 1,
        finalDueAt: null,
        installmentSchedule: null,
      }),
    ).toBeUndefined();
    expect(
      decodeTicketQuotePlanV2({
        ...RAW_PLAN,
        installmentSchedule: {
          ...RAW_PLAN.installmentSchedule,
          fullPriceCents: 100001,
        },
      }),
    ).toBeUndefined();
  });

  test("public package summary is concise, flex-aware, and has no dated rows", () => {
    const paymentPlanV2 = decodeTripPaymentPlanV2({
      v: 2,
      deposit: { mode: "percent", pct: 20 },
      count: 4,
      final_due_days_before_start: 30,
      flex: { enabled: true, min_payment_minor: 10000 },
    });
    expect(paymentPlanV2).not.toBeNull();
    expect(
      decodeTripPaymentPlanV2({
        v: 2,
        deposit: { mode: "percent", pct: 20 },
        count: 13,
        final_due_days_before_start: 30,
      }),
    ).toBeNull();
    const tier: TripOfferingTier = {
      id: "tier",
      ticketTypeId: "ticket",
      tierName: "Explorer",
      priceCents: 100000,
      currency: "USD",
      isFree: false,
      isUnlimited: true,
      ticketsRemaining: null,
      installmentSchedule: null,
      paymentPlanV2,
    };
    const summary = tripPlanV2PublicSummary(tier, true);
    expect(summary?.planLine).toMatch(
      /\$200.*today, then up to 4 payments · last one 30 days before departure/,
    );
    expect(summary?.flexLine).toBe("Pay any amount after your deposit");
    expect(summary?.depositPolicyLine).toBe("Deposit is non-refundable");
    expect(JSON.stringify(summary)).not.toMatch(/202\d-|dueAt|schedule/i);
    expect(sharedTripBody).toContain("<LazyTripPlanV2PublicSummary");
  });

  test("non-plan availability uses the approved full-pay explanations", () => {
    expect(tripPlanV2AvailabilityCopy("full_window", 5)).toBe(
      "You're booking within 5 days of departure, so the trip is paid in full today.",
    );
    expect(tripPlanV2AvailabilityCopy("full_only", 40)).toBe(
      "This booking date only allows paying in full.",
    );
  });
});

describe("#4522 v2 checkout choice", () => {
  test("renders loading truth and the approved disabled-CTA copy is wired", () => {
    const tree = mount(
      <TripPlanV2CheckoutChoice
        plan={undefined}
        value="full"
        onChange={() => undefined}
        currency="USD"
        dueTodayCents={undefined}
        fullPriceCents={undefined}
        flexEnabled={false}
        daysUntilDeparture={0}
        timeZone="UTC"
        loading
      />,
    );
    expect(JSON.stringify(tree.toJSON())).toContain(
      "Working out your payments…",
    );
    expect(paymentRoute).toContain('"Working out your payments…"');
    expect(paymentRoute).toContain('quoteStatus !== "ready"');
    unmount(tree);
  });

  test("selection renders the server rows and calls installments exactly once", () => {
    const onChange = jest.fn();
    const plan = decodeTicketQuotePlanV2(RAW_PLAN);
    expect(plan).toBeDefined();
    const tree = mount(
      <TripPlanV2CheckoutChoice
        plan={plan}
        value="installments"
        onChange={onChange}
        currency="USD"
        dueTodayCents={22000}
        fullPriceCents={110000}
        flexEnabled
        daysUntilDeparture={90}
        timeZone="America/New_York"
      />,
    );
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("Pay $220.00 today, then 2 payments");
    expect(text).toContain("Mon 1 Mar");
    expect(text).toContain(
      "You booked closer to the trip, so your plan has fewer payments.",
    );
    expect(text).toContain("You can pay more at any time from My trip.");
    expect(text).toContain("We’ll remind you before each payment.");
    const choice = tree.root.findByProps({
      testID: "trip-plan-v2-checkout-choice-installments",
    });
    TestRenderer.act(() => (choice.props.onPress as () => void)());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("installments");
    unmount(tree);
  });

  test("the screen updates quote scalar and every eligible create line", () => {
    const start = paymentRoute.indexOf("const setV2PaymentChoice");
    const end = paymentRoute.indexOf("// ORCH-0880", start);
    expect(start).toBeGreaterThanOrEqual(0);
    const window = paymentRoute.slice(start, end);
    expect(window).toContain("setPaymentPlanChoice(choice)");
    expect(window).toContain(
      "setLinePaymentPlanChoice(line.ticketTypeId, choice)",
    );
    expect(paymentRoute).toContain("plan={quote?.paymentPlanV2}");
    expect(paymentRoute).toContain("<BuyerConnectionNotice");
    expect(ticketQuoteServiceSource).toContain(
      "@mingla/offering-rendering/ticketQuotePlanV2Contract",
    );
    expect(ticketQuoteServiceSource).toContain(
      "decodeTicketQuotePlanV2(quote.paymentPlanV2)",
    );
    const reducerStart = cartSource.indexOf('case "SET_PAYMENT_PLAN_CHOICE"');
    const reducerEnd = cartSource.indexOf(
      'case "SET_EVENT_DATE_ID"',
      reducerStart,
    );
    const reducerWindow = cartSource.slice(reducerStart, reducerEnd);
    expect(reducerWindow.match(/quoteStatus:/g)).toHaveLength(2);
    expect(reducerWindow.match(/quote:\s*null/g)).toHaveLength(2);
  });
});

describe("#4522 rollback and refusal guards", () => {
  test("buyer v2 remains dark unless tripPlanV2 is bundled on", () => {
    expect(publicHook).toContain("featureFlags.tripPlanV2");
    expect(paymentRoute).toContain("!featureFlags.tripPlanV2");
  });

  test("the checkout part has no client schedule calculator", () => {
    expect(componentSource).not.toContain("computeTripPlanV2Schedule");
    expect(componentSource).not.toContain("projectInstallmentSchedule");
    expect(componentSource).toContain("plan.installmentSchedule");
  });

  test("legacy past-due conflict tells the buyer to choose full before generic 409 copy", () => {
    expect(
      paidCheckoutErrorMessage({
        code: "installment_schedule_past_due_at_booking",
        context: { status: 409 },
      }),
    ).toBe("This plan's first payment date has passed. Choose Pay in full.");
  });
});
