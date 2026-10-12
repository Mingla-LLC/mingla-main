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

## Re-activating the pilot after a deactivation

A deactivation switches the pilot off and returns its host to `pending`. Nothing
re-activates it automatically: the next green backup run does not, and no
scheduled job holds the credentials that activation needs. Until someone runs
the command below, the public host answers 404 on every route.

What deactivates the pilot: a backup run that proves a readiness violation (the
five `DATABASE_BACKUP_*` codes), or a backup job that fails without saying why.
What does not: a failure of the tenant retention sweep. That sweep is
housekeeping, runs in its own job after the backup evidence is committed, and a
failure there raises a `SITES_HOUSEKEEPING_ALERT` comment on the issue and one
email a day, and nothing else (#2830). A private-storage transport fault, a
read-back digest mismatch and an unusable bundle result do not deactivate
either: each leaves the site up on the evidence it already has and is reported
as held.

Who: whoever holds the Core service-role key. Today that is Seth's side only.

Last used: 2026-10-12. The operator re-activated the pilot with this procedure
after the 2026-10-07 deactivation, and it completed with the success line in
step 3.

Preconditions (activation refuses otherwise, and Core checks every one itself):

1. Backup evidence is under 26 hours old. That is three separate instants, all
   of which must be inside 26 hours: the backup entitlement stamp, the object
   manifest, and the database backup the run verified.
2. The restore drill is under 100 days old.
3. The pilot host is `pending`, which is the state a deactivation leaves it in.
4. Backup retention on record is at least 7 days.
5. The pilot is not already enabled. Running the command against a pilot that
   is already active is harmless: Core refuses the first call, the script stops
   with `PILOT_CONFIGURATION_FAILED`, and nothing changes.

Steps:

1. Confirm the cause of the deactivation is fixed, then take one fresh backup
   and wait for it to go green:

   ```
   gh workflow run "Mingla Sites · Backup and restore" -f mode=backup
   ```

   The `Private backup and isolated restore` job must conclude success and its
   log must contain `SITES_BACKUP_EVIDENCE_OK`.
2. The same day, from a checkout of `main`, with `SITES_PILOT_SITE_ID`,
   `SITES_CORE_BASE_URL`, `SITES_CORE_SERVICE_ROLE_KEY` and
   `SITES_CANDIDATE_PROBE_SECRET` set in the environment (never on the command
   line, never pasted anywhere). Do not leave it until the 26th hour: the
   oldest of the three instants in precondition 1 was taken during that run,
   before it finished, and the database backup it verified can be hours older
   still.

   The script checks the shape of each value before it calls anything, and
   stops with the code shown if one is wrong: the site id is a UUID; the Core
   base URL is character for character the Core origin the script pins
   (`CORE_ORIGIN_MISMATCH`); the service-role key is at least 80
   characters with no whitespace (`INVALID_CORE_SERVICE_KEY`); the candidate
   probe secret is base64 that decodes to exactly 32 bytes
   (`INVALID_CANDIDATE_PROBE_SECRET`).

   ```
   node scripts/sites/activate-gogi-pilot.mjs
   ```

   What the script checks before it activates, in order, stopping at the
   first failure with nothing activated:

   - the pilot binding is re-configured for the Gogi brand and reads back
     `configured` with the pilot still disabled;
   - the site is `published`, and its active publication is also its last
     successful publication;
   - that publication is `published`, is Restaurant Website v1 (artifact
     schema 1, renderer version 1), carries a valid artifact digest, and its
     artifact key is the one derived from the site, publication and digest;
   - a signed candidate probe of that exact publication on the pilot host
     passes, and the host readiness it records reads back `verified`.

   Core then applies the three preconditions above itself, plus a host probe
   no older than 15 minutes, which the probe in the same run satisfies.

   After activating, the script reads back the service configuration, the host
   row (`active`, primary) and a live request to the public host (HTTP 200,
   HTML, no infrastructure names in the page). If any read-back fails it
   deactivates again by itself and exits non-zero.
3. Expect exactly one success line:
   `SITES_GOGI_ACTIVATED site=<site id> publication=<publication id>`.
4. Confirm `https://gogi.sites.usemingla.com/` returns HTTP 200.
5. Record it on the issue: say that activation succeeded, with the date and the
   publication id from the success line. Do not paste the success line whole.
   It carries the site id, which is one of the four values, and none of the
   four belongs on a public issue.

If it fails, the script prints one line on stderr, `{"ok":false,"error":"<CODE>"}`,
and exits non-zero. Nothing else is printed. The codes:

| Code | What happened | What to do |
|---|---|---|
| `PILOT_CONFIGURATION_FAILED` | Core refused to re-bind the pilot. Most often the pilot is already enabled. | Check the public host. If it serves, there is nothing to do. |
| `PILOT_CONFIGURATION_READBACK_MISMATCH` | The binding did not read back as `configured` and disabled. | Do not retry blindly; read the service configuration. |
| `PILOT_SITE_READBACK_FAILED`, `PILOT_SITE_NOT_PUBLISHED` | The site is not `published`, or its active publication is not its last successful one. | Publish from Studio first. |
| `PILOT_PUBLICATION_READBACK_FAILED`, `PILOT_PUBLICATION_INVALID` | The publication is not a valid Restaurant Website v1 artifact. | Re-publish; do not edit the row. |
| `CANDIDATE_PROBE_FAILED` | The signed candidate probe of the pilot host did not pass. | Check the public runtime is deployed and the probe secret matches it. |
| `HOST_READINESS_RECORD_FAILED`, `HOST_READINESS_READBACK_MISMATCH` | Core refused to record host readiness, or it did not read back `verified`. | Retry once; then investigate Core. |
| `PILOT_ACTIVATION_FAILED` | Core refused activation: a precondition above is not met, or the call was lost. | Take a fresh backup (step 1), then retry. |
| `PILOT_ACTIVATION_READBACK_MISMATCH`, `PILOT_COMMITTED_READBACK_FAILED` | Activation was committed but a read-back or the live request failed. | The script has already deactivated again. Fix the cause, then start over. |
| `PILOT_DEACTIVATION_FAILED` | A step after the activation call failed AND the clean-up deactivation also failed. | Treat the pilot's state as unknown. Check the public host and the service configuration by hand. |

Two things about failure that are easy to get wrong:

- From the activation call onward, any failure triggers a compensating
  deactivation, including a refused or lost activation call, because a lost
  response may hide a committed activation. A refusal therefore also ends with
  the pilot deactivated and the host `pending`, which is where it started.
- When that compensating deactivation itself fails, the code reported is
  `PILOT_DEACTIVATION_FAILED` and the original cause is not printed.

Not provable from this repository alone: that the candidate-probe route
answers while the pilot is deactivated. The procedure completing on 2026-10-12,
from a deactivated pilot, is the evidence that it does.

## Sites operations alerts

A Sites operations failure is emailed to a person, once per failure kind and
code per UTC day, and recorded on issue #2830 (#2830 slice 2). The email is the
page; the issue comment is the record and the dedupe key.

Recipients are a repository secret, `MINGLA_SITES_OPS_ALERT_TO` (one address or
several, separated by commas). If it is unset the page falls back to the
red-main recipient, `MINGLA_MAIN_RED_ALERT_TO`. The sender uses the existing
`RESEND_API_KEY`. Never write an address into this repository, an issue, a pull
request, a log or a test: the repository and its Actions logs are public.

| Subject says | Kind | Meaning | Do |
|---|---|---|---|
| is OFFLINE | `PILOT_DEACTIVATED` | A backup run proved a readiness violation, or failed without saying why, and the pilot was switched off. | Fix the cause, then re-activate (section above). |
| Deactivation FAILED | `PILOT_DEACTIVATION_FAILED` | A backup failed and switching the pilot off also failed. | Check the public host now. |
| Site is up, backup did not complete | `BACKUP_FAILED_PILOT_HELD` | A backup failed for a reason that proves nothing about recoverability. The site is up on ageing evidence. | Run the backup again inside 26 hours. |
| Site is up, clean-up failed | `RETENTION_FAILED` | The retention sweep failed. The site and the backup are unaffected. | Read the sweep job's log. |
| Backup evidence expires in N h | `EVIDENCE_AGEING` | The hourly watchdog sees under 8 hours of the 26-hour budget left, or a restore drill past 93 days. | Run the backup. |
| Backup evidence has EXPIRED | `EVIDENCE_EXPIRED` | The budget is spent. Every page returns 404 until a backup run succeeds. | Run the backup. |
| could not be proven | `EVIDENCE_UNPROVEN` | The watchdog could not read its evidence. Not the same as the site being down. | Read the verdict line in the run. |
| Site is DOWN although backup evidence is fresh | `PILOT_HOST_DOWN_EVIDENCE_FRESH` | The public host is not answering 200 on two tries and the evidence is in budget. Usually a pilot that was deactivated and never re-activated. | Re-activate (section above). Sent daily while true. |

If the email cannot be sent (no recipient, no key, or the mail provider refuses
it), a `SITES_OPS_PAGE_DELIVERY_FAILED` comment appears on the issue and the job
is red. Treat that comment as "nobody is being emailed".

How the hourly watchdog decides, in order: the recovery evidence ledger (one
comment on the issue starting `SITES_RECOVERY_EVIDENCE_LEDGER v1`, written by
the backup run from the instants Core accepted, and edited in place); the backup
job's conclusion, which is printed as `secondary_job_success_at` and decides
only when no ledger exists; and one unauthenticated request to the public host,
printed as `public_host_status`. Only a ledger written by the workflow itself
counts. Do not edit or delete the ledger comment by hand: the next backup run
rewrites it, and until then the watchdog reports the evidence as unproven or
falls back to the job's conclusion.

A red run of the Sites backup workflow no longer turns the pre-merge `main`
check red. It is listed there on a line starting `OPERATIONS (not blocking,
paged separately)` and paged as above. Every other workflow still blocks.

## Ownership

Sites application owns service and publication behavior. Platform owns project,
storage, deployments, secrets, backups, and restore. Security owns isolation,
compromise, and incident review. Data/Product owns consent and retention.
Support owns provider-neutral customer communication. Independent testing owns
the release verdict; production authorization and post-deploy evidence remain
separate from implementation.
