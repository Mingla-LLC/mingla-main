/**
 * #2099 — the dedicated config for the §D6 Business behavioural suite (Check H).
 *
 * WHY IT IS MECHANICALLY REQUIRED (Amendment 6 §F5, Amendment 7 §G3):
 *   The stock `jest.config.cjs` sets `moduleFileExtensions: ["ts","tsx","js",
 *   "jsx","json"]` — no platform suffix — so the host page's EXTENSIONLESS
 *   `PendingVenueIdentityCorrectionLauncher` import cannot resolve there at
 *   all, and §F4 condition 2 forbids adding a bare `.ts`/`.tsx` sibling that
 *   would fix it (it would re-enter the native and eager graphs). This config
 *   changes exactly one thing that matters: resolution is WEB-FIRST, so the
 *   real `.web.tsx` launcher is what mounts.
 *
 * WHAT IT DELIBERATELY DOES NOT DO — every clause here is Check P's P-8b…P-8f,
 * and each one closes a substitution route that was executed against an earlier
 * draft of this contract:
 *   · P-8b — no `resolver`, `roots`, `modulePaths`, `moduleDirectories`,
 *     `haste`, `runner`, `testRunner`, `snapshotResolver`, `globalSetup`,
 *     `globalTeardown`, `testEnvironmentOptions`, `unmockedModulePathPatterns`,
 *     `automock`, `moduleLoader`, `preprocessorIgnorePatterns`, and NO
 *     `setupFiles` / `setupFilesAfterEnv` / `setupFilesAfterEach` (a setup file
 *     can `jest.mock` the unit under proof, or patch `react/jsx-runtime`, and
 *     neither the suite scan nor a resolution assertion would see it).
 *   · P-8c — nothing in this object names a #2099 module.
 *   · P-8d — `preset`, `transform` and `transformIgnorePatterns` are INHERITED
 *     from the stock config by reference, never authored. A repository-local
 *     transformer can rewrite the launcher's source at compile time while
 *     resolution, the module registry and reference identity all stay honest;
 *     inheritance is the only seal that sees it.
 *   · P-8e — `moduleNameMapper` is the stock map, unchanged. Not one entry is
 *     added and not one is overridden — nine of the eighteen stock values
 *     already resolve to first-party files, so an OVERRIDE is exactly as much a
 *     substitution surface as an addition.
 *
 * The suite itself is the #1483 bare `react-test-renderer` recipe
 * (`venuePublicPageActions.issue1483.test.tsx`), which is proven under this
 * same ts-jest/node preset — so no test-only dependency is installed, and
 * `package.json` and the lockfile stay untouched.
 */

const stock = require("./jest.config.cjs");

module.exports = {
  rootDir: __dirname,
  // INHERITED — never authored. See P-8d above.
  preset: stock.preset,
  testEnvironment: stock.testEnvironment,
  transform: stock.transform,
  transformIgnorePatterns: stock.transformIgnorePatterns,
  // INHERITED wholesale — no added key, no overridden key. See P-8e above.
  moduleNameMapper: stock.moduleNameMapper,
  // The ONE substantive difference from stock: web-first resolution, so the
  // host page's extensionless launcher import lands on `.web.tsx` and never on
  // the `.native.tsx` no-op.
  moduleFileExtensions: ["web.ts", "web.tsx", "ts", "tsx", "js", "jsx", "json"],
  testMatch: [
    "<rootDir>/src/components/venue/__tests__/issue2099PendingIdentityCorrection.behavior.render.test.tsx",
  ],
};
