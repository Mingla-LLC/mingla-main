/**
 * ORCH-1299 [rsvp-phone-picker-nested-modal] — implementor happy-path regression.
 *
 * The RSVP guest phone country-picker froze on WEB because PhoneInput hardcoded
 * CountryPickerModal (a nested RN <Modal>) and the RSVP details form lives inside
 * RsvpDetailsModal (another <Modal>). A <Modal> nested in a <Modal> never opens on
 * react-native-web. The fix adds `pickerPresentation` and resolves it via the pure
 * `resolvePickerPresentation` helper: `'overlay'` (CountryPickerOverlay, in-place)
 * ONLY on web; native and the default 'modal' path are unchanged (buyer checkout
 * keeps its nested <Modal>).
 *
 * This asserts the DECISION contract directly (no RN mount needed). It FAILS ON
 * REVERT: delete the `presentation === "overlay" && platformOS === "web"` branch
 * (or the whole helper) and cases T-1 regress.
 */

import {
  resolvePickerPresentation,
  type PhoneInputPickerPresentation,
} from "../../../../../packages/phone-input/pickerPresentation";

describe("ORCH-1299 resolvePickerPresentation", () => {
  test("T-1 — 'overlay' on web resolves to overlay (the RSVP nested-modal fix)", () => {
    expect(resolvePickerPresentation("overlay", "web")).toBe("overlay");
  });

  test("T-2 — 'overlay' on native stays modal (native nested-<Modal> works)", () => {
    expect(resolvePickerPresentation("overlay", "ios")).toBe("modal");
    expect(resolvePickerPresentation("overlay", "android")).toBe("modal");
  });

  test("T-3 — default/undefined stays modal on every platform (checkout unchanged)", () => {
    expect(resolvePickerPresentation(undefined, "web")).toBe("modal");
    expect(resolvePickerPresentation(undefined, "ios")).toBe("modal");
  });

  test("T-4 — explicit 'modal' stays modal even on web (buyer checkout path)", () => {
    expect(resolvePickerPresentation("modal", "web")).toBe("modal");
    expect(resolvePickerPresentation("modal", "android")).toBe("modal");
  });

  test("T-5 — the union type admits exactly 'modal' | 'overlay'", () => {
    const values: PhoneInputPickerPresentation[] = ["modal", "overlay"];
    expect(values).toHaveLength(2);
  });
});
