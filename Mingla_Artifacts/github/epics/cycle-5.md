# Cycle 5 — Ticket types: free / paid / approval / password / waitlist + reorder + visibility

**Phase:** Phase 2 — Core Wedge
**Estimated effort:** ~32 hrs
**Status:** 🟡 ACTIVE (next up)
**Codebase:** `mingla-business/`

## Scope

Cycle 3 shipped the **inline ticket sheet** (name + free toggle + unlimited toggle + price + capacity). Cycle 5 expands the standalone ticket-type editor with the full PRD §4.2 type matrix and §4.1 fields:

- **Ticket types** (radio-style picker inside the sheet): General / Early Bird / VIP / Free / Paid / Approval Required / Password Protected / Waitlist / Group / Add-on / Donation / Pay-What-You-Want
- **Visibility:** public / hidden / disabled (org-controlled toggle per ticket)
- **Sale + validity windows:** sale_start_at / sale_end_at / validity_start_at / validity_end_at
- **Approval-required flow:** ticket purchase enters pending → organiser approves/rejects (UI only this cycle; backend B4)
- **Password-protected flow:** buyer enters a password to unlock the ticket; UI captures password (hashed locally for now)
- **Waitlist:** when capacity hits 0, buyers join a waitlist; organiser invites them when slots open
- **Reorder:** drag-handle row + persisted display_order
- **Min/max purchase qty per buyer**
- **Allow transfers** toggle (per ticket)

## Journeys

- J-T1 — Add ticket type (open enhanced sheet, pick type, fill fields, save)
- J-T2 — Edit ticket type (sheet pre-fills, update + save)
- J-T3 — Reorder ticket types (drag-and-drop + persist display_order)
- J-T4 — Visibility toggle (public / hidden / disabled)
- J-T5 — Approval-required ticket flow (UI for the rule; orders flow lands B4)
- J-T6 — Password-protected ticket flow (hash locally; backend hashing lands B4)
- J-T7 — Waitlist enable + capacity-zero buyer-flow stub

## Out of scope this cycle

- ❌ Real Stripe gating (UI signals it; B2 wires it live)
- ❌ Real waitlist invite emails (B5)
- ❌ Real approval notifications (B5 + push)
- ❌ Backend (DEC-071 — frontend-first)

## Definition of done

- [ ] All 13 ticket types from PRD §4.2 selectable
- [ ] Visibility toggle works on each card + reflected in Step 7 mini card
- [ ] Reorder persists across draft re-open
- [ ] Approval / password / waitlist UI states render correctly in Preview
- [ ] Validation extends to enforce sale-window + min/max-qty rules
- [ ] Schema v3 → v4 migration additive (existing tickets default sensibly)
- [ ] TypeScript strict compiles clean
- [ ] `/ui-ux-pro-max` consulted for sheet redesign + reorder affordance
- [ ] Implementation report + closing commit

## References

- BUSINESS_PRD §4.1 (27 ticket fields), §4.2 (13 ticket types)
- Cycle 3 baseline: `mingla-business/src/components/event/CreatorStep5Tickets.tsx`
- Memory rule: keyboard never blocks an input field — applies to the new ticket sheet redesign
- Decision log: DEC-079 (kit closure — no new primitives unless surfaced 3+ times)

## Notes for the engineer

The ticket sheet from Cycle 3 already has an excellent keyboard pattern (dynamic snap + Keyboard listener + paddingBottom). REUSE IT. The Cycle 4 chip-based inheritance pattern (MultiDateOverrideSheet) might be useful for "type" selection if you want it to feel like "starting from a template."

User stories for this cycle live in `Mingla_Artifacts/github/user-stories/cycle-5/` — start there.
