import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  pickerCloseFocusTarget,
  shouldHapticCountrySelection,
  webOverlayFocusAction,
} from "../../phone-input/pickerPresentation.ts";
import { markRsvpPhoneTouchedById } from "../rsvpPhoneValidation.ts";

const body = await Deno.readTextFile(
  new URL("../RsvpOfferingBody.tsx", import.meta.url),
);

Deno.test("#1857 RSVP owns independent neutral country state for primary and plus-ones", () => {
  assertStringIncludes(body, "defaultPhoneCountry ?? null");
  assertStringIncludes(body, "phoneCountryIso: null");
  assertStringIncludes(body, "key={g.id}");
  assertStringIncludes(body, "row.id === g.id");
  assertStringIncludes(body, "label: `Guest ${i + 1} phone`");
  assertStringIncludes(
    body,
    "emptyRequired: (showValidationErrors || g.phoneTouched) && g.rawPhone.trim().length === 0",
  );
  assertStringIncludes(body, "emptyRequired: (showValidationErrors || primaryPhoneTouched)");
  assertStringIncludes(body, "onBlur: () => setPrimaryPhoneTouched(true)");
  assertStringIncludes(body, "markRsvpPhoneTouchedById(rows, g.id)");
  assertStringIncludes(body, "phoneCountryIso: g.phoneCountryIso");
  assert(!body.includes('defaultPhoneCountry ?? "US"'));
});

Deno.test("#1857 touched validation remains isolated by stable guest id", () => {
  const before = [
    { id: "guest-a", phoneTouched: false },
    { id: "guest-b", phoneTouched: false },
  ];
  const after = markRsvpPhoneTouchedById(before, "guest-b");
  assertEquals(after, [
    { id: "guest-a", phoneTouched: false },
    { id: "guest-b", phoneTouched: true },
  ]);
  assertEquals(after[0], before[0]);
});

const picker = await Deno.readTextFile(
  new URL("../../phone-input/CountryPickerModal.tsx", import.meta.url),
);
const phoneInput = await Deno.readTextFile(
  new URL("../../phone-input/PhoneInput.tsx", import.meta.url),
);

Deno.test("#1857 web picker traps Tab, closes on Escape, and restores focus", () => {
  assertEquals(webOverlayFocusAction({ key: "Escape", shiftKey: false, activeIndex: 1, focusableCount: 3 }), "close");
  assertEquals(webOverlayFocusAction({ key: "Tab", shiftKey: false, activeIndex: 2, focusableCount: 3 }), "first");
  assertEquals(webOverlayFocusAction({ key: "Tab", shiftKey: true, activeIndex: 0, focusableCount: 3 }), "last");
  assertStringIncludes(picker, "webOverlayFocusAction({");
  assertStringIncludes(picker, 'document.addEventListener("keydown", handleKeyDown)');
  assertStringIncludes(phoneInput, "pickerCloseFocusTarget(countryWasSelected.current)");
  assertEquals(pickerCloseFocusTarget(true), "phone");
  assertEquals(pickerCloseFocusTarget(false), "country");
});

Deno.test("#1857 country selection haptics are native-only", () => {
  assertStringIncludes(picker, "shouldHapticCountrySelection(Platform.OS)");
  assert(!picker.includes('if (Platform.OS !== "web")'));
  assertEquals(shouldHapticCountrySelection("web"), false);
  assertEquals(shouldHapticCountrySelection("ios"), true);
  assertEquals(shouldHapticCountrySelection("android"), true);
});

Deno.test("#1857 RSVP disables all mutable plus-one controls while submitting", () => {
  assertStringIncludes(body, "disabled: submitting");
  assertStringIncludes(
    body,
    "disabled={submitting || guests.length >= config.plusOnesMax}",
  );
  assertStringIncludes(body, "disabled={submitting || guests.length <= 0}");
});
