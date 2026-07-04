# SPEC — ORCH-1298 [chip-in-receipt-emails]

Binding build contract. Follows `INVESTIGATION_ORCH-1298_CHIP_IN_RECEIPT_EMAILS.md` (read it first).
Worktree: `~/Desktop/mingla-orchs/ORCH-1298-[chip-in-receipt-emails]/` on branch
`ORCH-1298-chip-in-receipt-emails`.

---

## 1. Executive summary

When a voluntary chip-in gift clears (`event_rsvp_contributions.status` flips to `paid`), send two
notifications, exactly once, on BOTH payment rails (Stripe + Paystack):

1. **Guest receipt** — a gift-framed thank-you email ("Thanks for chipping in 💛 — your {amount} gift to
   {event} is in"). Works for anon guests (raw `guest_email`) and logged-in guests (account). Logged-in
   guests also get the in-app + push copy.
2. **Host alert** — a positive "you received a gift" moment to the brand team: business-app push + in-app
   ("{guest} chipped in {amount} to {event}"), plus one brand-contact email.

The single enqueue point is `finalize_rsvp_contribution`'s **non-replay branch** — a pure-SQL INSERT of
two `notification_outbox` rows (guest + host, host fanned out per team member). Because BOTH rails call
this one idempotent RPC, we write the enqueue ONCE and it can never double-send. Drained by the existing
1-min cron → `notify-dispatch` v2 → Resend (email) / OneSignal (business-app push) / in-app. No money math,
no paid-flip, and no chip-in UI changes.

---

## 2. Scope & non-goals

**In scope:**
- Extend `finalize_rsvp_contribution` (RPC) to enqueue guest + host notifications on first `paid`.
- Seed two new `notification_categories`: `buyer_contribution_receipt` (guest) and
  `business.rsvp_contribution_received` (host).
- Add two `renderCategoryMessage` cases (guest + host copy) in `_shared/notifyTemplates.ts`.
- Both rails (Stripe + Paystack) — covered automatically by the shared RPC.

**Non-goals (explicit):**
- **Refund / cancellation / partial-refund receipts** — a fast-follow (`rsvp-contribution-refund`
  already exists; wire its receipts in ORCH-1298-B). Out of scope here.
- **SMS** — categories carry no `sms` channel (preserves DC-3). Out of scope.
- **App-screen UI** — no consumer/business screen changes; receipts are email/push/inbox only.
- **Money math / paid-flip logic / chip-in create + UI** — DO NOT TOUCH.
- **Migrating the ticket buyer-email or `business.order_paid` host path onto v2** — untouched.

**Assumptions (from the investigation):**
- The v2 outbox pipeline (outbox → `claim_notification_outbox` → `notify-outbox-drain` →
  `notify-dispatch` v2 → adapters) is live and complete (F-2, F-4, F-7).
- `finalize_rsvp_contribution` runs inside the webhook's transaction, so the enqueue commits atomically
  with the paid-flip (F-1, F-7).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behaviour | Files touched here | Parity |
|---|---------|----------|------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | Indirect | Logged-in guest who chipped in gets an in-app row + push "thanks"; email always. No screen code change. | none (server) | Automatic (server) |
| 2 | Consumer Android | Indirect | Same as iOS. | none | Automatic |
| 3 | Buyer/anon Web | Indirect | Anon guest (email only) gets the gift-framed email receipt. No web UI change. | none | Automatic |
| 4 | Business iOS | Indirect | Host (brand team) gets a business-app push + in-app "{guest} chipped in {amount}". | none | Automatic |
| 5 | Business Android | Indirect | Same as Business iOS. | none | Automatic |
| 6 | Admin Web (adjacent) | Not covered | n/a — admin is not a receipt recipient. | none | — |
| 7 | Business Web preview (adjacent) | Not covered | n/a — no preview surface change. | none | — |

All surfaces are reached via the shared backend (SQL RPC + notification pipeline); there is NO
per-surface app code, so parity is automatic. No native build / OTA is required (COMMS-0052/0063 N/A).

---

## 4. Layered specification

### 4.1 Database — migration `supabase/migrations/20261223000000_orch_1298_chip_in_receipt_enqueue.sql`

Monotonic version `20261223000000` (frontier across all worktrees = `20261222000000_orch_1296`;
verified §4.1-note). The migration does THREE things in order:

**(a) Seed the two categories** (idempotent `ON CONFLICT (key) DO UPDATE`, mirroring
`20261110000001_orch_1161_seed_notification_categories.sql`):

```
-- guest gift receipt: transactional; inapp+push+email; NO sms (DC-3 preserved).
('buyer_contribution_receipt', 'Purchases', true, 'normal',
   ARRAY['inapp','push','email'], 'reach_once'),
-- host gift-received: business.-prefixed key => v2 push routes to the BUSINESS app
-- (resolveOneSignalApp). inapp+push+email; NO sms.
('business.rsvp_contribution_received', 'Payments', true, 'normal',
   ARRAY['inapp','push','email'], 'reach_once')
```

> Copy is rendered in `notifyTemplates.ts` (§4.4), NOT in the seed. Both are `is_transactional=true`
> so `can_send` is on-by-default for the recipient; neither carries `sms`.

**(b) `CREATE OR REPLACE FUNCTION public.finalize_rsvp_contribution(uuid, text, text, text)`** — reproduce
the ORCH-1291 body VERBATIM (signature unchanged → no DROP), adding ONLY an enqueue block on the
non-replay branch, AFTER the `UPDATE … SET status='paid'` and BEFORE the final `RETURN`. Keep
`SECURITY DEFINER`, but change `SET search_path` to include `auth` for the guest-email COALESCE
(`SET search_path TO 'public', 'auth', 'pg_temp'`), or schema-qualify `auth.users` explicitly (preferred —
keep search_path as-is and write `auth.users`).

Enqueue block (illustrative shape — the implementor writes the full body):

```
-- Resolve the moment's facts from the row + a single events join.
--   v_event_title  := (SELECT title FROM public.events WHERE id = v_row.event_id);
--   v_guest_label  := COALESCE(NULLIF(btrim(v_row.guest_name),''), 'Someone');
--   v_guest_email  := COALESCE(v_row.guest_email,
--                              (SELECT u.email FROM auth.users u WHERE u.id = v_row.user_id));
-- payload carried to renderCategoryMessage (F-3): amount_cents + currency drive fmtAmount.
--   v_guest_payload := jsonb_build_object(
--     'contribution_id', v_row.id, 'event_id', v_row.event_id, 'event_title', v_event_title,
--     'amount_cents', v_row.amount_cents, 'currency', v_row.currency);
--   v_host_payload  := v_guest_payload || jsonb_build_object('guest_name', v_guest_label);

-- (1) GUEST receipt — one outbox row (contact = resolved email; user_id may be null=anon).
INSERT INTO public.notification_outbox
  (category_key, user_id, contact, brand_id, payload, idempotency_key)
VALUES ('buyer_contribution_receipt', v_row.user_id, v_guest_email, v_row.brand_id,
        v_guest_payload, 'chip_in_receipt:' || v_row.id || ':guest')
ON CONFLICT (idempotency_key) DO NOTHING;

-- (2) HOST push+in-app — one outbox row PER brand-team recipient (owner/admin/finance).
INSERT INTO public.notification_outbox
  (category_key, user_id, contact, brand_id, payload, idempotency_key)
SELECT 'business.rsvp_contribution_received', m.user_id, NULL, v_row.brand_id, v_host_payload,
       'chip_in_receipt:' || v_row.id || ':host:' || m.user_id
  FROM public.brand_team_members m
 WHERE m.brand_id = v_row.brand_id AND m.removed_at IS NULL AND m.accepted_at IS NOT NULL
   AND m.role IN ('brand_owner','brand_admin','finance_manager')
ON CONFLICT (idempotency_key) DO NOTHING;

-- (3) HOST email — one outbox row to the brand contact address (email leg; no user_id).
--     Only when brands.contact_email is present (fail-soft: skip if null).
INSERT INTO public.notification_outbox
  (category_key, user_id, contact, brand_id, payload, idempotency_key)
SELECT 'business.rsvp_contribution_received', NULL, b.contact_email, v_row.brand_id, v_host_payload,
       'chip_in_receipt:' || v_row.id || ':host_email'
  FROM public.brands b
 WHERE b.id = v_row.brand_id AND b.contact_email IS NOT NULL AND btrim(b.contact_email) <> ''
ON CONFLICT (idempotency_key) DO NOTHING;
```

Notes: the block runs ONLY on the non-replay branch (the RPC already early-returns before this on an
already-`paid` row — F-1/F-7). The host push rows carry `contact=NULL` → the email channel records
`skipped (no_contact)` while push (business app) + inapp fire. The host-email row (`user_id=NULL`) → the
`dispatchAnon` path emails once; inapp/push are skipped (no user). Enqueue failures must NOT abort the
paid-flip: wrap the enqueue in a nested `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING` block so the
money row still commits (mirror the "notifications are best-effort" posture of `fireOrderFinalizeNotifications`).

**No RLS change** — `notification_outbox`/`notification_categories` policies are unchanged; the RPC is
`SECURITY DEFINER` service-role. **No new columns.** `brands.contact_email` already exists (used as
`organizerEmail` in `ticket-confirmation-dispatch`); `brand_team_members(role, removed_at, accepted_at)`
already exist (used by `getBrandTeamUserIdsByRoles`).

### 4.2 Edge function — NONE new; two touched only to add copy

No new edge function. The existing `notify-outbox-drain` + `notify-dispatch` + `dispatchV2` + adapters
handle the drain/send unchanged (F-2). The ONLY edge change is the copy switch in §4.4 (shared module,
consumed by `notify-dispatch`). Re-deploy targets: `notify-dispatch` (and any fn bundling
`_shared/notifyTemplates.ts` — the orchestrator deploys per the edge-deploy runbook).

### 4.3 Service / Hook / Component — none

No service, hook, or component changes (backend + email/push only).

### 4.4 Copy — `supabase/functions/_shared/notifyTemplates.ts` (`renderCategoryMessage`)

Add two `case` branches BEFORE the `default`. Use `fmtAmount(payload)` for the money slot (currency-aware,
reads `amount_cents`+`currency`) and `str(payload.event_title, "your event")` / `str(payload.guest_name)`.
GSM-7 clean SMS strings are still returned (defensive), but neither category has an `sms` channel so the
SMS never sends.

```
case "buyer_contribution_receipt": {            // GUEST — gift-framed, NO tax/invoice language.
  const amount = fmtAmount(payload);
  return {
    push:  { title: "Gift received 💛",
             body: `Your ${amount} gift to ${eventTitle} is in — thank you!` },
    email: { subject: `Thanks for chipping in to ${eventTitle} 💛`,
             body:
               `Thank you for chipping in ${amount} to ${eventTitle}.\n\n` +
               `Your gift is confirmed. This is a thank-you, not a bill — there is nothing more to pay.\n\n` +
               `See you there!` },
    sms: `${brand}: Your ${amount} gift to ${eventTitle} is in. Thank you!`,
  };
}
case "business.rsvp_contribution_received": {   // HOST — positive "you got a gift" moment.
  const amount = fmtAmount(payload);
  const guest = str(payload.guest_name, "Someone");
  return {
    push:  { title: "You got a gift 🎁",
             body: `${guest} chipped in ${amount} to ${eventTitle}.` },
    email: { subject: `${guest} chipped in ${amount} to ${eventTitle}`,
             body:
               `Good news — ${guest} just chipped in ${amount} to ${eventTitle}.\n\n` +
               `It's on its way to your connected account. See the details in Mingla Business.` },
    sms: `${brand}: ${guest} chipped in ${amount} to ${eventTitle}.`,
  };
}
```

> DRAFT copy — shippable now; final polish may route to mingla-product. NO "tax", NO "invoice", NO
> "receipt of sale" language — this is a gift thank-you (Seth-locked, ORCH-1291 gift semantics).

### 4.5 Currency formatting

The amount renders in the CONTRIBUTION's currency (the brand settlement currency: USD/GBP/EUR/CHF or NGN).
The RPC puts `amount_cents = v_row.amount_cents` (the gift the guest named — WYSIWYG, equals
`buyer_total_cents`) and `currency = v_row.currency` into the payload; `fmtAmount` formats via
`Intl.NumberFormat(currency)`. NGN and other zero-/two-decimal currencies are handled by Intl.

---

## 5. Success criteria (observable, testable)

- **SC-1** — After a Stripe chip-in flips to `paid`, exactly ONE `notification_outbox` row exists with
  `category_key='buyer_contribution_receipt'` and `idempotency_key='chip_in_receipt:{id}:guest'`.
- **SC-2** — After the same finalize, ONE host outbox row exists per accepted owner/admin/finance team
  member with `category_key='business.rsvp_contribution_received'` and key
  `chip_in_receipt:{id}:host:{user_id}`; plus (if `brands.contact_email` set) one row keyed
  `chip_in_receipt:{id}:host_email`.
- **SC-3 (dual-rail)** — SC-1 + SC-2 hold identically when the finalize is driven by the Paystack rail
  (`paystackWebhookRouter` contribution branch).
- **SC-4 (guest email)** — after the drain, the guest email is sent via Resend to the resolved contact
  (`guest_email`, or `auth.users.email` for a logged-in guest with null `guest_email`); the body is
  gift-framed with the amount in the contribution's currency and contains NO "tax"/"invoice" strings.
- **SC-5 (host channels)** — the host push targets the BUSINESS OneSignal app (via the `business.`
  category prefix), an in-app `notifications` row (`type='business.rsvp_contribution_received'`) exists
  per team member, and one host email is sent to `brands.contact_email` when present.
- **SC-6 (idempotent replay)** — a REPLAYED webhook (second `finalize_rsvp_contribution` call for the same
  contribution) returns `idempotent_replay:true` and creates ZERO new outbox rows and ZERO new deliveries.
- **SC-7 (no money/UI regression)** — the paid-flip, `paid_at`, `stripe_charge_id`, and all money columns
  are byte-identical to the ORCH-1291 finalize; the chip-in create/UI is unchanged.

---

## 6. Invariants

| Invariant | How preserved | Verifying test |
|-----------|---------------|----------------|
| I-PROPOSED-W (notifications app-type-prefix) | Host category is `business.`-prefixed → push routes to business app; guest category is unprefixed → consumer app. | Assert `resolveOneSignalApp('business.rsvp_contribution_received')==='business'`. |
| DC-3 / I-PROPOSED-1161 (closed SMS set) | Neither new category has `sms` in `default_channels`. | Grep the seed: no `sms` on the two new keys. |
| I-PROPOSED-BA (ORCH-0788 template-key) | Untouched — this uses `category_key` (v2), not `ticket_order_notifications.template_key`. | `ticket-confirmation-dispatch` unchanged (diff = 0). |
| I-PROPOSED-V (stripe-notification-via-shared) | Untouched — no notification code added to `stripeWebhookRouter.ts`. | `stripeWebhookRouter.ts` diff = 0. |
| ORCH-1291 finalize money invariants | Body reproduced verbatim; only an additive enqueue block. | SC-7 + the ORCH-1291 finalize test still passes. |
| **I-PROPOSED-1298-CHIP-IN-RECEIPT-ENQUEUE (DRAFT)** | A first `paid` finalize enqueues exactly one guest + ≥one host outbox row; a replay enqueues none. | §7 T-1 / T-4 (fails-on-revert). Flips ACTIVE at CLOSE (orchestrator). |

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| **T-1 (happy, guest)** | Stripe contribution finalized first time | insert a `pending` contribution (guest_email set, brand w/ 1 owner), call `finalize_rsvp_contribution` | 1 `buyer_contribution_receipt` outbox row keyed `…:guest` | pgTAP/SQL |
| **T-2 (happy, host)** | same finalize | brand has owner+admin+finance accepted | 3 `business.rsvp_contribution_received` rows keyed `…:host:{uid}` + (if contact_email) 1 `…:host_email` | SQL |
| **T-3 (dual-rail)** | Paystack contribution finalized | contribution `provider='paystack'`, currency NGN | identical outbox rows to T-1/T-2 (amount in NGN) | SQL |
| **T-4 (ADVERSARIAL — replay enqueues nothing)** | call `finalize_rsvp_contribution` a SECOND time on the same (now `paid`) row | same args | RPC returns `idempotent_replay:true`; outbox row count UNCHANGED (0 new); no new deliveries | SQL |
| **T-5 (anon reachability)** | logged-in guest, `guest_email` NULL | contribution `user_id` set, `guest_email` NULL, `auth.users.email` present | guest outbox `contact` = the account email (COALESCE) | SQL |
| **T-6 (copy — no tax/invoice)** | render guest + host categories | `renderCategoryMessage('buyer_contribution_receipt', {amount_cents,currency,event_title})` | subject/body contain amount in currency; contain NO "tax"/"invoice"/"VAT" | Deno unit |
| **T-7 (push app routing)** | resolve host push app | `resolveOneSignalApp('business.rsvp_contribution_received')` | `'business'` | Deno unit |
| **T-8 (fail-soft)** | brand with no `contact_email`, no team members | finalize | paid-flip still commits; guest row present; zero host rows; no error | SQL |

---

## 8. Implementation order

1. **Migration `20261223000000_orch_1298_chip_in_receipt_enqueue.sql`:** (a) seed the two categories;
   (b) `CREATE OR REPLACE FUNCTION finalize_rsvp_contribution` = ORCH-1291 body verbatim + the enqueue
   block (nested exception-safe) on the non-replay branch; (c) `NOTIFY pgrst, 'reload schema'` (harmless).
2. **`_shared/notifyTemplates.ts`:** add the two `case` branches (§4.4).
3. **Tests:** T-1..T-8 (SQL under `supabase/migrations/__tests__/`, Deno units next to the touched fns).
4. Implementor writes `IMPLEMENTATION_ORCH-1298_*.md` with fails-on-revert proof for T-4 + T-1.

**Deploy (orchestrator, post-REVIEW):** apply the migration to prod (`--project-ref gqnoajqerqhnvulmnyvv`),
re-deploy `notify-dispatch` (bundles `_shared/notifyTemplates.ts`). No app build/OTA.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** T-1 (enqueue exists) + T-4 (replay enqueues nothing) are the paired guard.
  T-1 MUST FAIL if the enqueue block is removed (revert → 0 guest rows); T-4 MUST FAIL if idempotency is
  broken (revert of the `status <> 'paid'` guard → a replay would create a 2nd row). Both PASS when the
  fix is in place.
- **CI:** add a strict-grep registry gate `i-proposed-1298-chip-in-receipt-enqueue.mjs` asserting
  `finalize_rsvp_contribution`'s latest migration contains an `INSERT INTO public.notification_outbox`
  with `chip_in_receipt:` keys AND the seed contains both category keys with NO `sms`. Protective comment
  in the migration explaining WHY the enqueue lives on the non-replay branch (dual-rail single write +
  idempotency).

---

## 10. Open questions (for Seth / conductor — do NOT guess-resolve)

1. **Host email — parity vs. Seth's ask.** The existing ticket-sale host notification
   (`business.order_paid`) is **push + in-app ONLY, no email** (F-6). This SPEC ADDS a host email (to
   `brands.contact_email`) because Seth asked for "host = email + push/in-app". Confirm: keep the host
   email (recommended, honours the ask), or drop it for strict ticket-sale parity? If kept and
   `contact_email` is null, the host still gets push + in-app (fail-soft).
2. **Guest in-app/push for logged-in guests.** The guest category includes `inapp,push` so a logged-in
   guest gets a "thanks" in the CONSUMER app in addition to email; anon guests get email only. Confirm
   this is desired (email-only for everyone is the alternative — set guest `default_channels` to `{email}`).

---

## 11. Downstream routing

IMPLEMENT (mingla-implementor) — build the migration + copy + tests per §8 in this worktree; prove
fails-on-revert. → orchestrator applies the migration to prod + deploys `notify-dispatch`. →
TEST (mingla-tester) — live-fire a real chip-in on BOTH rails (Stripe + Paystack/NGN), confirm the guest
email + host push/in-app + host email arrive exactly once and a replayed webhook re-sends nothing. →
orchestrator CLOSE (flip I-PROPOSED-1298 ACTIVE, land the strict-grep gate, update WORLD_MAP).

---

## Scoped allowlist (implementor may change ONLY these)

- `supabase/migrations/20261223000000_orch_1298_chip_in_receipt_enqueue.sql` (NEW)
- `supabase/functions/_shared/notifyTemplates.ts` (add 2 cases)
- `supabase/migrations/__tests__/orch_1298_*.test.sql` (NEW) + Deno unit tests next to touched fns (NEW)
- `.github/scripts/strict-grep/i-proposed-1298-chip-in-receipt-enqueue.mjs` (NEW) + its workflow registry line
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1298_*.md` (NEW)

## DO-NOT-TOUCH (stop-and-amend before editing)

- The money math / `pricing_breakdown` / `buyer_total_cents` / `application_fee_amount_cents`, and the
  `status='paid' / paid_at / stripe_charge_id` flip logic in `finalize_rsvp_contribution`.
- `rsvp-contribution-create` / `rsvp-contribution-refund` / the chip-in UI (any `app-mobile`/`mingla-business` screen).
- `stripeWebhookRouter.ts`, `paystackWebhookRouter.ts`, `ticket-confirmation-dispatch`,
  `businessNotifyTriggers.ts`, `notify-dispatch/index.ts`, `notifyV2.ts`, the adapters, the outbox drain,
  and the ORCH-1161 foundation/seed/cron migrations (all reused UNCHANGED except the one copy switch in `notifyTemplates.ts`).
- `notification_outbox` / `notification_categories` / `notification_deliveries` schema (no ALTER).
