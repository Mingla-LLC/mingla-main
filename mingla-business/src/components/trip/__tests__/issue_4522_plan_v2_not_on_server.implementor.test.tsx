/**
 * issue #4522 W-5 — the deploy window: Host web is live with the plan-v2
 * builder, the database is main's (no plan-v2 schema). Switching the payment
 * plan on used to put a v2 plan (and `settings.share_payment_plan`) on every
 * save, which main's RPC refuses (`trip_settings_patch_invalid`): every save
 * failed, the error read as a connection problem, and switching off did not
 * recover. Now the pricing step asks the shared probe and offers no new plan
 * until the server has plan v2, saying so.
 *
 * Driven for real: the hook runs the shared probe against a client that
 * answers like main's database (`42703 column order_installments.kind does
 * not exist`), and the real pricing step renders on it.
 *
 * Fails without the fix: the switch is enabled and a tap adds a v2 plan.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let schemaHasKind = false;
jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => ({
      select: () => ({
        limit: () =>
          Promise.resolve(
            schemaHasKind
              ? { data: [], error: null }
              : {
                  data: null,
                  error: { code: "42703", message: "column order_installments.kind does not exist" },
                },
          ),
      }),
    }),
  },
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }), { virtual: true });
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => null }));
jest.mock("../../../hooks/useBrandTaxRegistration", () => ({
  useBrandTaxRegistration: () => ({ data: null }),
}));
jest.mock("../../pricing/LazyWhoCoversCostsSection", () => ({ WhoCoversCostsSection: () => null }));
jest.mock("../../brand/PayoutCountryInlinePrompt", () => ({ PayoutCountryInlinePrompt: () => null }));
jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../PaymentPlanEditor", () => ({ PaymentPlanEditor: () => null }));

// eslint-disable-next-line import/first
import {
  TRIP_PLAN_V2_NOT_SWITCHED_ON_COPY,
  TripCreatorStep4Pricing,
  type Step4Draft,
} from "../TripCreatorStep4Pricing";
// eslint-disable-next-line import/first
import { resetPlanV2SchemaProbeForTests } from "@mingla/offering-rendering/planV2Schema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Node = {
  props: Record<string, unknown>;
  type: unknown;
  findAll: (predicate: (node: Node) => boolean) => Node[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { root: Node; toJSON: () => unknown; unmount: () => void };
  act: (work: () => void | Promise<void>) => Promise<void>;
};

const strings = (node: unknown, out: string[] = []): string[] => {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) node.forEach((child) => strings(child, out));
  else if (node !== null && typeof node === "object") strings((node as { children?: unknown }).children ?? null, out);
  return out;
};

const draft: Step4Draft = {
  currency: "USD",
  packages: [
    {
      key: "pkg-1",
      ticketTypeId: "tt-1",
      name: "Standard",
      priceMajor: "900",
      capacity: 10,
      description: "",
      paymentPlan: null,
      soldCount: 0,
    },
  ],
  pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
} as unknown as Step4Draft;

const renderStep = async (onChange: jest.Mock) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <TripCreatorStep4Pricing
          draft={draft}
          onChange={onChange}
          paymentPlansAvailable
          tripStartAt="2027-03-12T00:00:00Z"
          timeZone="America/New_York"
        />
      </QueryClientProvider>,
    );
  });
  // Let the probe answer.
  for (let i = 0; i < 5; i += 1) {
    await TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  const planSwitch = tree.root.findAll(
    (node) => node.props.accessibilityLabel === "Package 1 payment plan switch" && typeof node.props.onValueChange === "function",
  )[0]!;
  return { tree, planSwitch };
};

beforeEach(() => resetPlanV2SchemaProbeForTests());

describe("#4522 W-5 — no v2 plan until the server has plan v2", () => {
  test("main's database: the switch is off and disabled, the host is told, a tap adds nothing", async () => {
    schemaHasKind = false;
    const onChange = jest.fn();
    const { tree, planSwitch } = await renderStep(onChange);
    expect(strings(tree.toJSON())).toContain(TRIP_PLAN_V2_NOT_SWITCHED_ON_COPY);
    expect(planSwitch.props.disabled).toBe(true);
    await TestRenderer.act(async () => {
      (planSwitch.props.onValueChange as (next: boolean) => void)(true);
    });
    expect(onChange).not.toHaveBeenCalled();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("plan v2 on the server: the switch adds a v2 plan", async () => {
    schemaHasKind = true;
    const onChange = jest.fn();
    const { tree, planSwitch } = await renderStep(onChange);
    expect(strings(tree.toJSON())).not.toContain(TRIP_PLAN_V2_NOT_SWITCHED_ON_COPY);
    expect(planSwitch.props.disabled).toBe(false);
    await TestRenderer.act(async () => {
      (planSwitch.props.onValueChange as (next: boolean) => void)(true);
    });
    const patch = onChange.mock.calls[0]?.[0] as { packages: Array<{ paymentPlan: { v?: number } }> };
    expect(patch.packages[0]!.paymentPlan.v).toBe(2);
    await TestRenderer.act(async () => tree.unmount());
  });
});
