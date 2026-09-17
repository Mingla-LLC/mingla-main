/** #3396 implementor rework: real smart input and form lifecycle, no network.
 * Runs in the required mingla-business jest full-suite workflow (stock config).
 * Native popup chrome is mocked; PhoneInput, parser, hook and forms are real.
 */
import React from "react";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mockVenueCountry: string | null = null;
const mockJoin = jest.fn(async (_input: unknown) => ({ status: "joined" }));
jest.mock("react-native", () => ({
  ...jest.requireActual<Record<string, unknown>>("react-native"),
  AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(true), addEventListener: () => ({ remove: () => undefined }) },
}));
jest.mock("../../../hooks/useVenueListings", () => ({ useVenueListing: () => ({ data: mockVenueCountry ? { countryCode: mockVenueCountry } : null }) }));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => ({ countryCode: "US" }) }));
jest.mock("../../../hooks/useVenueAvailability", () => ({ useAvailableSlots: () => ({ data: [{ slotStartUtc: "2026-09-20T18:00:00.000Z", slotLocalLabel: "6 PM", isFull: false }] }) }));
jest.mock("../../../hooks/useVenueTables", () => ({ useVenueTables: () => ({ data: [] }) }));
jest.mock("../../../hooks/useJoinWaitlistMutation", () => ({ useJoinWaitlistMutation: () => ({ isPending: false, mutateAsync: mockJoin }) }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Sheet", () => ({ Sheet: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../../wrappers/SmartScrollView", () => ({ ScrollView: require("react-native").ScrollView }));
jest.mock("react-native-keyboard-controller", () => ({ KeyboardProvider: ({ children }: { children: React.ReactNode }) => children, KeyboardToolbar: () => null }));
jest.mock("../../../../../packages/phone-input/CountryPickerModal", () => ({ CountryPickerModal: () => null, CountryPickerOverlay: () => null }));
jest.mock("../../ui/Input", () => ({ Input: (props: Record<string, unknown>) => require("react").createElement("Input", props) }));
jest.mock("../../ui/Button", () => ({ Button: (props: Record<string, unknown>) => require("react").createElement("Button", props) }));

import { PhoneField, phoneFieldError, usePhoneEntry, type PhoneEntry } from "../../ui/PhoneField";
import { ReservationCreateSheet } from "../ReservationCreateSheet";
import { WaitlistAddSheet } from "../WaitlistAddSheet";
import { JoinWaitlistSheet } from "../../waitlist/JoinWaitlistSheet";

interface Node { type: unknown; props: Record<string, unknown>; findAll: (predicate: (node: Node) => boolean) => Node[] }
interface Tree { root: Node; update: (element: React.ReactElement) => void; unmount: () => void }
const renderer = require("react-test-renderer") as { create: (element: React.ReactElement) => Tree; act: (callback: () => Promise<void> | void) => Promise<void> };
const mounted: Tree[] = [];
let entry: PhoneEntry;
const Probe = ({ country = "US" }: { country?: string }) => {
  entry = usePhoneEntry({ startCountries: [country] });
  return <PhoneField entry={entry} accessibilityLabel="Phone" />;
};
async function mount(element: React.ReactElement): Promise<Tree> {
  let tree!: Tree;
  await renderer.act(async () => { tree = renderer.create(element); });
  mounted.push(tree);
  return tree;
}
function find(tree: Tree, predicate: (node: Node) => boolean): Node {
  const node = tree.root.findAll(predicate)[0];
  if (!node) throw new Error("Expected mounted control");
  return node;
}
const phone = (tree: Tree) => find(tree, (n) => n.type === "TextInput" && n.props.keyboardType === "phone-pad");
const field = (tree: Tree) => find(tree, (n) => n.type === PhoneField).props.entry as PhoneEntry;
const id = (tree: Tree, testID: string) => find(tree, (n) => n.props.testID === testID);
const label = (tree: Tree, value: string) => find(tree, (n) => n.type === "TextInput" && n.props.accessibilityLabel === value);
async function type(node: Node, value: string): Promise<void> {
  await renderer.act(async () => (node.props.onChangeText as (value: string) => void)(value));
}
async function press(node: Node): Promise<void> {
  await renderer.act(async () => { await (node.props.onPress as () => void | Promise<void>)(); });
}
beforeEach(() => { mockVenueCountry = null; mockJoin.mockClear(); });
afterEach(async () => { await renderer.act(async () => mounted.splice(0).forEach((tree) => tree.unmount())); });

test.each([
  ["+234abc8031234567", "+234 (0) 803-123-4567", "NG", "+2348031234567"],
  ["00234abc8031234567", "00 234 803 123 4567", "NG", "+2348031234567"],
  ["415abc5550123", "(415) 555-0123", "US", "+14155550123"],
  ["4155550123 ext 4", "+44 7700 900123", "GB", "+447700900123"],
])("keeps malformed %s visible, then recovers with a valid formatted paste", async (bad, good, country, recipient) => {
  const tree = await mount(<Probe />);
  await type(phone(tree), bad);
  expect(entry.text).toBe(bad);
  expect(entry.e164).toBeNull();
  expect(entry.countryIso).toBe("US");
  await renderer.act(async () => entry.markTouched());
  expect(phoneFieldError(entry, { required: false })).toContain("only digits");
  await type(phone(tree), good);
  expect(entry.countryIso).toBe(country);
  expect(entry.e164).toBe(recipient);
  expect(phoneFieldError(entry, { required: false })).toBeNull();
});

test("letters are invalid in an optional phone, but deleting them restores the empty optional state", async () => {
  const tree = await mount(<Probe />);
  await type(phone(tree), "abc");
  await renderer.act(async () => entry.markTouched());
  expect(entry.isEmpty).toBe(false);
  expect(entry.e164).toBeNull();
  expect(phoneFieldError(entry, { required: false })).toContain("only digits");
  await type(phone(tree), "");
  expect(entry.isEmpty).toBe(true);
  expect(phoneFieldError(entry, { required: false })).toBeNull();
});

test("late defaults keep a stable reset and preserve a manually chosen empty country; explicit reset uses the latest default", async () => {
  const tree = await mount(<Probe />);
  const reset = entry.reset;
  await renderer.act(async () => entry.setCountryIso("GB"));
  await renderer.act(async () => tree.update(<Probe country="NG" />));
  expect(entry.reset).toBe(reset);
  expect(entry.countryIso).toBe("GB");
  await renderer.act(async () => reset());
  expect(entry.countryIso).toBe("NG");
  expect(entry.text).toBe("");
  await renderer.act(async () => tree.update(<Probe country="US" />));
  expect(entry.countryIso).toBe("US");
});

test.each(["reservation", "waitlist"] as const)("%s preserves the entire in-progress form when the venue country arrives, and resets on reopen", async (kind) => {
  const save = jest.fn((_input: unknown) => undefined);
  const render = (visible = true, venueId = "venue-first") => kind === "reservation"
    ? <ReservationCreateSheet visible={visible} onClose={() => undefined} brandId="brand" venueId={venueId} onSave={save} saving={false} />
    : <WaitlistAddSheet visible={visible} onClose={() => undefined} venueId={venueId} onSave={save} saving={false} />;
  const tree = await mount(render());
  await type(id(tree, `${kind}-guest-name`), "Ada Example");
  await type(phone(tree), "4155550123");
  await press(id(tree, `${kind}-party-plus`));
  if (kind === "reservation") {
    await type(id(tree, "reservation-notes"), "Quiet table");
    await type(id(tree, "reservation-occasion"), "Birthday");
    await press(id(tree, "reservation-slot-2026-09-20T18:00:00.000Z"));
  } else {
    await type(id(tree, "waitlist-quoted-wait"), "20");
    await press(id(tree, "waitlist-zone-outdoor"));
  }
  mockVenueCountry = "NG";
  await renderer.act(async () => tree.update(render()));
  expect(id(tree, `${kind}-guest-name`).props.value).toBe("Ada Example");
  expect(field(tree).countryIso).toBe("US");
  expect(field(tree).e164).toBe("+14155550123");
  const saveId = kind === "reservation" ? "reservation-create-save" : "waitlist-add-save";
  expect(id(tree, saveId).props.disabled).toBe(false);
  await press(id(tree, saveId));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ guestName: "Ada Example", guestPhoneE164: "+14155550123", partySize: 3 }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining(kind === "reservation"
    ? { guestNotes: "Quiet table", occasion: "Birthday" }
    : { quotedWaitMinutes: 20, preferredZone: "outdoor" }));
  await renderer.act(async () => tree.update(render(false)));
  await renderer.act(async () => tree.update(render(true, "venue-second")));
  expect(id(tree, `${kind}-guest-name`).props.value).toBe("");
  expect(field(tree).text).toBe("");
  expect(field(tree).countryIso).toBe("NG");
  expect(id(tree, saveId).props.disabled).toBe(true);
});

test.each(["reservation", "waitlist"] as const)("%s seeds only the untouched phone on a late venue response", async (kind) => {
  const render = () => kind === "reservation"
    ? <ReservationCreateSheet visible onClose={() => undefined} brandId="brand" venueId="venue" onSave={() => undefined} saving={false} />
    : <WaitlistAddSheet visible onClose={() => undefined} venueId="venue" onSave={() => undefined} saving={false} />;
  const tree = await mount(render());
  await type(id(tree, `${kind}-guest-name`), "Name entered before query");
  mockVenueCountry = "NG";
  await renderer.act(async () => tree.update(render()));
  expect(id(tree, `${kind}-guest-name`).props.value).toBe("Name entered before query");
  expect(field(tree).countryIso).toBe("NG");
  expect(field(tree).text).toBe("");
});

test("sold-out event waitlist keeps typed contact, consent and quantity when currency arrives; a new ticket resets", async () => {
  const render = (currency: string | null, ticketId = "ticket-first") => <JoinWaitlistSheet visible eventId="event" ticket={{ id: ticketId, name: "Ticket" }} currency={currency} onClose={() => undefined} />;
  const tree = await mount(render("USD"));
  await type(label(tree, "Waitlist name"), "Ada Example");
  await type(label(tree, "Waitlist email"), "ada@example.invalid");
  await type(phone(tree), "4155550123");
  await press(find(tree, (n) => n.props.accessibilityLabel === "Increase waitlist quantity"));
  await press(find(tree, (n) => n.props.accessibilityLabel === "Consent to waitlist messages"));
  await renderer.act(async () => tree.update(render("NGN")));
  expect(label(tree, "Waitlist name").props.value).toBe("Ada Example");
  expect(field(tree).e164).toBe("+14155550123");
  const submit = () => find(tree, (n) => n.type === "Button" && n.props.accessibilityLabel === "Submit waitlist signup");
  expect(submit().props.disabled).toBe(false);
  await press(submit());
  expect(mockJoin).toHaveBeenCalledWith(expect.objectContaining({ name: "Ada Example", email: "ada@example.invalid", phone: "+14155550123", qtyRequested: 2, consent: true }));
  await renderer.act(async () => tree.update(render("NGN", "ticket-next")));
  expect(label(tree, "Waitlist name").props.value).toBe("");
  expect(field(tree).countryIso).toBe("NG");
  expect(field(tree).text).toBe("");
  expect(submit().props.disabled).toBe(true);
});
