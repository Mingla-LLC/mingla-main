/**
 * issue #3380 — every Business and venue-web phone field uses the country
 * picker, starts on the venue's or brand's country, and never saves a number
 * under the wrong country.
 *
 * Seth, 2026-09-15: "in some forms or ordering, the country code is not
 * present, free form text input which does not make sense."
 *
 * FAILS ON REVERT:
 *   - guest reservation: remove `countryCode` from GuestVenueReservation and
 *     the Lagos venue opens on the visitor's region; restore the composeE164-
 *     only check and 0803… on +44 is submitted as +448031234567.
 *   - ordering: remove `renderPhoneField` from the review pane and the plain
 *     "Phone, with country code" box comes back; drop `phoneCountryIso` from the
 *     wire and the server never learns the country.
 *   - waiter / host sheets: restore the free-text Input and the source checks fail.
 *   - #2721: restore `patch: (p) => set(p)` and a Lagos draft keeps no phone country.
 *   - checkout / RSVP: restore locale-first and a naira event opens on +1 here.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockCreateReservation = jest.fn((_input: unknown) =>
  Promise.resolve({ kind: "free_completed" as const, reservationId: "r-3380" }),
);

jest.mock("../../../analytics/webAnalytics", () => ({
  __esModule: true,
  captureWeb: () => undefined,
  getStoredClickAttribution: () => ({ clickId: null }),
}));

jest.mock("../../../hooks/usePublicVenueAvailability", () => ({
  __esModule: true,
  usePublicVenueAvailability: () => ({
    data: [
      {
        slotStartUtc: "2026-09-20T19:00:00.000Z",
        slotLocalLabel: "8:00 PM",
        isFull: false,
      },
    ],
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: () => undefined,
  }),
}));

jest.mock("../../../services/venueGuestReservationService", () => ({
  __esModule: true,
  createGuestVenueReservation: (input: unknown) => mockCreateReservation(input),
}));

jest.mock("../../../services/venueOrganicCaptureService", () => ({
  __esModule: true,
  captureVenueOrganicEvent: () => Promise.resolve(),
  getVenueOrganicJourneyToken: () => null,
}));

// The picker is a host element so its props can be read; the COUNTRY DIRECTORY
// and the number rules stay real.
jest.mock("@mingla/phone-input", () => {
  const ReactActual = require("react") as typeof React;
  const countries = jest.requireActual(
    "../../../../../packages/phone-input/countries",
  ) as Record<string, unknown>;
  return {
    __esModule: true,
    ...countries,
    PhoneInput: (props: Record<string, unknown>) =>
      ReactActual.createElement("PhoneInput", props),
  };
});

jest.mock("../../ui/Button", () => ({
  __esModule: true,
  Button: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof React;
    return ReactActual.createElement("Button", props);
  },
}));
jest.mock("../../ui/Input", () => ({
  __esModule: true,
  Input: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof React;
    return ReactActual.createElement("Input", props);
  },
}));
jest.mock("../../ui/Icon", () => ({ __esModule: true, Icon: () => null }));

import { createThemePalette, resolveTheme } from "@mingla/offering-rendering";
import { GuestVenueReservation } from "../GuestVenueReservation";
import { seedContactPhoneCountry } from "../../../store/draftVenueStore";
import { phoneStartCountryForCurrency } from "../../../utils/phoneStartCountryForCurrency";
import { resolvePrimaryRsvpPhoneCountry } from "../../event/useBusinessRsvpPhoneField";
import { phoneFieldError } from "../../ui/PhoneField";
import {
  countryFromInternationalEntry,
  cursorAfterEdit,
} from "@mingla/phone-input/phoneEntryText";
import { parsePhoneEntry } from "@mingla/phone-input/phoneNumber";
import { venueOrderCreateBody } from "../../../../../packages/brand-rendering/venueOrdering/venueOrderingWire";
import { VenueOrderReviewPane } from "../../../../../packages/brand-rendering/venueOrdering/VenueOrderReviewPane";
import type { VenueOrderPhoneFieldArgs } from "../../../../../packages/brand-rendering/venueOrdering/venueOrderingTypes";

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Tree {
  root: Node;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const PALETTE = createThemePalette(resolveTheme(null, null));
const repo = join(__dirname, "..", "..", "..", "..", "..");
const read = (relative: string): string => readFileSync(join(repo, relative), "utf8");

const byProp = (tree: Tree, prop: string, value: unknown): Node =>
  tree.root.findAll((node) => node.props[prop] === value)[0] as Node;
const phoneInput = (tree: Tree): Node =>
  tree.root.findAll((node) => node.type === "PhoneInput")[0] as Node;
const texts = (tree: Tree): string[] =>
  tree.root
    .findAll((node) => typeof node.type === "string" && typeof node.props.children === "string")
    .map((node) => String(node.props.children));
const call = (node: Node, prop: string, ...args: unknown[]): void => {
  const fn = node.props[prop];
  if (typeof fn !== "function") throw new Error(`missing ${prop}`);
  (fn as (...a: unknown[]) => void)(...args);
};

const renderReservation = async (countryCode: string | null): Promise<Tree> => {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <GuestVenueReservation
        venueId="venue-3380"
        brandId="brand-3380"
        currency="NGN"
        countryCode={countryCode}
        analyticsSurface="buyer_web"
        palette={PALETTE}
      />,
    );
  });
  await TestRenderer.act(async () => {
    call(byProp(tree, "accessibilityLabel", "Select 8:00 PM"), "onPress");
  });
  await TestRenderer.act(async () => {
    call(byProp(tree, "aria-label", "Name, required"), "onChangeText", "Ada Obi");
    call(byProp(tree, "aria-label", "Email, required"), "onChangeText", "ada@example.com");
  });
  return tree;
};

const confirm = async (tree: Tree): Promise<void> => {
  await TestRenderer.act(async () => {
    call(byProp(tree, "label", "Confirm reservation"), "onPress");
    await Promise.resolve();
  });
};

describe("#3380 guest table reservation on a venue page", () => {
  beforeEach(() => {
    mockCreateReservation.mockClear();
  });

  test("a Lagos venue's picker starts on +234, and 0803 123 4567 books as +2348031234567", async () => {
    const tree = await renderReservation("NG");
    expect(phoneInput(tree).props.countryCode).toBe("NG");
    expect(phoneInput(tree).props.smartEntry).toBe(true);
    await TestRenderer.act(async () => {
      call(phoneInput(tree), "onChangePhone", "0803 123 4567");
    });
    await confirm(tree);
    expect(mockCreateReservation).toHaveBeenCalledTimes(1);
    const input = mockCreateReservation.mock.calls[0]?.[0] as {
      buyer: { phone: string; phoneCountryIso: string };
    };
    expect(input.buyer.phone).toBe("+2348031234567");
    expect(input.buyer.phoneCountryIso).toBe("NG");
    tree.unmount();
  });

  test("a US venue's picker starts on +1", async () => {
    const tree = await renderReservation("US");
    expect(phoneInput(tree).props.countryCode).toBe("US");
    tree.unmount();
  });

  test("0803… on the UK flag is refused, names Nigeria, and is never submitted", async () => {
    const tree = await renderReservation("GB");
    await TestRenderer.act(async () => {
      call(phoneInput(tree), "onChangePhone", "08031234567");
      call(phoneInput(tree), "onBlur");
    });
    await confirm(tree);
    expect(mockCreateReservation).not.toHaveBeenCalled();
    expect(String(phoneInput(tree).props.error)).toContain("Nigeria (+234)");
    const switchTo = tree.root.findAll(
      (node) =>
        typeof node.props.accessibilityLabel === "string" &&
        String(node.props.accessibilityLabel).startsWith("Switch the country code to Nigeria"),
    )[0] as Node;
    await TestRenderer.act(async () => {
      call(switchTo, "onPress");
    });
    expect(phoneInput(tree).props.countryCode).toBe("NG");
    await confirm(tree);
    expect(mockCreateReservation).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  test("a wrong-length number says what is wrong instead of a vague refusal", async () => {
    const tree = await renderReservation("NG");
    await TestRenderer.act(async () => {
      call(phoneInput(tree), "onChangePhone", "0803 123 45");
    });
    await confirm(tree);
    expect(mockCreateReservation).not.toHaveBeenCalled();
    expect(texts(tree)).toContain(
      "Nigerian mobile numbers have 10 digits after the 0 — you entered 8.",
    );
    tree.unmount();
  });
});

describe("#3380 the shared picker's smart entry", () => {
  test("a pasted +code names the country once it is settled", () => {
    expect(countryFromInternationalEntry("+234 803 123 4567", "US")).toEqual({
      countryCode: "NG",
      national: "8031234567",
    });
    expect(countryFromInternationalEntry("0044 7700 900123", "NG")).toEqual({
      countryCode: "GB",
      national: "7700900123",
    });
    expect(countryFromInternationalEntry("+1 416 555 0123", "CA")?.countryCode).toBe("CA");
    expect(countryFromInternationalEntry("+1 415 555 0123", "NG")?.countryCode).toBe("US");
    expect(countryFromInternationalEntry("+23", "US")).toBeNull();
    expect(countryFromInternationalEntry("0803 123 4567", "NG")).toBeNull();
  });

  test("the cursor position is recovered from the text alone", () => {
    expect(cursorAfterEdit("0803 124567", "0803 1294567")).toBe(8);
    expect(cursorAfterEdit("0803", "08031")).toBe(5);
    expect(cursorAfterEdit("0803 123", "0803123")).toBe(4);
  });

  test("an empty optional phone is never an error; a bad one always explains itself", () => {
    const empty = { isEmpty: true, touched: true, result: parsePhoneEntry("", { countryIso: "NG" }) };
    expect(phoneFieldError(empty, { required: false })).toBeNull();
    expect(phoneFieldError(empty, { required: true })).toBe("Enter a phone number.");
    const bad = {
      isEmpty: false,
      touched: true,
      result: parsePhoneEntry("0803 123", { countryIso: "NG" }),
    };
    expect(phoneFieldError(bad, { required: false })).toMatch(/10 digits after the 0/);
    expect(phoneFieldError({ ...bad, touched: false }, { required: false })).toBeNull();
  });
});

describe("#3380 menu ordering 'Who's ordering?'", () => {
  const request = (phoneCountryIso?: string | null) => ({
    spotCode: null,
    venueId: "v",
    sessionId: null,
    lines: [],
    buyer: { name: "Ada", email: "a@b.co", phone: "0803 123 4567", phoneCountryIso },
    partySizeClaimed: null,
    tipBps: null,
    tipFlatCents: null,
    entrySource: null,
  });

  test("the order carries the guest's country with the number", () => {
    const body = venueOrderCreateBody({ request: request("NG"), mode: "create", surface: "web" });
    expect(body.buyer).toEqual({
      name: "Ada",
      email: "a@b.co",
      phone: "0803 123 4567",
      phoneCountryIso: "NG",
    });
  });

  test("a host still on the plain box sends exactly the body it always did", () => {
    for (const iso of [undefined, null, ""]) {
      const body = venueOrderCreateBody({ request: request(iso), mode: "create", surface: "web" });
      expect(Object.keys(body.buyer as object).sort()).toEqual(["email", "name", "phone"]);
    }
  });

  const renderPane = async (props: {
    renderPhoneField?: (args: VenueOrderPhoneFieldArgs) => React.ReactNode;
    phoneFailure?: string | null;
  }): Promise<Tree> => {
    let tree!: Tree;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <VenueOrderReviewPane
          palette={PALETTE}
          surface={{ card: {} } as never}
          config={{
            state: "on",
            venueId: "v",
            venueName: "Gogi",
            spotState: "ok",
            spot: { label: "Table 4", kind: "table", servingMenuId: null },
            serviceChargeBps: 0,
            serviceChargeLabel: "Service",
            tipsEnabled: false,
            tipPresetsBps: [],
            counterPickupEnabled: false,
            prepTimeMinutes: 15,
          }}
          cart={[{
            key: "l1",
            menuItemId: "m1",
            itemName: "Jollof",
            quantity: 1,
            modifierIds: [],
            modifierNames: [],
            notes: null,
          }] as never}
          notesAllowedByItemId={{}}
          preview={{
            currency: "NGN",
            subtotalCents: 500000,
            serviceChargeCents: 0,
            serviceChargeLabel: "Service",
            feesAndTaxCents: 0,
            tipCents: 0,
            totalCents: 500000,
            lines: [],
            tipsEnabled: false,
            counterPickupEnabled: false,
          } as never}
          previewStatus="ready"
          previewError={null}
          tip={{ bps: null, flatCents: null } as never}
          tipRemembered={false}
          onTipChange={() => undefined}
          partySize={null}
          askPartySize={false}
          onPartySizeChange={() => undefined}
          buyer={{ name: "Ada", email: "ada@example.com", phone: "0803 123 4567", phoneCountryIso: "NG" }}
          onBuyerChange={() => undefined}
          onSetQuantity={() => undefined}
          onSetNotes={() => undefined}
          submitting={false}
          submitError={null}
          onSubmit={() => undefined}
          onBack={() => undefined}
          {...props}
        />,
      );
    });
    return tree;
  };

  const pay = (tree: Tree): Node =>
    tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.accessibilityLabel === "string" &&
        String(node.props.accessibilityLabel).startsWith("Pay"),
    )[0] as Node;

  test("the host's picker replaces the free-text box and receives the country", async () => {
    const seen: VenueOrderPhoneFieldArgs[] = [];
    const tree = await renderPane({
      renderPhoneField: (args) => {
        seen.push(args);
        return React.createElement("HostPhoneField", args);
      },
    });
    expect(tree.root.findAll((node) => node.type === "HostPhoneField")).toHaveLength(1);
    expect(
      tree.root.findAll((node) => node.props.placeholder === "Phone, with country code"),
    ).toHaveLength(0);
    expect(seen[0]?.phoneCountryIso).toBe("NG");
    expect(pay(tree).props.disabled).toBe(false);
    tree.unmount();
  });

  test("the host's verdict on the number holds the Pay button and is shown", async () => {
    const tree = await renderPane({
      renderPhoneField: (args) => React.createElement("HostPhoneField", args),
      phoneFailure: "Nigerian mobile numbers have 10 digits after the 0 — you entered 8.",
    });
    expect(pay(tree).props.disabled).toBe(true);
    expect(texts(tree)).toContain(
      "Nigerian mobile numbers have 10 digits after the 0 — you entered 8.",
    );
    tree.unmount();
  });

  test("buyer web mounts the picker, starting on the venue's country", () => {
    const slots = read("mingla-business/src/components/venueOrdering/BuyerVenueOrderingSlots.tsx");
    expect(slots).toContain("renderPhoneField={(args) => {");
    expect(slots).toContain("<BuyerVenueOrderPhoneField");
    // Required where the review renders it, never at module scope: mounting the
    // menu must not load the picker's keyboard stack (#2735 suites mount it).
    expect(slots).not.toMatch(/^import[^;]*BuyerVenueOrderPhoneField/m);
    expect(slots).not.toMatch(/^import[^;]*from "@mingla\/phone-input";/m);
    const field = read("mingla-business/src/components/venueOrdering/BuyerVenueOrderPhoneField.tsx");
    expect(field).toMatch(/<PhoneInput\s+smartEntry/);
    const route = read("mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx");
    expect(route).toContain("countryCode={venue.countryCode}");
    expect(route).toContain("countryCode={venueCountryCode}");
  });
});

describe("#3380 waiter and host sheets use the picker", () => {
  test.each([
    ["mingla-business/src/components/venue/orderPad/VenueOrderPadSheet.tsx", 2],
    ["mingla-business/src/components/venue/ReservationCreateSheet.tsx", 1],
    ["mingla-business/src/components/venue/WaitlistAddSheet.tsx", 1],
  ])("%s", (file, fields) => {
    const source = read(file);
    expect(source.match(/<PhoneField\b/g) ?? []).toHaveLength(fields);
    expect(source).toContain("usePhoneEntry({");
    expect(source).toContain("venueForPhone?.countryCode, brandForPhone?.countryCode");
    expect(source).not.toContain("E.164 format");
    expect(source).not.toMatch(/keyboardType="phone-pad"/);
  });

  test("the waiter's bill sends the country the pad chose", () => {
    const pad = read("mingla-business/src/components/venue/orderPad/VenueOrderPadSheet.tsx");
    expect(pad).toContain("phoneCountryIso: billPhone.countryIso");
    expect(pad.match(/\.\.\.billBuyerPhone,/g) ?? []).toHaveLength(2);
  });
});

describe("#2721 a venue created from scratch starts its phone on the venue's country", () => {
  test("setting a Lagos address seeds +234", () => {
    expect(
      seedContactPhoneCountry(
        { countryCode: null, contactPhoneCountryIso: null },
        { countryCode: "NG" },
      ),
    ).toEqual({ countryCode: "NG", contactPhoneCountryIso: "NG" });
    expect(
      seedContactPhoneCountry(
        { countryCode: null, contactPhoneCountryIso: null },
        { countryCode: " ng " },
      ).contactPhoneCountryIso,
    ).toBe("NG");
  });

  test("an operator's own pick is never overwritten", () => {
    expect(
      seedContactPhoneCountry(
        { countryCode: "NG", contactPhoneCountryIso: "GB" },
        { countryCode: "US" },
      ),
    ).toEqual({ countryCode: "US" });
  });

  test("a picker still on the old address's country follows a new address", () => {
    expect(
      seedContactPhoneCountry(
        { countryCode: "GB", contactPhoneCountryIso: "GB" },
        { countryCode: "NG" },
      ).contactPhoneCountryIso,
    ).toBe("NG");
  });

  test("a claim prefill that sets the phone country itself is left alone", () => {
    expect(
      seedContactPhoneCountry(
        { countryCode: null, contactPhoneCountryIso: null },
        { countryCode: "Ni", contactPhoneCountryIso: null },
      ),
    ).toEqual({ countryCode: "Ni", contactPhoneCountryIso: null });
  });

  test("a country name is never sliced into a code", () => {
    expect(
      seedContactPhoneCountry(
        { countryCode: null, contactPhoneCountryIso: null },
        { countryCode: "Nigeria" },
      ),
    ).toEqual({ countryCode: "Nigeria" });
  });

  test("an unmappable country seeds nothing", () => {
    expect(
      seedContactPhoneCountry(
        { countryCode: null, contactPhoneCountryIso: null },
        { countryCode: "Level 0, somewhere" },
      ),
    ).toEqual({ countryCode: "Level 0, somewhere" });
  });

  test("the store's patch goes through the seed", () => {
    expect(read("mingla-business/src/store/draftVenueStore.ts")).toContain(
      "patch: (p) => set((s) => seedContactPhoneCountry(s, p)),",
    );
  });
});

describe("#3380 event checkout and RSVP start on the event's country", () => {
  test("naira means Nigeria; the euro names no single country", () => {
    expect(phoneStartCountryForCurrency("NGN")).toBe("NG");
    expect(phoneStartCountryForCurrency("gbp")).toBe("GB");
    expect(phoneStartCountryForCurrency("EUR")).toBeNull();
    expect(phoneStartCountryForCurrency(null)).toBeNull();
  });

  test("a naira RSVP opens on +234 whatever the device locale", () => {
    const spy = jest
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ locale: "en-US" } as Intl.ResolvedDateTimeFormatOptions);
    try {
      expect(resolvePrimaryRsvpPhoneCountry("NGN")).toBe("NG");
      expect(resolvePrimaryRsvpPhoneCountry("EUR")).toBe("US");
      expect(resolvePrimaryRsvpPhoneCountry(null)).toBe("US");
    } finally {
      spy.mockRestore();
    }
  });

  test.each([
    "mingla-business/app/checkout/[eventId]/buyer.tsx",
    "mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx",
    "mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx",
  ])("%s seeds the picker from the event's currency", (file) => {
    const source = read(file);
    expect(
      source.match(
        /resolveInitialCountry\(buyer\.phone, phoneStartCountryForCurrency\(totals\.currency\)\)/g,
      ) ?? [],
    ).toHaveLength(2);
  });
});

describe("#3380 sold-out event waitlist", () => {
  test("uses the picker, starts on the event's country, and stores E.164", () => {
    const sheet = read("mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx");
    expect(sheet).toContain("<PhoneField");
    expect(sheet).toContain("startCountries: [phoneStartCountryForCurrency(currency)]");
    expect(sheet).toContain('const cleanPhone = phone.isEmpty ? "" : (phone.e164 ?? "");');
    expect(sheet).toMatch(/const canSubmit =[\s\S]*?phoneValid &&/);
    expect(sheet).not.toContain('placeholder="+1 555 0100"');
    for (const mount of [
      "mingla-business/src/components/event/PublicEventPage.tsx",
      "mingla-business/app/checkout/[eventId]/index.tsx",
    ]) {
      expect(read(mount)).toContain("currency={event.currency ?? null}");
    }
  });
});
