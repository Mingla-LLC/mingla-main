-- Issue #4226 — Host contacts in Mingla Admin (People, Email, Data room).
--
-- Seth's decision (2026-11-02, on #4226): contacts that hosts imported or
-- added by hand to their brand contact book become emailable by Mingla now.
-- The host's import attestation is the consent basis; these people have
-- attended events like the host's and should hear about similar events.
--
-- A HOST CONTACT is an email in a brand's contact book whose source is a host
-- import or a manual add:
--   brand_person_contact_methods      channel 'email', record_state 'active',
--                                     retired_at NULL
--   brand_person_contact_method_sources  active, provenance_kind 'import' or
--                                     'manual'
--   brand_person_source_links         not detached
--   brand_people                      record_status 'active' (not merged or
--                                     deleted)
--   brands                            not deleted
-- matched to the one People list by the normalised email lower(btrim(email)).
--
-- What this migration changes:
--   1. admin_people_directory_rows() / admin_people_directory() gain six
--      columns (appended; every existing column keeps its name, type and
--      position):
--        is_host_contact        a host added this email to their contact book
--        host_brand_ids         the brands that added them
--        host_brands            [{id, name, source, added_at,
--                                 attestation_version, import_batch_id}] —
--                               the evidence behind the consent basis
--        host_city              the city of the latest brand that added them
--                               (brands.city); "host city", never "event city"
--        host_contact_added_at  when a host first added them
--        consent_basis          why marketing_consent is 'yes': 'checkout'
--                               (a checkout opt-in), 'consent_record' (a
--                               recorded grant), 'host_import_attestation'
--                               (a host import, attested per batch) or
--                               'host_manual_add' (a host typed them in);
--                               NULL when consent is not 'yes'
--      Because the RETURNS TABLE shape changes, both functions are dropped
--      and recreated here, in one transaction, with the same grants and the
--      same admin guard. Their only callers are plpgsql functions (re-created
--      below) and analytics_dr_users() (LANGUAGE sql, no recorded
--      dependency; re-created below after the new list exists).
--   2. A person with no account and no ticket who is a host contact is a new
--      row with segment and app_status 'host_contact_no_app' (or segment
--      'internal' for a test-style email). An account, or a ticket person,
--      whose email a host added keeps their row and gains is_host_contact.
--      The Email "Everyone" audience (Seth, 2026-11-02) is every person in
--      this list: explorers, hosts, both, didn't finish sign-up, ticket
--      buyers with no app and host contacts with no app. admin-send-email
--      leaves out staff/test, no email, duplicates, unsubscribed/suppressed,
--      and no consent where consent applies, and counts each reason.
--   3. admin_people_segments() gains 'host_contact_no_app' and
--      'host_contacts'; admin_list_people() gains the segment
--      'host_contact_no_app' and host-contact facts on every row.
--   4. analytics_dr_users() gains the 'host_contacts' block for the Data room
--      (host contacts, and host contacts who later got an app).
--
-- Marketing consent per person ('yes' | 'no' | 'unsubscribed'), in order:
--   'unsubscribed'  any of their emails is in channel_suppressions (email,
--                   marketing or all) or marketing_unsubscribes, or a
--                   channel_suppressions row names their account (as before),
--                   OR a brand_person_channel_suppressions row (email,
--                   marketing or all, not lifted) names one of the brand
--                   contacts that makes them a host contact — a suppression
--                   by any brand that added them blocks Mingla too;
--   else the person's own latest signal (consent_records grant / revoke, or
--                   the checkout opt-in) decides, as before: 'yes' or 'no';
--   else a host contact is 'yes' (basis host_import_attestation when any
--                   source is an import, host_manual_add otherwise);
--   else 'no'.
-- A host's attestation never overrides a person's own "no".
--
-- Staff/test: by internal account (admin_account_is_internal) or, with no
-- account, a test-style email (admin_internal_email_rule). Never by a brand's
-- internal flag.
--
-- City / country for a host contact with no account and no ticket:
--   country  the brand contact's phone country (phone_country_iso on its
--            phone source, else the calling code of its phone), else the
--            brand's country_code;
--   city     the brand's city (host_city).
-- Folded rows keep their own country and fall back to the host country.
--
-- plpgsql, not sql: the list reads tables that the deliberately pre-#1931 CI
-- replay can skip (tickets.holder_email #4063 and others). A plpgsql body is
-- checked when it runs, not at CREATE.
--
-- Invariant (declared in the pg17 test): I-4226-HOST-CONTACTS-ONE-LIST | issue #4226 | Host contacts (brand contact-book emails from an import or manual add) join the one admin People list by normalised email; they are emailable with consent basis host_import_attestation / host_manual_add unless unsubscribed, suppressed Mingla-wide or by a brand that added them, or staff/test.

BEGIN;

--------------------------------------------------------------------------------
-- 1. One row per person, now with host contacts.
--------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_people_directory();
DROP FUNCTION IF EXISTS public.admin_people_directory_rows();

CREATE FUNCTION public.admin_people_directory_rows()
RETURNS TABLE (
  person_key               text,
  user_id                  uuid,
  email                    text,
  name                     text,
  first_name               text,
  display_name             text,
  username                 text,
  phone_e164               text,
  segment                  text,
  app_status               text,
  is_internal              boolean,
  has_explorer             boolean,
  is_ticket_holder         boolean,
  in_ticket_buyer_segment  boolean,
  tickets_count            integer,
  orders_count             integer,
  spent                    jsonb,
  last_spent_cents         bigint,
  last_currency            text,
  first_purchase_at        timestamptz,
  last_purchase_at         timestamptz,
  last_event_city          text,
  event_cities             text[],
  country                  text,
  marketing_consent        text,
  brand_ids                uuid[],
  brands                   jsonb,
  created_at               timestamptz,
  preferred_language       text,
  has_completed_onboarding boolean,
  email_verified           boolean,
  active                   boolean,
  is_beta_tester           boolean,
  -- #4226 host contacts (appended).
  is_host_contact          boolean,
  host_brand_ids           uuid[],
  host_brands              jsonb,
  host_city                text,
  host_contact_added_at    timestamptz,
  consent_basis            text
)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH
  -- Every email that belongs to an account with a profile: the profile email
  -- first, then the sign-in email.
  acct_email AS MATERIALIZED (
    SELECT DISTINCT ON (x.email) x.email, x.user_id
      FROM (
        SELECT lower(btrim(p.email)) AS email, p.id AS user_id, 0 AS pri, p.created_at
          FROM public.profiles p
         WHERE NULLIF(btrim(p.email), '') IS NOT NULL
        UNION ALL
        SELECT lower(btrim(u.email)), u.id, 1, u.created_at
          FROM auth.users u
         WHERE NULLIF(btrim(u.email), '') IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
      ) x
     ORDER BY x.email, x.pri, x.created_at
  ),
  paid AS MATERIALIZED (
    SELECT o.id, o.event_id, o.created_at, upper(btrim(o.currency)) AS currency,
           COALESCE(o.buyer_total_cents, o.total_cents, 0) - COALESCE(o.refunded_amount_cents, 0) AS spent_cents,
           NULLIF(lower(btrim(o.buyer_email)), '') AS buyer_email,
           o.buyer_user_id, o.buyer_name, o.buyer_phone_e164,
           o.metadata ->> 'marketing_opt_in' AS opt_in
      FROM public.orders o
     WHERE o.payment_status = 'paid'
  ),
  -- One row per (order, role): the buyer of each paid order, and the holder
  -- of each live ticket on it (a ticket with no holder email is the buyer's).
  contacts AS MATERIALIZED (
    SELECT pd.id AS order_id, 'buyer'::text AS role, NULL::uuid AS ticket_id,
           pd.buyer_user_id AS raw_uid, pd.buyer_email AS email,
           pd.buyer_name AS name, pd.buyer_phone_e164 AS phone, pd.created_at AS at
      FROM paid pd
    UNION ALL
    SELECT t.order_id, 'holder', t.id,
           COALESCE(t.holder_user_id, CASE WHEN h.email IS NULL THEN pd.buyer_user_id END),
           COALESCE(h.email, pd.buyer_email),
           COALESCE(NULLIF(btrim(t.holder_name), ''), NULLIF(btrim(t.attendee_name), ''),
                    CASE WHEN h.email IS NULL THEN pd.buyer_name END),
           COALESCE(NULLIF(btrim(t.holder_phone_e164), ''), CASE WHEN h.email IS NULL THEN pd.buyer_phone_e164 END),
           pd.created_at
      FROM public.tickets t
      JOIN paid pd ON pd.id = t.order_id
      CROSS JOIN LATERAL (
        SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(t.holder_email), ''), t.attendee_email))), '') AS email
      ) h
     WHERE t.status <> 'void'
  ),
  keyed AS MATERIALIZED (
    SELECT r.*,
           CASE WHEN r.user_id IS NOT NULL THEN 'u:' || r.user_id::text ELSE 'e:' || r.email END AS person_key
      FROM (
        SELECT c.*,
               COALESCE(
                 (SELECT pr.id FROM public.profiles pr WHERE pr.id = c.raw_uid),
                 (SELECT ae.user_id FROM acct_email ae WHERE ae.email = c.email)) AS user_id
          FROM contacts c
      ) r
     WHERE r.user_id IS NOT NULL OR r.email IS NOT NULL
  ),
  ticket_agg AS (
    SELECT k.person_key,
           (array_agg(k.user_id) FILTER (WHERE k.user_id IS NOT NULL))[1] AS user_id,
           (array_agg(k.email ORDER BY k.at DESC) FILTER (WHERE k.email IS NOT NULL))[1] AS email,
           (array_agg(btrim(k.name) ORDER BY k.at DESC) FILTER (WHERE NULLIF(btrim(k.name), '') IS NOT NULL))[1] AS name,
           (array_agg(btrim(k.phone) ORDER BY k.at DESC) FILTER (WHERE NULLIF(btrim(k.phone), '') IS NOT NULL))[1] AS phone,
           count(DISTINCT k.ticket_id)::integer AS tickets_count,
           count(DISTINCT k.order_id) FILTER (WHERE k.role = 'buyer')::integer AS orders_count,
           min(k.at) AS first_at,
           max(k.at) AS last_at
      FROM keyed k
     GROUP BY k.person_key
  ),
  spend AS (
    SELECT s.person_key, jsonb_object_agg(s.currency, s.cents ORDER BY s.currency) AS spent
      FROM (
        SELECT k.person_key, pd.currency, sum(pd.spent_cents)::bigint AS cents
          FROM (SELECT DISTINCT person_key, order_id FROM keyed WHERE role = 'buyer') k
          JOIN paid pd ON pd.id = k.order_id
         WHERE pd.currency IS NOT NULL AND pd.spent_cents > 0
         GROUP BY 1, 2
      ) s
     GROUP BY s.person_key
  ),
  last_spend AS (
    SELECT DISTINCT ON (k.person_key) k.person_key, pd.spent_cents::bigint AS cents, pd.currency
      FROM (SELECT DISTINCT person_key, order_id FROM keyed WHERE role = 'buyer') k
      JOIN paid pd ON pd.id = k.order_id
     WHERE pd.currency IS NOT NULL AND pd.spent_cents > 0
     ORDER BY k.person_key, pd.created_at DESC
  ),
  event_agg AS (
    SELECT k.person_key,
           (array_agg(ev.city ORDER BY pd.created_at DESC) FILTER (WHERE ev.city IS NOT NULL))[1] AS last_event_city,
           array_agg(DISTINCT ev.city) FILTER (WHERE ev.city IS NOT NULL) AS event_cities,
           array_agg(DISTINCT e.brand_id) FILTER (WHERE e.brand_id IS NOT NULL) AS brand_ids
      FROM (SELECT DISTINCT person_key, order_id FROM keyed) k
      JOIN paid pd ON pd.id = k.order_id
      LEFT JOIN public.events e ON e.id = pd.event_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(NULLIF(btrim(e.city), ''), NULLIF(btrim(e.destination_city), ''),
                        NULLIF(btrim(e.departure_city), '')) AS city
      ) ev
     GROUP BY k.person_key
  ),
  accounts AS (
    SELECT s.user_id, s.segment, s.app_status, s.has_explorer, s.is_internal,
           p.email AS profile_email, p.first_name, p.display_name, p.username, p.phone,
           p.country AS profile_country, p.created_at, p.preferred_language,
           p.has_completed_onboarding, p.email_verified, p.active, p.is_beta_tester,
           u.email AS auth_email,
           COALESCE(
             NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
             NULLIF(btrim(ca.display_name), ''),
             NULLIF(btrim(ca.business_name), ''),
             NULLIF(btrim(p.username), '')
           ) AS account_name
      FROM public.admin_people_app_status() s
      JOIN public.profiles p ON p.id = s.user_id
      LEFT JOIN auth.users u ON u.id = s.user_id
      LEFT JOIN public.creator_accounts ca ON ca.id = s.user_id
  ),
  -- #4226 host contacts: one row per (email, brand contact, source).
  hc_src AS MATERIALIZED (
    SELECT lower(btrim(cm.normalized_value)) AS email,
           cm.brand_id,
           cm.brand_person_id,
           NULLIF(btrim(bp.display_name), '') AS name,
           cms.provenance_kind AS source,
           COALESCE(sl.source_occurred_at, cms.created_at) AS added_at,
           ib.attestation_version,
           ib.id AS import_batch_id,
           NULLIF(btrim(br.city), '') AS brand_city,
           NULLIF(upper(btrim(br.country_code)), '') AS brand_country,
           br.name AS brand_name
      FROM public.brand_person_contact_methods cm
      JOIN public.brand_person_contact_method_sources cms
        ON cms.contact_method_id = cm.id
       AND cms.active AND cms.retired_at IS NULL
       AND cms.provenance_kind IN ('import', 'manual')
      JOIN public.brand_person_source_links sl
        ON sl.id = cms.source_link_id AND sl.detached_at IS NULL
      JOIN public.brand_people bp
        ON bp.id = cm.brand_person_id AND bp.record_status = 'active'
      JOIN public.brands br
        ON br.id = cm.brand_id AND br.deleted_at IS NULL
      LEFT JOIN public.brand_contact_import_rows ir
        ON cms.provenance_kind = 'import' AND ir.id = sl.source_id
      LEFT JOIN public.brand_contact_import_batches ib
        ON ib.id = ir.batch_id
     WHERE cm.channel = 'email'
       AND cm.record_state = 'active'
       AND cm.retired_at IS NULL
       AND NULLIF(btrim(cm.normalized_value), '') IS NOT NULL
  ),
  -- The brand contact's phone, and the country it carries.
  hc_phone AS (
    SELECT DISTINCT ON (pm.brand_person_id)
           pm.brand_person_id,
           pm.normalized_value AS phone,
           COALESCE(
             (SELECT max(ps.phone_country_iso) FROM public.brand_person_contact_method_sources ps
               WHERE ps.contact_method_id = pm.id AND ps.active AND ps.phone_country_iso IS NOT NULL),
             public.admin_country_from_e164(pm.normalized_value)) AS phone_country
      FROM public.brand_person_contact_methods pm
     WHERE pm.channel = 'phone' AND pm.record_state = 'active' AND pm.retired_at IS NULL
       AND pm.brand_person_id IN (SELECT hs.brand_person_id FROM hc_src hs)
     ORDER BY pm.brand_person_id, pm.is_primary DESC, pm.created_at DESC
  ),
  -- Which person a host-contact email belongs to: an account (profile email,
  -- then sign-in email), else a ticket person with that email, else a new
  -- person keyed by the email.
  hc_keyed AS MATERIALIZED (
    SELECT hs.*, ph.phone, ph.phone_country,
           COALESCE(
             (SELECT 'u:' || ae.user_id::text FROM acct_email ae WHERE ae.email = hs.email),
             -- An account key (u:) beats an email key (e:) when both exist.
             (SELECT max(k.person_key) FROM keyed k WHERE k.email = hs.email),
             'e:' || hs.email) AS person_key
      FROM hc_src hs
      LEFT JOIN hc_phone ph ON ph.brand_person_id = hs.brand_person_id
  ),
  hc_agg AS (
    SELECT h.person_key,
           (array_agg(h.email ORDER BY h.added_at DESC))[1] AS email,
           (array_agg(h.name ORDER BY h.added_at DESC) FILTER (WHERE h.name IS NOT NULL))[1] AS name,
           (array_agg(h.phone ORDER BY h.added_at DESC) FILTER (WHERE h.phone IS NOT NULL))[1] AS phone,
           (array_agg(COALESCE(h.phone_country, h.brand_country) ORDER BY h.added_at DESC)
              FILTER (WHERE COALESCE(h.phone_country, h.brand_country) IS NOT NULL))[1] AS host_country,
           (array_agg(h.brand_city ORDER BY h.added_at DESC) FILTER (WHERE h.brand_city IS NOT NULL))[1] AS host_city,
           min(h.added_at) AS added_at,
           array_agg(DISTINCT h.brand_id) AS brand_ids,
           array_agg(DISTINCT h.brand_person_id) AS brand_person_ids,
           CASE WHEN bool_or(h.source = 'import') THEN 'host_import_attestation' ELSE 'host_manual_add' END AS basis
      FROM hc_keyed h
     GROUP BY h.person_key
  ),
  hc_brands AS (
    SELECT b.person_key,
           jsonb_agg(jsonb_build_object(
             'id', b.brand_id, 'name', b.brand_name, 'source', b.source, 'added_at', b.added_at,
             'attestation_version', b.attestation_version, 'import_batch_id', b.import_batch_id)
             ORDER BY b.brand_name, b.brand_id) AS brands
      FROM (
        SELECT DISTINCT ON (h.person_key, h.brand_id)
               h.person_key, h.brand_id, h.brand_name, h.source, h.added_at,
               h.attestation_version, h.import_batch_id
          FROM hc_keyed h
         ORDER BY h.person_key, h.brand_id, (h.source = 'import') DESC, h.added_at
      ) b
     GROUP BY b.person_key
  ),
  universe AS (
    SELECT 'u:' || a.user_id::text AS person_key, a.user_id,
           COALESCE(NULLIF(lower(btrim(a.profile_email)), ''), NULLIF(lower(btrim(a.auth_email)), ''), t.email) AS email,
           COALESCE(a.account_name, t.name) AS name,
           a.first_name, a.display_name, a.username,
           COALESCE(NULLIF(btrim(a.phone), ''), t.phone) AS phone_e164,
           a.segment, a.app_status, a.is_internal, a.has_explorer,
           NULLIF(btrim(a.profile_country), '') AS profile_country,
           a.created_at, a.preferred_language, a.has_completed_onboarding,
           a.email_verified, a.active, a.is_beta_tester
      FROM accounts a
      LEFT JOIN ticket_agg t ON t.person_key = 'u:' || a.user_id::text
    UNION ALL
    SELECT t.person_key, NULL::uuid, t.email, t.name,
           NULL::text, NULL::text, NULL::text,
           t.phone,
           CASE WHEN public.admin_internal_email_rule(t.email) THEN 'internal' ELSE 'ticket_buyer_no_app' END,
           'ticket_buyer_no_app',
           public.admin_internal_email_rule(t.email),
           false,
           NULL::text,
           NULL::timestamptz, NULL::text, NULL::boolean, NULL::boolean, NULL::boolean, NULL::boolean
      FROM ticket_agg t
     WHERE t.user_id IS NULL
    UNION ALL
    -- #4226: a host contact with no account and no ticket.
    SELECT h.person_key, NULL::uuid, h.email, h.name,
           NULL::text, NULL::text, NULL::text,
           h.phone,
           CASE WHEN public.admin_internal_email_rule(h.email) THEN 'internal' ELSE 'host_contact_no_app' END,
           'host_contact_no_app',
           public.admin_internal_email_rule(h.email),
           false,
           NULL::text,
           NULL::timestamptz, NULL::text, NULL::boolean, NULL::boolean, NULL::boolean, NULL::boolean
      FROM hc_agg h
     WHERE h.person_key LIKE 'e:%'
       AND NOT EXISTS (SELECT 1 FROM ticket_agg t WHERE t.person_key = h.person_key)
  ),
  -- Every email a person is known by, for consent and suppression.
  person_emails AS (
    SELECT DISTINCT x.person_key, x.email
      FROM (
        SELECT un.person_key, un.email FROM universe un
        UNION ALL
        SELECT k.person_key, k.email FROM keyed k
        UNION ALL
        SELECT 'u:' || a.user_id::text, lower(btrim(a.auth_email)) FROM accounts a
        UNION ALL
        SELECT h.person_key, h.email FROM hc_keyed h
      ) x
     WHERE NULLIF(x.email, '') IS NOT NULL
  ),
  suppressed AS (
    SELECT DISTINCT pe.person_key
      FROM person_emails pe
     WHERE EXISTS (SELECT 1 FROM public.channel_suppressions cs
                    WHERE cs.channel = 'email' AND cs.scope IN ('marketing', 'all')
                      AND lower(btrim(cs.contact)) = pe.email)
        OR EXISTS (SELECT 1 FROM public.marketing_unsubscribes mu
                    WHERE lower(btrim(mu.contact_email)) = pe.email)
    UNION
    SELECT 'u:' || cs.user_id::text
      FROM public.channel_suppressions cs
     WHERE cs.user_id IS NOT NULL AND cs.channel = 'email' AND cs.scope IN ('marketing', 'all')
    UNION
    -- #4226: suppressed by a brand that added them as a host contact.
    SELECT h.person_key
      FROM hc_agg h
     WHERE EXISTS (SELECT 1 FROM public.brand_person_channel_suppressions bs
                    WHERE bs.brand_person_id = ANY (h.brand_person_ids)
                      AND bs.channel = 'email' AND bs.scope IN ('marketing', 'all')
                      AND bs.lifted_at IS NULL)
  ),
  consent_latest AS (
    SELECT DISTINCT ON (sig.person_key) sig.person_key, sig.granted, sig.basis
      FROM (
        SELECT pe.person_key, cr.created_at AS at, (cr.action = 'granted') AS granted, 'consent_record'::text AS basis
          FROM person_emails pe
          JOIN public.consent_records cr
            ON cr.scope = 'marketing' AND cr.channel = 'email' AND lower(btrim(cr.contact)) = pe.email
        UNION ALL
        SELECT 'u:' || cr.user_id::text, cr.created_at, (cr.action = 'granted'), 'consent_record'
          FROM public.consent_records cr
         WHERE cr.user_id IS NOT NULL AND cr.scope = 'marketing' AND cr.channel = 'email'
        UNION ALL
        SELECT k.person_key, pd.created_at, (pd.opt_in = 'true'), 'checkout'
          FROM keyed k
          JOIN paid pd ON pd.id = k.order_id
         WHERE k.role = 'buyer' AND pd.opt_in IN ('true', 'false')
      ) sig
     ORDER BY sig.person_key, sig.at DESC, sig.granted ASC
  ),
  joined AS (
    SELECT un.*,
           t.person_key  AS t_key, t.tickets_count, t.orders_count, t.first_at, t.last_at,
           sp.spent, ls.cents AS ls_cents, ls.currency AS ls_currency,
           ea.last_event_city, ea.event_cities, ea.brand_ids AS ea_brand_ids,
           (su.person_key IS NOT NULL) AS is_suppressed,
           cl.person_key AS cl_key, cl.granted AS cl_granted, cl.basis AS cl_basis,
           h.person_key  AS h_key, h.brand_ids AS h_brand_ids, h.host_city AS h_city,
           h.host_country AS h_country, h.added_at AS h_added_at, h.basis AS h_basis,
           hb.brands AS h_brands
      FROM universe un
      LEFT JOIN ticket_agg t ON t.person_key = un.person_key
      LEFT JOIN spend sp ON sp.person_key = un.person_key
      LEFT JOIN last_spend ls ON ls.person_key = un.person_key
      LEFT JOIN event_agg ea ON ea.person_key = un.person_key
      LEFT JOIN suppressed su ON su.person_key = un.person_key
      LEFT JOIN consent_latest cl ON cl.person_key = un.person_key
      LEFT JOIN hc_agg h ON h.person_key = un.person_key
      LEFT JOIN hc_brands hb ON hb.person_key = un.person_key
  ),
  graded AS (
    SELECT j.*,
           CASE
             WHEN j.is_suppressed THEN 'unsubscribed'
             WHEN j.cl_key IS NOT NULL THEN CASE WHEN j.cl_granted THEN 'yes' ELSE 'no' END
             WHEN j.h_key IS NOT NULL THEN 'yes'
             ELSE 'no'
           END AS consent,
           CASE
             WHEN j.is_suppressed THEN NULL
             WHEN j.cl_key IS NOT NULL THEN CASE WHEN j.cl_granted THEN j.cl_basis END
             WHEN j.h_key IS NOT NULL THEN j.h_basis
           END AS basis
      FROM joined j
  )
  SELECT
    g.person_key,
    g.user_id,
    g.email,
    g.name,
    g.first_name,
    g.display_name,
    g.username,
    g.phone_e164,
    g.segment,
    g.app_status,
    g.is_internal,
    g.has_explorer,
    (g.t_key IS NOT NULL) AS is_ticket_holder,
    (g.t_key IS NOT NULL AND NOT g.is_internal AND NOT g.has_explorer) AS in_ticket_buyer_segment,
    COALESCE(g.tickets_count, 0),
    COALESCE(g.orders_count, 0),
    COALESCE(g.spent, '{}'::jsonb),
    g.ls_cents,
    g.ls_currency,
    g.first_at,
    g.last_at,
    g.last_event_city,
    COALESCE(g.event_cities, '{}'::text[]),
    -- A host contact with no account and no ticket: the brand contact's phone
    -- country (phone_country_iso first), else the brand's country.
    COALESCE(g.profile_country,
             CASE WHEN g.user_id IS NULL AND g.t_key IS NULL THEN g.h_country END,
             public.admin_country_from_e164(g.phone_e164), g.h_country),
    g.consent,
    COALESCE(g.ea_brand_ids, '{}'::uuid[]),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name)
        FROM public.brands b WHERE b.id = ANY (g.ea_brand_ids)), '[]'::jsonb),
    g.created_at,
    g.preferred_language,
    g.has_completed_onboarding,
    g.email_verified,
    g.active,
    g.is_beta_tester,
    (g.h_key IS NOT NULL) AS is_host_contact,
    COALESCE(g.h_brand_ids, '{}'::uuid[]),
    COALESCE(g.h_brands, '[]'::jsonb),
    g.h_city,
    g.h_added_at,
    g.basis
  FROM graded g;
END;
$$;
COMMENT ON FUNCTION public.admin_people_directory_rows() IS
  'Issue #4226: one row per person (non-seed profiles, ticket people with no account, and host contacts with neither, by normalised email) with app status, ticket and host-contact facts, country, marketing consent and its basis. Helper: read only through admin RPCs.';
REVOKE ALL ON FUNCTION public.admin_people_directory_rows() FROM PUBLIC, anon, authenticated;

-- The same rows behind the guard: a signed-in admin, or the service role that
-- admin-send-email uses after its own admin check.
CREATE FUNCTION public.admin_people_directory()
RETURNS TABLE (
  person_key               text,
  user_id                  uuid,
  email                    text,
  name                     text,
  first_name               text,
  display_name             text,
  username                 text,
  phone_e164               text,
  segment                  text,
  app_status               text,
  is_internal              boolean,
  has_explorer             boolean,
  is_ticket_holder         boolean,
  in_ticket_buyer_segment  boolean,
  tickets_count            integer,
  orders_count             integer,
  spent                    jsonb,
  last_spent_cents         bigint,
  last_currency            text,
  first_purchase_at        timestamptz,
  last_purchase_at         timestamptz,
  last_event_city          text,
  event_cities             text[],
  country                  text,
  marketing_consent        text,
  brand_ids                uuid[],
  brands                   jsonb,
  created_at               timestamptz,
  preferred_language       text,
  has_completed_onboarding boolean,
  email_verified           boolean,
  active                   boolean,
  is_beta_tester           boolean,
  is_host_contact          boolean,
  host_brand_ids           uuid[],
  host_brands              jsonb,
  host_city                text,
  host_contact_added_at    timestamptz,
  consent_basis            text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.is_admin_user() OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN QUERY SELECT * FROM public.admin_people_directory_rows();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_people_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_people_directory() TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 2. People: counts and lists.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_people_segments()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  WITH d AS MATERIALIZED (SELECT * FROM public.admin_people_directory_rows())
  SELECT jsonb_build_object(
    'explorer',   count(*) FILTER (WHERE d.user_id IS NOT NULL AND d.segment = 'explorer'),
    'host',       count(*) FILTER (WHERE d.user_id IS NOT NULL AND d.segment = 'host'),
    'both',       count(*) FILTER (WHERE d.user_id IS NOT NULL AND d.segment = 'both'),
    'incomplete', count(*) FILTER (WHERE d.user_id IS NOT NULL AND d.segment = 'incomplete'),
    'internal',   count(*) FILTER (WHERE d.user_id IS NOT NULL AND d.segment = 'internal'),
    'people',     count(*) FILTER (WHERE d.user_id IS NOT NULL AND d.segment <> 'internal'),
    -- #4226: views, not a partition (see 20280301004226): never add to 'people'.
    'ticket_buyer_no_app', count(*) FILTER (WHERE d.in_ticket_buyer_segment),
    'ticket_people',       count(*) FILTER (WHERE d.is_ticket_holder AND NOT d.is_internal),
    'ticket_people_no_account', count(*) FILTER (WHERE d.is_ticket_holder AND NOT d.is_internal AND d.user_id IS NULL),
    -- #4226 host contacts: the tab (no account, no ticket) and everyone a host added.
    'host_contact_no_app', count(*) FILTER (WHERE d.segment = 'host_contact_no_app'),
    'host_contacts',       count(*) FILTER (WHERE d.is_host_contact AND NOT d.is_internal),
    'countries',  COALESCE((
      SELECT jsonb_agg(DISTINCT d2.country ORDER BY d2.country)
        FROM d d2
       WHERE NULLIF(btrim(d2.country), '') IS NOT NULL
         AND (d2.user_id IS NOT NULL OR d2.in_ticket_buyer_segment
              OR d2.segment = 'host_contact_no_app')), '[]'::jsonb),
    'as_of',      now()
  ) INTO v_out
  FROM d;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_people_segments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_people_segments() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_people(
  p_segment      text        DEFAULT 'explorer',
  p_search       text        DEFAULT NULL,
  p_country      text        DEFAULT NULL,
  p_joined_since timestamptz DEFAULT NULL,
  p_limit        integer     DEFAULT 25,
  p_offset       integer     DEFAULT 0,
  p_sort         text        DEFAULT 'joined_desc'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 1000);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_sort   text;
  v_total  bigint;
  v_rows   jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_segment IS NULL OR p_segment NOT IN ('explorer', 'host', 'both', 'incomplete', 'internal',
                                            'ticket_buyer_no_app', 'host_contact_no_app') THEN
    RAISE EXCEPTION 'invalid_segment';
  END IF;
  v_sort := CASE lower(COALESCE(p_sort, 'joined_desc'))
              WHEN 'joined_asc'       THEN 'joined_asc'
              WHEN 'name_asc'         THEN 'name_asc'
              WHEN 'name_desc'        THEN 'name_desc'
              WHEN 'last_active_desc' THEN 'last_active_desc'
              WHEN 'last_active_asc'  THEN 'last_active_asc'
              ELSE 'joined_desc'
            END;

  ------------------------------------------------------------------------------
  -- #4226: host contacts with no account and no ticket. "Joined" is when a
  -- host first added them.
  ------------------------------------------------------------------------------
  IF p_segment = 'host_contact_no_app' THEN
    WITH base AS (
      SELECT d.*
        FROM public.admin_people_directory_rows() d
       WHERE d.segment = 'host_contact_no_app'
         AND (p_country IS NULL OR d.country = p_country)
         AND (p_joined_since IS NULL OR d.host_contact_added_at >= p_joined_since)
         AND (
           v_search IS NULL
           OR d.name ILIKE '%' || v_search || '%'
           OR d.email ILIKE '%' || v_search || '%'
           OR d.phone_e164 ILIKE '%' || v_search || '%'
           OR d.host_city ILIKE '%' || v_search || '%'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(d.host_brands) hb
                       WHERE hb ->> 'name' ILIKE '%' || v_search || '%')
         )
    ),
    ranked AS (
      SELECT b.*, row_number() OVER (
        ORDER BY
          (CASE WHEN v_sort IN ('joined_asc', 'last_active_asc')   THEN b.host_contact_added_at END) ASC NULLS LAST,
          (CASE WHEN v_sort IN ('joined_desc', 'last_active_desc') THEN b.host_contact_added_at END) DESC NULLS LAST,
          (CASE WHEN v_sort = 'name_asc'  THEN lower(b.name) END) ASC NULLS LAST,
          (CASE WHEN v_sort = 'name_desc' THEN lower(b.name) END) DESC NULLS LAST,
          b.host_contact_added_at DESC NULLS LAST, b.person_key
      ) AS rn
      FROM base b
    )
    SELECT
      (SELECT count(*) FROM base),
      COALESCE(jsonb_agg(jsonb_build_object(
        'id',                    r.user_id,
        'person_key',            r.person_key,
        'name',                  r.name,
        'email',                 r.email,
        'phone',                 r.phone_e164,
        'country',               r.country,
        'host_city',             r.host_city,
        'joined_at',             r.host_contact_added_at,
        'host_contact_added_at', r.host_contact_added_at,
        'segment',               'host_contact_no_app',
        'app_status',            r.app_status,
        'has_account',           false,
        'is_host_contact',       true,
        'host_brands',           r.host_brands,
        'marketing_consent',     r.marketing_consent,
        'consent_basis',         r.consent_basis
      ) ORDER BY r.rn), '[]'::jsonb)
    INTO v_total, v_rows
    FROM ranked r
    WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

    RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
  END IF;

  ------------------------------------------------------------------------------
  -- #4226: ticket buyers with no Explorer app. "Joined" is when they got their
  -- first ticket; "last active" is their latest ticket.
  ------------------------------------------------------------------------------
  IF p_segment = 'ticket_buyer_no_app' THEN
    WITH base AS (
      SELECT d.*
        FROM public.admin_people_directory_rows() d
       WHERE d.in_ticket_buyer_segment
         AND (p_country IS NULL OR d.country = p_country)
         AND (p_joined_since IS NULL OR d.first_purchase_at >= p_joined_since)
         AND (
           v_search IS NULL
           OR d.name ILIKE '%' || v_search || '%'
           OR d.email ILIKE '%' || v_search || '%'
           OR d.phone_e164 ILIKE '%' || v_search || '%'
           OR d.last_event_city ILIKE '%' || v_search || '%'
         )
    ),
    ranked AS (
      SELECT b.*, row_number() OVER (
        ORDER BY
          (CASE WHEN v_sort = 'joined_asc'       THEN b.first_purchase_at END) ASC NULLS LAST,
          (CASE WHEN v_sort = 'joined_desc'      THEN b.first_purchase_at END) DESC NULLS LAST,
          (CASE WHEN v_sort = 'name_asc'         THEN lower(b.name) END) ASC NULLS LAST,
          (CASE WHEN v_sort = 'name_desc'        THEN lower(b.name) END) DESC NULLS LAST,
          (CASE WHEN v_sort = 'last_active_asc'  THEN b.last_purchase_at END) ASC NULLS LAST,
          (CASE WHEN v_sort = 'last_active_desc' THEN b.last_purchase_at END) DESC NULLS LAST,
          b.last_purchase_at DESC NULLS LAST, b.person_key
      ) AS rn
      FROM base b
    )
    SELECT
      (SELECT count(*) FROM base),
      COALESCE(jsonb_agg(jsonb_build_object(
        'id',                r.user_id,
        'person_key',        r.person_key,
        'name',              r.name,
        'email',             r.email,
        'phone',             r.phone_e164,
        'country',           r.country,
        'joined_at',         r.created_at,
        'segment',           'ticket_buyer_no_app',
        'app_status',        r.app_status,
        'has_account',       (r.user_id IS NOT NULL),
        'event_city',        r.last_event_city,
        'tickets',           r.tickets_count,
        'orders',            r.orders_count,
        'spent',             r.spent,
        'last_spent_cents',  r.last_spent_cents,
        'last_currency',     r.last_currency,
        'first_purchase_at', r.first_purchase_at,
        'last_purchase_at',  r.last_purchase_at,
        'marketing_consent', r.marketing_consent,
        'consent_basis',     r.consent_basis,
        'brands_bought',     r.brands,
        'is_host_contact',   r.is_host_contact,
        'host_brands',       r.host_brands
      ) ORDER BY r.rn), '[]'::jsonb)
    INTO v_total, v_rows
    FROM ranked r
    WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

    RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
  END IF;

  ------------------------------------------------------------------------------
  -- Account segments (#4130), with ticket and host-contact facts on every row.
  ------------------------------------------------------------------------------
  WITH dir AS MATERIALIZED (
    SELECT d.* FROM public.admin_people_directory_rows() d WHERE d.user_id IS NOT NULL
  ),
  base AS (
    SELECT p.id, p.email, p.phone, p.username, p.country, p.created_at, p.active,
           p.is_beta_tester, p.onboarding_step,
           COALESCE(
             NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
             NULLIF(btrim(ca.display_name), ''),
             NULLIF(btrim(ca.business_name), ''),
             NULLIF(btrim(p.username), '')
           ) AS name,
           d.segment, d.app_status, d.is_ticket_holder, d.in_ticket_buyer_segment,
           d.tickets_count AS tickets_held, d.orders_count, d.spent, d.last_spent_cents,
           d.last_currency, d.last_purchase_at, d.last_event_city, d.marketing_consent,
           d.consent_basis, d.is_host_contact, d.host_brands
      FROM dir d
      JOIN public.profiles p ON p.id = d.user_id
      LEFT JOIN public.creator_accounts ca ON ca.id = p.id
     WHERE d.segment = p_segment
       AND (p_country IS NULL OR p.country = p_country)
       AND (p_joined_since IS NULL OR p.created_at >= p_joined_since)
       AND (
         v_search IS NULL
         OR p.display_name ILIKE '%' || v_search || '%'
         OR concat_ws(' ', p.first_name, p.last_name) ILIKE '%' || v_search || '%'
         OR p.username ILIKE '%' || v_search || '%'
         OR p.email ILIKE '%' || v_search || '%'
         OR p.phone ILIKE '%' || v_search || '%'
         OR ca.business_name ILIKE '%' || v_search || '%'
       )
  ),
  enriched AS (
    SELECT b.*,
      u.raw_app_meta_data ->> 'provider' AS sign_in_method,
      NULLIF(GREATEST(
        COALESCE(u.last_sign_in_at, '-infinity'::timestamptz),
        COALESCE((SELECT max(a.created_at) FROM public.user_activity a WHERE a.user_id = b.id), '-infinity'::timestamptz)
      ), '-infinity'::timestamptz) AS last_active
      FROM base b
      LEFT JOIN auth.users u ON u.id = b.id
  ),
  ranked AS (
    SELECT e.*, row_number() OVER (
      ORDER BY
        (CASE WHEN v_sort = 'joined_asc'       THEN e.created_at END) ASC NULLS LAST,
        (CASE WHEN v_sort = 'joined_desc'      THEN e.created_at END) DESC NULLS LAST,
        (CASE WHEN v_sort = 'name_asc'         THEN lower(e.name) END) ASC NULLS LAST,
        (CASE WHEN v_sort = 'name_desc'        THEN lower(e.name) END) DESC NULLS LAST,
        (CASE WHEN v_sort = 'last_active_asc'  THEN e.last_active END) ASC NULLS LAST,
        (CASE WHEN v_sort = 'last_active_desc' THEN e.last_active END) DESC NULLS LAST,
        e.created_at DESC, e.id
    ) AS rn
    FROM enriched e
  )
  SELECT
    (SELECT count(*) FROM base),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',             r.id,
      'name',           r.name,
      'email',          r.email,
      'phone',          r.phone,
      'country',        NULLIF(btrim(r.country), ''),
      'joined_at',      r.created_at,
      'last_active_at', r.last_active,
      'sign_in_method', r.sign_in_method,
      'banned',         (r.active = false),
      'is_beta_tester', COALESCE(r.is_beta_tester, false),
      'segment',        r.segment,
      'app_status',     r.app_status,
      'onboarding_step', r.onboarding_step,
      'closed_business_account', EXISTS (
        SELECT 1 FROM public.creator_accounts ca2 WHERE ca2.id = r.id AND ca2.deleted_at IS NOT NULL),
      'saves',   (SELECT count(*) FROM public.saved_card s WHERE s.profile_id = r.id),
      'tickets', (SELECT count(*) FROM public.tickets t JOIN public.orders o ON o.id = t.order_id
                   WHERE o.buyer_user_id = r.id AND o.payment_status = 'paid' AND t.status <> 'void'),
      -- #4226 ticket facts (held tickets include ones given or transferred to them).
      'is_ticket_holder',        r.is_ticket_holder,
      'in_ticket_buyer_segment', r.in_ticket_buyer_segment,
      'tickets_held',            r.tickets_held,
      'orders',                  r.orders_count,
      'spent',                   r.spent,
      'last_spent_cents',        r.last_spent_cents,
      'last_currency',           r.last_currency,
      'last_purchase_at',        r.last_purchase_at,
      'event_city',              r.last_event_city,
      'marketing_consent',       r.marketing_consent,
      -- #4226 host-contact facts.
      'consent_basis',           r.consent_basis,
      'is_host_contact',         r.is_host_contact,
      'host_brands',             r.host_brands,
      'friends', (SELECT count(*) FROM public.friends f
                   WHERE f.user_id = r.id AND f.status = 'accepted' AND f.deleted_at IS NULL),
      'brands', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', x.id, 'name', x.name, 'role', x.role,
                 'payment_readiness', public.admin_brand_payment_readiness_w3(x.id))
                 ORDER BY x.role_rank, x.name)
          FROM (
            SELECT b.id, b.name, 'brand_owner'::text AS role, 0 AS role_rank
              FROM public.brands b
             WHERE b.account_id = r.id AND b.deleted_at IS NULL
            UNION
            SELECT b.id, b.name, m.role, 1
              FROM public.brand_team_members m
              JOIN public.brands b ON b.id = m.brand_id
             WHERE m.user_id = r.id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
               AND b.deleted_at IS NULL AND b.account_id IS DISTINCT FROM r.id
          ) x), '[]'::jsonb),
      'live_offerings', (
        SELECT count(*) FROM public.events e
          LEFT JOIN public.event_dates d ON d.event_id = e.id AND d.is_master
         WHERE e.deleted_at IS NULL
           AND public.admin_offering_is_current(e.status, d.start_at)
           AND e.brand_id IN (
             SELECT b.id FROM public.brands b WHERE b.account_id = r.id AND b.deleted_at IS NULL
             UNION
             SELECT m.brand_id FROM public.brand_team_members m
              WHERE m.user_id = r.id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL)),
      'internal', (SELECT jsonb_build_object('reason', ia.reason, 'marked_by', ia.marked_by, 'marked_at', ia.marked_at)
                     FROM public.admin_internal_accounts ia WHERE ia.user_id = r.id AND ia.is_internal)
    ) ORDER BY r.rn), '[]'::jsonb)
  INTO v_total, v_rows
  FROM ranked r
  WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_people(text, text, text, timestamptz, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_people(text, text, text, timestamptz, integer, integer, text) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 3. Data room: host contacts beside ticket buyers.
--------------------------------------------------------------------------------
-- 'host_contacts' (staff and test left out):
--   contacts            people a host imported or added by hand;
--   no_app              of those, people without the Explorer or Host app;
--   no_app_no_ticket    of those, the People "Host contacts, no app" tab count;
--   with_app            of those, people with the Explorer or Host app;
--   added_before_account  contacts a host added before they had an account
--                       (or who still have none);
--   converted           of those, people who now have the Explorer or Host app
--                       ("later got an app");
--   conversion_rate     converted / added_before_account (NULL with none).
CREATE OR REPLACE FUNCTION public.analytics_dr_users()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public, pg_temp
SET TimeZone = 'UTC'
AS $$
  WITH c AS MATERIALIZED (
    SELECT c.segment, p.created_at
      FROM public.admin_people_classified() c
      JOIN public.profiles p ON p.id = c.user_id
  ), r AS (
    SELECT * FROM c WHERE segment <> 'internal'
  ), months AS (
    SELECT generate_series(date_trunc('month', min(created_at)), date_trunc('month', now()),
                           interval '1 month') AS m
      FROM r
  ), d AS MATERIALIZED (
    SELECT * FROM public.admin_people_directory_rows()
  ), tb AS MATERIALIZED (
    SELECT d.user_id, d.app_status, d.in_ticket_buyer_segment,
           (d.user_id IS NULL OR d.first_purchase_at < d.created_at) AS bought_before_account,
           (d.app_status IN ('explorer', 'host', 'both')) AS has_app
      FROM d
     WHERE d.is_ticket_holder AND NOT d.is_internal
  ), hc AS MATERIALIZED (
    SELECT d.user_id, d.segment,
           (d.user_id IS NULL OR d.host_contact_added_at < d.created_at) AS added_before_account,
           (d.app_status IN ('explorer', 'host', 'both')) AS has_app
      FROM d
     WHERE d.is_host_contact AND NOT d.is_internal
  )
  SELECT jsonb_build_object(
    'segments', jsonb_build_object(
      'explorer',   (SELECT count(*) FROM r WHERE segment = 'explorer'),
      'host',       (SELECT count(*) FROM r WHERE segment = 'host'),
      'both',       (SELECT count(*) FROM r WHERE segment = 'both'),
      'incomplete', (SELECT count(*) FROM r WHERE segment = 'incomplete')),
    'total',             (SELECT count(*) FROM r),
    'internal_left_out', (SELECT count(*) FROM c WHERE segment = 'internal'),
    'ticket_buyers', (
      SELECT jsonb_build_object(
        'buyers',                count(*),
        'with_app',              count(*) FILTER (WHERE tb.has_app),
        'no_app',                count(*) FILTER (WHERE tb.in_ticket_buyer_segment),
        'no_account',            count(*) FILTER (WHERE tb.user_id IS NULL),
        'bought_before_account', count(*) FILTER (WHERE tb.bought_before_account),
        'converted',             count(*) FILTER (WHERE tb.bought_before_account AND tb.has_app),
        'conversion_rate',       CASE WHEN count(*) FILTER (WHERE tb.bought_before_account) = 0 THEN NULL
                                      ELSE round(
                                        (count(*) FILTER (WHERE tb.bought_before_account AND tb.has_app))::numeric
                                        / (count(*) FILTER (WHERE tb.bought_before_account)), 4) END)
        FROM tb),
    'host_contacts', (
      SELECT jsonb_build_object(
        'contacts',             count(*),
        'no_app',               count(*) FILTER (WHERE NOT hc.has_app),
        'no_app_no_ticket',     count(*) FILTER (WHERE hc.segment = 'host_contact_no_app'),
        'with_app',             count(*) FILTER (WHERE hc.has_app),
        'added_before_account', count(*) FILTER (WHERE hc.added_before_account),
        'converted',            count(*) FILTER (WHERE hc.added_before_account AND hc.has_app),
        'conversion_rate',      CASE WHEN count(*) FILTER (WHERE hc.added_before_account) = 0 THEN NULL
                                     ELSE round(
                                       (count(*) FILTER (WHERE hc.added_before_account AND hc.has_app))::numeric
                                       / (count(*) FILTER (WHERE hc.added_before_account)), 4) END)
        FROM hc),
    'months', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'month', to_char(x.m, 'YYYY-MM'), 'explorer', x.e, 'host', x.h,
               'both', x.b, 'incomplete', x.i) ORDER BY x.m)
        FROM (
          SELECT months.m,
                 count(r.segment) FILTER (WHERE r.segment = 'explorer')   AS e,
                 count(r.segment) FILTER (WHERE r.segment = 'host')       AS h,
                 count(r.segment) FILTER (WHERE r.segment = 'both')       AS b,
                 count(r.segment) FILTER (WHERE r.segment = 'incomplete') AS i
            FROM months
            LEFT JOIN r ON date_trunc('month', r.created_at) = months.m
           GROUP BY months.m) x
    ), '[]'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION public.analytics_dr_users() FROM PUBLIC, anon, authenticated;

COMMIT;
