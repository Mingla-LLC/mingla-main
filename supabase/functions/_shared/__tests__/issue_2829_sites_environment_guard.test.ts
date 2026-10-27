// #2829 — the edge-function half of the local-mode guard (R-8, AD-12).
// invariant: I-PROPOSED-2829-05 (DRAFT) — a 'local' service config row is
// refused by any function whose own SUPABASE_URL is not the local stack.
import { assertSitesEnvironmentAllowed } from "../sitesSecurity.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function refused(environment: unknown, url: string | undefined, cmsOrigin?: unknown): boolean {
  try {
    assertSitesEnvironmentAllowed(environment, url, cmsOrigin);
    return false;
  } catch (error) {
    return error instanceof Error && error.message === "sites_environment_refused";
  }
}

Deno.test("#2829 a local row is refused on a hosted project", () => {
  for (
    const url of [
      "https://gqnoajqerqhnvulmnyvv.supabase.co",
      "https://abcdefghijklmnopqrst.supabase.co",
      "http://gqnoajqerqhnvulmnyvv.supabase.co",
      "http://localhost.attacker.invalid:54321",
      "http://127.0.0.1.attacker.invalid",
      "https://127.0.0.1:54321",
      "",
      undefined,
    ]
  ) assert(refused("local", url), `local row accepted with SUPABASE_URL=${url}`);
});

Deno.test("#2829 a local row is accepted only inside the local stack", () => {
  for (
    const url of [
      "http://127.0.0.1:55321",
      "http://localhost:55321",
      "http://kong:8000",
      "http://host.docker.internal:55321",
    ]
  ) assert(!refused("local", url), `local row refused with SUPABASE_URL=${url}`);
});

Deno.test("#2829 production rows (and pre-#2829 rows) keep working everywhere", () => {
  for (const environment of ["production", undefined, null]) {
    assert(
      !refused(environment, "https://gqnoajqerqhnvulmnyvv.supabase.co"),
      `production row refused: ${environment}`,
    );
  }
  for (const environment of ["staging", "", 1, "LOCAL"]) {
    assert(refused(environment, "http://127.0.0.1:55321"), `unknown environment accepted: ${environment}`);
  }
});

Deno.test("#2829 brand-site-control checks the environment before signing to the CMS", async () => {
  const source = await Deno.readTextFile(
    new URL("../../brand-site-control/index.ts", import.meta.url),
  );
  const select = source.indexOf('.select("cms_origin,environment")');
  const guard = source.indexOf("guardSitesEnvironment(config.environment, config.cms_origin)");
  const sign = source.indexOf("resolveCoreToCmsSigner()");
  assert(select >= 0 && guard > select && sign > guard, "environment guard is not ahead of CMS signing");
  assert(source.includes("if (config === null || !environmentAllowed)"), "guard result is not enforced");
});

Deno.test("#2829 A2.3 the Docker host gateway is a local-only CMS origin", () => {
  const local = "http://kong:8000";
  for (const origin of ["http://host.docker.internal:3101", "http://localhost:3101", "http://127.0.0.1:3101"]) {
    assert(!refused("local", local, origin), `local CMS origin refused: ${origin}`);
  }
  for (
    const origin of [
      "https://host.docker.internal:3101",
      "http://host.docker.internal",
      "http://host.docker.internal.attacker.invalid:3101",
      "https://studio.sites.usemingla.com",
      42,
    ]
  ) assert(refused("local", local, origin), `local row accepted CMS origin ${origin}`);
  const hosted = "https://gqnoajqerqhnvulmnyvv.supabase.co";
  for (
    const origin of [
      "http://host.docker.internal:3101",
      "https://host.docker.internal:3101",
      "https://localhost:3101",
      "https://127.0.0.1:3101",
    ]
  ) {
    assert(refused("production", hosted, origin), `production row accepted CMS origin ${origin}`);
    assert(refused(undefined, hosted, origin), `pre-#2829 row accepted CMS origin ${origin}`);
  }
  assert(!refused("production", hosted, "https://studio.sites.usemingla.com"), "production CMS origin refused");
});
