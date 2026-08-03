/**
 * Issue #996 implementor guard: A5 must inject a local fetch implementation.
 *
 * This test reads source only. It never imports or executes the A5 suite, so it
 * cannot contact an ad platform. Set ISSUE_996_A5_SOURCE to check an alternate
 * copy of the suite (used by the deterministic historical-source proof).
 */

const DEFAULT_A5_SOURCE = new URL(
  "./issue_865_wp_bc_adversarial.tester.test.ts",
  import.meta.url,
);
const A5_START_MARKER =
  "// ═══ A5 — a HANGING sender is bounded and absorbed; the hook still returns ok ═";
const A6_START_MARKER =
  "// ═══ A6 — Reddit pending-config does NOT block the other three ═";

function sourceTarget(): string | URL {
  const override = Deno.env.get("ISSUE_996_A5_SOURCE")?.trim();
  return override ? override : DEFAULT_A5_SOURCE;
}

function describeTarget(target: string | URL): string {
  return typeof target === "string" ? target : target.pathname;
}

function isolateA5(source: string, target: string): string {
  const start = source.indexOf(A5_START_MARKER);
  if (start < 0) {
    throw new Error(
      `Issue #996 guard could not find the A5 start marker in ${target}`,
    );
  }

  const end = source.indexOf(A6_START_MARKER, start);
  if (end < 0) {
    throw new Error(
      `Issue #996 guard could not find the A6 boundary after A5 in ${target}`,
    );
  }

  return source.slice(start, end);
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

Deno.test("issue #996: A5 keeps its local capturing fetch dependency", async () => {
  const target = sourceTarget();
  const targetLabel = describeTarget(target);
  const source = await Deno.readTextFile(target);
  const a5 = withoutComments(isolateA5(source, targetLabel));

  const declaration =
    /const\s*\{\s*fn\s*:\s*capturedFetch\s*\}\s*=\s*capturingFetch\s*\(\s*\)\s*;/;
  const declarationMatch = declaration.exec(a5);
  if (!declarationMatch) {
    throw new Error(
      `Issue #996: A5 hermetic fetch dependency is missing in ${targetLabel}; ` +
        "declare `const { fn: capturedFetch } = capturingFetch();` inside A5",
    );
  }

  const callStart = a5.indexOf("await fireAdConversion(");
  const callEnd = a5.indexOf("}).catch(", callStart);
  if (callStart < 0 || callEnd < 0) {
    throw new Error(
      `Issue #996 guard could not isolate A5's fireAdConversion call in ${targetLabel}`,
    );
  }

  const fireCall = a5.slice(callStart, callEnd);
  const injection = /fetchImpl\s*:\s*capturedFetch\s*,?/;
  if (!injection.test(fireCall)) {
    throw new Error(
      `Issue #996: A5 does not inject its local fetch into fireAdConversion in ${targetLabel}; ` +
        "TikTok, Snap, and Reddit could fall back to globalThis.fetch",
    );
  }

  const declarationOffset = declarationMatch.index;
  const injectionOffset = a5.indexOf("fetchImpl", callStart);
  if (declarationOffset >= injectionOffset) {
    throw new Error(
      `Issue #996: A5 uses capturedFetch before its local declaration in ${targetLabel}`,
    );
  }
});
