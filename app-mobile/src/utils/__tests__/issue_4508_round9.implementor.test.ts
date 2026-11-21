// @ts-nocheck -- a Deno suite (deno2-discovered); the app tsc has no Deno globals or URL imports.
// issue #4508 fix round 9.
//
//   P2-A  After a country pick the phone pad came back with no Done bar.
//         Proven on the iPhone SE simulator (event log): iOS sends willHide
//         (picker search) → willShow (number field) → didHide (late, from the
//         picker) → didShow. The library's isVisible flips only on willShow
//         and didHide, so the late didHide left it "closed" with the keyboard
//         up, and the app-wide bar (KeyboardToolbarRoot) rendered nothing.
//         The bar now reads useKeyboardIsVisible, built on
//         nextKeyboardVisibility, which ignores a didHide that a later show
//         superseded. The picker's round-8 refocus delay is gone (next tick).
//   P2-B  The pass sheet scrolls the "Bring someone too" form into view when
//         its field takes focus (the purchase sheets' reveal).
//   P3    Pass chips read as the guest's row; a claimed guest's page shows the
//         pass's address.
//
//   Back   Opening `com.mingla.app.v2://event/<id>` mounted /event TWICE
//          (simulator log): expo-router opens the served route itself, and the
//          shell's Linking listener pushed it again. Closing the event showed the
//          second copy; on a slow device one copy's replace() took the other's
//          place and left a loading "Event" screen. The listener now skips a
//          route expo-router already opened.
//
// FAILS-ON-REVERT: the Linking listener pushing served routes again ->
// R9-Back fails; the bar back on useKeyboardState, or a didHide that closes
// over a newer show -> R9-P2-A fails; no reveal on focus -> R9-P2-B fails;
// chips on displayName -> R9-P3-chips fails; no pass address -> R9-P3-address
// fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  nextKeyboardVisibility,
  type KeyboardVisibilityEvent,
} from "../../wrappers/keyboardVisibility.ts";
import { rsvpPassLabel } from "../../../../packages/offering-rendering/rsvpPassLabels.ts";
import { parseDeepLink, shellSkipsRouterLink } from "../../services/deepLinkService.ts";
import { redirectSystemPath } from "../../../app/+native-intent.tsx";

const read = (path: string): string =>
  Deno.readTextFileSync(new URL(path, import.meta.url));

const run = (events: KeyboardVisibilityEvent[], visible = false) =>
  events.reduce(
    (s, e) => nextKeyboardVisibility(s, e),
    { visible, showing: visible },
  ).visible;

Deno.test("R9-P2-A: a late didHide never hides the bar over a newer keyboard", () => {
  // The simulator's order after a fast country pick.
  assertEquals(run(["keyboardWillHide", "keyboardWillShow", "keyboardDidHide", "keyboardDidShow"], true), true);
  // Even before the didShow arrives, the bar stays.
  assertEquals(run(["keyboardWillHide", "keyboardWillShow", "keyboardDidHide"], true), true);
  // Ordinary open and close still work.
  assertEquals(run(["keyboardWillShow", "keyboardDidShow"]), true);
  assertEquals(run(["keyboardWillHide", "keyboardDidHide"], true), false);
  assertEquals(run(["keyboardWillShow", "keyboardDidShow", "keyboardWillHide", "keyboardDidHide"]), false);
  // A didShow alone (a missed willShow) opens it.
  assertEquals(run(["keyboardDidShow"]), true);
});

Deno.test("R9-P2-A: the app-wide bar and every keyboard reader use the ordered state", () => {
  const bar = read("../../wrappers/KeyboardToolbarRoot.native.tsx");
  assert(bar.includes("const isVisible = useKeyboardIsVisible();"));
  assert(!/useKeyboardState/.test(bar.replace(/\/\/.*$/gm, "")), "not the library's state");
  const hook = read("../../wrappers/useKeyboardIsVisible.native.ts");
  assert(hook.includes("nextKeyboardVisibility(current, event)"));
  assert(!/useKeyboardState\(/.test(hook.replace(/\/\/.*$/gm, "")), "the hook is not the library's state");
  const input = read("../../../../packages/phone-input/PhoneInput.tsx");
  const close = input.slice(input.indexOf("const handlePickerClose"), input.indexOf("// Release the owed cursor"));
  assert(close.includes("setTimeout(() => target?.focus?.(), 0);"), "no per-caller timer after a pick");
});

Deno.test("R9-P2-B: the pass sheet reveals the bring form on focus", () => {
  const sheet = read("../../components/activity/RsvpPassSheet.tsx");
  assert(sheet.includes('scrollProps={{ ref: scrollRef, keyboardShouldPersistTaps: "handled" }}'));
  assert(/scrollRef\.current\?\.scrollToEnd\(\{ animated: true \}\)/.test(sheet));
  assert(sheet.includes("onFieldFocus={revealBringForm}"));
  const form = read("../../components/activity/RsvpPartyInvites.tsx");
  assert(form.includes("onFocus={onFieldFocus}"));
});

Deno.test("R9-P3-chips: a guest's pass reads as their row", () => {
  const invites = [
    { guestId: "g1", displayName: null, phoneLast4: "0003" },
    { guestId: "g2", displayName: "Kofi Mensah", phoneLast4: "0002" },
  ];
  assertEquals(rsvpPassLabel({ entityType: "guest", entityId: "g1", displayName: "Andy's guest" }, invites), "Number ending 0003");
  assertEquals(rsvpPassLabel({ entityType: "guest", entityId: "g2", displayName: "Andy's guest" }, invites), "Kofi Mensah · 0002");
  assertEquals(rsvpPassLabel({ entityType: "primary", entityId: "p", displayName: "Andy Adams" }, invites), "Andy Adams");
  assertEquals(rsvpPassLabel({ entityType: "guest", entityId: "gx", displayName: "Rita" }, undefined), "Rita");
  const popup = read("../../../../packages/offering-rendering/RsvpSuccessPopup.tsx");
  // Round 10: the chip shows the short label; its accessibility label is the full one.
  assert(popup.includes(": passLabel(credential)\n"));
  assert(popup.includes("{passLabel(selected)}"));
});

Deno.test("R9-P3-address: a claimed guest sees the pass's address", () => {
  const screen = read("../../screens/Event/ConsumerEventDetailScreen.tsx");
  assert(screen.includes("passHolderAddress={claimedGuestPass?.venue.locationText ?? null}"));
  const body = read("../../../../packages/offering-rendering/RsvpOfferingBody.tsx");
  assert(/: passHolderAddress\s*\?\s*passHolderAddress\s*:\s*addressRevealed/.test(body));
  assert(body.includes('event.format === "online" || addressRevealed || passHolderAddress'));
});

Deno.test("R9-Back: an OS link to a served route opens it once", () => {
  const url = "com.mingla.app.v2://event/00000000-0000-4000-8000-000000004508";
  const routerOpened = redirectSystemPath({ path: url, initial: false }) !== "/";
  assert(routerOpened, "expo-router serves /event itself");
  const dest = parseDeepLink(url);
  assertEquals(dest?.kind, "route");
  assertEquals(shellSkipsRouterLink(dest, routerOpened), true);
  // A push or a OneLink (no OS link) still opens the route; pages still go.
  assertEquals(shellSkipsRouterLink(dest, false), false);
  assertEquals(shellSkipsRouterLink(parseDeepLink("mingla://home"), true), false);
  assertEquals(shellSkipsRouterLink(null, true), false);
  const index = read("../../../app/index.tsx");
  assert(index.includes("if (shellSkipsRouterLink(parseDeepLink(url), opts?.routerOpened === true)) return;"));
  const effect = index.slice(index.indexOf("Linking.getInitialURL().then"), index.indexOf("}, [receiveAttendanceClaimUrl]);"));
  assertEquals((effect.match(/handleDeepLink\(url, \{ routerOpened: routerServesLink\(url\) \}\);/g) ?? []).length, 2);
  assertEquals((effect.match(/handleDeepLink\(event\.url, \{ routerOpened: routerServesLink\(event\.url\) \}\);/g) ?? []).length, 2);
  assert(!/handleDeepLink\((event\.)?url\);/.test(effect), "no OS link reaches the shell without the check");
});
