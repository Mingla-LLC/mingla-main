// @ts-nocheck — Deno-discovered suite; app-mobile's tsc sweep has no Deno globals,
// URL imports or allowImportingTsExtensions, while the deno-2-unit lane executes it directly.
/* eslint-disable import/no-unresolved -- Deno-discovered suite; Expo ESLint does not resolve URL imports. */
//
// #4334 polish — Discover "Choose a city" sheet bled off the top of the screen.
//
// The search field autofocuses and keyboardBehavior "interactive" lifts the 90%
// sheet by the keyboard height. With no topInset the header slid past the status
// bar / notch. The sheet must cap itself below the safe area (#3872 W5.1 prop).
//
// FAILS-ON-REVERT: drop `topInset` from CityPickerSheet → C-1 fails; pass a bare
// 0 or a constant that ignores the safe area → C-2 fails.
import { assert, assertMatch } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const root = new URL("../../../../../", import.meta.url);
const read = (rel: string): string => Deno.readTextFileSync(new URL(rel, root));
const src = read("app-mobile/src/components/discover/CityPickerSheet.tsx");

Deno.test("C-1: the city sheet passes topInset to BaseBottomSheet", () => {
  const sheet = src.slice(src.indexOf("<BaseBottomSheet"), src.indexOf("</BaseBottomSheet>"));
  assert(sheet.length > 0, "BaseBottomSheet not found");
  assertMatch(sheet, /\btopInset=\{/);
});

Deno.test("C-2: the cap follows the device safe area, not a constant", () => {
  assertMatch(src, /useSafeAreaInsets\(\)/);
  assertMatch(src, /topInset=\{[^}]*insets\.top[^}]*\}/);
});

Deno.test("C-3: the keyboard still lifts the sheet (behaviour kept, only capped)", () => {
  assertMatch(src, /keyboardBehavior="interactive"/);
  assertMatch(src, /autoFocus/);
});
