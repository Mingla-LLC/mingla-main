# Mingla Sites Pilot Operations

This runbook covers the Gogi Restaurant pilot for the fixed Restaurant Website
v1 renderer. Customer-facing messages must say only “Mingla Studio”, “Restaurant
Website v1”, and safe catalogue error text. Never expose infrastructure provider
names, database terms, object keys, signed URLs, raw responses, credentials, or
customer draft content.

## Scope and authorities

- Mingla Core owns identity, effective rank, site/host state, commerce truth,
  operation receipts, attribution, and active/last-good publication pointers.
- Mingla Studio owns tenant-isolated drafts, versions, media records, publication
  jobs, and private objects. The public runtime owns no draft or commerce truth.
- The public runtime resolves the exact Gogi pilot host through a signed
  runtime-to-Core request and renders only a digest-verified immutable artifact.
- No staging or per-brand project exists. Local migrations, isolated temporary
  restore targets, private previews, last-good delivery, and rollback are the
  pilot controls.
- Rank 10 receives no internal Website signal. Ranks 20–60 can read, edit, use
  Ari, preview, publish, and rollback. Only ranks 50–60 can provision, reconcile,
  perform permitted live-host-affecting work, or read the customer audit view.
- Custom domains and DNS mutations are outside this runbook and remain deferred.

## Launch gates

Keep the feature flag off and block the first publish until all of the following
have issue evidence:

Bootstrap remains disabled: create the private `sites_v1` service row with only
Gogi's `pilot_brand_id` bound and `pilot_enabled = false`, provision that brand,
then bind the returned `pilot_site_id` while leaving the pilot disabled. Core
rejects provisioning for every other brand. Set `pilot_enabled = true` only
after every launch gate below passes and the separate activation is approved.

1. Daily database backup entitlement is verified with at least seven days of
   retention, and the most recent evidence is no older than 26 hours.
2. The nightly object manifest covers artifact/media key, byte count, digest,
   site, reference state, and retention protection; evidence is no older than
   26 hours.
3. An isolated temporary restore proves tenant counts, object availability, and
   digests; the temporary target is destroyed and evidence is no older than
   100 days. Repeat quarterly while the pilot is live. Do not claim PITR.
4. The permanent pilot host passes exact-host/TLS/HTTP 200, publication and
   digest headers, canonical/robots/sitemap, required assets, keyboard/focus,
   image-alt, consent, CTA, provider-leak, and responsive 320/375/768/1024/1440
   probes.
5. A CMS application/database fault leaves the already published last-good page
   healthy, and a failed candidate publish leaves the Core pointer unchanged.
6. Secret inventory shows the exact approved 88-name manifest, the sole #2830
   slot-88 exception, zero missing/unexpected names, and zero high/critical
   dependency findings. A code merge does not authorize setting or distributing
   a live secret.

## Safe evidence and service objectives

Structured events may contain only request ID, operation ID, site ID,
publication ID, direction, route, state transition, latency, retry count, safe
error code, and version. Never record raw exchange/preview/attribution tokens,
cookies, authorization headers, signatures, storage URLs, secrets, artifact or
customer prose, email, raw URL/query, raw user agent, or provider bodies.

- Already available last-good public artifact: RTO zero across a CMS outage,
  subject to public runtime/object delivery availability.
- Public code/config rollback: at most 30 minutes.
- Studio edit/publish recovery: at most eight hours.
- Database/media RPO: at most 24 hours.
- Pilot regional-loss recovery target: at most 24 hours.

Page immediately for a confirmed tenant escape, wrong-host artifact, secret
exposure, signature/replay anomaly burst, or active-pointer/live-digest mismatch.
Disable only the affected route or pilot and preserve evidence without sensitive
values. Urgent thresholds are publish failures above 5% over 15 minutes with at
least five operations, public 5xx above 1% over five minutes with at least 100
requests, an ambiguous operation older than five minutes, or backup/object
manifest evidence older than 26 hours. Warn for p95 public TTFB above 1.5 seconds
over 15 minutes, a media job eligible for READY older than ten minutes, more than
ten retryable media failures, or a restore drill older than 100 days. CMS cached
read authority older than five minutes is urgent.

## Incident playbooks

### Studio or database outage

Pause provisioning, edits, media, previews, and publication; do not move the
active pointer. Verify the public exact-host artifact still serves. Restore the
Studio service from the last verified database backup and required objects into
an isolated target, verify tenant counts/digests, repair forward, then resume
privileged work. Sites application owns service/publish; Platform owns recovery.

### Public runtime outage

Keep Studio available but pause publish pointer commits. Restore the last known
good runtime revision/config within 30 minutes. Prove exact host, digest,
canonical, consent, and CTA before resuming. Never fall back to another tenant,
wildcard host, draft, or “first result”.

### Artifact or object corruption

Compare the Core pointer, immutable key, byte digest, and object-manifest record.
Do not serve unverified bytes. Restore the exact retained object, or create an
audited last-good pointer recovery. Re-probe before cache invalidation. Active,
last-good, retained rollback-source, newest 50, and under-90-day artifacts are
never cleanup candidates.

### Secret compromise or signature/replay burst

Page Security and Platform, block privileged Sites operations, and preserve
last-good public delivery. Rotate only the affected directional key: receiver
accepts new current plus old previous, sender moves to new current, controlled
current/previous/unknown/tamper/expiry/replay probes pass, and previous is removed
within 24 hours. For the attribution pepper, pause issuance and drain 30 minutes;
an incident rotation may invalidate outstanding tokens. Never reconstruct from
deployed readback or log key material.

### Tenant-isolation incident

Disable the affected route/pilot, revoke editor sessions, stop publication and
retention cleanup, preserve value-blind audit/nonce/receipt evidence, and engage
Security. Prove Core-derived identity and tenant, forced RLS, Payload tenant
hooks, relationship depth, versions/jobs/upload/preview, and exact host before
reenabling. Support uses provider-neutral copy.

### Stuck publish or ambiguous callback

Look up the existing operation ID and receipt. Never mint a second operation or
republish blindly. Reconcile by operation ID; verify exact revision, source
digest, immutable key/readback, candidate probe, Core pointer, and post-commit
live digest. If intended live truth cannot be proved, restore the previous
last-good pointer with an audited system operation.

### Media backlog or retention cleanup

Pause new uploads if the oldest eligible job exceeds ten minutes or retryable
backlog exceeds ten. Retry only immutable tenant/path/checksum-bound work.
Quarantine failures are removed within one hour, successful raw originals within
24 hours, and retryable raw objects within 72 hours. Customer deletion first
tombstones and removes future draft use; physical purge waits 30 days and a live
Core protection projection. A missing/incomplete protection projection blocks
the sweep.

### Backup or restore failure

Block first publish; after launch declare an incident and pause new publication.
Do not mark evidence current manually. Re-run the actual backup/object manifest,
perform the isolated restore, verify tenant/object digests, destroy the temporary
target, and record only timestamps/counts/evidence digest.

### Suspension and last-good recovery

Internal Admin may suspend/resume with an idempotent operation ID and reason
code. Suspension never deletes content or rewrites publication history. Recovery
selects an exact retained source and creates a new immutable publication or an
audited pointer repair; it never mutates a historical row or performs a
destructive database rollback.

## Ownership

Sites application owns service and publication behavior. Platform owns project,
storage, deployments, secrets, backups, and restore. Security owns isolation,
compromise, and incident review. Data/Product owns consent and retention.
Support owns provider-neutral customer communication. Independent testing owns
the release verdict; production authorization and post-deploy evidence remain
separate from implementation.
