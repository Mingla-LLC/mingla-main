# Paystack dispute evidence (Mingla MoR)

Issue #3645 WS5. Paystack NGN ticket charges are Mingla merchant-of-record; a Paystack dispute is Mingla's clock, not the organiser's.

## Who owns the clock

| Rail | MoR | Evidence / response owner | Provider window |
|---|---|---|---|
| Paystack (NGN ticket) | Mingla | Mingla ops (admin Money → Paystack disputes) | ~16h to auto-accept |
| Stripe direct-charge / Connect | Organiser (typical) | Organiser + Mingla support assist via Stripe disputes tab | Stripe evidence due |

Do not treat Stripe and Paystack dispute queues as interchangeable.

## Internal SLA (≪ 16h)

Internal deadline = `least(opened_at + 4 hours, response_due_by − 1 hour)`.

The admin list surfaces `internal_overdue` so the console goes red before Paystack's auto-accept.

## Workflow

1. **List** — Money ledger → Paystack disputes (soonest internal deadline first).
2. **Open** — auto-assembled dossier (order, tiers/qty, price/fees, consent, delivery, tickets/scans, provider ids). Gaps listed under `evidence_gaps`.
3. **Review** — human gate; server hashes the live dossier. Client never uploads evidence bytes.
4. **Export** — download the reviewed snapshot (filename ties to sha256). Requires review still current.
5. **Submit stub** — records immutable intent + snapshot with `provider_submit_status = not_sent_stub`. **Does not call Paystack yet.** Replace with live provider submit when API credentials and field map are approved.

If the dossier changes after review (new ticket, scan, consent, delivery), export/submit fail with `dossier_changed_since_review` until re-reviewed.

## Debt outcome

`record_paystack_dispute_outcome` still owns lose-accounting (merchant-accepted → organiser payout debt). Evidence workflow does not move money.

## Ops checklist for a live dispute

- [ ] Confirm rail is Paystack (not Stripe).
- [ ] Open dossier before internal deadline.
- [ ] Review → export → submit_stub (or live submit when enabled).
- [ ] Watch outcome webhook / resolve path for debt correctness.
