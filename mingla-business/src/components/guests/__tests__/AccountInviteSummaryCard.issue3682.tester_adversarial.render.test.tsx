import React from "react";

// #3682 tester — Constitution rule 3 (no silent failures): when the host's
// "Followers invited through Mingla" read fails, the card must say so and
// offer a retry. Before this fix it rendered nothing, which reads to the host
// as "nobody was invited through Mingla".
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer");
const { act } = TestRenderer;

jest.mock("../../../services/supabase", () => ({ supabase: { rpc: jest.fn() } }));
jest.mock("../../../hooks/useOfferingAccountInvites", () => ({
  useOfferingAccountInvites: jest.fn(),
}));
jest.mock("../../ui/Button", () => {
  const ReactModule = jest.requireActual("react");
  return { Button: (props: Record<string, unknown>) => ReactModule.createElement("button", props) };
});

import { AccountInviteSummaryCard } from "../AccountInviteSummaryCard";
import { useOfferingAccountInvites } from "../../../hooks/useOfferingAccountInvites";

const mockHook = useOfferingAccountInvites as jest.Mock;

const treeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(treeText).join(" ");
  if (value && typeof value === "object" && "children" in value) {
    return treeText((value as { children?: unknown }).children);
  }
  return "";
};

const render = () => {
  let renderer: any;
  act(() => { renderer = TestRenderer.create(<AccountInviteSummaryCard eventId="evt-1" />); });
  return renderer;
};

const okData = {
  counts: { invited: 1, reached: 1, pending: 0, notReached: 0 },
  recipients: [{ displayName: "Ada", avatarUrl: null, reason: "follower", push: "sent", email: "skipped" }],
};

describe("#3682 tester — account invite card never fails silently", () => {
  beforeEach(() => mockHook.mockReset());

  it("shows an error with a working retry when the read fails", () => {
    const refetch = jest.fn().mockResolvedValue(undefined);
    mockHook.mockReturnValue({ data: undefined, isError: true, isFetching: false, refetch });
    const renderer = render();
    expect(renderer.toJSON()).not.toBeNull();
    const text = treeText(renderer.toJSON());
    expect(text).toContain("Followers invited through Mingla");
    expect(text).toContain("We couldn't load who was invited through Mingla.");
    const [retry] = renderer.root.findAllByType("button");
    expect(retry.props.label).toBe("Try again");
    expect(retry.props.disabled).toBe(false);
    act(() => { retry.props.onPress(); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("disables the retry while a retry is in flight (no double fire)", () => {
    mockHook.mockReturnValue({ data: undefined, isError: true, isFetching: true, refetch: jest.fn() });
    const [retry] = render().root.findAllByType("button");
    expect(retry.props.disabled).toBe(true);
    expect(retry.props.label).toBe("Trying again…");
  });

  it("keeps showing loaded data when a background refetch fails", () => {
    mockHook.mockReturnValue({ data: okData, isError: true, isFetching: false, refetch: jest.fn() });
    const text = treeText(render().toJSON());
    expect(text).toContain("1 invited · 1 reached");
    expect(text).not.toContain("We couldn't load");
  });

  it("renders nothing while loading (not an error, not a fake empty state)", () => {
    mockHook.mockReturnValue({ data: undefined, isError: false, isFetching: true, refetch: jest.fn() });
    expect(render().toJSON()).toBeNull();
  });
});
