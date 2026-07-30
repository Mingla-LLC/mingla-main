import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";

import { SourceRefundAttentionForm } from "../SourceRefundAttentionForm";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestNode {
  props: Record<string, unknown>;
}

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: {
      findByProps: (props: Record<string, unknown>) => TestNode;
      findAllByProps: (props: Record<string, unknown>) => TestNode[];
    };
    unmount: () => void;
  };
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
};

test("attention form executes one-shot bank-detail validation and submission", async () => {
  const onSubmit = jest.fn();
  let tree!: ReturnType<typeof TestRenderer.create>;

  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <SourceRefundAttentionForm
        submitting={false}
        banks={[{ id: "058", name: "Test Bank" }]}
        loadingBanks={false}
        onRetryBanks={jest.fn()}
        onSubmit={onSubmit}
      />,
    );
  });

  const account = () =>
    tree.root.findByProps({ accessibilityLabel: "Account number" });
  const bank = () =>
    tree.root.findAllByProps({ accessibilityRole: "radio" })[0];
  const button = () =>
    tree.root.findByProps({ accessibilityLabel: "Continue refund" });

  expect(button()?.props.disabled).toBe(true);

  await TestRenderer.act(async () => {
    (account()?.props.onChangeText as (value: string) => void)("0123456789");
    (bank()?.props.onPress as () => void)();
  });

  expect(button()?.props.disabled).toBe(false);
  await TestRenderer.act(async () => {
    (button()?.props.onPress as () => void)();
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith({
    accountNumber: "0123456789",
    bankId: "058",
  });

  await TestRenderer.act(async () => {
    tree.unmount();
  });
});

test("authorized guest manage surface shows parked-delivery support copy without granting attention authority", () => {
  const source = readFileSync(
    resolve(__dirname, "../../../../app/reserve/[brandId]/manage.tsx"),
    "utf8",
  );
  expect(source).toContain("We couldn&apos;t confirm your text was sent.");
  expect(source).toContain("Support and reference this refund:");
  expect(source).toContain("{refund.refund_id}");
  expect(source).toContain(
    "Reservation management links cannot submit bank details.",
  );
});

test("guest attention token stays fragment-only, is scrubbed immediately, and is passed in memory", () => {
  const source = readFileSync(
    resolve(__dirname, "../../../../app/refund/[refundId]/attention.tsx"),
    "utf8",
  );

  expect(source).toContain("window.location.hash");
  expect(source).toContain('fragment.get("attentionToken")');
  expect(source).toContain("window.history.replaceState");
  expect(source).toContain("...(attentionToken ? { attentionToken } : {})");
  expect(source).not.toMatch(/localStorage|sessionStorage/);
  expect(source).not.toMatch(
    /useLocalSearchParams<[^>]*attentionToken|params\.attentionToken/,
  );
});
