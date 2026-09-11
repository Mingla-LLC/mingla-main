/**
 * #3186 implementor proof — the release attestation ships INSIDE the bundle.
 *
 * PURELY ADDITIVE. No existing expectation moves: the whole #2060 envelope suite
 * passes byte-for-byte against this change, which is the evidence that adding a
 * second attestation source did not redefine the first. `resolveReleaseAttestation`
 * reads env FIRST precisely so every pinned #2060 assertion that injects
 * `MINGLA_RELEASE_SHA` keeps its exact meaning.
 *
 * Context: #3185 — `MINGLA_RELEASE_SHA` was declared optional and set by nobody,
 * production served `release_sha: "unattested"`, the Business app rejected 100%
 * of Ari responses, and Ari was dead on every production build for nine days.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ARI_UNATTESTED_RELEASE,
  resolveReleaseAttestation,
} from "../agentReliability.ts";
import { BAKED_RELEASE_SHA } from "../releaseAttestationBake.ts";

const FORTY_HEX = "a".repeat(40);
const noEnv = { get: () => undefined };

Deno.test("#3186 happy: a baked SHA attests the bundle with no secret set", () => {
  const attested = resolveReleaseAttestation(noEnv, FORTY_HEX);
  assertEquals(attested.release_sha, FORTY_HEX);
});

Deno.test("#3186 happy: the baked SHA is lowercased like the env source", () => {
  const attested = resolveReleaseAttestation(noEnv, FORTY_HEX.toUpperCase());
  assertEquals(attested.release_sha, FORTY_HEX);
});

Deno.test("#3186 happy: no env and no bake still fails closed to unattested", () => {
  // This is the #3185 state. It must remain LOUD: the production client rejects
  // it on purpose, and a quiet fallback would have hidden the nine-day outage.
  assertEquals(
    resolveReleaseAttestation(noEnv, ARI_UNATTESTED_RELEASE).release_sha,
    ARI_UNATTESTED_RELEASE,
  );
  assertEquals(
    resolveReleaseAttestation(noEnv, "").release_sha,
    ARI_UNATTESTED_RELEASE,
  );
});

Deno.test("#3186 happy: the COMMITTED bake is the sentinel, never a real SHA", () => {
  // A committed SHA is stale the moment the next commit lands — the exact
  // failure mode the deploy-time bake replaces. The checked-in value must stay
  // the sentinel; only `scripts/deploy-supabase-functions.sh` may substitute it.
  assertEquals(BAKED_RELEASE_SHA, ARI_UNATTESTED_RELEASE);
});

Deno.test("#3186 happy: the deploy owns a bake target it can actually match", () => {
  const source = Deno.readTextFileSync(
    new URL("../releaseAttestationBake.ts", import.meta.url),
  );
  const targets = source
    .split("\n")
    .filter((line) => line.startsWith("export const BAKED_RELEASE_SHA = "));
  // Exactly one, on one line: the deploy's anchored substitution is only safe
  // while that is true, and it verifies its own effect afterwards.
  assertEquals(targets.length, 1);
});
