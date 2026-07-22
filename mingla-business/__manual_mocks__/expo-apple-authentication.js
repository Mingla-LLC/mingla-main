// Lightweight expo-apple-authentication mock — #1062 [biz-jest-residual-burndown]
// Wave 1 / B3a.
//
// The package entry (`build/index.js`) is ESM (`export * from …`) the node/ts-jest
// default config cannot parse. Pulled transitively via AuthContext; node-env tests
// whose chain loads AuthContext die at module-load. Inert stubs (no fabricated
// sign-in); a suite that tests Apple auth self-mocks it (jest.mock), overriding this
// map. Activated ONLY via an explicit moduleNameMapper entry.

const AppleAuthenticationButton = () => null;

module.exports = {
  __esModule: true,
  AppleAuthenticationButton,
  isAvailableAsync: async () => false,
  signInAsync: async () => {
    throw new Error("ERR_CANCELED");
  },
  refreshAsync: async () => ({}),
  signOutAsync: async () => ({}),
  getCredentialStateAsync: async () => 0,
  addRevokeListener: () => ({ remove() {} }),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  AppleAuthenticationCredentialState: {
    REVOKED: 0,
    AUTHORIZED: 1,
    NOT_FOUND: 2,
    TRANSFERRED: 3,
  },
  AppleAuthenticationButtonType: {
    SIGN_IN: 0,
    CONTINUE: 1,
    SIGN_UP: 2,
  },
  AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
  AppleAuthenticationUserDetectionStatus: {
    UNSUPPORTED: 0,
    UNKNOWN: 1,
    LIKELY_REAL: 2,
  },
};
