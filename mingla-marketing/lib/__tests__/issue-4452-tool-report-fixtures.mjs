// #4452 test fixtures (not a test): one full report per tool, shaped like the
// four real reports the redesign was approved from (Angus Barn, the Lekki yacht
// cruise, Kyoto in Bloom, the Raleigh pasta class), with every optional block
// filled so every section renders. Names and numbers are illustrative.

export const VENUE = {
  venue: { name: 'Angus Barn', city: 'Raleigh', website: 'https://www.angusbarn.com/' },
  match: { found: true, mingla_score: 94, ai_read: 'Explorers on Mingla already rate you highly.', photo_urls: ['https://example.test/p1.jpg', 'https://example.test/p2.jpg'] },
  screenshot: { image_url: 'https://example.test/before.jpg', og_image_url: null, after_url: 'https://example.test/after.jpg' },
  site_signals: { checks: [{ key: 'https', label: 'Secure connection (HTTPS)', status: 'pass', detail: 'Your site loads over a secure connection.' }, { key: 'title', label: 'Page title', status: 'warn', detail: 'Your title is 73 characters.' }] },
  percentile: { city: 'Raleigh', better_than_pct: 75, sample: 1702 },
  vibe_card: { vibes: ['Romantic', 'Fine dining', 'Classic steakhouse'], occasions: ['romantic dinner', 'special birthday'], signature_mention: 'A Raleigh icon since 1960.' },
  scores: { overall: 74, grade: 'B', first_impression: 60, findability: 70, mobile: 80, menu_offers: 65, occasion_signal: 90, reasons: { first_impression: 'The hero says fine Southern dining.' } },
  google_listing: { lines: ['Angus Barn is an iconic steakhouse in Raleigh.', 'It has a 4.6-star Google rating.'] },
  fixes: [{ title: 'Add a link preview', why: 'Shared links show a bare URL.', change: 'Add Open Graph tags.', impact: 'high' }, { title: 'Show menu prices', why: 'Guests compare prices.', change: 'Put prices on the menu page.', impact: 'medium' }],
  rewritten_hero: { before_excerpt: 'The Angus Barn Steakhouse, a Raleigh icon serving American style cuisine.', after_copy: 'Experience Raleigh’s iconic Angus Barn Steakhouse, renowned since 1960.' },
  ai_read: 'The site conveys a long-standing, award-winning steakhouse.',
  competition: { competitors: [{ name: 'LongHorn Steakhouse', city: 'Raleigh', website: null, mingla_score: 100, what_they_do_better: ['Online menu with prices'], evidence: null }], your_rank_read: 'Well established, mid-pack online.', outrank_playbook: [{ move: 'Add schema markup', why_it_works: 'Richer search listings.', effort: 'this_month' }] },
  review_themes: { praise: ['Overall dining experience'], complaints: ['Can be noisy'] },
  head_to_head: { competitor: 'Perry’s Steakhouse', rows: [{ dimension: 'Online menu prices', you: 'Not shown', them: 'Shown', winner: 'them' }] },
  where_you_win: ['An award-winning wine cellar'],
  offer: { per_person_from: '$3.99' },
  meta: { generated_at: '2026-08-16T12:00:00Z', fetch_failed: false },
}

export const EVENT = {
  event: { title: 'Sailor’s Lifestyle Yacht Cruise', category: 'Boat party', city: 'Lagos', venue_name: 'Terraform Jetty', date: '2026-12-04', start_time: '19:00', indoor_outdoor: 'indoor', ticket_price: 50000, capacity: 30, currency: 'NGN', audience_size: null, lineup: null },
  forecast: { total_low: 18, total_high: 30, baseline_low: 12, baseline_high: 22, capacity: 30, pct_capacity_low: 60, pct_capacity_high: 100, confidence: 'medium', headline_read: 'Strong festive kickoff meets high seasonal demand.' },
  plan: { kind: 'paid_optimized', currency: 'NGN', ticket_price: 50000, cpc: 120, cpc_source: 'researched', benchmarks: { cpc: 120, landing_to_ticket_pct: 2, show_rate_pct: 90 }, recommended_budget: 108426, ad_tickets_low: 7, ad_tickets_high: 12, ad_attendees_low: 6, ad_attendees_high: 11, cost_per_ticket: 11042, cost_pct_of_ticket: 22, ad_revenue: 490975, ad_profit: 382549, roas: 4.5, ads_worth_it: true, scenarios: [{ label: 'Lean', budget: 43370, ad_tickets: 7, revenue: 338913, profit: 295543, roas: 7.8, cost_per_ticket: 6398, total_attendees: 23, pct_capacity: 77, recommended: false }, { label: 'Recommended', budget: 108426, ad_tickets: 10, revenue: 490974, profit: 382548, roas: 4.5, cost_per_ticket: 11042, total_attendees: 26, pct_capacity: 87, recommended: true }], read: 'Spend about ₦108,426 on ads.' },
  factors: [{ label: 'Seasonal timing', status: 'help', detail: 'Detty December demand.' }, { label: 'Organiser audience reach', status: 'hurt', detail: 'Unverified follower base.' }],
  competitors: [{ name: 'Boat cruise with Worldbridge Travels', platform: 'Eventbrite', date_note: 'Sat 12 Dec', scale_note: 'medium-scale' }],
  comparables: [{ name: 'Terraform Jetty Sunset Yacht Parties', city: 'Lagos', turnout_note: '25 to 50 per charter', source_note: 'Terraform Jetty venue bookings' }],
  weather: { summary: 'Around 31°C, rain on ~20% of the last 5 years.', impact: 'A minor factor.', kind: 'climate_normal' },
  demand_read: 'Strong seasonal demand.',
  fixes: [{ title: 'Partner with Terraform Restaurant & Lounge', why: 'Built-in foot traffic at the jetty.', change: 'Table flyers and a story cross-post.', lift_note: '+5 to 8 guests', effort: 'this_week' }],
  listing_preview: { title: 'Sailor’s Lifestyle Yacht Cruise', tagline: 'Kick off Detty December in style.', vibe_tags: ['Luxury', 'Nightlife'], why_go: ['Sail past the Lekki-Ikoyi Link Bridge at night'], best_for: ['Couples and small groups'], cover_url: 'https://example.test/cruise.jpg' },
  offer: { per_person_from: '$3.99' },
  narrative: 'Launching on the first Friday of December puts you at the start of peak season.',
}

export const TRIP = {
  trip: { title: 'Kyoto in Bloom', destination: 'Kyoto, Japan', departure: 'San Francisco', start_date: '2027-04-05', nights: 5, days: 6, date_range: 'Apr 5 – Apr 10', group_size: 6, vibe: 'balanced', vibe_note: null, currency: 'USD' },
  headline_read: 'Perfectly timed, highly desirable, set to sell out fast.',
  cover_narrative: 'Imagine Kyoto bathed in soft pink hues.',
  confidence: 'high',
  plan: { currency: 'USD', nights: 5, days: 6, group_size: 6, cost_lines: [{ key: 'stay', label: 'Stay', per_person: 550, basis: '110 USD/night × 5 nights' }, { key: 'acts', label: 'Signature experiences', per_person: 149, basis: '5 experiences' }, { key: 'food', label: 'Food & drink', per_person: 330, basis: '55 USD/day × 6 days' }], cost_per_person: 1192, cost_per_person_low: 1073, cost_per_person_high: 1335, group_cost: 7152, margin_tiers: [{ margin_pct: 10, price_per_person: 1311, profit_per_person: 119, group_profit: 714, recommended: false }, { margin_pct: 30, price_per_person: 1550, profit_per_person: 358, group_profit: 2148, recommended: true }], recommended_margin_pct: 30, recommended_price_per_person: 1550, price_per_person_low: 1400, price_per_person_high: 1700, group_price: 9300, profit_per_person: 358, group_profit: 2148, comparable_price_pp: 3900, price_vs_market: 'Comparable trips advertise around $3,900 a person.', organic_bookings_low: 4, organic_bookings_high: 6, cpc: 1.2, cpc_source: 'estimated', recommended_ad_budget: 300, ad_bookings_low: 1, ad_bookings_high: 2, ad_extra_profit: 400, ads_worth_it: true, scenarios: [{ label: 'Recommended', budget: 300, ad_bookings: 2, extra_profit: 400, cost_per_booking: 150, total_booked: 6, pct_full: 100, recommended: true }], read: 'Lean on your list and Mingla’s organic reach.' },
  itinerary: [{ day: 1, title: 'Arrival & Gion evenings', summary: 'Settle into Gion.', stay: 'The Celestine Kyoto Gion', activities: ['Gion evening walk'] }],
  hotels: [{ name: 'The Celestine Kyoto Gion', area: 'Gion', nightly_pp: 135, note: 'Near the teahouses' }],
  activities: [{ name: 'Kiyomizu-dera Temple', price_pp: 5, tag: 'Must-see', why: 'Iconic wooden temple.', best_time: 'Early morning' }],
  comparables: [{ name: 'Classic Japan Cherry Blossom Tour', operator: 'Japan Journeys', price_pp: 2798, note: '10 days' }],
  weather: { summary: 'Around 18°C.', impact: 'Great conditions.', kind: 'climate_normal' },
  season_note: 'Early April is the peak of cherry blossom season.',
  demand_read: 'Exceptionally high demand.',
  factors: [{ label: 'Cherry blossom season', status: 'help', detail: 'Peak.' }, { label: 'High demand and crowds', status: 'watch', detail: 'Book ahead.' }],
  fixes: [{ title: 'Early bird booking incentive', why: 'Blossom-season urgency.', change: 'A perk for bookings in 2 weeks.', lift_note: '+1 booking', effort: 'this_week' }],
  listing_preview: { title: 'Kyoto in Bloom: A Cherry Blossom Dream', tagline: 'Ancient traditions meet the blossom.', vibe_tags: ['Culture'], why_go: ['Temples in sakura'], best_for: ['Culture lovers'], included: ['5 nights in boutique hotels'], excluded: ['International flights'], cover_url: 'https://example.test/kyoto.jpg' },
  price_basis: { note: 'Estimates for April 2027.', checked_on: '24 Jul 2026' },
  offer: { per_person_from: '$3.99' },
  pricing_status: 'priced',
}

/** The real Ibiza report's shape (25 Aug): every line and the price came back 0. */
export const TRIP_UNPRICED = {
  ...TRIP,
  trip: { ...TRIP.trip, title: 'Ibiza Summer Escape', destination: 'Ibiza, Spain' },
  plan: { ...TRIP.plan, cost_lines: TRIP.plan.cost_lines.map((l) => ({ ...l, per_person: 0 })), cost_per_person: 0, cost_per_person_low: 0, cost_per_person_high: 0, group_cost: 0, margin_tiers: TRIP.plan.margin_tiers.map((m) => ({ ...m, price_per_person: 0, profit_per_person: 0, group_profit: 0 })), recommended_price_per_person: 0, price_per_person_low: 0, price_per_person_high: 0, group_price: 0, profit_per_person: 0, group_profit: 0, comparable_price_pp: null, ad_extra_profit: 0, recommended_ad_budget: 0, cpc: 0 },
  hotels: TRIP.hotels.map((h) => ({ ...h, nightly_pp: 0 })),
  activities: TRIP.activities.map((a) => ({ ...a, price_pp: 0 })),
  comparables: TRIP.comparables.map((c) => ({ ...c, price_pp: 0 })),
  pricing_status: 'unpriced',
}

export const PRICING = {
  experience: { description: 'Pasta Making Class', category: 'Workshop / class', city: 'Raleigh, United States', seats: 12, current_price: 20, events_per_month: 6, currency: 'USD' },
  headline_verdict: 'You are running a popular experience but underpricing it.',
  narrative: 'The numbers show you are significantly underpricing.',
  confidence: 'medium',
  premium_framing: 'A hands-on Italian evening, not a cooking lesson.',
  value_points: ['Fresh pasta you take home'],
  audit: { currency: 'USD', seats: 12, events_per_month: 6, current_price: 20, cost_lines: [{ key: 'time', label: 'Your time', per_event: 140, per_head: 11.67, basis: '5 hrs × $28/hr', estimated: true }, { key: 'materials', label: 'Materials', per_event: 84, per_head: 7, basis: 'flour, eggs', estimated: false }], total_cost_per_event: 224, cost_per_head: 18.64, time_value_per_event: 140, hourly_rate: 28, hourly_rate_source: 'researched', own_hours: 5, own_hours_estimated: true, revenue_per_event: 240, profit_per_event: 16, margin_per_head: 1.36, monthly_profit: 96, break_even_seats_now: 11, verdict: 'underpriced', headline_amount: 4950, comp_price_pp: 70, recommended_price: 65, recommended_margin_pct: 70, break_even_seats_rec: 4, monthly_upside: 4950, extra_per_head: 45, read: 'You are profitable, but leaving about $4,950 a month on the table.' },
  comps: [{ name: 'Weaver Street Market · Pasta Making Class', price_pp: 25, note: '2 hours', source_note: 'their booking page' }, { name: 'Spaciously · Pasta Making Class', price_pp: 70, note: '2 hours', source_note: 'listing' }],
  demand_read: 'Healthy and expanding demand for cooking classes.',
  factors: [{ label: 'Current price vs true cost', status: 'hurt', detail: 'At $20 you barely cover cost.' }],
  fixes: [{ title: 'Raise the price in two steps', why: 'Keeps current guests.', change: '$20 → $40, then $65.', lift_note: '+$2,400 a month', effort: 'this_week' }],
  price_basis: { note: 'Prices checked this week.', checked_on: '24 Jul 2026' },
  offer: { per_person_from: '$3.99' },
  meta: { generated_at: '2026-07-24T12:00:00Z' },
}
