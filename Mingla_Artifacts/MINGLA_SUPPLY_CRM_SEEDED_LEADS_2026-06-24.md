# Mingla Supply CRM Seeded Leads - 2026-06-24

## Scope

Seeded 40 prospect cards into the ClickUp `Supply CRM` list in `Marketing Space`.

Interpretation used: 5 leads per business/supply ICP, spread across Triangle, DC, and Lagos. The corrected Mingla supply taxonomy has 8 business/supply ICPs, so this batch equals 40 cards. A full 5-per-ICP-per-market build would be 120 cards.

ClickUp list: https://app.clickup.com/90141074565/v/l/li/901417374441

## 2026-06-24 Correction

Seth flagged that lead cards need contact email, contact phone, and custom fields populated.

Completed:

- Updated all 40 seeded ClickUp card descriptions with explicit `Contact email` and `Contact phone` lines.
- Used verified public business contact info where available.
- Used `Not publicly listed` where no public email or phone could be verified from official/public sources.
- Closed the temporary schema probe card after it confirmed the connector does not enforce or expose required custom-field schema.

Still blocked:

- ClickUp custom fields are not populated because the available ClickUp connector can write custom fields only when field UUIDs are known, but it does not expose the Supply CRM custom-field schema. A test write using a label such as `ICP` failed with `Field is must be a valid UUID`, and a required-field schema probe created successfully without returning field definitions.

Needed to finish custom fields:

- Export or paste the Supply CRM custom-field schema: field name, field UUID, field type, and option IDs for dropdown/label fields.
- Once provided, backfill the same 40 cards from the data already present in each description.

## Seeded Lead Index

| ICP | Market | Lead | ClickUp task |
|---|---|---|---|
| Event-forward independent hospitality operators | Triangle | Fullsteam Brewery | https://app.clickup.com/t/86bak4t0u |
| Event-forward independent hospitality operators | Triangle | Glasshouse Kitchen | https://app.clickup.com/t/86bak4t2j |
| Event-forward independent hospitality operators | DC | Eaton DC Food & Drink | https://app.clickup.com/t/86bak4t4g |
| Event-forward independent hospitality operators | DC | Throw Social DC | https://app.clickup.com/t/86bak4t79 |
| Event-forward independent hospitality operators | Lagos | RSVP Lagos | https://app.clickup.com/t/86bak4t9n |
| Nightlife and live-entertainment venues | Triangle | Motorco Music Hall | https://app.clickup.com/t/86bak4tbe |
| Nightlife and live-entertainment venues | Triangle | The Pinhook | https://app.clickup.com/t/86bak4tdm |
| Nightlife and live-entertainment venues | Triangle | Local 506 | https://app.clickup.com/t/86bak4thj |
| Nightlife and live-entertainment venues | DC | Songbyrd Music House | https://app.clickup.com/t/86bak4tmt |
| Nightlife and live-entertainment venues | Lagos | Flytime Fest | https://app.clickup.com/t/86bak4tpq |
| Recurring promoters and community organizers | Triangle | Triangle Pop-Up | https://app.clickup.com/t/86bak4tu7 |
| Recurring promoters and community organizers | Triangle | Pop-Up Raleigh | https://app.clickup.com/t/86bak4ty1 |
| Recurring promoters and community organizers | DC | FRESHFARM | https://app.clickup.com/t/86bak4u2z |
| Recurring promoters and community organizers | Lagos | Mainland BlockParty | https://app.clickup.com/t/86bak4u6d |
| Recurring promoters and community organizers | Lagos | African Food & Drinks Festival | https://app.clickup.com/t/86bak4u8u |
| Experience, activity, and trip operators | Triangle | Triangle Food and City Tours | https://app.clickup.com/t/86bak4ub6 |
| Experience, activity, and trip operators | Triangle | Taste Carolina Gourmet Food Tours | https://app.clickup.com/t/86bak4ued |
| Experience, activity, and trip operators | DC | Mangia DC Food Tours | https://app.clickup.com/t/86bak4uhq |
| Experience, activity, and trip operators | DC | DC Metro Food Tours | https://app.clickup.com/t/86bak4ure |
| Experience, activity, and trip operators | Lagos | Nike Art Foundation | https://app.clickup.com/t/86bak4uve |
| Creator-hosts and micro-community curators | Lagos | Eat.Drink.Lagos / EatDrinkFestival | https://app.clickup.com/t/86bak4uye |
| Creator-hosts and micro-community curators | Triangle | The Triangle Weekender | https://app.clickup.com/t/86bak4v0y |
| Creator-hosts and micro-community curators | Triangle | Shop Local Raleigh | https://app.clickup.com/t/86bak4v43 |
| Creator-hosts and micro-community curators | DC | 730DC | https://app.clickup.com/t/86bak4v7u |
| Creator-hosts and micro-community curators | DC | City Girls Who Walk DC | https://app.clickup.com/t/86bak4vat |
| Pop-up, market, and temporary experience operators | Triangle | The Night Market Company | https://app.clickup.com/t/86bak4vty |
| Pop-up, market, and temporary experience operators | Triangle | The MAKRS Society | https://app.clickup.com/t/86bak4vy9 |
| Pop-up, market, and temporary experience operators | DC | Shop Made in DC | https://app.clickup.com/t/86bak4w3k |
| Pop-up, market, and temporary experience operators | Lagos | Lagos Food Festival | https://app.clickup.com/t/86bak4w6z |
| Pop-up, market, and temporary experience operators | Lagos | Mente de Moda | https://app.clickup.com/t/86bak4wen |
| Workshop-first wellness and lifestyle operators | Triangle | Current Wellness | https://app.clickup.com/t/86bak4wha |
| Workshop-first wellness and lifestyle operators | DC | Yoga District | https://app.clickup.com/t/86bak4wmw |
| Workshop-first wellness and lifestyle operators | DC | Epic Yoga DC | https://app.clickup.com/t/86bak4wvr |
| Workshop-first wellness and lifestyle operators | Lagos | i-Fitness Gym & Wellness Centres | https://app.clickup.com/t/86bak4wye |
| Workshop-first wellness and lifestyle operators | Lagos | Breathe Yoga Studio Lagos | https://app.clickup.com/t/86bak4x1x |
| Multi-location hospitality groups | Triangle | Giorgios Hospitality Group | https://app.clickup.com/t/86bak4x5g |
| Multi-location hospitality groups | Triangle | Urban Food Group | https://app.clickup.com/t/86bak4x9m |
| Multi-location hospitality groups | DC | Clyde's Restaurant Group | https://app.clickup.com/t/86bak4xea |
| Multi-location hospitality groups | DC | KNEAD Hospitality + Design | https://app.clickup.com/t/86bak4xhf |
| Multi-location hospitality groups | Lagos | Genesis Group Nigeria | https://app.clickup.com/t/86bak4xkg |

## CRM Card Format Used

Each card includes:

- ICP
- Market overlay
- Category
- Source URL
- Public signal
- Pain hypothesis
- Suggested channel
- First ask
- Activation motion
- Proof target
- Compliance note

## Next Batch Recommendation

Run outreach first against the highest-intent categories:

1. Recurring promoters and community organizers
2. Event-forward independent hospitality operators
3. Nightlife and live-entertainment venues
4. Experience, activity, and trip operators

For call/email execution, verify public phone and email/contact route on each source page immediately before outreach.
