const path = require("path");
const businessRoot = path.resolve(__dirname, "../mingla-business");
const businessModules = path.join(businessRoot, "node_modules");
const base = require(path.join(businessRoot, "jest.issue1561.web.render.cjs"));

module.exports = {
  ...base,
  rootDir: __dirname,
  modulePaths: [businessModules],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    "^react$": path.join(businessModules, "react"),
    "^react/(.*)$": path.join(businessModules, "react", "$1"),
    "^react-native$": path.join(businessModules, "react-native-web"),
    "^react-test-renderer$": path.join(businessModules, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(
      businessModules,
      "react-test-renderer",
      "$1",
    ),
    "^react-i18next$": path.resolve(
      __dirname,
      "src/test/reactI18next.render.mock.cjs",
    ),
    "^@mingla/calendar/(.*)$": path.resolve(__dirname, "../packages/calendar/$1"),
    "^@mingla/offering-rendering/(.*)$": path.resolve(
      __dirname,
      "../packages/offering-rendering/$1",
    ),
  },
  testMatch: [
    "**/__tests__/publicHeroAccessibility.issue2774.happy.test.tsx",
    "**/__tests__/publicHeroAccessibility.issue2774.adversarial.test.tsx",
    "**/__tests__/publicHeroAccessibility.issue2788.singleReactOwner.test.cjs",
    // issue #3321 — mounts the consumer experience detail through the #2774
    // hero-label path that crashed every open; runs in this same CI step.
    "**/__tests__/issue_3321_experience_detail_opens.render.test.tsx",
    // issue #3321 — no undeclared name / missing property in the three consumer
    // detail screens (a scoped type check; app-mobile has no typecheck gate).
    "**/__tests__/consumerDetailScreens.issue3321.namesExist.test.cjs",
    // issue #3682 — mounts the consumer brand page and presses its X: with no
    // history (app opened by a brand link) it must land on the Explorer home.
    "**/__tests__/issue_3682_brand_close_fallback.render.test.tsx",
    // issue #3682 (tester) — mounts both brand link routes against a history
    // model: X ends on Home with nothing underneath, never a dead back().
    "**/__tests__/issue_3682_brand_close_fallback.tester_adversarial.render.test.tsx",
    // issue #3859 — mounts the real Explorer brand host and invokes its public
    // navigation callbacks through the shared parity-contract adapter.
    "**/__tests__/issue_3859_explorer_public_parity.implementor.happy.test.tsx",
    // issue #3859 — Explorer stays signed-in-only during auth expiry and
    // recovers the account recap without losing the buyer's cart lines.
    "**/__tests__/issue_3859_expired_session_guard.implementor.happy.render.test.tsx",
    "**/__tests__/issue_3859_expired_session_guard.tester.adversarial.render.test.tsx",
    // issue #3859 — native checkout request, recovery, and terminal truth.
    "**/__tests__/issue_3859_checkout_v2_client.implementor.happy.test.ts",
    "**/__tests__/issue_3859_native_checkout_recovery.implementor.happy.test.ts",
    "**/__tests__/issue_3859_native_checkout_recovery.tester_adversarial.test.ts",
    "**/__tests__/issue_3859_native_checkout_terminal_flow.implementor.happy.test.ts",
    "**/__tests__/issue_3859_native_terminal_wiring.implementor.happy.test.ts",
    "**/__tests__/issue_3859_paystack_recovery_terminal_truth.implementor.happy.test.ts",
    // issue #3859 — public installment capability runs in this Node 20 lane
    // through Jest's existing TypeScript transform; the other pure Node guards
    // are spawned below without depending on app-mobile/node_modules.
    "**/__tests__/issue_3859_public_installment_capability.implementor.happy.test.ts",
    "**/__tests__/issue_3859_node_guards_ci.render.test.ts",
    // issue #2107 — mounts the Explorer welcome video, runs a restart whose
    // reloadAsync fails, and proves the released player is never touched again.
    "**/__tests__/issue_2107_welcome_video_released_on_restart.render.test.tsx",
    // issue #3682 — the consumer app updates the public aggregate immediately
    // on follow and restores the server count if the write fails.
    "**/__tests__/issue_3682_follower_count_optimistic.render.test.tsx",
    // issue #4111 Wave D — Explorer "Message {Brand}": enquiry rows, send args,
    // calendar prefills, push route, claim after email sign-in; the sheet
    // wiring from every entry point and the signed-out sign-in step; the
    // enquiry thread (composer, Report, resolved banner).
    "**/__tests__/issue_4111_explorer_enquiry_model.implementor.happy.test.ts",
    "**/__tests__/issue_4111_explorer_message_entry_points.implementor.happy.render.test.tsx",
    "**/__tests__/issue_4111_explorer_enquiry_thread.implementor.happy.render.test.tsx",
    // issue #4111 — tester adversarial: enquiry rows and read status under
    // hostile data (other people's receipts, system rows, cross-thread pages).
    "**/__tests__/issue_4111_explorer_enquiry_rows.tester.adversarial.test.ts",
    // issue #4459 rework — the Chats page and an open Guest chat mount together
    // (one enquiries channel); the Message <Brand> sheet closes on send.
    "**/__tests__/issue_4459_guest_chat_enquiry.implementor.render.test.tsx",
    // issue #4459 QA retest — the booking card opens the Guest chat in the
    // existing home shell; a rejoin drops the cached thread; row parity.
    "**/__tests__/issue_4459_booking_guest_chat.implementor.render.test.tsx",
    // issue #4459 QA retest 2 — a deep link to a chat the list has not loaded
    // yet (Rejoin / Open guest chat) opens the thread once it is found.
    "**/__tests__/issue_4459_deep_link_pending_chat.implementor.render.test.tsx",
    // issue #4459 tester retest — two Chats pages alive at once (the booking
    // card's Open/Rejoin guest chat replaces to /) must not throw on the
    // enquiries channel.
    "**/__tests__/issue_4459_chats_remount.tester.adversarial.render.test.tsx",
    // issue #4251 — RSVP covers keep their media type, and the compact
    // Purchases card draws a fixed 72 x 72 cover or its date tile.
    "**/__tests__/issue_4251_purchase_card_cover.implementor.happy.render.test.tsx",
    // issue #4275 — a restored `{}` error never reaches Sentry; a real Error does.
    "**/__tests__/issue_4275_your_circle_sentry.implementor.render.test.tsx",
    // issue #4275 — one read-status read per page, and a deliberate leave of a
    // chat is never reported as a channel failure.
    "**/__tests__/issue_4275_get_messages_one_read.implementor.render.test.ts",
    "**/__tests__/issue_4275_get_messages_sender_fanout.tester.adversarial.render.test.ts",
    "**/__tests__/issue_4275_page_catchup.tester.adversarial.render.test.tsx",
    // issue #4275 — the hook around the open-chat recovery controller.
    "**/__tests__/issue_4275_open_chat_recovery.implementor.render.test.tsx",
    // issue #4347 — a paid brand experience that lost its cardType never
    // writes "Spend level: Free" into the phone calendar.
    "**/__tests__/issue_4347_device_calendar_spend_level.implementor.happy.test.ts",
    // issue #4347 wave 1 — the redesigned deck card: pager, tap zones, fact
    // line, curated line, smart chip, claimed-venue chunking (pure), and every
    // deck-card state rendered.
    "**/__tests__/issue_4347_deck_card_model.implementor.test.ts",
    "**/__tests__/issue_4347_deck_card_states.implementor.render.test.tsx",
    // issue #4347 round 2 — real plan price estimates, the Direction B plan plate,
    // Price per stop, inline conditions rows, the shrinking pinned label.
    "**/__tests__/issue_4347_round2.implementor.render.test.tsx",
    "**/__tests__/issue_4347_round3.implementor.render.test.tsx",
    // issue #4347 wave 1 rework — smart chip after midnight, collab route
    // hand-off, kicker at large text, card-local tap zones, poster parity.
    "**/__tests__/issue_4347_wave1_rework.implementor.test.ts",
    // issue #4347 wave 2 — the expanded single place: gallery, basics tiles,
    // When you'd go, pinned bar, directions helper, night-out ticket bar.
    "**/__tests__/issue_4347_place_sheet_model.implementor.test.ts",
    "**/__tests__/issue_4347_place_sheet_states.implementor.render.test.tsx",
    // issue #4347 wave 3 — the expanded curated plan: arrival model, warning,
    // stop cards, navigator, Route all stops, On the night.
    "**/__tests__/issue_4347_plan_model.implementor.test.ts",
    "**/__tests__/issue_4347_plan_sheet_states.implementor.render.test.tsx",
    // issue #4347 wave 3 follow-ups — live font scale for the tap zones, one
    // overnight-hours model for the schedule check, one primary-button colour.
    "**/__tests__/issue_4347_wave3_followups.implementor.render.test.tsx",
    // issue #4347 wave 3 rework after the retest — one 15-minute rule, fixes
    // that keep the whole plan clear, pulse-only body, identity reset, route
    // cap note, locale keys, "Leave now", count-from-shown.
    "**/__tests__/issue_4347_wave3_rework.implementor.render.test.tsx",
    // issue #4347 wave 4 — the Explorer layer on a host venue page: "When
    // you'd go" in the host's measured palette (neutral fallback), converted
    // "Experiences here" prices, the pinned Save / Schedule / Share /
    // Reserve-or-Directions bar acting on the deck card, the state Close.
    "**/__tests__/issue_4347_venue_explorer_model.implementor.test.ts",
    // issue #4490 — the deck place sheet's main button follows what the venue
    // sells (features), not its type.
    "**/__tests__/issue_4490_deck_venue_cta.implementor.test.ts",
    // issue #4490 Explorer W3 — deck chips (shared deckVenueChip), the venue
    // page panes (model, seam, analytics, wiring) and the mounted pane states.
    "**/__tests__/issue_4490_w3_deck_venue_chip.implementor.test.ts",
    "**/__tests__/issue_4490_w3_venue_panes.implementor.test.ts",
    "**/__tests__/issue_4490_w3_venue_panes.implementor.render.test.tsx",
    // issue #4490 W3 fix 1 — the tester's adversarial pins and the fix suite
    // (plans with their period, ended events, free entry, sold out today, the
    // collab hand-off from the card sheet, the buyer web of this build).
    "**/__tests__/issue_4490_w3.tester.adversarial.test.ts",
    "**/__tests__/issue_4490_w3_fix1.implementor.test.ts",
    // issue #4490 W3 fix 2 — the Buy hand-off per build profile (injected
    // backend) and the groups "from" in one unit.
    "**/__tests__/issue_4490_w3_fix2.implementor.test.ts",
    // issue #4490 W3 fix 3 — the first device pass: venue times without Intl
    // parts (Hermes), ₦ on every engine, each tab's own action, offline vs a
    // server failure, panes per tab, the tab strip and header at 375 pt.
    "**/__tests__/issue_4490_w3_fix3.implementor.test.ts",
    "**/__tests__/issue_4490_w3_fix3.implementor.render.test.tsx",
    // issue #4490 W3 fix 4 — the second device pass: the Menu tab's order
    // sheet (empty basket, Close, its own window, the bar), the table verb,
    // ₦ typical spend, links over the shared deck, the 10 s pane budget.
    "**/__tests__/issue_4490_w3_fix4.implementor.test.ts",
    "**/__tests__/issue_4490_w3_fix4.implementor.render.test.tsx",
    // issue #4490 W3 fix 5 — the third device pass: the Menu tab's order bar
    // docked at the bottom edge, the note field keeping focus, Pay clear of
    // the keyboard's Done bar.
    "**/__tests__/issue_4490_w3_fix5.implementor.test.ts",
    "**/__tests__/issue_4490_w3_fix5.implementor.render.test.tsx",
    // issue #4490 Explorer W5 — deck analytics for hosted venues (is_hosted_venue,
    // deck_lead, venue_id, position_in_deck; venue_checkout_finished).
    "**/__tests__/issue_4490_w5_deck_analytics.implementor.test.ts",
    // issue #4490 W5 fix 2 (W5-D1) — the deck's expand / save / dismiss analytics
    // run behind one guard (an analytics failure never stops the action), and
    // the whole Explorer app reads no undeclared name (the missing import that
    // broke every deck card on the device).
    "**/__tests__/issue_4490_w5_deck_handlers.implementor.test.ts",
    "**/__tests__/issue_4490_w5_no_undeclared_names.implementor.test.cjs",
    // issue #4490 Explorer W6a — Venues in Discover: the kind, the venue card
    // (model, route with ?tab=, mounted variant), Type of place chips, wiring.
    "**/__tests__/issue_4490_w6a_discover_venues.implementor.render.test.tsx",
    // issue #4490 W6 fix 2 — the device pass's Discover P3s: the lead line wraps
    // (no price cut mid-number), one body state at a time with the pills kept,
    // no stale count while new filters load, the 10 s Venues read budget.
    "**/__tests__/issue_4490_w6_fix2_discover.implementor.render.test.tsx",
    // issue #4490 Explorer W6b — "Places on Mingla" deck chips: resolvePills,
    // saved categories, the hook's parse and keys, the mounted row, sheet wiring.
    "**/__tests__/issue_4490_w6b_places_on_mingla.implementor.render.test.tsx",
    // issue #4490 W6b fix 3 — a venue-type chip change gives the solo deck a new
    // key (it refetches as a category change does); a chip-only deck with
    // nothing open ends with hasMore:false (the empty state, not a loader).
    "**/__tests__/issue_4490_w6b_deck_refetch.implementor.test.ts",
    // issue #4490 W7 — "When you'd go" on every venue surface: the pure model
    // (chips, hide rules, Leave by, 7-day reach, On the day, checkout line,
    // Hermes) and the rendered blocks (event page, pass, checkout line).
    "**/__tests__/issue_4490_w7_when_you_go_model.implementor.test.ts",
    "**/__tests__/issue_4490_w7_when_you_go.implementor.render.test.tsx",
    // issue #4624 — the Explorer cart's code notices: code copy, Lower to N /
    // Keep N at full price, per-line Keep, no Lower when nothing fits.
    "**/__tests__/issue_4624_cart_code_notices.implementor.render.test.tsx",
    // issue #4624 tester — sale notices byte-identical to the #3872 cart, code
    // notices never in sale wording when the row or line is missing.
    "**/__tests__/issue_4624_cart_notices.tester.adversarial.render.test.tsx",
    // issue #4490 Explorer W4 — native checkout per offer: the reducer (steps,
    // keys, words), the venue recovery pointer and payment leg, sign-out
    // clearing the pointer, the sheet's pure model and the sheet itself.
    "**/__tests__/issue_4490_w4_venue_checkout_flow.implementor.test.ts",
    "**/__tests__/issue_4490_w4_venue_checkout_recovery.implementor.test.ts",
    "**/__tests__/issue_4490_w4_signout_clears_venue_checkout.implementor.test.ts",
    "**/__tests__/issue_4490_w4_checkout_model.implementor.test.ts",
    "**/__tests__/issue_4490_w4_checkout_service.implementor.test.ts",
    "**/__tests__/issue_4490_w4_checkout_sheet.implementor.render.test.tsx",
    "**/__tests__/issue_4490_w4_purchases_pay.implementor.test.ts",
    // #4490 06-W4 fix 1: option rows priced by the server for the chosen day, the plan Review, sign in again mid-checkout.
    "**/__tests__/issue_4490_w4_fix1.implementor.render.test.tsx",
    "**/__tests__/issue_4490_w4_fix1.implementor.test.ts",
    "**/__tests__/issue_4490_w4_fix2.implementor.render.test.tsx",
    "**/__tests__/issue_4490_w4_fix2.implementor.test.ts",
    "**/__tests__/issue_4347_venue_explorer.implementor.render.test.tsx",
    // issue #4347 wave 3 retest extras — the gallery video's Sound control,
    // and the deck chip on the schedule check's 15-minute rule.
    "**/__tests__/issue_4347_retest_extras.implementor.render.test.tsx",
    // issue #4347 wave 1 — tester adversarial: the photo flip's gesture lease,
    // the smart chip in venue time and across midnight, claimed-venue keys,
    // the hint's logout sweep, locale plurals, the kicker's contrast floor.
    "**/__tests__/issue_4347_wave1.tester.adversarial.test.ts",
    // issue #4347 wave 1 rework + wave 2 — tester adversarial: the collab
    // route hand-off as its real host mounts it, card-local tap targets on
    // every face layer, the 482pt scrim on iPhone SE at the largest text; the
    // place sheet's gallery under parent re-renders, forecast / sunset /
    // quieter-at edges, and pinned-bar parity with the old band.
    "**/__tests__/issue_4347_wave1_rework.tester.adversarial.render.test.tsx",
    "**/__tests__/issue_4347_place_sheet.tester.adversarial.render.test.tsx",
    // issue #4347 wave 3 + follow-ups — tester adversarial: the one overnight
    // model with Google's real separators, arrivals across midnight and venue
    // clocks, the warning's fix, Route all stops encoding / cap, the scroll
    // store's publish budget; the plan sheet's route label on iPhone, the
    // swap and start-time count, the navigator and the pinned plan bar.
    "**/__tests__/issue_4347_wave3.tester.adversarial.test.ts",
    "**/__tests__/issue_4347_wave3.tester.adversarial.render.test.tsx",
    // issue #4347 wave 3 rework — tester retest: every offered start fix
    // clears the whole plan (seeded sweep), one 15-minute rule for the sheet
    // and the schedule check, the route cap note, the identity-keyed reset.
    "**/__tests__/issue_4347_wave3_retest.tester.adversarial.test.tsx",
    // issue #4347 wave 4 — tester adversarial: "When you'd go" against every
    // production brand theme, hostile palettes, the hand-off store, the bar's
    // Save (double tap, failure), Null Island directions; the gallery's Sound
    // control (per gallery, re-render, a11y, Reduce Motion).
    "**/__tests__/issue_4347_wave4.tester.adversarial.render.test.tsx",
    "**/__tests__/issue_4347_gallery_sound.tester.adversarial.render.test.tsx",
    // issue #4347 × #4334 — tester final retest: the sheet's Directions and
    // Route all stops on #4334's Maps target (bytes, refused ids, pairing).
    "**/__tests__/issue_4347_maps_routing.tester.adversarial.test.ts",
    // issue #4402 — Creator setup errors land beside the button: a refused
    // profile Save, the Rates step before a profile exists, a refused Save rate.
    "**/__tests__/issue_4402_creator_setup_errors.implementor.render.test.tsx",
    // issue #4402 — Socials handle states from the server (pending, review,
    // expired, rejected, verified), no X, Local prefill; showcase progress
    // only after a pick.
    "**/__tests__/issue_4402_creator_socials_states.implementor.render.test.tsx",
    // issue #4402 — a refused bank connect shows its error under the button
    // that caused it, not at the bottom of the form.
    "**/__tests__/issue_4402_payout_connect_error.implementor.render.test.tsx",
    // issue #4402 — the creator delivery card waits for processing and sends once;
    // the Shoot card and the posts-checked notices; the media poll and resume.
    "**/__tests__/issue_4402_explorer_delivery.implementor.render.test.tsx",
    "**/__tests__/issue_4402_explorer_media_poll.implementor.render.test.ts",
    // issue #4456 — the Unsend / Remove confirm sheet opens, Cancel and the
    // backdrop close it, and a sheet that never opens is closed (device F-1).
    "**/__tests__/issue_4456_unsend_confirm_sheet.implementor.render.test.tsx",
    // issue #4456 — Profile → Edit bio opens (it froze), saves and closes.
    "**/__tests__/issue_4456_edit_bio_sheet.implementor.render.test.tsx",
    // issue #4473 — "Missing a ticket?": Check again, the three ways in, the
    // dark add sheet (tabs, code, found / shared / nothing), ask-to-send and
    // the confirmation-link step; Send to a friend draws dark.
    "**/__tests__/issue_4473_missing_ticket.implementor.render.test.tsx",
    // issue #3281 S6 — Explorer's RSVP add-ons: the pass sheet's list and the reads/sends.
    "**/__tests__/issue_3281_rsvp_add_ons_explorer.implementor.render.test.tsx",
    // issue #4473 — purchases shared with a second proven account (list,
    // read-only detail, owner note, Calendar) and "Is this your ticket?".
    "**/__tests__/issue_4473_shared_purchases.implementor.render.test.tsx",
    // issue #4473 device pass — one dark Done bar, in-sheet country picker,
    // per-kind shared notes, channel hint, keyboard closed before results.
    "**/__tests__/issue_4473_device_fixes.implementor.render.test.tsx",
    // issue #4523 — the program pickers use the shared Mingla calendar: month
    // changes never close it, a day tap picks once, a range commits on Done.
    "**/__tests__/issue_4523_program_pickers_calendar.implementor.render.test.tsx",
    // issue #4523 — Creator date of birth: year grid, three taps, 18+ only.
    "**/__tests__/issue_4523_creator_dob.implementor.render.test.tsx",
    // issue #4523 — Explorer inline calendars: stay dates and plan date never move on a month change.
    "**/__tests__/issue_4523_explorer_inline_calendars.implementor.render.test.tsx",
    // issue #4523 — form date questions (RSVP / brand forms) use the Mingla calendar.
    "**/__tests__/issue_4523_rsvp_form_date.implementor.render.test.tsx",
    "**/__tests__/issue_4522_trip_balance_card.implementor.render.test.tsx",
    // issue #4541 — the Explorer form screen, questions card, hand-off, draft
    // and sign-out, deep links and the form route, the app checkout's
    // questions (marker, answers, refusals), the RSVP read through the edge.
    "**/__tests__/BrandFormScreen.issue4541.test.tsx",
    "**/__tests__/QuestionsCard.issue4541.test.tsx",
    "**/__tests__/FormHandoff.issue4541.test.tsx",
    "**/__tests__/authCleanup.formDrafts.issue4541.test.ts",
    "**/__tests__/deepLink.form.issue4541.test.ts",
    "**/__tests__/nativeCheckout.brandForm.issue4541.test.ts",
    "**/__tests__/brandFormService.issue4541.test.ts",
    // issue #4541 A3 — the RSVP success popup hands its close to the
    // "After they RSVP" block: Answer now closes it, then opens the form.
    "**/__tests__/rsvpFormHandoff.issue4541.test.tsx",
    // issue #4541 R2.10 — a questions read that keeps failing never blocks
    // a purchase (CHECKOUT_FORM_READ_FAILURE_BLOCKS_PAY).
    "**/__tests__/CheckoutQuestionsReadFailure.issue4541.test.tsx",
  ],
};
