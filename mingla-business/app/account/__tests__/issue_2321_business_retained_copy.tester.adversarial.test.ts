// @ts-nocheck — Deno-runtime contract test; the app TypeScript project does not
// include Deno globals. This is the independent tester guard for issue #2321.
//
// Different angle from the implementor tests: those exercise the consumer step
// selector and backend side evaluator. This guard attacks the Business mirror's
// terminal-state wiring and user-visible copy. A retained Explorer login must be
// carried from the real response into Step4Success and must never wear the
// recoverable/full-deletion headline.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = (await Deno.readTextFile(new URL("../delete.tsx", import.meta.url)))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

function sliceFunction(name: string): string {
  const start = source.indexOf(`const ${name}:`);
  assert(start >= 0, `${name} must exist`);
  const end = source.indexOf("\n);", start);
  assert(end > start, `${name} must have a readable terminal body`);
  return source.slice(start, end + 3);
}

const route = source.slice(
  source.indexOf("const handleConfirmDelete"),
  source.indexOf("// ---- Render ----"),
);
const step4 = sliceFunction("Step4Success");
const retainedArm = step4.slice(
  step4.indexOf("{retained ? (") + "{retained ? (".length,
  step4.indexOf(") : ("),
);
const removedArm = step4.slice(
  step4.indexOf(") : (") + ") : (".length,
  step4.lastIndexOf(")}"),
);

Deno.test("#2321 tester · the edge response actually drives the Business terminal state", () => {
  assertStringIncludes(route, "const retained = result.authRetained === true");
  assertStringIncludes(route, "setAuthRetained(retained)");
  assertStringIncludes(source, "<Step4Success retained={authRetained} />");
});

Deno.test("#2321 tester · retained Business deletion names the surviving Explorer login and next action", () => {
  assertStringIncludes(retainedArm, "Business Account Deleted");
  assertStringIncludes(
    retainedArm,
    "Your business account is gone. Your Explorer login still works.",
  );
  assertStringIncludes(
    retainedArm,
    "To remove that too, delete your account in the Mingla app.",
  );
  assert(
    !retainedArm.includes("Account scheduled for deletion"),
    "a retained login must not render the non-retained/recoverable headline",
  );
});

Deno.test("#2321 tester · true auth removal keeps the existing recoverable-deletion copy", () => {
  assertStringIncludes(removedArm, "Account scheduled for deletion");
  assertStringIncludes(
    removedArm,
    "You can recover it by signing in again within 30 days.",
  );
  assert(
    !removedArm.includes("Business Account Deleted"),
    "the two terminal outcomes must remain distinct",
  );
});
