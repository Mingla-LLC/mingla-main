# REVIEW — ORCH-0990 SPEC (Pass 1)

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-29
**Artifact under review:** `Mingla_Artifacts/specs/SPEC_ORCH-0990_FLOWER_STOP_REAL_FLORISTS.md` (committed `79addb01d`)
**Verdict: NEEDS WORK** — two evidence-backed defects; the proposed mechanism would re-ship the Lagos bug.

---

## Commit-hash verification

- SPEC file `Mingla_Artifacts/specs/SPEC_ORCH-0990_FLOWER_STOP_REAL_FLORISTS.md` → committed on branch `ORCH-0990-flower-stop-real-florists` at `79addb01d` (`git log --oneline` confirms; not uncommitted). SPEC-phase deliverable verified present.
- No product code claimed changed this phase (SPEC only) — nothing else to hash-verify.

## Dependency walk (config-layer)

The SPEC proposes touching `.github/scripts/strict-grep/orch-0990-flower-stop-florist-gate.mjs` (new) + `orch-0863-marketing-hub-phase-b.mjs` (allowlist). These are IMPLEMENT-phase artifacts; at SPEC REVIEW the relevant dependency is the **RPC `fetch_local_signal_ranked` consumer contract** — see Defect 1, which proves the SPEC mis-scoped the DB layer.

---

## What the SPEC got right

- Root cause correctly identified (missing `flowers` entry in `COMBO_SLUG_TYPE_FILTER` + popularity-based, non-type-aware `flowers` signal).
- Correctly recognized that a naïve approach starves coverage and that ranking must decouple from the popularity signal.
- Correctly chose Google's florist tag as the verification basis and cited Places docs (COMMS-0003 satisfied).
- Correctly flagged honest-empty behavior for thin cities (flower stop is `optional: true, dismissible: true`).

## Defect 1 (P0) — proposed gate re-admits the Lagos noise; wrong column

The SPEC sets `COMBO_SLUG_TYPE_FILTER.flowers = ['florist']`, which drives the RPC clause `pp.types && ARRAY['florist']` — an **array-overlap on the `types[]` column**. Live data (Management API, 2026-05-29, Lagos bbox 6.3–6.7 / 3.2–3.6) proves Google over-applies the secondary `florist` tag in Lagos to businesses that do **not** sell walk-in bouquets:

| name | primary_type | flowers score | in `types[]`? | real florist? |
|---|---|---|---|---|
| Regal Flowers Lekki Branch | `florist` | 144 | yes | ✅ |
| BusyBee Events (event planner) | `service` | 104 | yes | ❌ |
| Rukkies Decor | `general_contractor` | 100 | yes | ❌ |
| LEE signTEC EMPIRE | `service` | 98 | yes | ❌ |
| FRESH FLOWERS BY OLIVE DESIGNS | `florist` | 33 | yes | ✅ |
| Sparkle Gardens | `florist` | 0 | yes | ✅ |

At the SPEC's proposed floor (40), the `types[] && {florist}` gate yields **Regal Flowers (144, real) + BusyBee Events (104) + Rukkies Decor (100) + LEE signTEC (98)** — i.e. 1 real florist and 3 non-bouquet businesses. **This is the exact reported bug, unfixed.**

**`primary_type` is the clean discriminator** — every noise entry has `primary_type` of `service` / `general_contractor` / `null`; every real florist has `primary_type='florist'`.

But `primary_type='florist'` alone would exclude the floral-dept groceries Seth explicitly chose (Raleigh has **zero** `primary_type='florist'` places — all its bouquet availability is Harris Teeter `grocery_store` + `florist` tag). So the **required gate is the composite**:

```
primary_type = 'florist'
  OR (primary_type IN ('grocery_store','supermarket') AND 'florist' = ANY(types))
```

Verified against live data with this composite gate (no floor):
- **Lagos** → exactly 3 rows, all real florists (Regal 144, Fresh Flowers 33, Sparkle Gardens 0). Zero noise.
- **Raleigh** → 8 Harris Teeters with floral departments (97–141). Exactly the verified-floral grocery Seth wanted.

**Consequence:** the RPC `fetch_local_signal_ranked` filters only on `pp.types && p_required_types`; it **cannot express the composite predicate**. The SPEC's "no DB migration / no RPC edit" boundary is therefore wrong — a `CREATE OR REPLACE FUNCTION` migration (new primary-type-aware parameter, or the composite predicate inline) **is required**. This also means an `ORCH_0990_BACKEND_ALLOWLIST` entry for the migration (COMMS-0002).

## Defect 2 (P1) — proposed floor of 40 drops real florists

Lowering `COMBO_SLUG_FILTER_MIN.flowers` 80→40 still drops **FRESH FLOWERS BY OLIVE DESIGNS (33)** and **Sparkle Gardens (0)** — both real `primary_type='florist'` shops in Lagos. Since the popularity `flowers` signal is meaningless for small florists, once the composite **type-gate** is the hard guarantee of bouquet availability, the score floor for flowers should be **0** (or removed), with score used only to ORDER results, never to drop a verified florist. The "100% bouquet" bar is enforced by the gate, not the popularity score.

## Defect 3 (P1) — per-city coverage must be recomputed with the composite gate

The SPEC's coverage table (claimed Lagos 10 / Raleigh 26 / "8 empty cities") was computed with the wrong `types[]`-only predicate. Re-run the all-served-cities coverage using the **composite gate above** and report, per city: count of true `primary_type='florist'`, count of grocery+`florist`-tag, the combined fillable total, and which cities are genuinely empty (→ honest-omit). This is the real coverage truth the implementor and Seth need.

---

## Required rework (hand back to forensics SPEC)

1. Replace the `types[] && {florist}` mechanism with the composite primary-type-aware gate; spec the `fetch_local_signal_ranked` migration (new param or inline predicate) and its `ORCH_0990_BACKEND_ALLOWLIST` line.
2. Set the flowers score floor to 0 (order-only); justify with the Lagos 33/0 evidence.
3. Recompute per-city coverage with the composite gate; list genuinely-empty cities.
4. Keep the strict-grep gate + Step-0.5 fails-on-revert test + `I-PROPOSED-FLOWER-STOP-FLORIST-VERIFIED` invariant, updated to assert the composite gate (not types-only).
5. Re-confirm scope stays backend (now: RPC migration + `signalRankFetch.ts` + strict-grep + test). Still no client code change.
