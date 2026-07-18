/**
 * WEB SHIM for appsFlyerService — ORCH-1378 [onelink-dead-on-business-web].
 *
 * ⚠️ THE RULE THAT KEEPS THIS FILE HONEST. Every export of the NATIVE twin
 * (`appsFlyerService.ts`) MUST exist here too. TypeScript CANNOT see a gap:
 * `tsc` resolves imports to the NATIVE module (`moduleSuffixes` is unset in
 * tsconfig.json) while Metro substitutes THIS file into the web bundle. So a
 * missing export is a GREEN typecheck and a live `TypeError` in production.
 *
 * That is not hypothetical — it shipped. `subscribeOneLinkDeepLink` and
 * `resolveBusinessOneLinkDestination` were missing here, and the root `_layout`
 * threw `TypeError: subscribeOneLinkDeepLink is not a function` on EVERY
 * business-web load (reproduced 3/3).
 *
 * CI now enforces the pairing:
 * `.github/scripts/strict-grep/i-1378-web-shim-export-parity.mjs`
 * (I-PROPOSED-1378-WEB-SHIM-EXPORT-PARITY). If you add a function to the native
 * twin, add it here IN THE SAME COMMIT.
 */

// ORCH-1378 — type re-export so the shim's type surface matches the native
// twin's. Types are erased at runtime and cannot throw, but a consumer doing
// `import type { BusinessOneLinkDestination }` must resolve on both sides.
// `import type`/`export type` emit NO runtime require, so this cannot become a
// circular import of the native module into the web bundle.
import type { BusinessOneLinkDestination } from "./appsFlyerService";

export type { BusinessOneLinkDestination };

export function initializeAppsFlyer(): void {}

export function setAppsFlyerUserId(_userId: string): void {}

export function clearAppsFlyerUserId(): void {}

export function registerAppsFlyerDevice(_userId: string): void {}

export function resetAppsFlyerDeviceCache(): void {}

export function logAppsFlyerEvent(
  _eventName: string,
  _eventValues: Record<string, string | number | boolean> = {},
): void {}

// ─── ORCH-1378: the two exports whose ABSENCE threw on every web load ───────

/**
 * No-op — there is no AppsFlyer OneLink SDK on web, so no deep link can ever be
 * delivered and the sink is never invoked.
 *
 * RETURNS `void`, matching the native twin EXACTLY (appsFlyerService.ts:257 —
 * `subscribeOneLinkDeepLink(onDestination): void`). The native function stores
 * the sink in a module-level variable; it hands back no unsubscribe handle, and
 * the sole call site (`_layout.tsx:518`) does not read the return value.
 * Returning anything else here would re-introduce the very native/web signature
 * divergence this shim exists to prevent.
 */
export function subscribeOneLinkDeepLink(
  _onDestination: (dest: BusinessOneLinkDestination) => void,
): void {}

/**
 * No-op returning `null` (= "no destination"). Parity only: there is no
 * web-reachable call site (ORCH-1378 D-4), because only the native SDK ever
 * produces a OneLink payload to resolve.
 */
export function resolveBusinessOneLinkDestination(
  _data: Record<string, unknown> | null | undefined,
): BusinessOneLinkDestination {
  return null;
}
