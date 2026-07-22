// Lightweight @react-native-google-signin/google-signin mock — #1062
// [biz-jest-residual-burndown] Wave 1 / B3a.
//
// The package's entry (`lib/module/index.js`) is ESM (`export { … }`) that the
// node/ts-jest default config cannot parse. It is pulled transitively by
// AuthContext, so any node-env unit test whose chain loads AuthContext (e.g.
// draftRsvpValidation → draftEventStore → … → AuthContext) dies at module-load.
// These tests never exercise Google sign-in — they only need the symbols
// AuthContext destructures at load time. Inert stubs, no fabricated auth. A suite
// that actually tests google-signin behavior self-mocks it (jest.mock), overriding
// this map. Activated ONLY via an explicit moduleNameMapper entry.

const GoogleSignin = {
  configure: () => {},
  hasPlayServices: async () => true,
  signIn: async () => ({ type: "cancelled" }),
  signInSilently: async () => ({ type: "noSavedCredentialFound" }),
  signOut: async () => {},
  revokeAccess: async () => {},
  getCurrentUser: () => null,
  getTokens: async () => ({ idToken: null, accessToken: null }),
  hasPreviousSignIn: () => false,
};

const statusCodes = {
  SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED",
  IN_PROGRESS: "IN_PROGRESS",
  PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
  SIGN_IN_REQUIRED: "SIGN_IN_REQUIRED",
};

const GoogleSigninButton = () => null;
GoogleSigninButton.Size = { Icon: 0, Standard: 1, Wide: 2 };
GoogleSigninButton.Color = { Dark: 0, Light: 1 };

module.exports = {
  __esModule: true,
  GoogleSignin,
  GoogleSigninButton,
  statusCodes,
  isErrorWithCode: () => false,
  isSuccessResponse: (r) => Boolean(r) && r.type === "success",
  isNoSavedCredentialFoundResponse: (r) =>
    Boolean(r) && r.type === "noSavedCredentialFound",
};
