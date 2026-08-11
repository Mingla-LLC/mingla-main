/**
 * keyboardPrimitives — NATIVE (and any non-web) build.
 *
 * Per #1627 [keyboard-guard-vacuity].
 *
 * A re-export, and nothing else. On iOS and Android `KeyboardProvider` and
 * `KeyboardToolbar` here ARE the library's components, so CountryPickerModal's
 * element tree is byte-identical to what it rendered before the split.
 *
 * The whole point of this file existing is Metro platform resolution: on native
 * Metro resolves THIS `.tsx`, NOT the `keyboardPrimitives.web.tsx` sibling, so
 * `react-native-keyboard-controller` — a NATIVE-only library whose twelve
 * primitives are all inert in a browser — never enters the WEB bundle. Same
 * split the package already uses for `WebOverlayPortal`, proven to resolve on a
 * real `expo export -p web`.
 *
 * WHY IT MATTERS HERE SPECIFICALLY. `CountryPickerModal` is on the buyer money
 * path — the three checkout routes plus `PublicEventPage` and
 * `GuestVenueReservation` — and `PhoneInput` renders the MODAL variant (not the
 * overlay) on web, because `resolvePickerPresentation` returns `"overlay"` only
 * when a caller explicitly asks and the checkout callers do not. So this one
 * import put the entire library barrel into `__common`, the eager chunk every
 * guest downloads before any route renders: 60,418 B raw / 9,966 B brotli.
 *
 * Invariant: I-PROPOSED-1627-NO-NATIVE-KEYBOARD-LIBRARY-IN-THE-WEB-GRAPH.
 */

// ONE statement, with the type inlined, on purpose. `packages/phone-input` has
// no node_modules of its own and mingla-business's tsconfig `paths` map does not
// list this library, so from that compiler's scope the specifier is
// unresolvable — exactly as `react`, `react-dom`, `expo-haptics` and
// `react-native-safe-area-context` already are for this package's other files
// (40 such pre-existing diagnostics on main). Splitting the value and type
// re-exports across two statements would emit that same pre-existing diagnostic
// TWICE where CountryPickerModal previously emitted it once. Keeping it to a
// single statement keeps the repo's diagnostic count exactly flat.
export {
  KeyboardProvider,
  KeyboardToolbar,
  type KeyboardToolbarProps,
} from "react-native-keyboard-controller";
