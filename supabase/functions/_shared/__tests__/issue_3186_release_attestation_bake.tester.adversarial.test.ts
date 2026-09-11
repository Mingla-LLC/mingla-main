/**
 * #3186 tester adversarial — attacks the bake from angles the implementor suite
 * does not: source PRECEDENCE, the 40-vs-64 hex split between edge and client,
 * and whitespace/casing smuggling. Deliberately a different failure surface from
 * the happy path, not a renamed copy of it.
 */
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ARI_UNATTESTED_RELEASE,
  resolveReleaseAttestation,
} from "../agentReliability.ts";

const ENV_SHA = "b".repeat(40);
const BAKED = "c".repeat(40);
const envWith = (sha: string) => ({
  get: (name: string) => (name === "MINGLA_RELEASE_SHA" ? sha : undefined),
});

Deno.test("#3186 adversarial: env wins over bake, so no #2060 assertion moved", () => {
  // If bake won, every pinned #2060 test that injects the env var would silently
  // start asserting a different value. Precedence is the compatibility contract.
  const attested = resolveReleaseAttestation(envWith(ENV_SHA), BAKED);
  assertEquals(attested.release_sha, ENV_SHA);
  assertNotEquals(attested.release_sha, BAKED);
});

Deno.test("#3186 adversarial: a junk env value falls through to the bake, not to unattested", () => {
  // The #3185 shape in miniature: a present-but-invalid value must not be
  // treated as authoritative, and must not discard a good bake either.
  for (const junk of ["unattested", "not-a-sha", "", "   ", "z".repeat(40)]) {
    assertEquals(
      resolveReleaseAttestation(envWith(junk), BAKED).release_sha,
      BAKED,
      `junk env "${junk}" should fall through to the bake`,
    );
  }
});

Deno.test("#3186 adversarial: both sources junk => unattested, never a half-truth", () => {
  assertEquals(
    resolveReleaseAttestation(envWith("nope"), "also-nope").release_sha,
    ARI_UNATTESTED_RELEASE,
  );
});

Deno.test("#3186 adversarial: a 64-hex digest passes the edge but NO client would accept it", () => {
  // The edge pattern is /^[0-9a-f]{40,64}$/ while the Business app's
  // RELEASE_SHA_RE is /^[0-9a-f]{40}$/. A 64-char digest therefore satisfies the
  // server and is rejected by every production build — #3185 from the other end.
  // The deploy is the gate that makes this unreachable: it refuses any
  // --merged-commit that is not exactly 40 lowercase hex (proved by the sibling
  // Node suite, which runs the real script). This test pins the hazard so the
  // day someone relaxes that guard, the reason is written down here.
  const sixtyFour = "d".repeat(64);
  const edgeAccepts = resolveReleaseAttestation(
    { get: () => undefined },
    sixtyFour,
  ).release_sha;
  assertEquals(edgeAccepts, sixtyFour);
  assert(
    !/^[0-9a-f]{40}$/.test(edgeAccepts),
    "a 64-hex attestation must NOT satisfy the client's exact-40 rule",
  );
});

Deno.test("#3186 adversarial: surrounding whitespace cannot smuggle a value in or out", () => {
  assertEquals(
    resolveReleaseAttestation({ get: () => undefined }, `  ${BAKED}  `)
      .release_sha,
    BAKED,
  );
  assertEquals(
    resolveReleaseAttestation(envWith(`\t${ENV_SHA}\n`), BAKED).release_sha,
    ENV_SHA,
  );
});
