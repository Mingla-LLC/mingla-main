// #2323 — lower `import(...)` to `Promise.resolve().then(() => require(...))`
// for the render-proof lane ONLY.
//
// `useAttendanceClaimArm` mints the claim link behind a dynamic `import()`, and
// #2323 deliberately KEEPS it that way so the shipped bundle graph is byte-for-
// byte what it was (the eager `__common` budget is ratcheted; a static import
// would move a module into it for a test's convenience).
//
// Under `babel-preset-expo` that `import()` survives into the transform output,
// and jest's CJS runtime throws
//   "A dynamic import callback was invoked without --experimental-vm-modules"
// BEFORE the hook's own code runs. The suite would then be measuring the
// harness, not the product — and `jest.mock` would never apply, so every
// assertion about what the hook mints would pass or fail for the wrong reason.
//
// Metro does this same lowering for the real app. This is a transform, not a
// stub: the hook's own logic is untouched and is what the assertions read.
module.exports = function dynamicImportToRequire({ types: t }) {
  return {
    name: "issue-2323-dynamic-import-to-require",
    visitor: {
      Import(path) {
        const call = path.parentPath;
        if (!call.isCallExpression()) return;
        call.replaceWith(
          t.callExpression(
            t.memberExpression(
              t.callExpression(
                t.memberExpression(t.identifier("Promise"), t.identifier("resolve")),
                [],
              ),
              t.identifier("then"),
            ),
            [
              t.arrowFunctionExpression(
                [],
                t.callExpression(t.identifier("require"), call.node.arguments),
              ),
            ],
          ),
        );
      },
    },
  };
};
