# Proposals — Signals · Vibes · Anti-Signals

**Last updated:** 2026-05-05 (post-ORCH-0713 v2 calibration)
**Sources:** trial Q1 outputs (`place_intelligence_trial_runs.q1_response`) + operator directives in conversation
**Status meanings:** `DRAFT` (idea) · `UNDER_REVIEW` (orchestrator vetting) · `ACCEPTED-PHASE2` (locked for Phase 2 dispatch) · `ACCEPTED-PHASE3` · `LIVE` · `REJECTED` · `DEFERRED`

---

## 1. Signal Proposals

### Status: ACCEPTED-PHASE2 (locked per DEC-098)

| ID | Name | Definition | Source | Decision rationale |
|---|---|---|---|---|
| PROP-SIG-001 | `lgbtq_safe_space` | Demographic-safety signal: queer-affirming, explicitly inclusive venues | v1 + v2 Arcana Bar; v1 DSSOLVR (`inclusive_accessibility`) | DEC-098 D-0713-4. Distinct from any current signal; structural community-safety dimension |
| PROP-SIG-002 | `family_friendly` | Kids welcome / suitable for children. Distinct from `picnic_friendly` (BYO-blanket outdoor) | v2 Babylon Park, ParTee Shack, Pullen Park common vibe; v1 Pullen `family_picnic_destination` | DEC-098 D-0713-4. Operator-locked |
| PROP-SIG-003 | `cocktail_destination` | Drink program is the primary draw (not venue type). Distinct from `drinks` which is venue-type | v1 Mala Pata `cocktail_destination`; v1 TDQ `premium_cocktails_wine`+`sommelier_service` | DEC-098 D-0713-4. Operator-locked |

### Status: UNDER_REVIEW (surfaced 2x+ across runs; deserve consideration)

| ID | Name | Definition | Source | Notes |
|---|---|---|---|---|
| PROP-SIG-010 | `event_venue` | Place capable of hosting private events (weddings, parties) | v1 Bayfront `event_floral_production` + `wedding_florals_specialist`; v2 Domain `wedding_venue`; v1 Royal Festival Hall `multi_use_cultural_campus`; v2 Lake Roland `event_hosting` | Could be Phase 2.X. Distinct from `picnic_friendly` (private booking vs public) |
| PROP-SIG-011 | `arcade_games` / `barcade` | Arcade-game-driven venue (often combined with bar) | v1 Boxcar `barcade`; v2 Boxcar `arcade_games`+`outdoor_lawn_games`; v1+v2 DSSOLVR `arcade_gaming`/`arcade_games_retro` | Today: place is `lively` AND `play` — combined score covers it. Adding own signal = finer-grained ranking but adds taxonomy complexity. **Defer until evidence of poor combined-deck quality.** |
| PROP-SIG-012 | `specialty_coffee` | Specialty espresso / craft coffee bar (third-wave) | v1 Rosslyn `specialty_espresso`+`work_focused_cafe`; v2 Rosslyn `specialty_coffee_destination` | Could fold into `icebreakers` (already Rosslyn's anchor at score 70-75). **Defer.** |

### Status: REJECTED (with rationale)

| ID | Name | Source | Why rejected |
|---|---|---|---|
| PROP-SIG-020 | `chef_driven_craft` | v1 Mala Pata | Already implied by high `fine_dining` score; not a separate signal |
| PROP-SIG-021 | `staff_personality_driven` | v1 Trader Joe's + ParTee | Quality multiplier, not a signal — let aesthetic data + reviews surface it |
| PROP-SIG-022 | `tarot_esoteric` | v1 Arcana | Too place-specific; let reviews surface organically |
| PROP-SIG-023 | `cannabis_friendly` | v1 Backyard | Too place-specific + legal-jurisdiction-dependent |
| PROP-SIG-024 | `dog_park_social` | v1 Lake Roland | Place-specific; `allows_dogs` boolean already captures intent |
| PROP-SIG-025 | `fishing_waterfront` / `water_sports_launch` / `water_recreation` | v1 Lake Roland; v2 Umstead `water_recreation` | Long-tail outdoor activities — place-specific; subset of `nature` |
| PROP-SIG-026 | `wildlife_education_center` | v1 Lake Roland | Subset of `creative_arts` + `nature`; not a destination type |
| PROP-SIG-027 | `canopy_walkway_adventure` | v2 Lekki | Place-specific feature; not a Mingla-wide signal |
| PROP-SIG-028 | `biking_trails` | v2 Umstead | Subset of `nature`; not a separate signal |
| PROP-SIG-029 | `art_installations` | v2 Umstead | Subset of `creative_arts`; not a separate signal |
| PROP-SIG-030 | `amusement_park_classic` | v2 Pullen Park | Same as `play` already covers; not finer-grained |
| PROP-SIG-031 | `prepared_foods_deli` | v2 Wegmans | Sub-feature of `groceries`; Wegmans already scored 92 for groceries |
| PROP-SIG-032 | `standing_venue` | v2 Rosslyn | Operational fact, not a signal |
| PROP-SIG-033 | `cultural_anchor` / `multi_use_cultural_campus` | v1+v2 Royal Festival Hall | Already implied by `theatre`+`creative_arts` overlap |
| PROP-SIG-034 | `craft_brewery_tour` | v2 DSSOLVR | Subset of `drinks`; tour aspect is incidental |
| PROP-SIG-035 | `community_events_programming` / `community_events_hub` | v1+v2 Arcana | Overlaps with proposed `event_venue` (PROP-SIG-010) |
| PROP-SIG-036 | `artisanal_craft_drinks` | v2 Arcana | Subset of `drinks` + venue's bar program |
| PROP-SIG-037 | `handmade_craft_food_forward` | v2 Mala Pata | Subset of `fine_dining`; chef-driven aspect |
| PROP-SIG-038 | `occasion_dining_upscale_small_plates` | v2 Mala Pata | Subset of `fine_dining` + small-plates style |
| PROP-SIG-039 | `daytime_brunch_party` | v1 Backyard | Combination of existing signals (brunch + lively); composition handles it |
| PROP-SIG-040 | `meat_curation_specialist` | v1 TDQ | Subset of `fine_dining` (steakhouse specifically) |
| PROP-SIG-041 | `sommelier_service` / `premium_cocktails_wine` | v1 TDQ | Folded into PROP-SIG-003 `cocktail_destination` |
| PROP-SIG-042 | `waterfront_riverside_dining` / `marina views` | v1 TDQ; v1 Calusso | Setting attribute, not destination type — covered by `scenic` overlap |
| PROP-SIG-043 | `heritage_estate` / `historic_landmark` | v1 Domain Three Fountains | Subset of `creative_arts` + `nature` overlap |
| PROP-SIG-044 | `family_activity_cluster` / `family_picnic_destination` / `kid_centric` | v1 Domain, v1 Pullen | Folded into PROP-SIG-002 `family_friendly` |
| PROP-SIG-045 | `competitive_sports_activity` / `milestone_celebration_venue` | v1 ParTee | Folded into PROP-SIG-002 `family_friendly` + PROP-SIG-010 `event_venue` |
| PROP-SIG-046 | `accessible_arts` | v1 Royal Festival Hall | Subset of `creative_arts`; accessibility is meta-attribute |
| PROP-SIG-047 | `flowers_and_plants` | v1 Trader Joe's | Sub-feature of `groceries` (TJ's flower section); folded into existing `flowers` admittance rule |

---

## 2. Anti-Signal Proposals

### Status: ACCEPTED-PHASE2 (locked per DEC-098 D-0713-5)

Anti-signals are NEW conceptual category — "why-NOT" filters that downrank or warn. Schema shape decided at Phase 2 SPEC.

| ID | Name | Definition | Source | Notes |
|---|---|---|---|---|
| PROP-ANTI-001 | `noise_fatigue` | Reviewers report difficulty conversing due to noise level | v1 Anthony's; v2 Anthony's `noise_tolerance_required` | Hits date-night signal especially |
| PROP-ANTI-002 | `reservation_friction` | Reservations difficult to obtain, frequent cancellations, unreliable | v1 Anthony's; v2 Anthony's `reservation_reliability_risk` | Operationally useful for date-planning |
| PROP-ANTI-003 | `service_inconsistent` | Service quality varies wildly run-to-run per reviews | v1 Fairview, Calusso (both anchored fine_dining; both scored 82-92 with this caveat in reasoning) | Strong negative signal for occasion dining |
| PROP-ANTI-004 | `security_risk` | Reviews mention security or safety incidents | v1 Backyard `security_and_staff_risk` | Most severe — could be hard exclude rather than downrank |
| PROP-ANTI-005 | `accessibility_gaps` | Reviews mention accessibility shortfalls (wheelchair, hearing-impaired, etc.) | v1 ParTee | Inverse of inclusion signals |

### Status: UNDER_REVIEW

| ID | Name | Definition | Source | Notes |
|---|---|---|---|---|
| PROP-ANTI-010 | `intimate_high_volume_tension` | Place markets as intimate but actually high-volume | v1 Mala Pata | May be subset of PROP-ANTI-001 noise_fatigue |

---

## 3. Vibe Vocabulary

Vibes are descriptive adjectives Claude extracts from reviews + photos. Per DEC-098 D-0713-2, they live on the **place card** as display chips, NEVER in the preferences sheet. No taxonomy lock — operator monitors clusters for emergent themes.

### Recurring clusters (across v1 + v2 runs, 32 places × ~5 vibes each = ~160 vibe phrases per run)

| Cluster | Sample phrases |
|---|---|
| **Energy** | high-energy, vibrant, lively, energetic, neon-soaked, party-heavy, festive, high-volume |
| **Intimacy** | intimate, cozy, moody, peaceful, meditative, contemplative, calm |
| **Craft** | chef-driven, artisanal, specialty, world-class, curated, technical, design-forward |
| **Demographic** | queer-affirming, queer-safe-space, inclusive, community-centered, kid-centric, family-friendly, family-first, collegiate |
| **Aesthetic** | Instagram-worthy, neon, neon-lit, minimalist, industrial, Victorian, brutalist, elegant, opulent, neon-bright |
| **Pricing** | budget-friendly, upscale, no-frills, affordable, premium, occasion-driven, occasion-dining |
| **Setting** | waterfront, marina views, creek-side, forested, riverside, Thames-riverside, lush, scenic |
| **Negative caveats** | inconsistent service, expensive but uneven, tired, chaotic, loud, noise fatigue, premium but aging |

### Vibe stability (v1 → v2)

After the v2 prompt update (price_range cents + boolean split + scoring rubric), most vibe vocabulary remained STABLE. Notable shifts:
- v2 phrases tend to be SHORTER + more concrete ("date-night" vs v1's "occasion-driven date-night-positioning")
- Negative caveats appear more often as standalone vibes in v2 (rubric encouraged honesty)
- Demographic vibes (queer-affirming, family-friendly) crystallized — operator-validated for promotion to PROP-SIG-001 + PROP-SIG-002

---

## 4. Workflow when adding a new proposal

1. **Source it** — surfaced in trial Q1, operator request, or external research
2. **Add a row to this file** with status `DRAFT`
3. **Orchestrator vets** — `UNDER_REVIEW` if 2+ trial places surfaced it, else `REJECTED` with reason
4. **Operator decides** to move forward → status `ACCEPTED-PHASE2` (or 3) + DEC entry
5. **Phase 2 SPEC dispatch** writes migration + scorer rules + initial cutoff
6. **Calibration trial** validates → cutoff locked → status `LIVE` → moved to [SIGNAL_TAXONOMY.md](SIGNAL_TAXONOMY.md)
7. **CALIBRATION_LOG entry** records the lock event
