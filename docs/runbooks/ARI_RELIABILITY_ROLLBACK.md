# Ari reliability certification and rollback

This runbook owns the release-safety sequence for issue #2060. It does not
replace the domain rollback instructions owned by each Pass 4 issue.

## Release preflight

1. Freeze the candidate to one merge SHA. Build `agent-chat` and
   `agent-confirm-action` from that same checkout and embed the SHA through
   `MINGLA_RELEASE_SHA`.
2. Record the two deployed function versions and downloaded bundle hashes, the
   Business web deployment, the Business iOS simulator and physical-device
   artifacts, and the Business Android artifact in one `ari_cert_run_id`.
3. Refuse certification when any artifact is unattested, carries another SHA,
   or when any canonical ledger row remains `broken`, `registered_unverified`,
   or `in_flight`.
4. Run `node scripts/ari/certify-capabilities.mjs --plan` to produce the exact
   116-row scenario plan. The plan is derived from the canonical ledger; do not
   maintain a second row list.
5. For every iOS scenario and tenant/role case, capture both simulator and
   physical-iPhone evidence. Listing a physical build in the run manifest does
   not satisfy the physical scenario matrix.
6. Before calling `ari_cert_record_evidence`, a database-owner adapter for the
   capability must prove the exact operation, request, turn, execution, receipt,
   canonical readback, readback digest, and telemetry references and insert the
   immutable tuple into `private.ari_cert_verified_provenance`. Neither a client
   nor `service_role` can populate that table. A dependency without a canonical
   adapter therefore blocks certification instead of accepting asserted IDs.

## Fixture discipline

- Use dedicated accounts and brands. Mint one unguessable `ari_cert_run_id` and
  record every created database row, upload, schedule, provider sandbox object,
  and external sink identifier in `ari_cert_fixtures` before exercising it.
- Never use a shared demo account or an untagged fixture.
- Clean in reverse dependency order: provider schedules and sends, uploads,
  domain children, domain roots, Ari operations/pending actions/messages,
  conversations, brands, profiles, then disposable auth users.
- Mark a fixture `removed` only with a canonical zero-residue read reference.
  A missing cleanup receipt is a release blocker, not permission to erase the
  evidence row.

## Compatible rollback sequence

1. Disable new Ari intake at the routing/config layer while keeping reads and
   reconciliation available. Do not disable #2013 tenant containment or #2019
   caller-bound authorization.
2. Query pending, executing, and `reconciliation_required` operations. Drain
   safe pending work; reconcile every executing/unknown operation through its
   Pass 4 canonical owner. Do not mint replacement execution IDs.
3. Re-publish the previously certified `agent-chat` and
   `agent-confirm-action` bundles as a compatible pair. Never roll back one
   function alone.
4. Restore the compatible Business web artifact. Native clients remain on
   their existing runtime; if that runtime is below the minimum compatible
   protocol, the edge returns `MINIMUM_VERSION_REQUIRED` rather than falling
   back to the unsafe legacy response.
5. Do not down-migrate additive #2060 tables in production. They retain the
   evidence needed to replay or reconcile stable IDs across the rollback.
6. Prove zero stranded pending/executing/reconciling operations, then record
   the prior pair and rollback timestamp on the certification run.
7. Before re-enabling intake, live-fire one authenticated read, one proposed
   write with zero pre-confirm side effect, one confirmed write replay, and an
   outsider denial against the restored pair. Record the exact deployed SHA
   and bundle hashes.

## Certification command

After the independent tester has produced the immutable evidence JSON:

```bash
node scripts/ari/certify-capabilities.mjs --validate /absolute/path/to/evidence.json
```

Validation also requires `ARI_CERTIFICATION_ATTESTATION_KEY` from the deploy
owner's existing secret bundle. The database-owner tester adapter records the
independent verdict, cleanup manifest, and rollback rehearsal through
`ari_cert_record_completion` before finalization; `service_role` cannot execute
that function.
The database finalizer reads the same value
from `app.settings.ari_certification_attestation_key` plus the non-secret key
identifier in `app.settings.ari_certification_attestation_key_id`, computes the
ordered evidence, artifact, capability, native-runtime, cleanup, rollback, and
run-manifest digests, and returns the HMAC attestation stored in the evidence
file. The signed run manifest includes the tester verdict, both function
versions, and the web deployment identity. Never commit, print, or place that key in an issue; do
not create a standalone Supabase secret when the existing runtime bundle can
carry it.

The command must report all 116 capabilities. Any missing row, surface, role
matrix, canonical readback, release attestation, cleanup proof, rollback proof,
or independent PASS exits non-zero.
