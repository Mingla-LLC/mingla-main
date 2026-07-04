// ORCH-1297 [bunny-tus-patch-auth-headers] — dedicated jest config for the
// TUS-PATCH-auth-headers behavioral test.
//
// The test imports eventCoverVideoProcessingService at RUNTIME (to exercise
// uploadEventCoverVideoSourceViaTus → patchHeaders end-to-end). Under the default
// node/ts-jest config, ts-jest type-checks every transformed module and the
// service trips a PRE-EXISTING baseline type error (the web stub
// platformFileSystem.ts types createMultipartUploadTask with 0 params while the
// service's Cloudinary path calls it with 4). That mismatch is out of ORCH-1297
// scope and already keeps the sibling eventCoverVideoProcessingService.test.ts
// from compiling on origin/main. `isolatedModules: true` transpiles without type
// diagnostics, so the RUNTIME behavior is exercised unchanged. Mirrors the repo's
// per-ORCH dedicated-config pattern (jest.orch1118.render.cjs, …).
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
