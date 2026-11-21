// issue #4508 fix round 7 — one Done bar on the guest number field, and a
// guest number grouped by its own country. Deno-runnable: both modules are pure.
//
//   R7-A  iOS: React Native gives a phone-pad field that asks for returnKeyType
//         "done" and has no inputAccessoryViewID its own native "Done" toolbar
//         (RCTTextInputComponentView setDefaultInputAccessoryView). With the
//         field's own bar off (the Explorer event sheet, the claim screen,
//         the group invite), that toolbar stacked under the app-wide Done bar.
//   R7-C  "+233241234567" read "+23 324 123 4567": the grouping ignored where
//         the calling code ends.
//
// FAILS-ON-REVERT: hard-code returnKeyType "done" in PhoneInput again -> R7-A
// fails; restore the right-to-left grouping of every digit -> R7-C fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  callingCodeLength,
  formatPartyPhone,
  numberPreview,
  partyGuestLabel,
} from "../rsvpGuestPartyModel.ts";

const read = (path: string): string =>
  Deno.readTextFileSync(new URL(path, import.meta.url));

Deno.test("R7-A: PhoneInput asks for its return key through that rule", () => {
  const input = read("../../phone-input/PhoneInput.tsx");
  const field = input.slice(input.indexOf("<PhoneTextInput"), input.indexOf("inputAccessoryViewID="));
  assert(field.includes('keyboardType="phone-pad"'), "the phone field");
  assert(
    field.includes('returnKeyType={Platform.OS === "ios" && !showDoneAccessory ? "default" : "done"}'),
    "iOS asks for default (no native toolbar) only when the host owns the Done bar; Android and the field's own bar keep done",
  );
  assert(!/returnKeyType="done"/.test(field), "no hard-coded done return key on the phone field");
});

Deno.test("R7-C: calling codes are split where they end", () => {
  assertEquals(callingCodeLength("15551234567"), 1);
  assertEquals(callingCodeLength("79161234567"), 1);
  assertEquals(callingCodeLength("447700900123"), 2);
  assertEquals(callingCodeLength("33612345678"), 2);
  assertEquals(callingCodeLength("233241234567"), 3);
  assertEquals(callingCodeLength("2348031234567"), 3);
  assertEquals(callingCodeLength("353851234567"), 3);
});

Deno.test("R7-C: a guest number is grouped by its own country", () => {
  assertEquals(formatPartyPhone("+233241234567"), "+233 24 123 4567");
  assertEquals(formatPartyPhone("+2348031234567"), "+234 803 123 4567");
  assertEquals(formatPartyPhone("+447700900123"), "+44 770 090 0123");
  assertEquals(formatPartyPhone("+15551234567"), "+1 555 123 4567");
  assertEquals(formatPartyPhone("+353851234567"), "+353 85 123 4567");
  // Short or odd input never throws and never loses digits.
  assertEquals(formatPartyPhone("+1234"), "+1234");
  assertEquals(formatPartyPhone("+12345678").replace(/\D/g, ""), "12345678");
  // The added row and the live preview read the same.
  assertEquals(partyGuestLabel({ displayName: null, phone: "+233241234567" }), "+233 24 123 4567");
  const preview = numberPreview({
    phone: "+233241234567",
    phoneCountryIso: "GH",
    ownPhones: [],
    party: [],
    lookup: { state: "failed" },
  });
  assertEquals(preview.kind, "unchecked");
  assertEquals((preview as { title: string }).title, "+233 24 123 4567");
});
