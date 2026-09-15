/** #3396 independent retest: real smart input through the reservation submit boundary. */
import React from "react";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockCreate = jest.fn(async (_input: unknown) => ({ kind: "free_completed", reservationId: "qa-local" }));
jest.mock("react-native", () => ({
  ...jest.requireActual<Record<string, unknown>>("react-native"),
  AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(true), addEventListener: () => ({ remove: () => undefined }) },
}));
jest.mock("../../../analytics/webAnalytics", () => ({ captureWeb: () => undefined, getStoredClickAttribution: () => ({ clickId: null }) }));
jest.mock("../../../hooks/usePublicVenueAvailability", () => ({ usePublicVenueAvailability: () => ({
  data: [{ slotStartUtc: "2026-09-20T19:00:00.000Z", slotLocalLabel: "8:00 PM", isFull: false }],
  isLoading: false, isFetching: false, isError: false, refetch: () => undefined,
}) }));
jest.mock("../../../services/venueGuestReservationService", () => ({ createGuestVenueReservation: (input: unknown) => mockCreate(input) }));
jest.mock("../../../services/venueOrganicCaptureService", () => ({ captureVenueOrganicEvent: () => Promise.resolve(), getVenueOrganicJourneyToken: () => null }));
jest.mock("../../../../../packages/phone-input/CountryPickerModal", () => ({ CountryPickerModal: () => null, CountryPickerOverlay: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Input", () => ({ Input: (props: Record<string, unknown>) => require("react").createElement("Input", props) }));
jest.mock("../../ui/Button", () => ({ Button: (props: Record<string, unknown>) => require("react").createElement("Button", props) }));

import { GuestVenueReservation } from "../GuestVenueReservation";
import { createThemePalette, resolveTheme } from "@mingla/offering-rendering";
interface Node { type: unknown; props: Record<string, unknown>; findAll: (predicate: (node: Node) => boolean) => Node[] }
interface Tree { root: Node; unmount: () => void }
const renderer = require("react-test-renderer") as { create: (element: React.ReactElement) => Tree; act: (callback: () => Promise<void> | void) => Promise<void> };
const mounted: Tree[] = [];
const palette = createThemePalette(resolveTheme(null, null));
function find(tree: Tree, predicate: (node: Node) => boolean): Node {
  const found = tree.root.findAll(predicate)[0];
  if (!found) throw new Error("Expected mounted reservation control");
  return found;
}
async function invoke(node: Node, prop: string, ...args: unknown[]): Promise<void> {
  await renderer.act(async () => { await (node.props[prop] as (...values: unknown[]) => unknown)(...args); });
}
beforeEach(() => mockCreate.mockClear());
afterEach(async () => { await renderer.act(async () => mounted.splice(0).forEach((tree) => tree.unmount())); });

test.each(["+234abc8031234567", "00234abc8031234567", "0803abc1234567"])("malformed %s never reaches booking transport, even when Confirm is invoked", async (malformed) => {
  let tree!: Tree;
  await renderer.act(async () => {
    tree = renderer.create(<GuestVenueReservation venueId="qa-venue" brandId="qa-brand" currency="NGN" countryCode="NG" analyticsSurface="buyer_web" palette={palette} />);
  });
  mounted.push(tree);
  await invoke(find(tree, (n) => n.props.accessibilityLabel === "Select 8:00 PM"), "onPress");
  await invoke(find(tree, (n) => n.props["aria-label"] === "Name, required"), "onChangeText", "QA No Submit");
  await invoke(find(tree, (n) => n.props["aria-label"] === "Email, required"), "onChangeText", "qa3396@example.invalid");
  const phone = () => find(tree, (n) => n.type === "TextInput" && n.props.keyboardType === "phone-pad");
  await invoke(phone(), "onChangeText", malformed);
  // The real browser intentionally leaves Confirm available to reveal validation.
  // This tests that actual handler, with the transport replaced by a local mock.
  await invoke(find(tree, (n) => n.props.label === "Confirm reservation"), "onPress");
  expect(mockCreate).not.toHaveBeenCalled();
  expect(phone().props.value).toBe(malformed);
  expect(tree.root.findAll((n) => typeof n.props.children === "string" && n.props.children.includes("only digits")).length).toBeGreaterThan(0);
  await invoke(phone(), "onChangeText", "+234 803 123 4567");
  await invoke(find(tree, (n) => n.props.label === "Confirm reservation"), "onPress");
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ buyer: expect.objectContaining({ phone: "+2348031234567", phoneCountryIso: "NG" }) }));
});
