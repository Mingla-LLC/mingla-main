# Cycle B4 — Backend: scanner + door payments wired live

**Phase:** Phase 6 — Backend MVP
**Estimated effort:** ~56 hrs
**Status:** ⬜ PLACEHOLDER (MVP CUTLINE — last cycle before private beta)
**Codebase:** `supabase/` + `mingla-business/`

## Scope

Live scanner (QR validation against database, scan_events insert, dedupe, offline-sync). Live door payments via Stripe Terminal + iOS Tap to Pay (where available). Door-revenue ledger.

## Journeys (to refine)

- J-B4.1 — QR validation edge fn + scan_events insert + dedupe RPC
- J-B4.2 — Offline scan queue sync + conflict resolution
- J-B4.3 — Stripe Terminal integration (card-reader live)
- J-B4.4 — iOS Tap to Pay (NFC) integration — feature flag per device approval
- J-B4.5 — Door-revenue ledger + reconciliation hooks

## References

- BUSINESS_PROJECT_PLAN §B.5, §B.6
- R11 (NFC platform support — feature flag)

## Notes

**This is the MVP cutline.** When B4 ships and is stable, the private beta opens. After this, B5 (marketing) and B6 (chat agent) are post-launch enhancements. Strategic Plan §5.3.
