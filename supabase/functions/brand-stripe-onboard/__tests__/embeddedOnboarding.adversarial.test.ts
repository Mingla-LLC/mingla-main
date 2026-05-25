/**
 * ORCH-0954 adversarial regression for the embedded onboarding cutover.
 *
 * Different angle from the implementor happy-path test: missing
 * BUSINESS_WEB_ORIGIN must fail closed at module load for both URL-minting edge
 * functions, so neither onboarding nor account management can emit malformed or
 * wrong-origin embedded-component links.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

interface ImportRun {
  code: number;
  stderr: string;
  timedOut: boolean;
}

async function importModuleWithMissingOrigin(
  modulePath: string,
): Promise<ImportRun> {
  const repoRoot = new URL("../../../../", import.meta.url).pathname;
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      `
        Deno.env.delete("BUSINESS_WEB_ORIGIN");
        Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
        Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test");
        await import(${JSON.stringify(modulePath)});
      `,
    ],
    cwd: repoRoot,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  let timeoutId: number | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), 2_000);
  });
  const result = await Promise.race([child.output(), timeout]);
  if (timeoutId !== undefined) clearTimeout(timeoutId);

  if (result === "timeout") {
    child.kill("SIGTERM");
    await child.output().catch(() => undefined);
    return { code: -1, stderr: "import timed out", timedOut: true };
  }

  return {
    code: result.code,
    stderr: new TextDecoder().decode(result.stderr),
    timedOut: false,
  };
}

async function assertMissingBusinessOriginRejects(
  modulePath: string,
  label: string,
): Promise<void> {
  const result = await importModuleWithMissingOrigin(modulePath);

  assertEquals(
    result.timedOut,
    false,
    `${label} import must not start serve()`,
  );
  assert(
    result.code !== 0,
    `${label} import must fail without BUSINESS_WEB_ORIGIN`,
  );
  assertStringIncludes(
    result.stderr,
    "BUSINESS_WEB_ORIGIN env var is not set",
  );
  assert(
    !result.stderr.includes("https://business.usemingla.com"),
    `${label} must not fall back to the production origin when the secret is missing`,
  );
}

Deno.test("ORCH-0954 adversarial — embedded Connect URL functions fail closed without BUSINESS_WEB_ORIGIN", async () => {
  await assertMissingBusinessOriginRejects(
    "./supabase/functions/brand-stripe-onboard/index.ts",
    "brand-stripe-onboard",
  );
  await assertMissingBusinessOriginRejects(
    "./supabase/functions/brand-stripe-account-session/index.ts",
    "brand-stripe-account-session",
  );
});
