import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));

import { WhoCoversCostsSection } from "../WhoCoversCostsSection";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  props: Record<string, unknown>;
  findByProps: (props: Record<string, unknown>) => TestInstance;
}
interface Renderer {
  root: TestInstance;
  toJSON: () => unknown;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};

const visibleStrings = (node: unknown, out: string[] = []): string[] => {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) {
    node.forEach((child) => visibleStrings(child, out));
  } else if (node !== null && typeof node === "object") {
    const host = node as {
      props?: Record<string, unknown>;
      children?: unknown;
    };
    if (typeof host.props?.accessibilityLabel === "string") {
      out.push(host.props.accessibilityLabel);
    }
    visibleStrings(host.children ?? null, out);
  }
  return out;
};

const render = async (passTax: boolean | null): Promise<Renderer> => {
  let tree!: Renderer;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <WhoCoversCostsSection
        format="event"
        overrides={{
          passTax,
          passMinglaFee: null,
          passServiceFee: null,
        }}
        defaults={{
          passTax: false,
          passMinglaFee: false,
          passServiceFee: false,
        }}
        onChange={() => undefined}
        previewBaseCents={190_000_000}
        currency="NGN"
        effectiveTakeRateBps={150}
        paymentProvider="paystack"
        paymentCountry="NG"
        vatRegistered={false}
        onSetupVat={() => undefined}
        onEditDefaults={() => undefined}
      />,
    );
  });
  return tree;
};

describe("#1318 Nigeria VAT and payout clarity", () => {
  test("shows the approved local VAT choice, exact no-VAT payout, and defaults edit", async () => {
    const tree = await render(null);
    const shown = visibleStrings(tree.toJSON());

    expect(shown).toEqual(
      expect.arrayContaining([
        "Add 7.5% VAT on top",
        "No VAT",
        "Mingla doesn’t file VAT for you.",
        "Buyer pays",
        "₦1,900,000.00",
        "You keep",
        "₦1,814,500.00",
        "Using your brand defaults",
        "Edit defaults →",
      ]),
    );
    expect(shown).not.toContain("Set up VAT");
    expect(shown.join(" ")).not.toMatch(
      /sale before VAT|Mingla 4\.5%|before VAT/i,
    );

    const buyer = tree.root.findByProps({
      testID: "who-covers-costs-buyer-pays",
    });
    const keep = tree.root.findByProps({
      testID: "who-covers-costs-you-keep",
    });
    expect(buyer.props).toEqual(
      expect.objectContaining({ numberOfLines: 1, adjustsFontSizeToFit: true }),
    );
    expect(keep.props).toEqual(
      expect.objectContaining({ numberOfLines: 1, adjustsFontSizeToFit: true }),
    );
    await TestRenderer.act(() => tree.unmount());
  });

  test("adds 7.5% to the buyer and leaves that passed VAT in what the host keeps", async () => {
    const tree = await render(true);
    const shown = visibleStrings(tree.toJSON());
    expect(shown).toEqual(
      expect.arrayContaining(["₦2,042,500.00", "₦1,957,000.00"]),
    );
    await TestRenderer.act(() => tree.unmount());
  });

  test("keeps an unregistered Stripe market on its existing setup path", async () => {
    let tree!: Renderer;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        <WhoCoversCostsSection
          format="trip"
          overrides={{
            passTax: null,
            passMinglaFee: null,
            passServiceFee: null,
          }}
          defaults={{
            passTax: false,
            passMinglaFee: false,
            passServiceFee: false,
          }}
          onChange={() => undefined}
          previewBaseCents={10_000}
          currency="GBP"
          effectiveTakeRateBps={150}
          paymentProvider="stripe"
          paymentCountry="GB"
          vatRegistered={false}
          onSetupVat={() => undefined}
        />,
      );
    });
    const shown = visibleStrings(tree.toJSON());
    expect(shown).toContain("Set up VAT");
    expect(shown).not.toContain("Add 7.5% VAT on top");
    await TestRenderer.act(() => tree.unmount());
  });
});
