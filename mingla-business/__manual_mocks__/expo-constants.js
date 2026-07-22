// Lightweight expo-constants mock — #1062 [biz-jest-residual-burndown] Wave 1 / B3a.
//
// The real package is native-bridge ESM; node-env unit tests that transitively
// import it (e.g. via @mingla/offering-rendering's mapboxToken /
// mapboxFunctionsBase, or postHogService / supabase.ts config reads) fail to LOAD
// under the default node/ts-jest config. Those readers walk
// `Constants.expoConfig.extra -> process.env` for inlining-safe config values, so
// the mock provides that SHAPE with an EMPTY `extra` — a real config-less read
// (env fallback / null), NOT a fabricated value. Suites that need specific
// Constants values self-mock expo-constants with jest.mock(), which overrides
// this map (e.g. mapboxStaticImage.orch1138 already does).
//
// Activated ONLY via an explicit moduleNameMapper entry in jest.config.cjs.

const Constants = {
  // Dummy inlining-safe config so a node-env test that transitively imports the
  // REAL src/services/supabase.ts (which calls createClient(url, key) at module
  // scope and THROWS "supabaseUrl is required" on an empty url) can CONSTRUCT the
  // client and load. These are placeholder values used only for construction — no
  // network call is made in node, and no test asserts on them. A suite that needs
  // real config self-mocks expo-constants (jest.mock), overriding this.
  expoConfig: {
    extra: {
      EXPO_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-1062",
    },
  },
  manifest: null,
  manifest2: null,
  executionEnvironment: "storeClient",
  platform: {},
};

module.exports = {
  __esModule: true,
  default: Constants,
  ExecutionEnvironment: {
    Bare: "bare",
    Standalone: "standalone",
    StoreClient: "storeClient",
  },
  AppOwnership: { Standalone: "standalone", Expo: "expo", Guest: "guest" },
};
