import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

interface RenderNode {
  props: Record<string, unknown> & { testID?: string; children?: unknown };
  findAll: (
    predicate: (node: RenderNode) => boolean,
    options?: { deep: boolean },
  ) => RenderNode[];
}
interface RenderTree {
  root: RenderNode;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const act = TestRenderer.act as (callback: () => Promise<void>) => Promise<void>;

const mockInvoke = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) =>
        (mockInvoke as unknown as (...values: unknown[]) => unknown)(...args),
    },
  },
}));
jest.mock("../../components/ui/Icon", () => ({
  __esModule: true,
  Icon: () => null,
}));

import { DownloadMinglaCta } from "../../components/checkout/DownloadMinglaCta";
import { useAttendanceClaimArm } from "../useAttendanceClaimArm";

const unavailable503 = {
  context: {
    status: 503,
    clone: () => ({
      json: async () => ({ error: "claim_link_temporarily_unavailable" }),
    }),
  },
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue({ data: null, error: unavailable503 } as never);
});

describe("#2241 real 503 → service → hook → CTA", () => {
  test("configuration outage renders the actionable no-retry status", async () => {
    const Probe = (): React.ReactElement => {
      const arm = useAttendanceClaimArm(
        {
          checkoutSessionId: "checkout-session",
          buyerStatusToken: "buyer-possession-proof",
        },
        "event-id",
      );
      return (
        <DownloadMinglaCta
          eventName="Mingla Test Event"
          eventType="event"
          brandSlug="mingla"
          entitySlug="test-event"
          claimPhase={arm.phase}
          claimAppUrl={arm.link?.appClaimUrl ?? null}
          onRetryClaim={arm.retry}
        />
      );
    };

    let renderer: RenderTree | null = null;
    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const root = (renderer as unknown as RenderTree).root;
    const primary = root.findAll((node) =>
      node.props.testID === "confirm-app-cta-primary"
    );
    const retry = root.findAll((node) =>
      node.props.testID === "confirm-app-cta-retry"
    );
    const status = root.findAll((node) => node.props.role === "status");
    const text = root.findAll(() => true, { deep: true })
      .map((node) =>
        typeof node.props.children === "string" ? node.props.children : ""
      )
      .join(" ");

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(primary.length).toBeGreaterThan(0);
    expect(retry).toHaveLength(0);
    expect(status.length).toBeGreaterThan(0);
    expect(status[0]?.props.accessibilityLiveRegion).toBe("polite");
    expect(text).toContain(
      "Your tickets are confirmed. You can open the app and sign in with your checkout email or phone.",
    );
    await act(async () => {
      (renderer as unknown as RenderTree).unmount();
    });
  });
});
