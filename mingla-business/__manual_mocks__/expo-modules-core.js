// Lightweight expo-modules-core mock — #1062 [biz-jest-residual-burndown] Wave 1 / B3a.
//
// The real package ships native-bridge ESM (`import ... from './...'`) that the
// node/ts-jest default config cannot parse ("Cannot use import statement outside
// a module"), so any node-env unit test whose chain transitively imports
// expo-modules-core (e.g. via expo-image-picker, expo-file-system) fails to LOAD
// before a single assertion runs. These node tests never exercise a NATIVE module
// — they only need the symbols their imported modules destructure at load time.
// This mock provides those symbols with realistic shapes and NO fabricated
// behavior (native lookups return null / the platform-unavailable path, never a
// blanket-truthy stub). A suite that needs specific behavior self-mocks
// expo-modules-core with jest.mock(), which overrides this map.
//
// Referenced ONLY by an explicit moduleNameMapper entry in jest.config.cjs (this
// directory is deliberately NOT the reserved `__mocks__/`, so there is no
// surprise auto-mock — the map is the single, controlled activation point).

class CodedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CodedError";
    this.code = typeof code === "string" ? code : "ERR_UNSPECIFIED";
  }
}

class UnavailabilityError extends CodedError {
  constructor(moduleName, propertyName) {
    super(
      "ERR_UNAVAILABLE",
      `${moduleName}.${propertyName} is not available on this platform.`,
    );
    this.name = "UnavailabilityError";
  }
}

class EventEmitter {
  addListener() {
    return { remove() {} };
  }
  removeListener() {}
  removeAllListeners() {}
  emit() {}
}

class NativeModule extends EventEmitter {}
class SharedObject extends EventEmitter {}
class SharedRef extends SharedObject {}

module.exports = {
  __esModule: true,
  CodedError,
  UnavailabilityError,
  EventEmitter,
  NativeModule,
  SharedObject,
  SharedRef,
  NativeModulesProxy: {},
  // Native module lookups: unavailable in node — return null / empty (never a
  // fabricated implementation), matching how the real requireOptional* behaves
  // off-device.
  requireNativeModule: () => ({}),
  requireOptionalNativeModule: () => null,
  requireNativeViewManager: () => null,
  requireNativeView: () => null,
  registerWebModule: (mod) => mod,
  Platform: { OS: "web", select: (spec) => (spec ? spec.web ?? spec.default : undefined) },
  uuid: {
    v4: () => "00000000-0000-4000-8000-000000000000",
    v5: () => "00000000-0000-5000-8000-000000000000",
  },
};
