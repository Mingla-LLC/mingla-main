# INVESTIGATE — ORCH-1162 Bug 1: time displays missing AM/PM on public offering pages

- **Phase:** INVESTIGATE (read-only forensic). No product code edited.
- **Date:** 2026-06-18
- **Device under test:** Samsung Galaxy A72, adb serial `R58R54YV7JT`, USB. System clock **24-hour** (`settings get system time_12_24` → `24`), locale en-US (secondary en-GB). Both apps installed: consumer `com.mingla.app.v2`, business `com.sethogieva.minglabusiness`.
- **Apps connected:** consumer app dev build → Metro :8083 → **PROD Supabase** (`gqnoajqerqhnvulmnyvv`), confirmed (leggothis brand shows the same 11 events as the prod query). Business app dev build → Metro :8081 → a **different (dev) Supabase** (the prod-only single-mode fixtures did not resolve; only the shared recurring fixtures did).
- **Evidence dir:** `Mingla_Artifacts/evidence/ORCH-1162/`

---

## EXECUTIVE VERDICT

**The dispatch's stated repro mechanism is REFUTED by on-device runtime proof.** On this device's React Native **Hermes** engine, a `toLocaleTimeString` / `Intl.DateTimeFormat` call with `hour:"numeric"` and **no `hour12`** does **NOT** defer to the Android `time_12_24` system setting. It follows the **locale string**:

- `undefined` / `"en-US"` locale → renders **12-hour with AM/PM** (proven on-device, device set to 24h → still "12:15 AM").
- `"en-GB"` locale → renders **24-hour, no meridiem**, regardless of the device 12/24h setting (proven on-device: device set to **12h** → event line still rendered "00:15").

So the real bug is NOT "locale-deferring formatters drop AM/PM on a 24h device." The real bug is **formatters PINNED to `en-GB`** (a 24-hour-default locale), which render 24h **on every device, every system setting** — a deterministic defect. Seth is seeing 24h times because the consumer event date-line helper and the shared sale-window banner are hard-coded to `en-GB`. The dispatch's prime suspect (`experienceDateSubline.ts` `formatTimeLine`, which is `en-US`) is in fact **correct** on Hermes.

### What MISSES AM/PM, grouped by offering type × surface

| Offering | Surface | Status | Cause |
|---|---|---|---|
| **Event** | Consumer app — expanded card date line (`ExpandedBusinessEventSheet`) | **CONFIRMED MISSING** (runtime: "00:15") | `formatEventDateLine`→`formatTimeInTz` pinned `en-GB` |
| **Experience** | Consumer app — expanded card date line (same helper) | **CONFIRMED MISSING** (runtime: "WED, 17 JUN · 00:15 – 23") | same `formatTimeInTz` |
| Event / Experience / Trip | Consumer + Business — pre-sale "Sales open …" banner (`QuantityRow`) | **CONFIRMED-by-determinism** (en-GB pinned; not live-rendered — no event in a pre-sale window during the run) | `QuantityRow.formatSaleDate` pinned `en-GB` |
| Event | **Buyer-web** public event page `/e/{brand}/{event}` | **CORRECT** (runtime: "4 PM – 10 PM") | business `formatTimeLabel` string-math 12h |
| Experience | **Buyer-web** public experience page `/exp/{brand}/{exp}` | **CORRECT** (runtime: "5:00 PM") | `formatStopTime` clock-string branch (12h) |
| Experience | Business app — native public preview + checkout subline | **CORRECT** (runtime: "5:00 PM" stop, recurring subline has no time) | `formatStopTime` 12h branch; `formatTimeLine` en-US (12h on Hermes) |
| Experience | Consumer app — Reserve/occurrence picker (`ExperienceReservePicker`) | **CORRECT** (runtime: "12:15 AM" at 24h device) | `undefined` locale → 12h on Hermes |
| Trip | All checkout/public surfaces | **N/A** (time-less by design — date ranges only) | — |
| iOS (all apps) | — | **CORRECT by code-trace parity** (same RN/Hermes Intl; not runtime-proven, no iOS sim booted) | — |

**Net: the fix is needed at exactly the en-GB-pinned time formatters. Two LIVE sites + one dead-code site.**

---

## INVESTIGATION MANIFEST (files read, in trace order)

1. `mingla-business/src/utils/experienceDateSubline.ts` — `formatTimeLine` (dispatch prime suspect), `formatExperienceDateSubline`.
2. `app-mobile/src/utils/eventDateDisplay.ts` — `formatTimeInTz`, `format24hTimeInTz`, `formatEventDateLine`, `formatEventLocalRange`.
3. `mingla-business/src/utils/eventDateDisplay.ts` — `formatTimeLabel`, `formatTimeLabelInTz`, `formatShortDateInTz`, `formatDraftDateLine`.
4. `packages/event-rendering/QuantityRow.tsx` — `formatSaleDate` (shared sale-window banner).
5. `packages/event-rendering/PublicEventPage.tsx` — shared renderer (pass-through; no own time formatter).
6. `mingla-business/src/components/experience/ExperiencePreview.tsx` — `formatStopTime`.
7. `mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx`.
8. `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` — public experience route.
9. `app-mobile/src/components/expandedCard/ExperienceReservePicker.tsx` — `formatDateLabel`, `formatWindow` (NEW; agents partly missed).
10. `app-mobile/src/components/expandedCard/ReservationPassSection.tsx` — `formatReservedForLong` (NEW).
11. `app-mobile/src/components/expandedCard/ExperienceOccurrencePicker.tsx` — `formatOccurrence`.
12. `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` — `datesList` Intl + `dateLine` via `formatEventDateLine`.
13. `mingla-business/src/components/brand/ExperienceMiniCard.tsx` — `formatNextOccurrence` (en-GB; verified **dead code**, not imported).
14. Migration / data: prod query of `events` + `event_dates` + `experience_stops` (read-only, via Supabase MCP) for known-time fixtures.

---

## Q-SCORECARD

- **Q1. Does any public-facing time display drop AM/PM on Seth's 24h device?**
  **Verdict: YES** — the consumer expanded-card event/experience date line ("00:15"). `proven` (runtime screenshots `consumer_11`, `consumer_15`).

- **Q2. Is the root cause the device 24h system setting interacting with locale-deferring formatters (the dispatch's hypothesis)?**
  **Verdict: NO — REFUTED.** Hermes does not defer to the system 24/12h toggle. The cause is `en-GB`-pinned formatters that are intrinsically 24h on all devices. `proven` (12h-device A/B: en-GB still rendered "00:15"; `undefined` still rendered "12:15 AM").

- **Q3. Is the dispatch's prime suspect `experienceDateSubline.ts:48 formatTimeLine` actually a bug?**
  **Verdict: NO.** It is `en-US`, which renders 12h with AM/PM on Hermes. `proven`-equivalent (the on-device `undefined`-locale picker resolved to en-US and showed AM/PM; en-US explicit == resolved-default here).

- **Q4. Which exact sites render an offering time WITHOUT a meridiem on a public surface?**
  **Verdict:** (a) consumer `formatTimeInTz` (`app-mobile/src/utils/eventDateDisplay.ts:50-58`) — LIVE, proven; (b) shared `QuantityRow.formatSaleDate` (`packages/event-rendering/QuantityRow.tsx:117-127`) — LIVE, en-GB, determinism-confirmed; (c) `ExperienceMiniCard.formatNextOccurrence` (`mingla-business/src/components/brand/ExperienceMiniCard.tsx:100-104`) — DEAD CODE, not rendered. `proven` for (a), `probable` (determinism) for (b), `ruled out as live` for (c).

- **Q5. Is buyer-web affected?**
  **Verdict: NO.** Web event page rendered "4 PM – 10 PM"; web experience rendered "5:00 PM". Web follows the browser/OS locale (en-US here), and the business event formatter is string-math 12h regardless. `proven` (runtime `web_04`, `web_05`). Caveat: web does not reflect the Android `time_12_24` toggle at all, so web is not where Seth's report originates.

- **Q6. Are trip surfaces affected?**
  **Verdict: NO.** Trip checkout/public date lines are time-less (date ranges only). `proven` (code-trace: `formatTripDateRange`, `formatTripDateLine` carry no `hour` field).

- **Q7. Are the intentional 24h sites bugs?**
  **Verdict: NO — do not touch.** `format24hTimeInTz` (consumer calendar row) is explicitly `hour12:false` by design; `formatEventLocalRange` ("21:00 → 02:00") is the intentional compact calendar range. `proven` (code-trace + the file's own ORCH-0877 design note).

---

## FINDINGS (six-field evidence)

### F-1 — `formatTimeInTz` pinned to `en-GB` → consumer event/experience date line shows 24h (CONFIRMED ROOT CAUSE)
1. **Symptom:** Consumer expanded card eyebrow reads "WED, 17 JUN · 00:15 – 23" (24h, no AM/PM). Seth's reported bug.
2. **Layer:** code (mobile) + runtime.
3. **Probe:** Deep-linked consumer app (connected to prod) to the deck, expanded the "Raleigh Wine and Dine Crawl" card; captured `consumer_15_engb_eventline_24h_on_12hdevice.png` with the device flipped to **12h**.
4. **Evidence:** `app-mobile/src/utils/eventDateDisplay.ts:50-58`
   ```
   const formatTimeInTz = (iso, tz) =>
     new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", timeZone: tz })
       .format(new Date(iso))
       .replace(/:00\b/, "").replace(/\bam\b/g, "AM").replace(/\bpm\b/g, "PM");
   ```
   Node probe: `Intl.DateTimeFormat("en-GB",{hour:"numeric",minute:"2-digit"})` of 19:00 UTC → **"19:00"**. On-device (Hermes, device at 12h): event line still rendered **"00:15"**. The `.replace(/\bam\b/…)`/`\bpm\b` post-process can NEVER fire — en-GB emits no "am"/"pm". The file's own doc-comment claims output "10 PM"; the code cannot produce it.
5. **Mechanism:** `formatEventDateLine` (lines 93-115, used by `ExpandedBusinessEventSheet.dateLine`) calls `formatTimeInTz` for both start and end. en-GB is a 24-hour-default locale; pinning it forces 24h on every device → the meridiem is dropped.
6. **Severity:** CONFIRMED ROOT CAUSE. Confidence: `proven`.

### F-2 — `QuantityRow.formatSaleDate` pinned to `en-GB` → "Sales open …" banner shows 24h (SECONDARY ROOT CAUSE)
1. **Symptom:** Pre-sale banner "Sales open {Wed 15 Jul, 19:00}" shows 24h on a public offering's get-tickets row (consumer + business + buyer-web).
2. **Layer:** code (shared package) + runtime (determinism).
3. **Probe:** Code-trace + Node probe (no event was in a pre-sale window during the device run, so not live-rendered).
4. **Evidence:** `packages/event-rendering/QuantityRow.tsx:117-127`
   ```
   const formatSaleDate = (iso) => new Date(iso).toLocaleString("en-GB", {
     weekday:"short", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });
   ```
   Node probe → **"Wed 15 Jul, 19:00"** (24h). Used at `QuantityRow.tsx` render: `Sales open {formatSaleDate(ticket.saleStartAt)}`. `QuantityRow` is the shared ticket row consumed by consumer `TicketCartSheet` AND business checkout AND `PublicEventPage`.
5. **Mechanism:** en-GB pinned → 24h sale-open time on the buyer-facing pre-sale banner across all three apps.
6. **Severity:** SECONDARY ROOT CAUSE. Confidence: `probable` (deterministic by code + Node; not live-rendered on-device because no pre-sale-window offering existed during the run).

### F-3 — `experienceDateSubline.ts formatTimeLine` is `en-US`, NOT a bug (RULED OUT — refutes dispatch lead)
1. **Symptom (claimed):** experience single-mode subline shows 24h on the 24h device.
2. **Layer:** code + runtime.
3. **Probe:** On-device render of an `undefined`-locale Intl time (`ExperienceReservePicker`) with the device at 24h → `consumer_11_reserve_picker.png`.
4. **Evidence:** `mingla-business/src/utils/experienceDateSubline.ts:44-53` uses `toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit"})`. Node: en-US of 19:00 UTC → **"7:00 PM"**. On-device, `undefined`(→en-US) picker rendered **"12:15 AM"** while the device was at 24h. en-US default hour cycle is h12; Hermes does not override it from the system toggle.
5. **Mechanism:** en-US locale → 12h with AM/PM on Hermes; the system 24h toggle has no effect. No meridiem loss.
6. **Severity:** RULED OUT (as a bug). Confidence: `proven` (the on-device `undefined` render resolved to en-US, identical class).

### F-4 — `ExperienceReservePicker` / `ReservationPassSection` / `ExperienceOccurrencePicker` / `ExpandedBusinessEventSheet.datesList` use `undefined` locale → NOT bugs (RULED OUT)
1. **Symptom (claimed):** consumer reservation/occurrence times drop AM/PM on the 24h device.
2. **Layer:** code + runtime.
3. **Probe:** `consumer_11_reserve_picker.png` — device at 24h, picker rendered eight rows each "…, 12:15 AM".
4. **Evidence:** `ExperienceReservePicker.tsx:71-127`, `ReservationPassSection.tsx:22-28`, `ExperienceOccurrencePicker.tsx:53-67`, `ExpandedBusinessEventSheet.tsx:152-166` — all `Intl.DateTimeFormat(undefined, {hour:"numeric", minute:"2-digit", …})`, no `hour12`. Rendered **"12:15 AM"** (12h + meridiem) on the 24h device.
5. **Mechanism:** `undefined` → device default locale en-US → 12h. System 24h toggle ignored by Hermes.
6. **Severity:** RULED OUT. Confidence: `proven`.

### F-5 — Buyer-web event + experience pages render AM/PM correctly (RULED OUT)
1. **Symptom (to check):** web public pages drop AM/PM.
2. **Layer:** runtime (web).
3. **Probe:** Device Chrome → `business.usemingla.com/e/leggothis/the-party-block` (`web_04`) and `…/exp/mingla-qa-experiences/qa-raleigh-twilight-tasting-crawl` (`web_05`).
4. **Evidence:** Event page rendered "WED 9 DEC · 4 PM – 10 PM" and "Wed 9 Dec · 4 PM – 10 PM". Experience page rendered "5:00 PM start". Both with meridiem, device clock at 24h.
5. **Mechanism:** business `formatTimeLabel` is string-math 12h (correct); `formatStopTime` clock-string branch is string-math 12h. Web also follows the browser locale (en-US 12h), independent of the Android system toggle.
6. **Severity:** RULED OUT. Confidence: `proven`. (Note: web is not the surface where Seth's 24h report originates — web never reflects the device 12/24h toggle.)

### F-6 — `ExperienceMiniCard.formatNextOccurrence` is `en-GB` but DEAD CODE (RULED OUT as live)
1. **Symptom:** would render a 24h "next occurrence" time on a brand-page mini card.
2. **Layer:** code.
3. **Probe:** `rg` for imports of `mingla-business/src/components/brand/ExperienceMiniCard`.
4. **Evidence:** zero imports — the standalone component is not referenced anywhere. The LIVE public-brand-page mini card is a different inline component (`packages/brand-rendering/PublicBrandPage.tsx:1318`) that is date-only (`formatUpcomingDateLine`).
5. **Mechanism:** en-GB pinned at line 100-104 would be a bug if rendered, but it is unreachable.
6. **Severity:** RULED OUT (as live). Confidence: `proven` (no importers). Flag for dead-code cleanup, not a launch fix.

---

## FIVE-TRUTH-LAYER RECONCILIATION

| Layer | Finding | Contradiction? |
|---|---|---|
| **Docs** | `app-mobile/src/utils/eventDateDisplay.ts` doc-comment promises "Sat 18 May · 10 PM"; `experienceDateSubline.ts` header promises "7:00 PM". | **Yes (F-1):** the consumer doc-comment lies — the en-GB code can only produce "22:00". The code, not the comment, is truth. |
| **Schema** | `event_dates.start_at` is a UTC instant; `experience_stops.start_time` is a clock string "HH:mm:ss". | No conflict; consistent with the two `formatStopTime` branches. |
| **Code** | Mix of en-GB (24h, bug), en-US (12h, ok), `undefined` (12h on Hermes, ok), and string-math (12h, ok). | The en-GB vs en-US split is the entire bug surface. |
| **Runtime** | en-GB → "00:15" (device at 12h); en-US/undefined → "12:15 AM" (device at 24h); web → "4 PM". | **The decisive contradiction with the dispatch's hypothesis** (system-toggle deferral). Hermes follows locale, not the toggle. |
| **Data** | Prod has single-mode + stop-time fixtures (DC Evening Crawl 18:00/19:15/20:30); business dev DB lacks them. | Explains why the business native single-mode `formatTimeLine` could not be live-rendered (env split). |

---

## REPRO EVIDENCE (device runs)

| # | Screenshot | What it proves |
|---|---|---|
| 1 | `web_04_event_party_block.png` | Buyer-web EVENT page → "WED 9 DEC · 4 PM – 10 PM" (meridiem OK, device 24h). |
| 2 | `web_05_experience_twilight.png` | Buyer-web EXPERIENCE page → "5:00 PM" (meridiem OK). |
| 3 | `biz_08_qa_twilight_native.png` | Business app NATIVE experience preview → stop "5:00 PM" (string-math branch OK), device 24h. |
| 4 | `biz_06_exp_deeplink.png` | Business native recurring experience subline "Every day · Next: Fri, 19 Jun" (no time → recurring branch never calls `formatTimeLine`). |
| 5 | `consumer_11_reserve_picker.png` | **Device at 24h**, consumer Reserve picker (`undefined` locale) → every row "12:15 AM" (12h + meridiem). **Refutes the toggle-deferral hypothesis.** |
| 6 | `consumer_15_engb_eventline_24h_on_12hdevice.png` | **Device at 12h** (status bar "6:57"), consumer event/experience date line (`en-GB`) → "WED, 17 JUN · 00:15 – 23" (24h). **Proves en-GB is deterministic 24h, device-setting-independent.** |

Device flipped 24h→12h for the A/B and **restored to 24h** (`settings get system time_12_24` → `24`, verified twice). Two Metro servers (:8081, :8083) started for the runtime proof and stopped at the end.

---

## BLAST RADIUS / CROSS-SURFACE MAP

| Surface | en-GB time formatter present? | In scope |
|---|---|---|
| Consumer iOS | `formatTimeInTz` (shared file), `QuantityRow` (shared pkg) | YES (code-trace parity — same Hermes) |
| Consumer Android | `formatTimeInTz`, `QuantityRow` | YES (F-1 proven, F-2 deterministic) |
| Buyer-web | business `formatTimeLabel` (string-math), `QuantityRow` sale banner | PARTIAL — only `QuantityRow` sale banner; web event/exp date lines are correct |
| Business iOS | `QuantityRow` (checkout) | YES for sale banner; experience/event date lines correct |
| Business Android | `QuantityRow` | same as iOS |
| Admin web | none of these | NO |
| Business web preview | business `formatTimeLabel` (correct) + `QuantityRow` | PARTIAL (sale banner only) |

**Single shared-helper consolidation note:** there is NOT one helper that fixes everything, but the bug is small and well-bounded:
- `app-mobile/src/utils/eventDateDisplay.ts:50-58` `formatTimeInTz` — fixes the consumer EVENT line and EXPERIENCE expanded-card line at once (one helper, two offering types).
- `packages/event-rendering/QuantityRow.tsx:117-127` `formatSaleDate` — fixes the sale-open banner across all three apps at once (shared package).
- (optional) `mingla-business/src/components/brand/ExperienceMiniCard.tsx:100-104` — dead code; either delete or fix-for-hygiene, no live impact.
- The correct reference implementation already exists in the repo: business `formatTimeLabel` (string-math) and `formatTimeLabelInTz` (h23 read → 12h convert) in `mingla-business/src/utils/eventDateDisplay.ts`. The consumer-side fix is to switch the en-GB Intl calls to the same 12h discipline (explicit `hour12:true` on a 12h locale, or string-math), preserving the timezone argument.

---

## INTENTIONAL 24h SITES — DO NOT TOUCH

- `app-mobile/src/utils/eventDateDisplay.ts:60-66` `format24hTimeInTz` (explicit `hour12:false`) — consumer calendar row, by design.
- `app-mobile/src/utils/eventDateDisplay.ts:122-138` `formatEventLocalRange` ("21:00 → 02:00") — intentional compact calendar range.
- `mingla-business/src/utils/eventDateDisplay.ts:203-208` h23 read inside `formatTimeLabelInTz` (it is INTERNAL to a 12h conversion — the output IS 12h; do not "fix" the h23 read).
- All `en-CA`/`en-GB` DATE-only formatters (no `hour` field): not time displays.

---

## COMPLETE LIST OF FORMATTER SITES TO FIX (live)

1. `app-mobile/src/utils/eventDateDisplay.ts:50-58` — `formatTimeInTz` (en-GB → 12h). **LIVE, CONFIRMED.** One-line fix: render meridiem (e.g. `hour12:true` on a 12h locale or string-math), keep `timeZone`.
2. `packages/event-rendering/QuantityRow.tsx:117-127` — `formatSaleDate` (en-GB `hour:"2-digit"` → 12h). **LIVE, deterministic.** Same fix.
3. (optional / hygiene) `mingla-business/src/components/brand/ExperienceMiniCard.tsx:100-104` — `formatNextOccurrence` (en-GB). **DEAD CODE** — delete the unused component or fix for parity; no launch impact.

---

## DISCOVERIES FOR ORCHESTRATOR

- **D-1 (engine truth, reusable):** React Native **Hermes** `Intl`/`toLocaleTimeString` does **not** honor the Android 24-hour system toggle for `hour:"numeric"` when `hour12` is omitted — it follows the *locale string* (proven on a physical 24h device). This contradicts the widely-cited "Android respects time_12_24" behavior (which applies to native Android `DateFormat`, not Hermes ICU). Any future "missing AM/PM" report should be triaged by the **locale string** (`en-GB`/`en-CA` = 24h-default), not by the device setting. Codify this so we never re-spend a device session disproving the toggle theory.
- **D-2:** The dispatch's prior source-recon mis-classified `formatTimeInTz` ("post-processed meridiem, correct") — its `.replace(/\bam\b/…)` is dead post-processing on en-GB output. Worth a note in the recon checklist: a `.replace` for am/pm on an en-GB formatter is a tell-tale latent bug.
- **D-3:** Business dev Supabase ≠ prod Supabase; the consumer dev build points at PROD. Future device investigations should confirm which DB each app is bound to before relying on prod fixtures.
- **D-4:** Dead component `mingla-business/src/components/brand/ExperienceMiniCard.tsx` (zero importers) — candidate for cleanup ORCH.

---

## CONFIDENCE & RECOMMENDED NEXT PHASE

- **Overall confidence: `proven`** for the live consumer event/experience date-line bug (F-1) and the engine-behavior truth (D-1); `probable` for the shared sale-banner (F-2, deterministic but not live-rendered).
- **Recommended next phase: SPEC**, scoped to the two live en-GB formatter sites (F-1, F-2) with the dead-code site (F-6) as an optional hygiene line. The fix is meridiem-restoration using the repo's existing 12h discipline; preserve all timezone handling and the intentional-24h sites listed above. **No fix is proposed here** — this is the investigation verdict only.
