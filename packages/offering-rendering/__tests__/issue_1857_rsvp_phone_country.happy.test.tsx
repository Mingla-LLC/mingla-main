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

// #4508 replaced the per-row plus-one phone form ("Guest N phone" rows with
// their own country, touched state and add / remove buttons) with the guest
// block, which its own #4508 suites cover. #1857's promise here is the RSVP
// owner's own phone field: a neutral (never US) default country, its own
// country state, and validation that waits for a touch or a submit.
const primaryField = body.slice(
  body.indexOf('role: "primary"') - 200,
  body.indexOf("onBlur: () => setPrimaryPhoneTouched(true)") + 60,
);

Deno.test("#1857 RSVP owns independent neutral country state for the owner's phone", () => {
  assertStringIncludes(body, "useState<string | null>(\n    defaultPhoneCountry ?? null,\n  );\n  const [phoneRawValue");
  assert(!body.includes('defaultPhoneCountry ?? "US"'));
  assert(primaryField.includes('role: "primary"'), "the owner's field is found");
  assertStringIncludes(primaryField, "countryCode: phoneCountry,");
  assertStringIncludes(primaryField, "setPhoneCountry(isoCode);");
  // The guest number keeps its own country, so picking one never moves the other.
  assertStringIncludes(body, "const [guestNumberCountry, setGuestNumberCountry] = useState<string | null>(");
  assert(!primaryField.includes("guestNumberCountry"), "the owner's field never reads the guest country");
  assertStringIncludes(primaryField, "emptyRequired: (showValidationErrors || primaryPhoneTouched)");
  assertStringIncludes(primaryField, "onBlur: () => setPrimaryPhoneTouched(true)");
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

Deno.test("#1857 RSVP disables the owner's phone field while submitting", () => {
  assertStringIncludes(primaryField, "disabled: submitting,");
});
