/**
 * #3186 — the release attestation, baked into the deployed bundle.
 *
 * WHY THIS IS A FILE AND NOT A SECRET. `MINGLA_RELEASE_SHA` was declared
 * `optional_top_level` and set by nobody: the runbook told a human to "embed the
 * SHA" and no caller ever did. Production served `release_sha: "unattested"`,
 * the Business app's `assertAriEnvelope` rejected 100% of Ari responses, and Ari
 * was dead on every production build for nine days (#3185). Setting the secret
 * unblocked it but bought a worse problem: a project-global secret is pinned to
 * one commit, so the next deploy from any other commit would serve an
 * attestation naming the WRONG code — silent, and passing every gate.
 *
 * A baked constant fixes both. It travels WITH the bundle it describes, so it
 * cannot drift from the code it attests to, and it costs no secret slot against
 * the founder-approved 88-name capacity target (docs/runbooks/SUPABASE_SECRET_CAPACITY.md).
 *
 * `scripts/deploy-supabase-functions.sh` REWRITES this file immediately before
 * deploying, substituting the merge commit it was given. The committed value is
 * deliberately the unattested sentinel: a checkout that was never deployed has
 * no release to attest to, and saying so is honest. Production builds reject the
 * sentinel (that is the #3185 gate working), dev builds tolerate it.
 *
 * DO NOT hand-edit the constant, and do not commit a real SHA here — a committed
 * SHA is stale the moment the next commit lands, which is exactly the failure
 * mode this replaces.
 */
// Deliberately NO import from `agentReliability.ts`: that module imports this
// one, and a cycle would put this constant in the temporal dead zone at exactly
// the moment the envelope builder reads it. The literal is asserted equal to
// `ARI_UNATTESTED_RELEASE` by the #3186 regression suite instead.
//
// The line below is the deploy's substitution target. Keep it on one line and
// keep the spelling exact — `scripts/deploy-supabase-functions.sh` matches it.
export const BAKED_RELEASE_SHA = "unattested";
