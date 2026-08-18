// #2099 Amendment 6 §F4 — DECLARATIONS ONLY. Zero runtime bytes.
//
// Metro resolves the extensionless
// `../../../src/components/venue/PendingVenueIdentityCorrectionLauncher`
// specifier in `app/venue/[venueId]/index.tsx` to `.web.tsx` on web and
// `.native.tsx` on iOS/Android. TypeScript does not: `expo/tsconfig.base` sets
// no `moduleSuffixes`, so without this file the host emits TS2307. The
// repository already relies on exactly this shape for
// `src/components/ui/useShareNetworkState.{web.ts,native.ts,d.ts}` — removing
// that `.d.ts` adds nine TS2307s across its nine real importers.
//
// BINDING (§F4): no `import`, no `require`, no value implementation, no
// executable statement, no bare `.ts`/`.tsx` sibling and no barrel re-export —
// any of those would re-enter the native and eager graphs and destroy the §D2
// boundary. `React` below is the UMD global from `@types/react`, not an import.
// `mingla-business/tsconfig.json` stays unmodified; adding `moduleSuffixes` is
// explicitly forbidden.

export interface PendingVenueIdentityCorrectionLauncherProps {
  venueId: string | null;
  claimStatus: string | null;
  onSuccess?: () => void;
}

export declare function PendingVenueIdentityCorrectionLauncher(
  props: PendingVenueIdentityCorrectionLauncherProps,
): React.ReactElement | null;

export default PendingVenueIdentityCorrectionLauncher;
