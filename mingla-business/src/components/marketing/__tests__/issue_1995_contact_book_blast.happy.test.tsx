import React, { useState } from "react";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../ui/Sheet", () => ({
  Sheet: ({
    visible,
    children,
  }: React.PropsWithChildren<{ visible: boolean }>): React.ReactNode =>
    visible ? children : null,
}));
jest.mock("../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import { supabase } from "../../../services/supabase";
import {
  confirmMarketingBook,
  MarketingBookSendError,
  previewMarketingBook,
  sendNow,
} from "../../../services/marketing/marketingCampaignService";
import {
  getBookBlastDisabledReason,
  isBookBlastFeatureReady,
} from "../../../hooks/marketing/useBookBlastPreview";
import { ComposerReviewSheet } from "../ComposerReviewSheet";
import type { MarketingBookQuote } from "../../../types/marketing";

const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => RenderedTree;
  act: (callback: () => void) => void;
};
interface RenderedNode {
  props: Record<string, unknown> & { onPress?: () => void };
  findAll: (predicate: (node: RenderedNode) => boolean) => RenderedNode[];
}
interface RenderedTree {
  root: RenderedNode;
  update: (node: React.ReactElement) => void;
  toJSON: () => unknown;
}

const quote: MarketingBookQuote = {
  quoteVersion: 1,
  quoteHash: "a".repeat(64),
  quotedAt: "2026-08-13T12:00:00.000Z",
  expiresAt: "2026-08-13T12:05:00.000Z",
  selectedCount: 2,
  reachableCount: 1,
  suppressedCount: 1,
  unavailableCount: 0,
  smsSegments: 0,
  costKind: "not_metered",
  estimatedCostMinor: null,
  currency: null,
};

function pressByLabel(tree: RenderedTree, label: string): void {
  const match = tree.root.findAll(
    (node) => node.props.accessibilityLabel === label,
  )[0];
  if (match?.props.onPress === undefined) throw new Error(`missing:${label}`);
  TestRenderer.act(() => match.props.onPress?.());
}

function reviewProps(
  overrides: Partial<React.ComponentProps<typeof ComposerReviewSheet>> = {},
) {
  return {
    visible: true,
    audienceName: "Your Book",
    recipientCount: 1,
    subject: "Hello",
    scheduledLabel: "Now",
    isSendNow: true,
    submitting: false,
    onBack: jest.fn(),
    onClose: jest.fn(),
    onConfirm: jest.fn(),
    selectedCount: 2,
    suppressedCount: 1,
    unavailableCount: 0,
    estimatedCostLabel: "Provider cost not metered",
    quoteExpiresAt: quote.expiresAt,
    ...overrides,
  };
}

describe("#1995 rendered Book review behavior", () => {
  it("blocks offline, retries visibly, then enables after reconnect", () => {
    const retry = jest.fn();
    let tree!: RenderedTree;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <ComposerReviewSheet
          {...reviewProps({
            disabledReason:
              "You're offline. Reconnect to refresh this preview.",
            onRetryPreview: retry,
            retryDisabled: true,
          })}
        />,
      );
    });
    const send = tree.root.findAll(
      (node) => node.props.accessibilityLabel === "Send now",
    )[0];
    expect(send?.props.accessibilityState).toEqual({ disabled: true });
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Refresh preview",
      )[0]?.props.accessibilityState,
    ).toEqual({ disabled: true });
    TestRenderer.act(() => {
      tree.update(
        <ComposerReviewSheet
          {...reviewProps({
            disabledReason: "The server preview is unavailable.",
            onRetryPreview: retry,
            retryDisabled: false,
          })}
        />,
      );
    });
    pressByLabel(tree, "Refresh preview");
    expect(retry).toHaveBeenCalledTimes(1);
    TestRenderer.act(() => {
      tree.update(
        <ComposerReviewSheet {...reviewProps({ disabledReason: null })} />,
      );
    });
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Send now",
      )[0]?.props.accessibilityState,
    ).toEqual({ disabled: false });
  });

  it("expires from the live clock and keeps refresh recovery available", () => {
    expect(
      getBookBlastDisabledReason({
        featureReady: true,
        online: true,
        previewPending: false,
        previewError: null,
        quote,
        nowMs: Date.parse("2026-08-13T12:04:59.999Z"),
      }),
    ).toBeNull();
    expect(
      getBookBlastDisabledReason({
        featureReady: true,
        online: true,
        previewPending: false,
        previewError: null,
        quote,
        nowMs: Date.parse("2026-08-13T12:05:00.000Z"),
      }),
    ).toBe("This preview expired. Refresh it before confirming.");
  });

  it("renders stale old-to-new facts and needs a second press", () => {
    let confirmed = false;
    function Harness(): React.ReactElement {
      const [stale, setStale] = useState(false);
      return (
        <ComposerReviewSheet
          {...reviewProps({
            recipientCount: stale ? 8 : 9,
            staleWarning: stale,
            staleDetail: stale
              ? "Reach changed from 9 to 8; cost changed from 315 to 280."
              : undefined,
            onConfirm: () => {
              if (!stale) setStale(true);
              else confirmed = true;
            },
          })}
        />
      );
    }
    let tree!: RenderedTree;
    TestRenderer.act(() => {
      tree = TestRenderer.create(<Harness />);
    });
    pressByLabel(tree, "Send now");
    expect(confirmed).toBe(false);
    const alert = tree.root.findAll(
      (node) => node.props.accessibilityLiveRegion === "assertive",
    )[0];
    expect(alert).toBeDefined();
    pressByLabel(tree, "Confirm updated send");
    expect(confirmed).toBe(true);
  });
});

test("feature flags fail closed while cached true values refetch", () => {
  const ready = {
    data: true,
    isFetched: true,
    isPending: false,
    isFetching: false,
    isError: false,
  };
  expect(isBookBlastFeatureReady(ready, ready)).toBe(true);
  expect(isBookBlastFeatureReady({ ...ready, isFetching: true }, ready)).toBe(
    false,
  );
  expect(isBookBlastFeatureReady({ ...ready, isFetched: false }, ready)).toBe(
    false,
  );
});

test("Book Functions errors are parsed while legacy sendNow remains raw", async () => {
  const raw = new Error("FunctionsHttpError") as Error & {
    context: { json: () => Promise<unknown> };
  };
  raw.context = {
    json: async () => ({
      error: "BOOK_BLAST_PREVIEW_STALE",
      preview: { ...quote, reachableCount: 2 },
    }),
  };
  (supabase.functions.invoke as jest.Mock).mockResolvedValue({ error: raw });
  await expect(previewMarketingBook("campaign")).rejects.toMatchObject({
    name: "MarketingBookSendError",
    code: "BOOK_BLAST_PREVIEW_STALE",
  });
  await expect(
    confirmMarketingBook({
      campaign_id: "campaign",
      client_request_id: "request",
      quote,
      scheduled_for: null,
    }),
  ).rejects.toMatchObject({
    name: "MarketingBookSendError",
    code: "BOOK_BLAST_PREVIEW_STALE",
    refreshedPreview: { ...quote, reachableCount: 2 },
  } satisfies Partial<MarketingBookSendError>);
  await expect(sendNow("00000000-0000-4000-8000-000000000000")).rejects.toBe(
    raw,
  );
});
