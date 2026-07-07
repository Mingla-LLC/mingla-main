// ORCH-1321 [android-media-permission-strip] — dedicated jest config for the
// Android media-permission-skip behavioral test.
//
// The test imports platformImagePicker.native + coverPickerDeviceMedia.native at
// RUNTIME (to exercise the requestMediaLibraryPermissionsAsync /
// requestCoverMediaLibraryPermission wrappers end-to-end). Under the default
// node/ts-jest config, ts-jest type-checks every transformed module and
// platformImagePicker.native.ts trips a PRE-EXISTING baseline type error (its
// launchImageLibraryAsync/launchCameraAsync return ImagePickerResult, whose
// canceled shape has `assets: null`, against the wrapper's non-null
// PlatformImagePickerAsset[] return type). That mismatch predates ORCH-1321 (it
// is one of the 756 baseline `tsc` errors on origin/main) and is out of scope for
// the permission strip. `isolatedModules: true` transpiles without type
// diagnostics, so the RUNTIME behavior is exercised unchanged. Mirrors the repo's
// per-ORCH dedicated-config pattern (jest.orch1297.cfg.cjs, jest.orch1118.render.cjs, …).
const base = require("./jest.config.cjs");

module.exports = {
  ...base,
  transform: {
    ...base.transform,
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      { isolatedModules: true, tsconfig: { jsx: "react-jsx" } },
    ],
  },
};
