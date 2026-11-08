// issue #1023 wave 2 — node/ts-jest stand-in for the expo-font native module
// (see jest.config.cjs moduleNameMapper). Nothing is ever registered: every
// font reads as not loaded and loadAsync resolves without effect, which is
// exactly what a font-agnostic render or logic suite needs. Suites that
// assert on font registration jest.mock("expo-font") themselves.
module.exports = {
  __esModule: true,
  isLoaded: () => false,
  isLoading: () => false,
  loadAsync: async () => undefined,
  useFonts: () => [true, null],
};
