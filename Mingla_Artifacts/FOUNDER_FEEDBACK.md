# Founder Feedback Log

Append-only log. Most recent first. Each entry: date received → verbatim feedback → status (open / triaged-to-ORCH-XXXX / declined) → orchestrator notes.

<!-- TEMPLATE for new entries:

## YYYY-MM-DD — One-line topic

> "verbatim founder quote here"

**Triage:** [orchestrator's plain-English breakdown]
**Status:** [open / triaged-to-ORCH-XXXX / declined]

-->

---

## 2026-05-05 — Brand delete + cover/profile media (Giphy/Pexels/upload)

> "1. No way to delete a brand, should be a delete button on the drop down sheet, and on the brand page"
> "2. We need to add giphy and pexels integration for cover and profile, instead of the weid covers we have. We also need the person to be able to upload custom picturue or video, or gif for the event image, or use giphy or pexels"

**Triage:** 2 sub-items, both surfaced during Cycle 17d forensics dispatch authoring.

- **Sub-item 1 (D-17d-FOUNDER-1)** — Missing brand-delete UX. There is no UI affordance to delete a brand. Operator wants delete button on (a) the brand-switcher dropdown sheet (`BrandSwitcherSheet.tsx`) and (b) the brand profile page (`BrandProfileView.tsx` / `app/brand/[id]/...`). **Triage:** triaged-to-Cycle 17d forensics §3 (verify schema-side delete capability — `brands` table soft-delete vs hard-delete + cascade behavior on `events`/`orders`/`brand_team_members`/`scanner_invitations` + RLS for owner-only delete). Severity S1-high (GDPR-adjacent + missing-feature blocking real account hygiene).

- **Sub-item 2 (D-17d-FOUNDER-2)** — Cover/profile media options. Today brand profile + event covers use `EventCover.tsx`'s SVG hue-stripe placeholder ("weird covers" per operator). Operator wants: (a) custom upload (picture/video/GIF), (b) Giphy integration, (c) Pexels integration — applied to BOTH brand cover/profile AND event covers. **Triage:** triaged-to-Cycle 17d forensics §3 (audit current `Storage` buckets for upload paths + investigate Giphy + Pexels API integration patterns + assess scope of `EventCover.tsx` replacement vs additive picker). Severity S2-medium (design-debt + missing-feature; not launch-blocking but high founder-value).

**Status:** both sub-items in active Cycle 17d forensics scope (investigate-only; SPEC-time decision on whether to fold into 17d IMPL or split into 17e features cycle).

---

## 2026-05-04 — Top bar IA + bottom nav real estate

> "the + button, when you navigate to the events page is missing. + for adding evemnts, and the notification, and search should be constant on the top bar at all times. I am thinking of moving the account from thr menu, to tyhe top bar. It is taking too much real estate for the bottom nav menu"

**Triage:** 3 sub-items.
- **Sub-item 1** — Missing `+` on events page: triaged-to-Cycle 17a §A.1 (tactical fix — events.tsx renders `[search, bell, +]` inline) + Cycle 17b structural rework (TopBar `extraRightSlot` prop + new I-37 invariant)
- **Sub-item 2** — Constant top bar (search + bell + `+`): triaged-to-Cycle 17b structural rework (D-17-12)
- **Sub-item 3** — Move Account to top bar: **declined** per operator decision 2026-05-04 ("leave the account in the bottom nav menu")

**Status:** sub-items 1+2 in active 17a/17b pipeline; sub-item 3 declined.
