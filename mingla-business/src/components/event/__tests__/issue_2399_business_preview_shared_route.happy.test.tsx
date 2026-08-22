/* eslint-disable import/first, @typescript-eslint/no-require-imports */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import type { DraftEvent } from "../../../store/draftEventStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const draft = {
  id: "event-preview", brandId: "brand-1", serverSlug: "preview-event",
  name: "Preview event", description: "Buyer preview", format: "in_person",
  partyTypes: [], vibeTags: [], musicGenres: [], whenMode: "multi_date",
  date: null, doorsOpen: null, endsAt: null, endsAtUtc: null,
  timezone: "America/New_York", recurrenceRule: null,
  multiDates: [
    { id: "day-2", date: "2026-08-30", startTime: "13:00", endTime: "16:00", overrides: { title: null, description: null, venueName: null, address: null, onlineUrl: null } },
    { id: "day-1", date: "2026-08-29", startTime: "13:00", endTime: "16:00", overrides: { title: null, description: null, venueName: null, address: null, onlineUrl: null } },
  ],
  multiDatePricingMode: "per_day", venueName: "Venue", address: "Address",
  onlineUrl: null, city: "New York", locationGeo: null,
  hideAddressUntilTicket: false, coverHue: 25, coverMediaUrl: null,
  coverMediaType: null, coverMediaProvider: null, coverMediaSourceUrl: null,
  coverMediaCredit: null, coverMediaCreditUrl: null, coverMediaAlt: null,
  currency: "USD", tickets: [], visibility: "public", requireApproval: false,
  allowTransfers: true, hideRemainingCount: false, passwordProtected: false,
  privateGuestList: false, inPersonPaymentsEnabled: false,
  isRsvp: false, rsvpCapacity: null, rsvpAllowPlusOnes: false,
  rsvpPlusOnesMax: 0, rsvpWaitlistEnabled: false, rsvpApprovalMode: "auto",
  rsvpDiscoverable: true, rsvpContributionEnabled: false,
  rsvpContributionSuggestedCents: null, rsvpContributionMinCents: null,
  lastStepReached: 0, status: "draft",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
} as DraftEvent;

const router = {
  canGoBack: jest.fn(() => true), back: jest.fn(), replace: jest.fn(),
};

jest.mock("react-native", () => ({
  StyleSheet: { create: <T,>(value: T): T => value }, Text: "Text", View: "View",
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: draft.id }), useRouter: () => router,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    removeQueries: jest.fn(), setQueryData: jest.fn(), invalidateQueries: jest.fn(),
  }),
}));
jest.mock("../../../constants/designSystem", () => ({
  canvas: { discover: "#000" }, spacing: { md: 16, lg: 24 },
  text: { secondary: "#ccc" }, typography: { bodySm: { fontSize: 14 } },
}));
jest.mock("../../ui/Spinner", () => ({ Spinner: () => React.createElement("SpinnerProbe") }));
jest.mock("../../ui/Toast", () => ({
  Toast: (props: Record<string, unknown>) => React.createElement("ToastProbe", props),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useBrandList: () => [{ id: "brand-1", slug: "brand", displayName: "Brand", defaultCurrency: "USD", photo: null, theme: null }],
}));
jest.mock("../../../store/draftEventStore", () => ({
  useDraftById: () => draft,
  useDraftEventStore: (selector: (state: { deleteDraft: () => void }) => unknown) => selector({ deleteDraft: jest.fn() }),
}));
jest.mock("../../../hooks/useServerDraftEvents", () => ({
  eventDraftKeys: { detail: (id: string) => ["draft", id], list: (id: string) => ["drafts", id] },
  useServerDraftById: () => ({ data: draft, isLoading: false, isFetching: false, isError: false }),
}));
jest.mock("../../../utils/draftPromotion", () => ({ promoteLegacyDraftOnce: jest.fn() }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));
jest.mock("../../../utils/authReadiness", () => ({ isBusinessAuthNotReadyError: () => false }));
jest.mock("../DraftEventFoundationPreview", () => ({
  DraftEventFoundationPreview: (props: Record<string, unknown>) => React.createElement("FoundationPreviewProbe", props),
}));

import EventPreviewRoute from "../../../../app/event/[id]/preview";
import { draftEventBuyerPreview } from "../../../utils/draftEventBuyerPreview";
import { retryCanonicalDayTruth } from "../../../utils/publicEventDayRecovery";

// The repo intentionally carries no react-test-renderer declarations.
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
  create: (node: React.ReactElement) => {
    root: { findByType: (type: string) => { props: Record<string, unknown> } };
    unmount: () => void;
  };
};

describe("issue #2399 Business preview buyer-tree parity", () => {
  test("the real production preview route mounts the Foundation preview with chronological draft truth", () => {
    let rendered: ReturnType<typeof TestRenderer.create> | undefined;
    TestRenderer.act(() => { rendered = TestRenderer.create(<EventPreviewRoute />); });
    const buyerPage = rendered?.root.findByType("FoundationPreviewProbe");
    expect(buyerPage).toBeDefined();
    expect((buyerPage?.props.occurrences as { id: string }[]).map((row) => row.id)).toEqual(["day-1", "day-2"]);
    expect(buyerPage?.props.multiDatePricingMode).toBe("per_day");
    expect(buyerPage?.props).toEqual(expect.objectContaining({
      onClose: expect.any(Function), onShare: expect.any(Function),
      onCheckout: expect.any(Function), onBlocked: expect.any(Function),
    }));
    expect(() => rendered?.root.findByType("PreviewEventView")).toThrow();
    TestRenderer.act(() => { rendered?.unmount(); });
  });

  test("preview actions remain local: back is preserved and checkout/share only explain preview state", () => {
    router.back.mockClear();
    let rendered: ReturnType<typeof TestRenderer.create> | undefined;
    TestRenderer.act(() => { rendered = TestRenderer.create(<EventPreviewRoute />); });
    const actions = rendered?.root.findByType("FoundationPreviewProbe").props as {
      onClose: () => void; onShare: () => void; onCheckout: () => void;
    };
    TestRenderer.act(actions.onClose);
    expect(router.back).toHaveBeenCalledTimes(1);
    TestRenderer.act(actions.onShare);
    expect(rendered?.root.findByType("ToastProbe").props.message).toBe("Preview links are available after publishing.");
    TestRenderer.act(actions.onCheckout);
    expect(rendered?.root.findByType("ToastProbe").props.message).toBe("Checkout is available after publishing.");
    TestRenderer.act(() => { rendered?.unmount(); });
  });

  test("the pure adapter does not publish and keeps the draft identity", () => {
    const preview = draftEventBuyerPreview(draft, null);
    expect(preview.event.id).toBe(draft.id);
    expect(preview.event.status).toBe("published");
    expect(preview.occurrences.map((row) => row.id)).toEqual(["day-1", "day-2"]);
  });

  test("stale truth stays fenced while refresh is pending or fails, and clears only on success", async () => {
    let resolveRefresh: ((value: boolean) => void) | undefined;
    const refresh = jest.fn(() => new Promise<boolean>((resolve) => { resolveRefresh = resolve; }));
    const clearFence = jest.fn();
    const reportFailure = jest.fn();
    const pending = retryCanonicalDayTruth(refresh, clearFence, reportFailure);
    expect(clearFence).not.toHaveBeenCalled();
    resolveRefresh?.(false);
    await expect(pending).resolves.toBe(false);
    expect(clearFence).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledTimes(1);

    await expect(retryCanonicalDayTruth(
      () => Promise.reject(new Error("offline")), clearFence, reportFailure,
    )).resolves.toBe(false);
    expect(reportFailure).toHaveBeenCalledTimes(2);
    expect(clearFence).not.toHaveBeenCalled();

    await expect(retryCanonicalDayTruth(
      () => Promise.resolve(true), clearFence, reportFailure,
    )).resolves.toBe(true);
    expect(clearFence).toHaveBeenCalledTimes(1);
  });
});
