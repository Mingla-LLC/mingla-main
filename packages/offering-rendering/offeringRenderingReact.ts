// offeringRenderingReact — issue #2508 [maps-app-chooser].
//
// THE PACKAGE-LOCAL REACT BRIDGE. One job, named in the filename, so nothing
// else in this package has to carry it and no test can reasonably stub it as
// something other than what it is.
//
// WHY A BRIDGE AT ALL
// -------------------
// This package is source-linked into both apps, and their typecheck roots
// resolve bare specifiers through `paths` in their own tsconfig. That map pins
// `react-native`, `react-native-svg`, `expo-blur`, `lucide-react-native` and
// `expo-video` — but NOT `react` — and a file under `packages/` sits outside
// the app directory, so Node-style lookup walks up to a repo root that has no
// `node_modules`. Every direct `import ... from "react"` in this package
// therefore raises TS2307, and once React is unresolved every component typed
// `React.FC<Props>` degrades to `any`, taking its destructured props with it as
// implicit-any cascade. That cascade is what
// `mingla-business/scripts/ci/issue-1403-typecheck-delta.mjs` ratchets on.
//
// `packages/brand-rendering` solved the same problem with the same one-module
// bridge (`PublicVenueTabs.tsx`), and its consumers prove it works:
// `PublicVenueScreen.tsx` (1,400 lines) and `StayGuestBooking.tsx` (988) carry
// ZERO diagnostics, while every file in either package that imports react
// directly carries the cascade.
//
// WHY `require` AND NOT `import`
// ------------------------------
// `require` takes no part in TypeScript's module-specifier resolution, so it
// gets React's real runtime without raising the TS2307 that a bare `import`
// would — which is the entire point of this file. Metro (native + web) and jest
// both resolve it from the consuming app, exactly as they already do for the
// `require("expo-clipboard")` in `mingla-business/src/utils/sharePublicUrl.ts`.
//
// WHY ITS OWN FILE, AND NOT AN EXISTING MODULE
// --------------------------------------------
// #2508 first published this from `LucideIcons.tsx` on the reasoning that it
// was the package's only true leaf. Leaf-ness prevents CYCLES, but it does not
// protect a module's SEMANTIC contract:
// `issue_1902_public_event_acquisition.test.tsx` legitimately stubs the icon
// module as `new Proxy({}, { get: () => icon })` — "every export is an icon" is
// a fair reading of a file called LucideIcons — which turned the bridge into a
// no-op component and made `React.useState` undefined at runtime. A module
// whose name IS its job cannot be mis-stubbed that way.
//
// NEW SHARED RENDERERS IN THIS PACKAGE SHOULD IMPORT REACT FROM HERE, and
// should type their components as plain functions with NAMED PROP TYPES rather
// than `React.FC`. Naming the props concretely is the part that buys real type
// checking: `React.FC` off an unresolved React is `any`, and every prop
// destructured from it becomes an implicit any.
//
// Leave the RETURN type inferred. It is the one annotation that cannot be
// written honestly here — React's element type is unresolvable for the same
// reason as everything else in this file, the global `JSX` namespace comes from
// React's own types so it is missing too, and a structural stand-in is rejected
// outright as a component return (TS2786). Inferring it costs nothing: the
// implicit-any cascade this module exists to stop comes from untyped
// PARAMETERS, not from unnamed returns.

/**
 * The slice of React this package's shared renderers actually use, DECLARED
 * rather than inferred.
 *
 * This is deliberately a real interface and not `any`. `require` hands back an
 * untyped value, and leaving it that way would make every hook call in the
 * package unchecked — and would reject a type argument outright
 * (`useState<boolean>(false)` on an untyped function is TS2347). Naming the
 * surface here means the hooks are genuinely typed at every call site, which is
 * strictly better than the `any` a bare bridge would give: `packages/brand-
 * rendering`'s equivalent settles for an untyped React, and its consumers lose
 * hook typing as a result.
 *
 * Add to this interface when a shared renderer needs another React API. Do not
 * widen it to `any`.
 */
export interface OfferingRenderingReactApi {
  useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void];
  useCallback<T extends (...args: never[]) => unknown>(
    fn: T,
    deps: readonly unknown[],
  ): T;
  useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  useRef<T>(initial: T): { current: T };
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const OfferingRenderingReact = require("react") as OfferingRenderingReactApi;
