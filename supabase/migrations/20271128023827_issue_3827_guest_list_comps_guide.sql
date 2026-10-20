-- Issue #3827 — Feature Guide wording for guest-list comps.
-- Rewrites four Feature Guide entries that described the old phone-only comp
-- guests and phone-only check-in: events-comp-guests, events-check-in,
-- events-guest-list and events-reconciliation. Guest-list guests now get a real
-- ticket, QR code and email; email is optional; they take a place and count as
-- going but are never sales; cancelling voids the ticket with no refund; door
-- staff find people by name and Admit on the scanner and on web; check-ins come
-- from the server.
-- Same rules as 20271110003720: a human-verified Live entry is never edited, no
-- evidence is added, and the number of effectively Live entries never changes.
-- INVARIANT: {"id":"I-3827-GUIDE-MATCHES-COMPS","rule":"The comp, check-in, guest-list and reconciliation Feature Guide entries describe server guest-list tickets (real ticket, QR, email optional, capacity yes, sales no, cancel voids without refund, find by name and Admit) and never the retired phone-only comp list."}

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $foundation$
BEGIN
  IF to_regclass('public.product_capabilities') IS NULL
     OR to_regclass('public.product_truth_audit') IS NULL
     OR to_regprocedure('public.issue_3720_feature_guide_effective_status(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue3827_guide_foundation_missing';
  END IF;
END;
$foundation$;

CREATE TEMP TABLE issue_3827_guide ON COMMIT DROP AS
SELECT *
  FROM jsonb_to_recordset($catalog$
[
  {
    "capability_key": "events-comp-guests",
    "title": "Add guests to the guest list (free tickets, no checkout)",
    "outcome_summary": "Put people on an event's guest list without them buying anything (comp, guest list spot, plus-one, VIP, press). Each person gets a real free ticket with its own QR code, sent by the standard ticket email when you give an email. Guest-list tickets take a place (they count toward capacity, places left and how many are going) but never count as sales, revenue, fees or payouts. Covers: comp ticket, complimentary guest, free entry, guest list, plus-one, add guests in bulk.",
    "how_to": "In Mingla Host, open the event and tap \"Guests\", then tap \"+\" (\"Add to guest list\").\n1. Pick the ticket type. Hidden ticket types are listed too, so a hidden \"Guest list\" ticket type works well. Each one shows how many places are left; a sold-out one is greyed out.\n2. If the event runs on several dates, pick the date they are coming.\n3. Fill in Full name (required), Email (sends their ticket) and Phone (optional). Tap \"+ Add a plus-one\" for each person they bring: give a plus-one a name (and optionally an email or phone) and they get their own ticket; leave a plus-one blank and their QR code goes in the main guest's email.\n4. Tap \"+ Add another guest\" for more people (up to 50 at once), or \"Paste a list\" and paste one guest per line as \"Name, email, party size\", then tap \"Preview\".\n5. Add an optional \"Note for your team\" and tap \"Add {n} guests\".\nEveryone with an email gets the standard free-ticket email with a QR code. They show in Guests with a GUEST LIST pill. Open a guest to tap \"Resend ticket\" or \"Cancel guest-list ticket\".",
    "limitations": "Event manager or above only. Ticketed events only (not RSVP events, trips or experiences). There must be enough places left on the ticket type for everyone in the request; otherwise nobody in that request is added (\"Not enough places left on ... N left.\"), so raise the capacity or use another ticket type. The same email can hold only one live guest-list ticket per event (\"Already on the guest list for this event.\"). A guest with no email gets no email; door staff find them by name. Cancelling voids the QR code and frees the place; it is refused once anyone on that ticket is checked in, and the guest is emailed that it was cancelled. No money is involved, so there is nothing to refund. Ticket resends are limited to 3 an hour per guest. Comps added before this update were saved only on that phone; the Guests screen offers a one-time \"Re-add\" to turn them into real tickets.",
    "support_wording": "Hosts add guest-list guests from the event's Guests page with the \"+\" button. Each guest gets a real free ticket and QR code by email (email is optional) and can be checked in by scanning or by name at the door. Guest-list tickets use up places but are not sales, so they never appear in revenue or payouts; cancelling one simply voids the ticket.",
    "who_can_use": ["Brand owner", "Brand admin", "Event manager"],
    "surfaces": ["Mingla Host iOS", "Mingla Host Android", "Mingla Host web", "Email"]
  },
  {
    "capability_key": "events-check-in",
    "title": "Check guests in at the door (scan or find by name)",
    "outcome_summary": "Check guests in at the door by scanning the QR code on their ticket, or by finding them by name and tapping Admit. Both go through the same check on Mingla's server, which shows a green check-in, already checked in, wrong event, ticket not valid, doors not open yet, or event ended. Check-ins are shared across every door phone and the Guests list. Covers: check-in, door scanning, ticket scanner, QR scan, entry, admit guests, guest list at the door, find by name.",
    "how_to": "In the Mingla Host app on iOS or Android, open the event and tap \"Scan tickets\". People invited as scanners see their events on the Home screen and tap one to open the camera. Allow camera access when asked. Point the camera at the ticket QR code. A result shows for about three seconds: \"<name> checked in\", \"Already checked in\", \"Different event\", \"Ticket not valid\", \"Doors aren't open yet\", \"Event ended\" or \"Ticket not found\".\nNo QR? Tap \"Find by name\", type at least 2 letters of the name or email, and tap \"Admit\" on the ticket (or \"Admit all\" for a party). On Mingla Host web, the Scan tickets page has the same \"Find a guest by name\" panel, so a laptop at the door works too. A host can also open a guest in Guests and tap \"Admit\" on a ticket.",
    "limitations": "Camera scanning works only in the Mingla Host iOS and Android apps; on Mingla Host web use \"Find a guest by name\". Scanning and name search need an internet connection; there is no offline mode (\"You're offline. Connect to search the guest list.\"). Name search shows names, a masked email and ticket states only, and finds every ticket holder of the event, buyers and guest-list guests alike. Admitting by name is recorded like a scan, so a second admit, or scanning that QR afterwards, shows \"Already checked in\". The person checking in must be on the brand team as a scanner or event manager and above, or have accepted a scanner invite; otherwise they see that they are not authorized for this event. A cancelled guest-list ticket shows \"Ticket not valid\".",
    "support_wording": "Door staff check guests in by scanning the ticket QR code in the Mingla Host app, or with \"Find by name\" and Admit when someone has no QR, including on Mingla Host web. Check-ins are stored on Mingla's server, so every door phone and the Guests list agree. If a ticket was already used, staff see \"Already checked in\".",
    "who_can_use": ["Brand owner", "Brand admin", "Event manager", "Scanner"],
    "surfaces": ["Mingla Host iOS", "Mingla Host Android", "Mingla Host web"]
  },
  {
    "capability_key": "events-guest-list",
    "title": "Guest list with search and CSV export",
    "outcome_summary": "See everyone coming to an event in one list: online buyers, guest-list guests and door sales, with status pills (PAID, GUEST LIST, CANCELLED), check-in state from Mingla's server, search by name, email or phone, filter by day for multi-day events, and export the list as a CSV spreadsheet. Covers: guest list, attendee list, who is coming, download guests, export attendees.",
    "how_to": "In Mingla Host, open the event and tap the \"Guests\" tile (it shows the guest count, guest-list guests included). Tap the search icon and type in \"Buyer name, email, or phone\". For events with several days, use the day chips (\"All\" or a day) to filter. Tap a row to open the guest: see their tickets, each with its check-in state, \"Admit\", and for guest-list guests \"Resend ticket\" and \"Cancel guest-list ticket\". Tap \"+\" to add people to the guest list. Tap the export icon to export the list: on web the CSV downloads; on iPhone and Android it opens the share sheet. The CSV has columns such as Kind (ONLINE, COMP or DOOR), Name, Email, Phone, Ticket type, Quantity, Status, Payment method, Gross, Refunded, Net and Came with. For brands where Mingla has switched on the newer guest status view, the page shows that view instead, with its own filters, an \"Add to guest list\" button, and an export prepared on the server.",
    "limitations": "Event manager or above only; lower roles see \"Couldn't load guest status\". Online orders, guest-list guests and check-ins come from Mingla's server and appear on every device; door sales in the standard list still come only from the device you are using. Guest-list rows always show 0 money. On iPhone and Android the export is shared as text through the share sheet rather than saved as a file. The newer guest status view is switched on per brand by Mingla and is off by default.",
    "support_wording": "Hosts can see their guest list from the Guests tile on the event, search it, add guest-list guests, and export it as a CSV. Ticket buyers, guest-list guests and check-ins appear on every device; door sales only appear on the device where they were recorded.",
    "who_can_use": ["Brand owner", "Brand admin", "Event manager"],
    "surfaces": ["Mingla Host iOS", "Mingla Host Android", "Mingla Host web"]
  },
  {
    "capability_key": "events-reconciliation",
    "title": "Reconcile sales across online, door and guest list",
    "outcome_summary": "See one end-of-night report for an event: tickets sold online and at the door, guest-list tickets, revenue by payment method, refunds, net, processing fees, expected payout, and scan results, with a CSV export. Guest-list tickets are counted as places but never as sales or revenue. Covers: reconciliation, end of night report, cash up, settlement, sales summary, payout estimate, comps.",
    "how_to": "In Mingla Host, open the event and tap the \"Reconciliation\" tile (or \"View full reconciliation report\" on the Door Sales page). The report shows TICKETS (Online sold, Door sold, Comps (guest list), TOTAL LIVE), REVENUE (Card (online), Apple Pay, Google Pay, Free (online), Cash (door), Card reader (door), NFC tap (door), Manual (door), Gross, Refunded, NET, Processing fee (online), EXPECTED PAYOUT) and SCANS (Scanned in, No-shows or Waiting, Duplicate scans, Wrong event, Not-found, Voided, Cancelled), with a by-scanner breakdown. Tap the export icon to download (web) or share (iPhone and Android) the reconciliation CSV; guest-list rows are marked COMP with 0 money.",
    "limitations": "Finance manager or above (also event manager, brand admin, brand owner); scanners and marketing managers see \"Restricted\". Online sales and guest-list tickets come from Mingla's server; door sales and the scan counts in this report still come only from the device you are viewing it on, so those parts can differ between devices. Card reader and NFC show \"Not available yet\". The report is advisory; payouts follow Mingla's own records of online payments. No PDF export.",
    "support_wording": "Hosts with finance access or above can open the Reconciliation tile on an event to see online and door sales, guest-list tickets, refunds, fees and expected payout, and export it as a CSV. Guest-list tickets never count as revenue. Door sales and scan counts in the report only include what was recorded on the device being used.",
    "who_can_use": ["Brand owner", "Brand admin", "Event manager", "Finance manager"],
    "surfaces": ["Mingla Host iOS", "Mingla Host Android", "Mingla Host web"]
  }
]
$catalog$::jsonb) AS seed(
    capability_key text, title text, outcome_summary text, how_to text,
    limitations text, support_wording text, who_can_use jsonb, surfaces jsonb
  );

CREATE TEMP TABLE issue_3827_guide_live_before ON COMMIT DROP AS
SELECT count(*)::integer AS live_rows
  FROM public.product_capabilities c
 WHERE c.claimed_status = 'live'
   AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live';

DO $preflight$
DECLARE
  v_missing text;
BEGIN
  IF (SELECT count(*) FROM issue_3827_guide) <> 4
     OR (SELECT count(DISTINCT capability_key) FROM issue_3827_guide) <> 4 THEN
    RAISE EXCEPTION 'issue3827_guide_payload_shape';
  END IF;
  SELECT string_agg(g.capability_key, ', ' ORDER BY g.capability_key)
    INTO v_missing
    FROM issue_3827_guide g
   WHERE NOT EXISTS (SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = g.capability_key);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'issue3827_guide_missing_capability: %', v_missing;
  END IF;
  -- Never edit a human-verified (effectively Live) entry.
  IF EXISTS (
    SELECT 1 FROM issue_3827_guide g
      JOIN public.product_capabilities c USING (capability_key)
     WHERE public.issue_3720_feature_guide_effective_status(c.id) = 'Live'
  ) THEN
    RAISE EXCEPTION 'issue3827_guide_protected_live_entry';
  END IF;
END;
$preflight$;

WITH saved AS (
  UPDATE public.product_capabilities c
     SET title = s.title,
         outcome_summary = s.outcome_summary,
         how_to = s.how_to,
         limitations = s.limitations,
         support_wording = s.support_wording,
         who_can_use = ARRAY(SELECT jsonb_array_elements_text(s.who_can_use)),
         surfaces = ARRAY(SELECT jsonb_array_elements_text(s.surfaces)),
         revision = c.revision + 1,
         updated_at = now()
    FROM issue_3827_guide s
   WHERE c.capability_key = s.capability_key
     AND (c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording,
          c.who_can_use, c.surfaces)
         IS DISTINCT FROM
         (s.title, s.outcome_summary, s.how_to, s.limitations, s.support_wording,
          ARRAY(SELECT jsonb_array_elements_text(s.who_can_use)),
          ARRAY(SELECT jsonb_array_elements_text(s.surfaces)))
  RETURNING c.id, c.revision
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', saved.id,
       jsonb_build_object(
         'source', 'issue_3827_guest_list_comps_guide',
         'issue', 3827,
         'revision', saved.revision
       )
  FROM saved;

DO $postcheck$
BEGIN
  IF (SELECT count(*)::integer
        FROM public.product_capabilities c
       WHERE c.claimed_status = 'live'
         AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live')
     <> (SELECT live_rows FROM issue_3827_guide_live_before) THEN
    RAISE EXCEPTION 'issue3827_guide_live_count_changed';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM issue_3827_guide s
      JOIN public.product_capabilities c USING (capability_key)
     WHERE c.title <> s.title
        OR c.how_to <> s.how_to
        OR c.limitations <> s.limitations
        OR char_length(btrim(c.outcome_summary)) NOT BETWEEN 20 AND 1000
        OR char_length(btrim(c.how_to)) NOT BETWEEN 20 AND 4000
        OR char_length(btrim(c.limitations)) NOT BETWEEN 10 AND 4000
        OR char_length(btrim(c.support_wording)) NOT BETWEEN 20 AND 4000
  ) THEN
    RAISE EXCEPTION 'issue3827_guide_row_not_saved_or_invalid';
  END IF;

  -- The retired phone-only behaviour must not be described any more.
  IF EXISTS (
    SELECT 1
      FROM issue_3827_guide s
      JOIN public.product_capabilities c USING (capability_key)
     WHERE concat_ws(' ', c.outcome_summary, c.how_to, c.limitations, c.support_wording)
           ILIKE ANY (ARRAY['%Mark checked in%', '%saved only on the phone or browser%', '%no ticket, no QR%', '%Add comp guest%'])
  ) THEN
    RAISE EXCEPTION 'issue3827_guide_old_comp_wording_remains';
  END IF;
END;
$postcheck$;

COMMIT;
