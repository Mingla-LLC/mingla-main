# B2a Path C V3 — Webhook Secret Rotation Runbook

**Status:** Operator-side runbook — minimal code changes (env-var swap only).
**Authoritative source:** B2a Path C V3 SPEC §13 amendment A1 + INVARIANT_REGISTRY I-PROPOSED-V/W.
**Owner:** Sethogieva or whoever holds Stripe Dashboard admin access.
**Estimated time:** 15-30 min per endpoint.

---

## Why this runbook exists

Stripe webhook signing secrets MUST be rotated periodically (Stripe security best practice: at least annually, immediately on any suspected compromise). A naïve rotation causes a delivery gap: events signed with the new secret arrive while our handler still verifies against the old, producing 400 responses and triggering Stripe's retry storm.

V3 deploys a **dual-secret pattern**: the webhook handler tries `STRIPE_WEBHOOK_SECRET` first, falls back to `STRIPE_WEBHOOK_SECRET_PREVIOUS` if the first fails. This lets a rotation proceed with **zero delivery loss** if executed in the order below.

V3 also requires a **third secret** `STRIPE_WEBHOOK_SECRET_PLATFORM` for the Platform-context endpoint (per amendment A1). When rotating either, follow the same pattern but adjust env-var names accordingly.

---

## Pre-flight

- [ ] Confirm operator has Stripe Dashboard admin access at the live OR test workspace being rotated.
- [ ] Confirm operator has Supabase project admin access to update edge function secrets.
- [ ] Confirm CI is green on `Seth` branch (no in-flight Sub-dispatch B/C work that would invalidate the deploy).
- [ ] Notify ops Slack channel that a rotation is starting (event delivery pause possible if rotation is mishandled).

---

## Procedure

The webhook handler reads three env vars per amendment A1:

| Env var | Role |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | **Primary** — current Connect endpoint signing secret. Tried first. |
| `STRIPE_WEBHOOK_SECRET_PLATFORM` | **Primary platform** — current Platform endpoint signing secret. |
| `STRIPE_WEBHOOK_SECRET_PREVIOUS` | **Rotation fallback** — set to the OLD signing secret during the rotation window. Set to empty string outside rotation. |

This runbook covers rotating the **Connect endpoint** secret. To rotate the Platform endpoint, repeat with `STRIPE_WEBHOOK_SECRET_PLATFORM` substituted.

### Step 1 — Move current secret into the fallback slot

In Supabase → Project Settings → Edge Functions → Secrets:

1. Read the current value of `STRIPE_WEBHOOK_SECRET`.
2. Set `STRIPE_WEBHOOK_SECRET_PREVIOUS` to that exact value.
3. **Do NOT change `STRIPE_WEBHOOK_SECRET` yet.**
4. Trigger an edge fn redeploy or wait for the secret-propagation tick (Supabase typically takes 30-60 s).

After this step, the handler still verifies against the same secret in the primary slot AND now has a copy in the fallback slot. No behavior change for incoming events.

### Step 2 — Roll the secret in Stripe

1. Open https://dashboard.stripe.com/webhooks (live) or `/test/webhooks` (test mode).
2. Click into the Connect endpoint (description: `Mingla Business V3 — Connect events (brand admin connected accounts)`; ID like `we_*`).
3. In the "Signing secret" panel, click **"Roll secret"** → confirm.
4. Stripe issues a new `whsec_*` value. Copy it.

Stripe begins signing new events with this new secret IMMEDIATELY. Events already in flight (queued retries) continue to be signed with the OLD secret until Stripe's internal cache rolls forward (typically <1 min).

**During this window**, our handler:
- Receives an event signed with the NEW secret → verification against `STRIPE_WEBHOOK_SECRET` (still old) FAILS → falls back to `STRIPE_WEBHOOK_SECRET_PREVIOUS` (also old) → ALSO FAILS → returns 400.

This is the gap the dual-secret pattern alone CANNOT close. Stripe retries on 400, so events aren't lost — they arrive again after Step 3 completes.

### Step 3 — Update `STRIPE_WEBHOOK_SECRET` to the new value

In Supabase → Project Settings → Edge Functions → Secrets:

1. Set `STRIPE_WEBHOOK_SECRET` to the NEW `whsec_*` value from Step 2.
2. Wait for redeploy / secret propagation (30-60 s).

After this, the handler's primary secret matches what Stripe signs with. New events verify against the primary; in-flight retries from Step 2 verify against `STRIPE_WEBHOOK_SECRET_PREVIOUS` (the old secret) on the fallback path.

### Step 4 — Verify both new and retried events are landing

1. Open Stripe Dashboard → Webhooks → endpoint → "Recent events" tab.
2. Trigger a test event from Stripe ("Send test webhook" → pick `account.updated`).
3. Confirm the test event delivers with a 200 response.
4. Watch Supabase edge fn logs for the next 5 minutes — verify no new 400s appear.
5. Sample a few `payment_webhook_events` rows; confirm `processed=true` for events received in the last 5 min.

If any 400s persist after 5 min, **abort and rollback** (Step 6).

### Step 5 — Clear the fallback after the retry window

After 24 hours (Stripe's max retry window for webhooks), no event signed with the old secret should still be arriving. To finish the rotation:

1. In Supabase, set `STRIPE_WEBHOOK_SECRET_PREVIOUS` to an **empty string** (`""`).
2. Wait for secret propagation (30-60 s).

The handler now verifies against only the new primary secret; the old secret is no longer trusted anywhere.

### Step 6 — Rollback (if Step 4 surfaces problems)

If 400s persist after Step 4 and you suspect the new secret is wrong:

1. Read the value Stripe shows for the endpoint's signing secret today (Stripe Dashboard → endpoint → "Signing secret" → "Click to reveal").
2. Compare to what's in Supabase as `STRIPE_WEBHOOK_SECRET`. They MUST match exactly.
3. If they don't match, paste the correct value from Stripe into Supabase. Wait for propagation.
4. If they DO match but 400s persist, the issue is downstream of signature verification — investigate handler code; this runbook can't help further.

---

## Audit trail

Every rotation MUST log an entry in `Mingla_Artifacts/DECISION_LOG.md` with:

- Date + time of rotation
- Reason (annual hygiene / suspected compromise / specific incident)
- Operator who performed the rotation
- Confirmation that Step 5 completed (no fallback secret left in place)

Lack of log entry is itself a security finding at the next audit.

---

## Post-rotation verification

24-48 hours after Step 5:

- [ ] Webhook delivery success rate ≥ 99% on the rotated endpoint (Stripe Dashboard → endpoint → metrics)
- [ ] `payment_webhook_events` no anomalous spike in `processed=false` rows
- [ ] No customer-facing reports of stuck onboarding / missing balance updates / failed payouts

If any of the above fails, treat as an incident — investigate before the next rotation cycle.
