-- Issue #3827 — Feature Guide wording for revocable private ticket links.
-- Invariant I-3827-GUIDE-MATCHES-PRIVATE-LINKS is declared beside its SQL test.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $foundation$
BEGIN
  IF to_regclass('public.product_capabilities') IS NULL
     OR to_regclass('public.product_truth_audit') IS NULL
     OR to_regprocedure('public.issue_3720_feature_guide_effective_status(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue3827_private_links_guide_foundation_missing';
  END IF;
END;
$foundation$;

CREATE TEMP TABLE issue_3827_private_links_guide ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset($catalog$
[
  {
    "capability_key": "events-guest-list",
    "title": "Guest list, private links, search and CSV export",
    "outcome_summary": "See everyone coming to an event in one guest list and create revocable private links for guest-list sign-ups or hidden paid tickets. Each link tracks who used it, can have its own person limit, and can be reset or revoked without cancelling tickets already issued. Guest-list links can collect a group with a separate name, email and phone for every person, issue one free pass per person automatically, or wait for host approval. Covers: private ticket link, guest-list sign-up link, promoter link, hidden ticket, track link sales, guest list, attendee list, search and CSV export.",
    "how_to": "In Mingla Host, open a ticketed event and tap Guests, then tap the link icon to open Private links. You can also open a saved hidden ticket type and tap Private links.\n1. Tap New link and choose a ticket type. A free type makes a guest-list sign-up link. A paid type must be hidden and makes a private ticket link that opens normal checkout.\n2. Give the link a recognisable name such as \"DJ Kaycee's invites\". Optionally limit the number of people who may use it. For free links, choose how many guests one person may bring and whether requests need host approval.\n3. Tap Create link, then Copy link or Share. Anyone holding the bearer link can use it, so share it only with the intended audience.\n4. The list shows people or tickets attributed to each link, remaining link uses, and approval requests. Open Review to approve or decline a whole pending group. Pending requests do not hold capacity.\n5. Reset link immediately invalidates the old URL and copies a replacement. Revoke link stops all future use and declines pending requests; tickets and paid orders already issued remain valid.\nThe Guests list, guest detail, door search and CSV show the link label as Via link. Hidden paid tickets are omitted from ordinary public event and direct-checkout reads; only a currently active matching private link can unlock checkout.",
    "limitations": "Event manager or above only. Private links are for published ticketed events, not RSVP events, trips or experiences. Paid links require a hidden, online-enabled paid ticket type and allow one checkout party per link use; normal ticket capacity, purchase limits, sale windows and payment checks still apply. Free guest-list groups support up to 10 people total. Every person must provide a name, valid email and phone; emails must be different within the submitted group, while phone numbers may repeat. A person already holding an active ticket for the event is skipped rather than issued a duplicate. Automatic issuance is all-or-nothing for the new people in the group when capacity is insufficient. Approval requests hold no capacity and may be full by the time the host approves. A link can be reset or revoked, but an issued ticket is cancelled from the guest record instead. There are no request or decline emails. Link URLs are bearer credentials, are never indexed, and should not be posted publicly unless the host accepts that anyone who obtains the URL may use it.",
    "support_wording": "Hosts create private links from an event's Guests page or a saved hidden ticket. A free link collects each person's name, email and phone and gives every accepted person their own guest-list pass; it can issue automatically or wait for host approval. A paid link unlocks one hidden ticket type in normal checkout. Reset or revoke the bearer link to stop future use without invalidating passes already issued, and use Via link in Guests, door search or the CSV to see which link brought someone.",
    "who_can_use": ["Brand owner", "Brand admin", "Event manager"],
    "surfaces": ["Mingla Host iOS", "Mingla Host Android", "Mingla Host web", "Email"]
  }
]
$catalog$::jsonb) AS seed(
  capability_key text, title text, outcome_summary text, how_to text,
  limitations text, support_wording text, who_can_use jsonb, surfaces jsonb
);

CREATE TEMP TABLE issue_3827_private_links_live_before ON COMMIT DROP AS
SELECT count(*)::integer AS live_rows
  FROM public.product_capabilities c
 WHERE c.claimed_status = 'live'
   AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live';

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM issue_3827_private_links_guide) <> 1 THEN
    RAISE EXCEPTION 'issue3827_private_links_guide_payload_shape';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_capabilities
     WHERE capability_key = 'events-guest-list'
  ) THEN
    RAISE EXCEPTION 'issue3827_private_links_guide_capability_missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_capabilities c
     WHERE c.capability_key = 'events-guest-list'
       AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live'
  ) THEN
    RAISE EXCEPTION 'issue3827_private_links_guide_protected_live_entry';
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
    FROM issue_3827_private_links_guide s
   WHERE c.capability_key = s.capability_key
     AND (c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording,
          c.who_can_use, c.surfaces) IS DISTINCT FROM
         (s.title, s.outcome_summary, s.how_to, s.limitations, s.support_wording,
          ARRAY(SELECT jsonb_array_elements_text(s.who_can_use)),
          ARRAY(SELECT jsonb_array_elements_text(s.surfaces)))
  RETURNING c.id, c.revision
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', id,
       jsonb_build_object('source', 'issue_3827_private_ticket_links_guide',
         'issue', 3827, 'revision', revision)
  FROM saved;

DO $postcheck$
DECLARE v_text text;
BEGIN
  IF (SELECT count(*)::integer
        FROM public.product_capabilities c
       WHERE c.claimed_status = 'live'
         AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live')
     <> (SELECT live_rows FROM issue_3827_private_links_live_before) THEN
    RAISE EXCEPTION 'issue3827_private_links_guide_live_count_changed';
  END IF;

  SELECT concat_ws(' ', title, outcome_summary, how_to, limitations, support_wording)
    INTO v_text
    FROM public.product_capabilities
   WHERE capability_key = 'events-guest-list';
  IF v_text NOT ILIKE '%Reset link%'
     OR v_text NOT ILIKE '%Pending requests do not hold capacity%'
     OR v_text NOT ILIKE '%hidden paid ticket%'
     OR v_text NOT ILIKE '%Via link%'
     OR v_text ILIKE '%event password%'
     OR v_text ILIKE '%ticket password%' THEN
    RAISE EXCEPTION 'issue3827_private_links_guide_contract_missing';
  END IF;
END;
$postcheck$;

COMMIT;
