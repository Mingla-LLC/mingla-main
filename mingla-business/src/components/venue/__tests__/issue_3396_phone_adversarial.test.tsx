/** Independent tester #3396: actual shared input transformation and late-query races. */
import React from "react";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mockVenueCountry: string | null = null;
jest.mock("react-native", () => ({
  ...jest.requireActual<Record<string, unknown>>("react-native"),
  AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false), addEventListener: () => ({ remove: () => undefined }) },
}));
jest.mock("../../../hooks/useVenueListings", () => ({ useVenueListing: () => ({ data: mockVenueCountry ? { countryCode: mockVenueCountry } : null }) }));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => ({ countryCode: "US" }) }));
jest.mock("../../../hooks/useVenueAvailability", () => ({ useAvailableSlots: () => ({ data: [] }) }));
jest.mock("../../../hooks/useVenueTables", () => ({ useVenueTables: () => ({ data: [] }) }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Sheet", () => ({ Sheet: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("../../../wrappers/SmartScrollView", () => ({ ScrollView: require("react-native").ScrollView }));
jest.mock("react-native-keyboard-controller", () => ({ KeyboardProvider: ({ children }: { children: React.ReactNode }) => children, KeyboardToolbar: () => null }));
// The closed country popup is native chrome; the input, smart-edit handler,
// hook and strict parser remain real. No picker opening is claimed here.
jest.mock("../../../../../packages/phone-input/CountryPickerModal", () => ({ CountryPickerModal: () => null, CountryPickerOverlay: () => null }));
jest.mock("../../ui/Input", () => ({ Input: (props: Record<string, unknown>) => require("react").createElement("Input", props) }));
jest.mock("../../ui/Button", () => ({ Button: (props: Record<string, unknown>) => require("react").createElement("Button", props) }));

import { PhoneField, usePhoneEntry, type PhoneEntry } from "../../ui/PhoneField";
import { ReservationCreateSheet } from "../ReservationCreateSheet";
import { WaitlistAddSheet } from "../WaitlistAddSheet";

interface Node { type: unknown; props: Record<string, any>; findAll: (predicate: (node: Node) => boolean) => Node[] }
interface Tree { root: Node; update: (element: React.ReactElement) => void; unmount: () => void }
const renderer = require("react-test-renderer") as { create: (element: React.ReactElement) => Tree; act: (callback: () => Promise<void> | void) => Promise<void> };
const mounted: Tree[] = [];
let currentEntry: PhoneEntry;
const Probe = ({ countries = ["US"] }: { countries?: string[] }) => {
  currentEntry = usePhoneEntry({ startCountries: countries });
  return <PhoneField entry={currentEntry} accessibilityLabel="Phone" required />;
};
const mount = async (element: React.ReactElement): Promise<Tree> => {
  let tree!: Tree;
  await renderer.act(async () => { tree = renderer.create(element); });
  mounted.push(tree);
  return tree;
};
const input = (tree: Tree): Node => {
  const found = tree.root.findAll((node) => node.type === "TextInput" && node.props.keyboardType === "phone-pad")[0];
  if (!found) throw new Error("Real shared PhoneInput did not mount its native input");
  return found;
};
beforeEach(() => { mockVenueCountry = null; });
afterEach(async () => { await renderer.act(async () => mounted.splice(0).forEach((tree) => tree.unmount())); });

test.each(["+234abc8031234567", "00234abc8031234567", "415abc5550123"])("smart entry does not turn malformed %s into an accepted recipient", async (text) => {
  const tree = await mount(<Probe />);
  await renderer.act(async () => input(tree).props.onChangeText(text));
  expect(currentEntry.result.ok).toBe(false);
  expect(currentEntry.e164).toBeNull();
});

test("valid international paste switches country and yields the exact intended recipient", async () => {
  const tree = await mount(<Probe />);
  await renderer.act(async () => input(tree).props.onChangeText("+234 803 123 4567"));
  expect(currentEntry.countryIso).toBe("NG");
  expect(currentEntry.e164).toBe("+2348031234567");
});

test.each(["reservation", "waitlist"])("late venue country preserves the %s form already being typed", async (kind) => {
  const render = () => kind === "reservation"
    ? <ReservationCreateSheet visible onClose={() => undefined} brandId="brand-test" venueId="venue-test" onSave={() => undefined} saving={false} />
    : <WaitlistAddSheet visible onClose={() => undefined} venueId="venue-test" onSave={() => undefined} saving={false} />;
  const tree = await mount(render());
  const name = () => tree.root.findAll((node) => node.type === "Input" && node.props.placeholder === "Guest name")[0]!;
  await renderer.act(async () => { name().props.onChangeText("Test Guest"); input(tree).props.onChangeText("4155550123"); });
  expect(name().props.value).toBe("Test Guest");
  expect(input(tree).props.value).toContain("415");
  mockVenueCountry = "NG";
  await renderer.act(async () => tree.update(render()));
  expect(name().props.value).toBe("Test Guest");
  expect(input(tree).props.value).toContain("415");
});
