/*
 * #2829 W11 (design contract: "Connection drops — answers already confirmed
 * are saved; an unsent answer shows as unsent with Try again"): when "What
 * you'll offer" can't be saved, the owner's ticks stay on screen, the part is
 * not left, and the message says to try again; a refusal Core named is shown
 * in Core's words.
 */
import React from "react";

const mockBack = jest.fn();
const mockMutate = jest.fn();
let mockViewProps: Record<string, unknown> = {};
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack, replace: jest.fn(), canGoBack: () => true }) }));
jest.mock("../../SiteOfferingsView", () => ({
  SiteOfferingsView: (props: Record<string, unknown>) => { mockViewProps = props; return null; },
}));
jest.mock("../../../../components/ui/SafeScreen", () => ({ SafeScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("../../../../components/ui/TopBar", () => ({ TopBar: () => null }));
jest.mock("../../../../hooks/useFeatureFlag", () => ({ useFeatureFlag: () => ({ data: false }) }));
jest.mock("../../../../sites/planApi", () => ({
  useBrandSitePlan: () => ({
    isLoading: false, isError: false, isSuccess: true, error: null, refetch: jest.fn(),
    data: { canManage: true, plan: { revision: 4, offeringsSelected: ["trips"], venueDescriptor: null }, prefillOfferings: null, liveCounts: { trips: 0, events: 0, experiences: 0 } },
  }),
  useSaveBrandSitePlan: () => ({ mutate: mockMutate, isPending: false }),
}));

import { OfferingsPart } from "../OfferingsPart";
import { BrandSitesError } from "../../../../services/brandSitesService";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (run: () => void) => void;
  create: (node: React.ReactElement) => { unmount: () => void };
};

beforeEach(() => {
  mockBack.mockReset();
  mockMutate.mockReset();
});

describe("#2829 W11 an answer that didn't save", () => {
  it("keeps the ticks, stays on the part, and says Try again", () => {
    mockMutate.mockImplementation((_input: unknown, handlers: { onError: (error: unknown) => void }) => handlers.onError(new TypeError("Network request failed")));
    let tree!: { unmount: () => void };
    act(() => { tree = create(<OfferingsPart brandId="b" embedded />); });
    act(() => { (mockViewProps.onToggle as (key: string) => void)("events"); });
    act(() => { (mockViewProps.onContinue as () => void)(); });
    expect(mockMutate).toHaveBeenCalledWith({ revision: 4, patch: { offerings_selected: ["trips", "events"], venue_descriptor: null } }, expect.any(Object));
    expect(mockViewProps.notice).toEqual({ kind: "error", message: "Your answer didn't save. Try again." });
    expect([...(mockViewProps.selected as Set<string>)]).toEqual(["trips", "events"]);
    expect(mockBack).not.toHaveBeenCalled();
    // Try again sends the same answer.
    mockMutate.mockImplementation((_input: unknown, handlers: { onSuccess: () => void }) => handlers.onSuccess());
    act(() => { (mockViewProps.onContinue as () => void)(); });
    expect(mockMutate).toHaveBeenLastCalledWith({ revision: 4, patch: { offerings_selected: ["trips", "events"], venue_descriptor: null } }, expect.any(Object));
    expect(mockBack).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("a refusal Core named is shown in its own words", () => {
    mockMutate.mockImplementation((_input: unknown, handlers: { onError: (error: unknown) => void }) =>
      handlers.onError(new BrandSitesError("PLAN_LOCKED", "Someone else is working on your website right now.", false)));
    let tree!: { unmount: () => void };
    act(() => { tree = create(<OfferingsPart brandId="b" embedded />); });
    act(() => { (mockViewProps.onContinue as () => void)(); });
    expect(mockViewProps.notice).toEqual({ kind: "error", message: "Someone else is working on your website right now." });
    act(() => tree.unmount());
  });
});
