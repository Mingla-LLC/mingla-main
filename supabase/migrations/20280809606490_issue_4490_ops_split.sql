-- Issue #4490, spec 08 O4, migration "50" (split bill), file number 606490
-- (the spec's 504490 sorts before the O1-O3 migrations it builds on).
--
-- A Till check can be split, by item or evenly, into shares. Every share is
-- paid through the EXISTING payment paths (cash and the venue's own machine:
-- issue_4490_till_take_payment; tap and scan: issue_4490_till_card_prepare /
-- issue_4490_till_card_start, one carrier per share). The check is paid when
-- every share is paid (the one finalizer, issue_4490_till_apply_payment, sees
-- paid_minor reach total_due_minor as before).
--
-- Rules (spec 08 §3 O4 + §11 T11, A4, A5):
-- * Only the unpaid remainder is split; a paid share keeps its shares and
--   items. Never while a share is paying (PT409 till_share_paying) or while
--   an unshared payment is pending (till_payment_in_progress). The check
--   version is checked (PT409 till_check_changed): two concurrent splits ->
--   one PT409.
-- * By item: every unit of every unpaid line goes to exactly one share; the
--   service charge left goes pro rata to each share's food and drink, the
--   remainder minor units to the first new share. After an unshared part
--   payment (or a paid even share, or a deposit on the check) only `even` is
--   accepted (PT409 till_split_after_part_payment); any other reason the
--   items do not add up to what is left (a discounted round) is
--   till_split_even_only.
-- * Evenly: what is left (base) and the service charge left are each split
--   floor(x / n), the remainder minor units to the first shares, one each.
-- * The sum of the unpaid shares equals what is left on the check to the
--   minor unit, always: anything that changes what is left other than a
--   share's own payment (an item added or voided, an unshared payment, a
--   refund) drops the unpaid shares (trigger), so a stale share can never be
--   paid. A share is paid with exactly its amount and its service charge.
-- * Share payments carry the check version they saw: a share payment is
--   accepted when that version is not older than the split it pays
--   (set_version), so two devices paying two different shares at the same
--   time both land, and the same share twice: one lands, the other is
--   PT409 till_share_paid / till_share_paying.
-- * Tips are chosen per share at pay time (the existing tip rules).
--
-- How a share payment reaches the existing paths: three INTERNAL wrappers
-- (issue_4490_till_pay_share, issue_4490_till_card_prepare_share,
-- issue_4490_till_card_start_share) put the share id in a transaction-local
-- setting and call the existing function, which reads it through
-- issue_4490_till_share_context(). With no share the three functions behave
-- exactly as before (re-emitted from their latest bodies: 464490 + 594490 +
-- 600490 + 605490 for take_payment; 599490 + 600490 for card_prepare;
-- 599490 + 605490 for card_start), plus: a check with an unpaid split is paid
-- share by share (till_split_active), and the charge-to-room tender is refused
-- (till_room_not_ready, spec D13 seam, see 607490).
--
-- Checked patches (live bodies, precondition-counted): apply_payment and
-- card_close only reopen a check when no other payment is still pending;
-- keep_late refuses to keep late money whose share is already paid;
-- the sale projection carries each payment's share and the shares.
-- pg_venue_order_finalize_payment is NOT touched.
--
-- Late money and refunds with shares:
-- * A share whose code was cancelled or expired is unpaid again (its share
--   state follows its payments); it may be paid another way. If the cancelled
--   code's money lands later it is late money exactly as before (paid_late,
--   overpaid_minor), never counted twice: "Keep it as payment" is refused when
--   the share was paid meanwhile (refund it), and allowed when the share is
--   still unpaid (the share becomes paid).
-- * A refund of a share's payment is the existing refund (cash/own machine
--   record, or the one card refund). On a check still being paid it makes
--   that money due again (the O1 fix 2 rule), so the unpaid shares are
--   dropped and the rest is paid in full or split again (evenly).
--
-- No venue_id column (the #2099 seal is unchanged). Static SQL. Local stack
-- only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o4s_patch(
  p_sig regprocedure,
  p_old text,
  p_new text,
  p_count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O4 split patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 1. Shares.
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_till_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.venue_till_sales(id) ON DELETE CASCADE,
  share_no smallint NOT NULL CHECK (share_no BETWEEN 1 AND 200),
  mode text NOT NULL CHECK (mode IN ('by_item', 'even')),
  -- The share's part of the check, service charge included (minor units).
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 2147483647),
  service_charge_minor bigint NOT NULL DEFAULT 0
    CHECK (service_charge_minor >= 0 AND service_charge_minor <= amount_minor),
  state text NOT NULL DEFAULT 'unpaid' CHECK (state IN ('unpaid', 'paying', 'paid')),
  -- The check version the split was set at (a share payment must have seen it).
  set_version integer NOT NULL CHECK (set_version > 0),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, share_no)
);
CREATE INDEX venue_till_shares_sale_idx ON public.venue_till_shares (sale_id, state);
COMMENT ON TABLE public.venue_till_shares IS
  '#4490 spec 08 O4: one share of a split Till check. Written only by issue_4490_till_set_split; '
  'state follows the share''s payments (issue_4490_till_share_state_sync). The unpaid shares always add up '
  'to what is left on the check (issue_4490_till_shares_follow_sale).';

CREATE TABLE public.venue_till_share_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.venue_till_shares(id) ON DELETE CASCADE,
  venue_order_item_id uuid NULL REFERENCES public.venue_order_items(id) ON DELETE RESTRICT,
  till_line_id uuid NULL REFERENCES public.venue_till_lines(id) ON DELETE RESTRICT,
  units integer NOT NULL CHECK (units > 0 AND units <= 99),
  -- What these units are worth before service charge (the server's split of
  -- the item's price; the remainder minor units go to the first share).
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_till_share_items_one_ref CHECK ((venue_order_item_id IS NULL) <> (till_line_id IS NULL)),
  UNIQUE (share_id, venue_order_item_id),
  UNIQUE (share_id, till_line_id)
);
CREATE INDEX venue_till_share_items_item_idx ON public.venue_till_share_items (venue_order_item_id)
  WHERE venue_order_item_id IS NOT NULL;
CREATE INDEX venue_till_share_items_line_idx ON public.venue_till_share_items (till_line_id)
  WHERE till_line_id IS NOT NULL;

ALTER TABLE public.venue_till_payments
  ADD CONSTRAINT venue_till_payments_share_fk FOREIGN KEY (share_id)
    REFERENCES public.venue_till_shares(id) ON DELETE SET NULL;
CREATE INDEX venue_till_payments_share_idx ON public.venue_till_payments (share_id) WHERE share_id IS NOT NULL;
-- W4-N3 kept for a check paid in one go (one payment attempt at a time); a
-- split check takes one attempt per share at a time.
DROP INDEX public.venue_till_payments_one_pending_uniq;
CREATE UNIQUE INDEX venue_till_payments_one_pending_uniq ON public.venue_till_payments (sale_id)
  WHERE state = 'pending' AND share_id IS NULL;
CREATE UNIQUE INDEX venue_till_payments_one_pending_share_uniq ON public.venue_till_payments (share_id)
  WHERE state = 'pending' AND share_id IS NOT NULL;

ALTER TABLE public.venue_till_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_till_share_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_till_shares, public.venue_till_share_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_till_shares, public.venue_till_share_items TO authenticated;
GRANT ALL ON public.venue_till_shares, public.venue_till_share_items TO service_role;
CREATE POLICY "venue till shares venue readers" ON public.venue_till_shares
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.venue_till_sales s WHERE s.id = venue_till_shares.sale_id
      AND public.issue_4490_can_view_venue(s.venue_id)));
CREATE POLICY "venue till share items venue readers" ON public.venue_till_share_items
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.venue_till_shares sh JOIN public.venue_till_sales s ON s.id = sh.sale_id
    WHERE sh.id = venue_till_share_items.share_id AND public.issue_4490_can_view_venue(s.venue_id)));

-- ---------------------------------------------------------------------------
-- 2. Helpers.
-- ---------------------------------------------------------------------------
-- The share a wrapper is paying (transaction-local; NULL = the whole check).
CREATE FUNCTION public.issue_4490_till_share_context()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('mingla.issue_4490_till_share', true), '')::uuid
$$;

-- The service charge still to be carried by payments on a check: the check's
-- service charge less what paid payments already carried (late money that was
-- never kept does not count). 607490 also takes out a deposit's part.
CREATE FUNCTION public.issue_4490_till_sc_left(p_sale_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT GREATEST(s.service_charge_minor - COALESCE((
    SELECT sum(p.service_charge_minor) FROM public.venue_till_payments p
    WHERE p.sale_id = s.id AND p.state IN ('paid', 'refunded', 'partially_refunded') AND NOT p.paid_late), 0), 0)::bigint
  FROM public.venue_till_sales s WHERE s.id = p_sale_id
$$;

-- A share's state follows its payments: paid once a payment for it is paid
-- (late money only once kept), paying while one is pending, else unpaid.
CREATE FUNCTION public.issue_4490_till_share_state_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_share uuid;
BEGIN
  FOREACH v_share IN ARRAY ARRAY[NEW.share_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.share_id END]
  LOOP
    CONTINUE WHEN v_share IS NULL;
    UPDATE public.venue_till_shares sh
    SET state = x.next_state, updated_at = now()
    FROM (
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM public.venue_till_payments p
                     WHERE p.share_id = v_share AND p.state IN ('paid', 'partially_refunded', 'refunded')
                       AND (NOT p.paid_late OR p.late_kept_at IS NOT NULL)) THEN 'paid'
        WHEN EXISTS (SELECT 1 FROM public.venue_till_payments p
                     WHERE p.share_id = v_share AND p.state = 'pending') THEN 'paying'
        ELSE 'unpaid' END AS next_state
    ) x
    WHERE sh.id = v_share AND sh.state IS DISTINCT FROM x.next_state;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER issue_4490_till_share_state
  AFTER INSERT OR UPDATE OF state, late_kept_at, share_id ON public.venue_till_payments
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_till_share_state_sync();

-- I-4490-SPLIT-SUM-EQUALS-REMAINING: when what is left on a check changes and
-- the shares still to pay no longer add up to it, the unpaid shares go (a
-- share being paid stays; its payment is checked against its own amount).
CREATE FUNCTION public.issue_4490_till_shares_follow_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_open bigint;
BEGIN
  IF NEW.state NOT IN ('open', 'paying') THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum(sh.amount_minor), 0) INTO v_open
  FROM public.venue_till_shares sh WHERE sh.sale_id = NEW.id AND sh.state IN ('unpaid', 'paying');
  IF v_open <> GREATEST(NEW.total_due_minor - NEW.paid_minor, 0)
     AND EXISTS (SELECT 1 FROM public.venue_till_shares sh WHERE sh.sale_id = NEW.id AND sh.state = 'unpaid') THEN
    DELETE FROM public.venue_till_shares sh WHERE sh.sale_id = NEW.id AND sh.state = 'unpaid';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER issue_4490_till_shares_follow_sale
  AFTER UPDATE OF total_due_minor, paid_minor ON public.venue_till_sales
  FOR EACH ROW
  WHEN (OLD.total_due_minor IS DISTINCT FROM NEW.total_due_minor OR OLD.paid_minor IS DISTINCT FROM NEW.paid_minor)
  EXECUTE FUNCTION public.issue_4490_till_shares_follow_sale();

-- An item or line a paid (or paying) share covers is paid: it is refunded,
-- never voided.
CREATE FUNCTION public.issue_4490_till_share_line_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'venue_order_items' THEN
    IF NEW.prep_state = 'voided' AND OLD.prep_state IS DISTINCT FROM 'voided' AND EXISTS (
        SELECT 1 FROM public.venue_till_share_items si
        JOIN public.venue_till_shares sh ON sh.id = si.share_id
        WHERE si.venue_order_item_id = NEW.id AND sh.state IN ('paid', 'paying')) THEN
      RAISE EXCEPTION 'till_line_paid' USING ERRCODE = 'PT409';
    END IF;
  ELSIF NEW.state = 'voided' AND OLD.state IS DISTINCT FROM 'voided' AND EXISTS (
      SELECT 1 FROM public.venue_till_share_items si
      JOIN public.venue_till_shares sh ON sh.id = si.share_id
      WHERE si.till_line_id = NEW.id AND sh.state IN ('paid', 'paying')) THEN
    RAISE EXCEPTION 'till_line_paid' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER issue_4490_till_share_item_guard
  BEFORE UPDATE OF prep_state ON public.venue_order_items
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_till_share_line_guard();
CREATE TRIGGER issue_4490_till_share_line_guard
  BEFORE UPDATE OF state ON public.venue_till_lines
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_till_share_line_guard();

-- ---------------------------------------------------------------------------
-- 3. Setting the split.
-- ---------------------------------------------------------------------------
-- p_mode: 'by_item' | 'even' | 'none' ('none' drops the unpaid shares: "Pay in full").
-- p_shares: by_item = [{"items":[{"orderItemId":uuid,"units":n} | {"lineId":uuid,"units":1}]}, ...]
--           even    = {"count": n}   (n = 2..20)
CREATE FUNCTION public.issue_4490_till_set_split(
  p_sale_id uuid,
  p_mode text,
  p_shares jsonb,
  p_actor uuid,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_remaining bigint;
  v_sc_left bigint;
  v_base bigint;
  v_n integer;
  v_next integer;
  v_i integer;
  v_base_i bigint;
  v_sc_i bigint;
  v_share_id uuid;
  v_menu_total bigint;
  v_base_total bigint;
  v_bad integer;
  v_part boolean;
  v_bases bigint[];
  v_menus bigint[];
  v_scs bigint[];
  v_sc_given bigint;
BEGIN
  IF p_mode NOT IN ('by_item', 'even', 'none') OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  IF public.issue_4490_till_release_stale(v_sale.id) > 0 THEN
    SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  END IF;
  IF v_sale.state NOT IN ('open', 'paying') THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_till_shares sh WHERE sh.sale_id = v_sale.id AND sh.state = 'paying') THEN
    RAISE EXCEPTION 'till_share_paying' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = v_sale.id AND p.state = 'pending') THEN
    RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
  END IF;
  -- The check as it is now (a round added since the last read counts).
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  DELETE FROM public.venue_till_shares sh WHERE sh.sale_id = v_sale.id AND sh.state = 'unpaid';
  IF p_mode = 'none' THEN
    UPDATE public.venue_till_sales SET version = version + 1, updated_at = now() WHERE id = v_sale.id;
    RETURN public.issue_4490_till_sale_projection(v_sale.id);
  END IF;
  v_remaining := GREATEST(v_sale.total_due_minor - v_sale.paid_minor, 0);
  IF v_remaining <= 0 OR v_sale.settled_outside IS NOT NULL THEN
    RAISE EXCEPTION 'till_nothing_to_pay' USING ERRCODE = 'PT409';
  END IF;
  v_sc_left := LEAST(public.issue_4490_till_sc_left(v_sale.id), v_remaining);
  SELECT COALESCE(max(sh.share_no), 0) INTO v_next FROM public.venue_till_shares sh WHERE sh.sale_id = v_sale.id;

  IF p_mode = 'even' THEN
    v_n := CASE WHEN jsonb_typeof(p_shares) = 'object' AND jsonb_typeof(p_shares->'count') = 'number'
                     AND (p_shares->>'count') ~ '^[0-9]{1,2}$'
                THEN (p_shares->>'count')::integer END;
    IF v_n IS NULL OR v_n NOT BETWEEN 2 AND 20 OR v_next + v_n > 200 THEN
      RAISE EXCEPTION 'till_split_invalid' USING ERRCODE = '22023';
    END IF;
    v_base := v_remaining - v_sc_left;
    IF v_remaining < v_n THEN
      RAISE EXCEPTION 'till_split_invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE public.venue_till_sales SET version = version + 1, updated_at = now()
    WHERE id = v_sale.id RETURNING * INTO v_sale;
    FOR v_i IN 0 .. v_n - 1 LOOP
      v_base_i := v_base / v_n + CASE WHEN v_i < v_base % v_n THEN 1 ELSE 0 END;
      v_sc_i := v_sc_left / v_n + CASE WHEN v_i < v_sc_left % v_n THEN 1 ELSE 0 END;
      IF v_base_i + v_sc_i <= 0 THEN
        RAISE EXCEPTION 'till_split_invalid' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.venue_till_shares (
        sale_id, share_no, mode, amount_minor, service_charge_minor, state, set_version, created_by_user_id
      ) VALUES (
        v_sale.id, v_next + v_i + 1, 'even', v_base_i + v_sc_i, v_sc_i, 'unpaid', v_sale.version, p_actor);
    END LOOP;
    RETURN public.issue_4490_till_sale_projection(v_sale.id);
  END IF;

  -- By item. T11: after money that no share carries (an unshared part
  -- payment, an even share, a refund, a deposit), only an even split of the rest.
  v_part := EXISTS (SELECT 1 FROM public.venue_till_payments p
                    WHERE p.sale_id = v_sale.id AND p.share_id IS NULL
                      AND p.state IN ('paid', 'partially_refunded', 'refunded')
                      AND (NOT p.paid_late OR p.late_kept_at IS NOT NULL))
         OR EXISTS (SELECT 1 FROM public.venue_till_shares sh WHERE sh.sale_id = v_sale.id AND sh.mode = 'even')
         OR EXISTS (SELECT 1 FROM public.venue_till_refunds r JOIN public.venue_till_payments p ON p.id = r.payment_id
                    WHERE p.sale_id = v_sale.id)
         OR EXISTS (SELECT 1 FROM public.venue_till_lines l
                    WHERE l.sale_id = v_sale.id AND l.kind = 'deposit_credit' AND l.state IN ('held', 'committed'));
  IF v_part THEN
    RAISE EXCEPTION 'till_split_after_part_payment' USING ERRCODE = 'PT409';
  END IF;
  IF jsonb_typeof(p_shares) <> 'array' THEN
    RAISE EXCEPTION 'till_split_invalid' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_shares);
  IF v_n NOT BETWEEN 2 AND 20 OR v_next + v_n > 200
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_shares) s
                WHERE jsonb_typeof(s) <> 'object' OR jsonb_typeof(s->'items') <> 'array'
                   OR jsonb_array_length(s->'items') = 0 OR jsonb_array_length(s->'items') > 100)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_shares) s, jsonb_array_elements(s->'items') e
                WHERE jsonb_typeof(e) <> 'object'
                   OR ((e ? 'orderItemId') = (e ? 'lineId'))
                   OR COALESCE(e->>'orderItemId', e->>'lineId', '') !~ '^[0-9a-fA-F-]{36}$'
                   OR jsonb_typeof(e->'units') <> 'number' OR COALESCE(e->>'units', '') !~ '^[0-9]{1,2}$'
                   OR (e->>'units')::integer < 1) THEN
    RAISE EXCEPTION 'till_split_invalid' USING ERRCODE = '22023';
  END IF;

  -- What is still to pay, unit by unit: each food and drink item of a round
  -- on this check (less what paid shares took), and each other line (one
  -- unit) no paid share took.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.t4490_split_avail (
    kind text, ref uuid, units_left integer, value_left bigint, is_menu boolean
  ) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.t4490_split_req (
    share_idx integer, kind text, ref uuid, units integer, value bigint
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.t4490_split_avail, pg_temp.t4490_split_req;
  INSERT INTO pg_temp.t4490_split_avail (kind, ref, units_left, value_left, is_menu)
  SELECT 'i', i.id,
         i.quantity - COALESCE((SELECT sum(si.units) FROM public.venue_till_share_items si
                                JOIN public.venue_till_shares sh ON sh.id = si.share_id
                                WHERE si.venue_order_item_id = i.id AND sh.state = 'paid'), 0)::integer,
         i.line_total_cents - COALESCE((SELECT sum(si.amount_minor) FROM public.venue_till_share_items si
                                        JOIN public.venue_till_shares sh ON sh.id = si.share_id
                                        WHERE si.venue_order_item_id = i.id AND sh.state = 'paid'), 0),
         true
  FROM public.venue_till_lines l
  JOIN public.venue_orders o ON o.id = l.venue_order_id
  JOIN public.venue_order_items i ON i.venue_order_id = o.id
  WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.state = 'held' AND i.prep_state <> 'voided';
  INSERT INTO pg_temp.t4490_split_avail (kind, ref, units_left, value_left, is_menu)
  SELECT 'l', l.id,
         CASE WHEN EXISTS (SELECT 1 FROM public.venue_till_share_items si
                           JOIN public.venue_till_shares sh ON sh.id = si.share_id
                           WHERE si.till_line_id = l.id AND sh.state = 'paid') THEN 0 ELSE 1 END,
         CASE WHEN EXISTS (SELECT 1 FROM public.venue_till_share_items si
                           JOIN public.venue_till_shares sh ON sh.id = si.share_id
                           WHERE si.till_line_id = l.id AND sh.state = 'paid') THEN 0 ELSE l.amount_minor END,
         false
  FROM public.venue_till_lines l
  WHERE l.sale_id = v_sale.id AND l.kind NOT IN ('menu_round', 'deposit_credit') AND l.state = 'held';
  INSERT INTO pg_temp.t4490_split_req (share_idx, kind, ref, units)
  SELECT (s.ord - 1)::integer,
         CASE WHEN e ? 'orderItemId' THEN 'i' ELSE 'l' END,
         lower(COALESCE(e->>'orderItemId', e->>'lineId'))::uuid,
         (e->>'units')::integer
  FROM jsonb_array_elements(p_shares) WITH ORDINALITY s(sh, ord),
       jsonb_array_elements(s.sh->'items') e;

  -- Every unit exactly once: each requested item is on this check with units
  -- left, no item twice in one share, and the units per item add up exactly.
  SELECT count(*) INTO v_bad FROM pg_temp.t4490_split_req r
  WHERE NOT EXISTS (SELECT 1 FROM pg_temp.t4490_split_avail a
                    WHERE a.kind = r.kind AND a.ref = r.ref AND a.units_left > 0);
  IF v_bad > 0
     OR EXISTS (SELECT 1 FROM pg_temp.t4490_split_req r GROUP BY r.share_idx, r.kind, r.ref HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM pg_temp.t4490_split_avail a
                WHERE a.units_left > 0 AND a.units_left IS DISTINCT FROM (
                  SELECT sum(r.units) FROM pg_temp.t4490_split_req r WHERE r.kind = a.kind AND r.ref = a.ref))
     OR EXISTS (SELECT 1 FROM pg_temp.t4490_split_avail a WHERE a.units_left < 0) THEN
    RAISE EXCEPTION 'till_split_invalid' USING ERRCODE = '22023';
  END IF;

  -- What each share's units are worth: the item's value left in proportion
  -- to the units (floor), the remainder minor units to the first share
  -- holding that item.
  UPDATE pg_temp.t4490_split_req r
  SET value = (a.value_left * r.units) / a.units_left
  FROM pg_temp.t4490_split_avail a
  WHERE a.kind = r.kind AND a.ref = r.ref;
  UPDATE pg_temp.t4490_split_req r
  SET value = r.value + (a.value_left - x.given)
  FROM pg_temp.t4490_split_avail a,
       (SELECT r2.kind, r2.ref, sum(r2.value) AS given, min(r2.share_idx) AS first_idx
        FROM pg_temp.t4490_split_req r2 GROUP BY r2.kind, r2.ref) x
  WHERE a.kind = r.kind AND a.ref = r.ref AND x.kind = r.kind AND x.ref = r.ref AND r.share_idx = x.first_idx;

  SELECT COALESCE(sum(r.value), 0) INTO v_base_total FROM pg_temp.t4490_split_req r;
  IF v_base_total + v_sc_left <> v_remaining THEN
    -- The items do not add up to what is left (a discounted round): even only.
    RAISE EXCEPTION 'till_split_even_only' USING ERRCODE = 'PT409';
  END IF;
  SELECT array_agg(COALESCE(b.base, 0) ORDER BY g.i), array_agg(COALESCE(b.menu, 0) ORDER BY g.i)
  INTO v_bases, v_menus
  FROM generate_series(0, v_n - 1) g(i)
  LEFT JOIN (
    SELECT r.share_idx, sum(r.value) AS base,
           sum(r.value) FILTER (WHERE a.is_menu) AS menu
    FROM pg_temp.t4490_split_req r
    JOIN pg_temp.t4490_split_avail a ON a.kind = r.kind AND a.ref = r.ref
    GROUP BY r.share_idx
  ) b ON b.share_idx = g.i;
  v_menu_total := 0;
  FOR v_i IN 1 .. v_n LOOP
    v_menu_total := v_menu_total + v_menus[v_i];
  END LOOP;
  -- Service charge left: pro rata to each share's food and drink, the
  -- remainder minor units to the first share.
  v_scs := array_fill(0::bigint, ARRAY[v_n]);
  v_sc_given := 0;
  IF v_menu_total > 0 THEN
    FOR v_i IN 1 .. v_n LOOP
      v_scs[v_i] := (v_sc_left * v_menus[v_i]) / v_menu_total;
      v_sc_given := v_sc_given + v_scs[v_i];
    END LOOP;
  END IF;
  v_scs[1] := v_scs[1] + (v_sc_left - v_sc_given);
  FOR v_i IN 1 .. v_n LOOP
    IF v_bases[v_i] + v_scs[v_i] <= 0 THEN
      RAISE EXCEPTION 'till_split_invalid' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  UPDATE public.venue_till_sales SET version = version + 1, updated_at = now()
  WHERE id = v_sale.id RETURNING * INTO v_sale;
  FOR v_i IN 1 .. v_n LOOP
    INSERT INTO public.venue_till_shares (
      sale_id, share_no, mode, amount_minor, service_charge_minor, state, set_version, created_by_user_id
    ) VALUES (
      v_sale.id, v_next + v_i, 'by_item', v_bases[v_i] + v_scs[v_i], v_scs[v_i], 'unpaid', v_sale.version, p_actor)
    RETURNING id INTO v_share_id;
    INSERT INTO public.venue_till_share_items (share_id, venue_order_item_id, till_line_id, units, amount_minor)
    SELECT v_share_id, CASE WHEN r.kind = 'i' THEN r.ref END, CASE WHEN r.kind = 'l' THEN r.ref END, r.units, r.value
    FROM pg_temp.t4490_split_req r WHERE r.share_idx = v_i - 1
    ORDER BY r.kind, r.ref;
  END LOOP;
  RETURN public.issue_4490_till_sale_projection(v_sale.id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Cash and the venue's own machine (re-emitted from the live body:
--    464490 + 594490 + 600490 + 605490). New: the share context, the split
--    guard and the room seam; nothing else changes for a whole-check payment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_take_payment(p_sale_id uuid, p_method text, p_amount_minor bigint, p_tip_minor bigint, p_cash_given_minor bigint, p_actor uuid, p_device_user uuid, p_client_request_id uuid, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_existing public.venue_till_payments%ROWTYPE;
  v_settings public.venue_till_settings%ROWTYPE;
  v_share public.venue_till_shares%ROWTYPE;
  v_share_id uuid := public.issue_4490_till_share_context();
  v_remaining bigint;
  v_sc_left bigint;
  v_sc bigint;
  v_tip bigint := COALESCE(p_tip_minor, 0);
  v_payment_id uuid;
  v_result jsonb;
BEGIN
  -- #4490 08-O4 (D13 seam): charge to room comes with stays.
  -- [TRANSITIONAL] exit: the stay venue work ships a room folio (spec 08 §3 O4).
  IF p_method = 'room' THEN
    RAISE EXCEPTION 'till_room_not_ready' USING ERRCODE = 'PT409';
  END IF;
  IF p_method NOT IN ('cash', 'own_machine') OR p_client_request_id IS NULL
     OR p_amount_minor IS NULL OR p_amount_minor <= 0 OR v_tip < 0
     OR (p_method = 'cash' AND (p_cash_given_minor IS NULL OR p_cash_given_minor < p_amount_minor + v_tip))
     OR (p_method <> 'cash' AND p_cash_given_minor IS NOT NULL) THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  -- #4490 08-O3 fix 5 (O3-S3): the check is locked first, then the request id
  -- is looked up, so two calls with one id run one after the other. The same
  -- id with the same money facts is a retry: it answers the ORIGINAL payment
  -- (its method, amount, tip, change). The same id with another method,
  -- amount, tip, cash given or share is refused and moves no money.
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, NULL);
  SELECT p.* INTO v_existing FROM public.venue_till_payments p
  WHERE p.sale_id = p_sale_id AND p.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.method IS DISTINCT FROM p_method
       OR v_existing.amount_minor IS DISTINCT FROM p_amount_minor
       OR v_existing.tip_minor IS DISTINCT FROM v_tip
       OR v_existing.cash_given_minor IS DISTINCT FROM p_cash_given_minor
       OR (v_share_id IS NOT NULL AND v_existing.share_id IS DISTINCT FROM v_share_id) THEN
      RAISE EXCEPTION 'till_request_reused' USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object('paymentId', v_existing.id, 'replayed', true,
      'method', v_existing.method, 'amountMinor', v_existing.amount_minor,
      'tipMinor', v_existing.tip_minor, 'state', v_existing.state, 'shareId', v_existing.share_id,
      'changeMinor', CASE WHEN v_existing.cash_given_minor IS NOT NULL
        THEN v_existing.cash_given_minor - v_existing.amount_minor - v_existing.tip_minor END,
      'sale', public.issue_4490_till_sale_projection(p_sale_id));
  END IF;
  -- T10: the version this payment was taken against. A share payment must
  -- have seen its split (another share paid since does not stale it).
  IF v_share_id IS NULL THEN
    IF p_expected_version IS NOT NULL AND p_expected_version <> v_sale.version THEN
      RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  -- #4490 O2 fix 1 (O2-T4): a code past its time or a tap that never reached
  -- the reader no longer holds the check.
  IF public.issue_4490_till_release_stale(v_sale.id) > 0 THEN
    SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  END IF;
  IF v_share_id IS NULL THEN
    IF v_sale.state = 'paying' THEN
      RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
    END IF;
    IF v_sale.state <> 'open' THEN
      RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = v_sale.id AND p.state = 'pending') THEN
      RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
    END IF;
    -- #4490 08-O4: a split check is paid share by share.
    IF EXISTS (SELECT 1 FROM public.venue_till_shares sh WHERE sh.sale_id = v_sale.id AND sh.state <> 'paid') THEN
      RAISE EXCEPTION 'till_split_active' USING ERRCODE = 'PT409';
    END IF;
  ELSE
    IF v_sale.state NOT IN ('open', 'paying') THEN
      RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
    END IF;
    SELECT * INTO v_share FROM public.venue_till_shares WHERE id = v_share_id AND sale_id = v_sale.id FOR UPDATE;
    IF NOT FOUND OR p_expected_version IS NULL OR p_expected_version < v_share.set_version THEN
      RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
    END IF;
    IF v_share.state = 'paid' THEN
      RAISE EXCEPTION 'till_share_paid' USING ERRCODE = 'PT409';
    END IF;
    IF v_share.state = 'paying' THEN
      RAISE EXCEPTION 'till_share_paying' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT 1 FROM public.venue_till_payments p
               WHERE p.sale_id = v_sale.id AND p.state = 'pending' AND p.share_id IS NULL) THEN
      RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
    END IF;
    IF p_amount_minor <> v_share.amount_minor THEN
      RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  -- T8: an unsent round is sent before any money moves.
  PERFORM public.issue_4490_till_send(v_sale.id, p_actor);
  -- #4490 O1 fix 1: never take money for a round another path settled, and
  -- price the check from its children right before the money moves.
  IF EXISTS (
    SELECT 1 FROM public.venue_till_lines l
    JOIN public.venue_orders o ON o.id = l.venue_order_id
    WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.state <> 'voided'
      AND (o.payment_status NOT IN ('pending', 'cancelled') OR o.money_path <> 'venue_collected')) THEN
    RAISE EXCEPTION 'till_round_settled_elsewhere' USING ERRCODE = 'PT409';
  END IF;
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  -- A check that changed under the split dropped its unpaid shares.
  IF v_share_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.venue_till_shares WHERE id = v_share_id AND state = 'unpaid') THEN
    RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
  END IF;
  v_remaining := v_sale.total_due_minor - v_sale.paid_minor;
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'till_nothing_to_pay' USING ERRCODE = 'PT409';
  END IF;
  IF p_amount_minor > v_remaining THEN
    RAISE EXCEPTION 'till_amount_over_due' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('remainingMinor', v_remaining)::text;
  END IF;
  IF p_amount_minor + v_tip > 2147483647 THEN
    RAISE EXCEPTION 'till_payment_too_large' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_settings FROM public.venue_till_settings WHERE venue_id = v_sale.venue_id;
  IF v_tip > 0 AND (COALESCE(v_settings.tips_enabled, true) = false OR v_tip > p_amount_minor) THEN
    RAISE EXCEPTION 'till_tip_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_share_id IS NOT NULL THEN
    -- A share carries its own service charge (set with the split).
    v_sc := v_share.service_charge_minor;
  ELSE
    -- Service charge share: pro rata of what is left (half up); the last
    -- payment takes the remainder.
    v_sc_left := public.issue_4490_till_sc_left(v_sale.id);
    v_sc := CASE WHEN p_amount_minor = v_remaining THEN LEAST(v_sc_left, p_amount_minor)
                 ELSE LEAST(floor((v_sc_left::numeric * p_amount_minor) / v_remaining + 0.5)::bigint, p_amount_minor) END;
  END IF;
  INSERT INTO public.venue_till_payments (
    sale_id, share_id, method, amount_minor, service_charge_minor, tip_minor, cash_given_minor, state,
    taken_by_user_id, device_user_id, server_user_id, client_request_id
  ) VALUES (
    v_sale.id, v_share_id, p_method, p_amount_minor, v_sc, v_tip, p_cash_given_minor, 'pending',
    p_actor, COALESCE(p_device_user, p_actor), v_sale.server_user_id, p_client_request_id
  ) RETURNING id INTO v_payment_id;
  v_result := public.issue_4490_till_apply_payment(v_payment_id);
  RETURN jsonb_build_object('paymentId', v_payment_id, 'replayed', false,
    'method', p_method, 'amountMinor', p_amount_minor, 'tipMinor', v_tip, 'shareId', v_share_id,
    'state', (SELECT p.state FROM public.venue_till_payments p WHERE p.id = v_payment_id),
    'salePaid', COALESCE((v_result->>'salePaid')::boolean, false),
    'changeMinor', CASE WHEN p_method = 'cash' THEN p_cash_given_minor - p_amount_minor - v_tip END,
    'sale', public.issue_4490_till_sale_projection(v_sale.id));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Tap and scan (re-emitted from the live bodies: card_prepare 599490 +
--    600490; card_start 599490 + 605490). A share pays exactly its amount and
--    service charge on its own carrier.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_card_prepare(p_sale_id uuid, p_actor uuid, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_share public.venue_till_shares%ROWTYPE;
  v_share_id uuid := public.issue_4490_till_share_context();
  v_sent jsonb;
  v_sc_left bigint;
BEGIN
  IF v_share_id IS NULL THEN
    v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  ELSE
    v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, NULL);
  END IF;
  -- #4490 O2 fix 1 (O2-T4): expired codes and taps that never reached the reader.
  PERFORM public.issue_4490_till_release_stale(v_sale.id);
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  IF v_share_id IS NULL THEN
    IF v_sale.state = 'paying'
       OR EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = v_sale.id AND p.state = 'pending') THEN
      RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
    END IF;
    IF v_sale.state <> 'open' THEN
      RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
    END IF;
    -- #4490 08-O4: a split check is paid share by share.
    IF EXISTS (SELECT 1 FROM public.venue_till_shares sh WHERE sh.sale_id = v_sale.id AND sh.state <> 'paid') THEN
      RAISE EXCEPTION 'till_split_active' USING ERRCODE = 'PT409';
    END IF;
  ELSE
    IF v_sale.state NOT IN ('open', 'paying') THEN
      RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
    END IF;
    SELECT * INTO v_share FROM public.venue_till_shares WHERE id = v_share_id AND sale_id = v_sale.id;
    IF NOT FOUND OR p_expected_version IS NULL OR p_expected_version < v_share.set_version THEN
      RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
    END IF;
    IF v_share.state = 'paid' THEN
      RAISE EXCEPTION 'till_share_paid' USING ERRCODE = 'PT409';
    END IF;
    IF v_share.state = 'paying' THEN
      RAISE EXCEPTION 'till_share_paying' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT 1 FROM public.venue_till_payments p
               WHERE p.sale_id = v_sale.id AND p.state = 'pending' AND p.share_id IS NULL) THEN
      RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  v_sent := public.issue_4490_till_send(v_sale.id, p_actor);
  IF EXISTS (
    SELECT 1 FROM public.venue_till_lines l
    JOIN public.venue_orders o ON o.id = l.venue_order_id
    WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.state <> 'voided'
      AND (o.payment_status NOT IN ('pending', 'cancelled') OR o.money_path <> 'venue_collected')) THEN
    RAISE EXCEPTION 'till_round_settled_elsewhere' USING ERRCODE = 'PT409';
  END IF;
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  IF v_sale.total_due_minor - v_sale.paid_minor <= 0 THEN
    RAISE EXCEPTION 'till_nothing_to_pay' USING ERRCODE = 'PT409';
  END IF;
  IF v_share_id IS NOT NULL THEN
    SELECT * INTO v_share FROM public.venue_till_shares WHERE id = v_share_id AND state = 'unpaid';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object(
      'saleId', v_sale.id, 'venueId', v_sale.venue_id, 'brandId', v_sale.brand_id,
      'currency', v_sale.currency, 'version', v_sale.version, 'shareId', v_share.id,
      'amountMinor', v_share.amount_minor,
      'serviceChargeMinor', v_share.service_charge_minor,
      'sentOrderIds', COALESCE(v_sent->'sentOrderIds', '[]'::jsonb));
  END IF;
  v_sc_left := public.issue_4490_till_sc_left(v_sale.id);
  RETURN jsonb_build_object(
    'saleId', v_sale.id, 'venueId', v_sale.venue_id, 'brandId', v_sale.brand_id,
    'currency', v_sale.currency, 'version', v_sale.version,
    'amountMinor', v_sale.total_due_minor - v_sale.paid_minor,
    'serviceChargeMinor', LEAST(v_sc_left, v_sale.total_due_minor - v_sale.paid_minor),
    'sentOrderIds', COALESCE(v_sent->'sentOrderIds', '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_till_card_start(p_sale_id uuid, p_method text, p_tip_minor bigint, p_actor uuid, p_device_user uuid, p_client_request_id uuid, p_expected_version integer, p_money jsonb, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_existing public.venue_till_payments%ROWTYPE;
  v_settings public.venue_till_settings%ROWTYPE;
  v_share public.venue_till_shares%ROWTYPE;
  v_share_id uuid := public.issue_4490_till_share_context();
  v_remaining bigint;
  v_sc bigint;
  v_tip bigint := COALESCE(p_tip_minor, 0);
  v_payment_id uuid := gen_random_uuid();
  v_carrier_id uuid := gen_random_uuid();
  v_provider text := p_money->>'provider';
  v_total bigint := (p_money->>'totalCents')::bigint;
  v_code public.venue_till_pay_codes%ROWTYPE;
BEGIN
  IF p_method NOT IN ('tap', 'scan') OR p_client_request_id IS NULL OR v_tip < 0
     OR p_money IS NULL OR jsonb_typeof(p_money) <> 'object'
     OR v_provider NOT IN ('stripe', 'paystack') OR v_total IS NULL OR v_total <= 0
     OR (p_method = 'tap' AND (v_provider <> 'stripe' OR p_code IS NOT NULL))
     OR (p_method = 'scan' AND p_code IS NULL) THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  -- Replay: the same request returns the payment (and code) it made.
  -- #4490 08-O3 fix 5: locked before the lookup (one id, one payment, also
  -- when two calls race); the same id with another method or tip is refused.
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, NULL);
  SELECT p.* INTO v_existing FROM public.venue_till_payments p
  WHERE p.sale_id = p_sale_id AND p.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.method IS DISTINCT FROM p_method OR v_existing.tip_minor IS DISTINCT FROM v_tip
       OR (v_share_id IS NOT NULL AND v_existing.share_id IS DISTINCT FROM v_share_id) THEN
      RAISE EXCEPTION 'till_request_reused' USING ERRCODE = 'PT409';
    END IF;
    SELECT * INTO v_code FROM public.venue_till_pay_codes WHERE payment_id = v_existing.id;
    RETURN jsonb_build_object('paymentId', v_existing.id, 'carrierOrderId', v_existing.carrier_order_id,
      'replayed', true, 'state', v_existing.state, 'amountMinor', v_existing.amount_minor,
      'tipMinor', v_existing.tip_minor, 'chargedMinor', v_existing.charged_minor, 'shareId', v_existing.share_id,
      'code', v_code.code, 'codeStatus', v_code.status, 'expiresAt', v_code.expires_at);
  END IF;
  IF v_share_id IS NULL THEN
    IF p_expected_version IS NOT NULL AND p_expected_version <> v_sale.version THEN
      RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
    END IF;
    IF v_sale.state = 'paying'
       OR EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = v_sale.id AND p.state = 'pending') THEN
      RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
    END IF;
    IF v_sale.state <> 'open' THEN
      RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
    END IF;
    -- #4490 08-O4: a split check is paid share by share.
    IF EXISTS (SELECT 1 FROM public.venue_till_shares sh WHERE sh.sale_id = v_sale.id AND sh.state <> 'paid') THEN
      RAISE EXCEPTION 'till_split_active' USING ERRCODE = 'PT409';
    END IF;
  ELSE
    IF v_sale.state NOT IN ('open', 'paying') THEN
      RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
    END IF;
    SELECT * INTO v_share FROM public.venue_till_shares WHERE id = v_share_id AND sale_id = v_sale.id FOR UPDATE;
    IF NOT FOUND OR p_expected_version IS NULL OR p_expected_version < v_share.set_version THEN
      RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
    END IF;
    IF v_share.state = 'paid' THEN
      RAISE EXCEPTION 'till_share_paid' USING ERRCODE = 'PT409';
    END IF;
    IF v_share.state = 'paying' THEN
      RAISE EXCEPTION 'till_share_paying' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT 1 FROM public.venue_till_payments p
               WHERE p.sale_id = v_sale.id AND p.state = 'pending' AND p.share_id IS NULL) THEN
      RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  -- prepare already sent and repriced at this version: a held round now means
  -- the check moved since.
  IF EXISTS (SELECT 1 FROM public.venue_till_lines l JOIN public.venue_orders o ON o.id = l.venue_order_id
             WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND o.fulfillment_status = 'held') THEN
    RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
  END IF;
  v_remaining := v_sale.total_due_minor - v_sale.paid_minor;
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'till_nothing_to_pay' USING ERRCODE = 'PT409';
  END IF;
  IF v_share_id IS NOT NULL THEN
    -- A share pays exactly its amount and its service charge.
    IF v_share.amount_minor > v_remaining THEN
      RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
    END IF;
    v_remaining := v_share.amount_minor;
    v_sc := v_share.service_charge_minor;
  ELSE
    v_sc := LEAST(public.issue_4490_till_sc_left(v_sale.id), v_remaining);
  END IF;
  SELECT * INTO v_settings FROM public.venue_till_settings WHERE venue_id = v_sale.venue_id;
  IF v_tip > 0 AND (COALESCE(v_settings.tips_enabled, true) = false OR v_tip > v_remaining) THEN
    RAISE EXCEPTION 'till_tip_invalid' USING ERRCODE = '22023';
  END IF;
  -- The priced carrier must be this payment: base + service charge = what is
  -- left (or the share), tip as chosen, same currency.
  IF (p_money->>'subtotalCents')::bigint IS DISTINCT FROM v_remaining - v_sc
     OR (p_money->>'serviceChargeCents')::bigint IS DISTINCT FROM v_sc
     OR (p_money->>'tipCents')::bigint IS DISTINCT FROM v_tip
     OR upper(COALESCE(p_money->>'currency', '')) <> v_sale.currency THEN
    RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
  END IF;
  IF v_total > 2147483647 OR v_remaining + v_tip > 2147483647 THEN
    RAISE EXCEPTION 'till_payment_too_large' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, qr_spot_id, source, taken_by_user_id,
    money_path, provider, stripe_account_id, currency,
    subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents, platform_service_fee_cents,
    pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, tax_amount_cents, total_cents,
    pricing_breakdown, payment_status, fulfillment_status, idempotency_key, till_payment_id, metadata
  ) VALUES (
    v_carrier_id, v_sale.session_id, v_sale.brand_id, v_sale.venue_id, v_sale.qr_spot_id, 'staff', p_actor,
    'mingla', v_provider,
    CASE WHEN v_provider = 'stripe' THEN NULLIF(p_money->>'stripeAccountId', '') END, v_sale.currency,
    (v_remaining - v_sc)::integer, (v_remaining - v_sc)::integer, 0, 0, v_sc::integer, v_tip::integer,
    (p_money->>'effectiveTakeRateBps')::integer, (p_money->>'serviceFeeBps')::integer,
    (p_money->>'minglaFeeCents')::integer, (p_money->>'platformServiceFeeCents')::integer,
    COALESCE((p_money->>'passMinglaFee')::boolean, false), COALESCE((p_money->>'passServiceFee')::boolean, false),
    COALESCE((p_money->>'passTax')::boolean, false),
    (p_money->>'buyerSubtotalCents')::integer, (p_money->>'taxAmountCents')::integer, v_total::integer,
    p_money->'pricingBreakdown', 'pending', 'payment_only', 'till_carrier:' || v_payment_id::text, v_payment_id,
    jsonb_build_object('till_carrier', true, 'till_method', p_method)
      || CASE WHEN v_share_id IS NOT NULL THEN jsonb_build_object('till_share_id', v_share_id) ELSE '{}'::jsonb END);
  IF v_provider = 'stripe' AND NOT EXISTS (
       SELECT 1 FROM public.venue_orders WHERE id = v_carrier_id AND stripe_account_id IS NOT NULL) THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.venue_till_payments (
    id, sale_id, share_id, method, amount_minor, service_charge_minor, tip_minor, charged_minor, state,
    carrier_order_id, taken_by_user_id, device_user_id, server_user_id, client_request_id
  ) VALUES (
    v_payment_id, v_sale.id, v_share_id, p_method, v_remaining, v_sc, v_tip, v_total, 'pending', v_carrier_id,
    p_actor, COALESCE(p_device_user, p_actor), v_sale.server_user_id, p_client_request_id);
  IF p_method = 'scan' THEN
    INSERT INTO public.venue_till_pay_codes (code, payment_id, provider, created_by)
    VALUES (p_code, v_payment_id, v_provider, p_actor)
    RETURNING * INTO v_code;
  END IF;
  UPDATE public.venue_till_sales
  SET state = 'paying', version = version + 1, updated_at = now() WHERE id = v_sale.id;
  RETURN jsonb_build_object('paymentId', v_payment_id, 'carrierOrderId', v_carrier_id, 'replayed', false,
    'state', 'pending', 'amountMinor', v_remaining, 'tipMinor', v_tip, 'chargedMinor', v_total,
    'shareId', v_share_id,
    'code', v_code.code, 'codeStatus', v_code.status, 'expiresAt', v_code.expires_at);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. The share wrappers (the edge calls these with a shareId).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4490_till_pay_share(
  p_sale_id uuid, p_share_id uuid, p_method text, p_amount_minor bigint, p_tip_minor bigint,
  p_cash_given_minor bigint, p_actor uuid, p_device_user uuid, p_client_request_id uuid, p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_share_id IS NULL THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('mingla.issue_4490_till_share', p_share_id::text, true);
  v := public.issue_4490_till_take_payment(p_sale_id, p_method, p_amount_minor, p_tip_minor, p_cash_given_minor,
    p_actor, p_device_user, p_client_request_id, p_expected_version);
  PERFORM set_config('mingla.issue_4490_till_share', '', true);
  RETURN v;
END;
$$;

CREATE FUNCTION public.issue_4490_till_card_prepare_share(
  p_sale_id uuid, p_share_id uuid, p_actor uuid, p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_share_id IS NULL THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('mingla.issue_4490_till_share', p_share_id::text, true);
  v := public.issue_4490_till_card_prepare(p_sale_id, p_actor, p_expected_version);
  PERFORM set_config('mingla.issue_4490_till_share', '', true);
  RETURN v;
END;
$$;

CREATE FUNCTION public.issue_4490_till_card_start_share(
  p_sale_id uuid, p_share_id uuid, p_method text, p_tip_minor bigint, p_actor uuid, p_device_user uuid,
  p_client_request_id uuid, p_expected_version integer, p_money jsonb, p_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_share_id IS NULL THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('mingla.issue_4490_till_share', p_share_id::text, true);
  v := public.issue_4490_till_card_start(p_sale_id, p_method, p_tip_minor, p_actor, p_device_user,
    p_client_request_id, p_expected_version, p_money, p_code);
  PERFORM set_config('mingla.issue_4490_till_share', '', true);
  RETURN v;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Checked patches.
-- ---------------------------------------------------------------------------
-- A check goes back to open from paying only when nothing else is still being
-- paid (two shares can be paid by card at once).
SELECT pg_temp.issue_4490_o4s_patch(
  'public.issue_4490_till_apply_payment(uuid)'::regprocedure,
  $old$      UPDATE public.venue_till_sales SET state = 'open', updated_at = v_now WHERE id = v_sale.id;$old$,
  $new$      -- #4490 08-O4: only when no other payment (another share) is still pending.
      UPDATE public.venue_till_sales SET state = 'open', updated_at = v_now
      WHERE id = v_sale.id AND NOT EXISTS (
        SELECT 1 FROM public.venue_till_payments p2 WHERE p2.sale_id = v_sale.id AND p2.state = 'pending');$new$);

SELECT pg_temp.issue_4490_o4s_patch(
  'public.issue_4490_till_card_close(uuid)'::regprocedure,
  $old$  UPDATE public.venue_till_sales
  SET state = 'open', version = version + 1, updated_at = now()
  WHERE id = v_payment.sale_id AND state = 'paying';$old$,
  $new$  -- #4490 08-O4: back to open only when no other share is still being paid.
  UPDATE public.venue_till_sales
  SET state = CASE WHEN EXISTS (SELECT 1 FROM public.venue_till_payments p2
                                WHERE p2.sale_id = v_payment.sale_id AND p2.state = 'pending')
                   THEN 'paying' ELSE 'open' END,
      version = version + 1, updated_at = now()
  WHERE id = v_payment.sale_id AND state = 'paying';$new$);

SELECT pg_temp.issue_4490_o4s_patch(
  'public.issue_4490_till_keep_late_payment(uuid,uuid,integer)'::regprocedure,
  $old$  v_left := GREATEST(v_sale.total_due_minor - v_sale.paid_minor, 0);$old$,
  $new$  -- #4490 08-O4: late money for a share someone has paid meanwhile is
  -- refunded, never kept (the share would be paid twice).
  IF v_payment.share_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.venue_till_shares sh WHERE sh.id = v_payment.share_id AND sh.state = 'paid') THEN
    RAISE EXCEPTION 'till_late_nothing_to_keep' USING ERRCODE = 'PT409';
  END IF;
  v_left := GREATEST(v_sale.total_due_minor - v_sale.paid_minor, 0);$new$);

-- The check the Till shows: each payment's share, and the shares.
CREATE FUNCTION public.issue_4490_till_sale_extras(p_sale_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'shares', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', sh.id, 'shareNo', sh.share_no, 'mode', sh.mode, 'state', sh.state,
          'amountMinor', sh.amount_minor, 'serviceChargeMinor', sh.service_charge_minor,
          'setVersion', sh.set_version,
          'paymentId', (SELECT p.id FROM public.venue_till_payments p
                        WHERE p.share_id = sh.id
                          AND (p.state = 'pending' OR (p.state IN ('paid', 'partially_refunded', 'refunded')
                               AND (NOT p.paid_late OR p.late_kept_at IS NOT NULL)))
                        ORDER BY p.seq DESC LIMIT 1),
          'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'orderItemId', si.venue_order_item_id, 'lineId', si.till_line_id,
                'units', si.units, 'amountMinor', si.amount_minor)
              ORDER BY si.created_at, si.id)
            FROM public.venue_till_share_items si WHERE si.share_id = sh.id), '[]'::jsonb))
        ORDER BY sh.share_no)
      FROM public.venue_till_shares sh WHERE sh.sale_id = p_sale_id), '[]'::jsonb),
    'split', jsonb_build_object(
      'evenOnly', EXISTS (SELECT 1 FROM public.venue_till_payments p
                          WHERE p.sale_id = p_sale_id AND p.share_id IS NULL
                            AND p.state IN ('paid', 'partially_refunded', 'refunded')
                            AND (NOT p.paid_late OR p.late_kept_at IS NOT NULL))
               OR EXISTS (SELECT 1 FROM public.venue_till_shares sh WHERE sh.sale_id = p_sale_id AND sh.mode = 'even')
               OR EXISTS (SELECT 1 FROM public.venue_till_refunds r JOIN public.venue_till_payments p ON p.id = r.payment_id
                          WHERE p.sale_id = p_sale_id),
      'serviceChargeLeftMinor', public.issue_4490_till_sc_left(p_sale_id),
      'unitsPaid', COALESCE((
        SELECT jsonb_object_agg(x.ref, x.units) FROM (
          SELECT COALESCE(si.venue_order_item_id, si.till_line_id)::text AS ref, sum(si.units) AS units
          FROM public.venue_till_share_items si
          JOIN public.venue_till_shares sh ON sh.id = si.share_id
          WHERE sh.sale_id = p_sale_id AND sh.state = 'paid'
          GROUP BY 1) x), '{}'::jsonb)))
$$;

SELECT pg_temp.issue_4490_o4s_patch(
  'public.issue_4490_till_sale_projection(uuid)'::regprocedure,
  $old$          'id', p.id, 'method', p.method, 'state', p.state, 'amountMinor', p.amount_minor,$old$,
  $new$          'id', p.id, 'method', p.method, 'state', p.state, 'amountMinor', p.amount_minor,
          'shareId', p.share_id,$new$);
SELECT pg_temp.issue_4490_o4s_patch(
  'public.issue_4490_till_sale_projection(uuid)'::regprocedure,
  $old$      FROM public.venue_till_payments p WHERE p.sale_id = s.id), '[]'::jsonb)
  )
  FROM public.venue_till_sales s$old$,
  $new$      FROM public.venue_till_payments p WHERE p.sale_id = s.id), '[]'::jsonb)
  ) || public.issue_4490_till_sale_extras(s.id)
  FROM public.venue_till_sales s$new$);

-- ---------------------------------------------------------------------------
-- 8. Privileges: every new function is internal (service role only). The
--    re-emitted and patched ones keep theirs (CREATE OR REPLACE keeps
--    grants); re-stated for the three re-emitted here.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_till_share_context(),
  public.issue_4490_till_sc_left(uuid),
  public.issue_4490_till_share_state_sync(),
  public.issue_4490_till_shares_follow_sale(),
  public.issue_4490_till_share_line_guard(),
  public.issue_4490_till_set_split(uuid, text, jsonb, uuid, integer),
  public.issue_4490_till_pay_share(uuid, uuid, text, bigint, bigint, bigint, uuid, uuid, uuid, integer),
  public.issue_4490_till_card_prepare_share(uuid, uuid, uuid, integer),
  public.issue_4490_till_card_start_share(uuid, uuid, text, bigint, uuid, uuid, uuid, integer, jsonb, text),
  public.issue_4490_till_sale_extras(uuid),
  public.issue_4490_till_take_payment(uuid, text, bigint, bigint, bigint, uuid, uuid, uuid, integer),
  public.issue_4490_till_card_prepare(uuid, uuid, integer),
  public.issue_4490_till_card_start(uuid, text, bigint, uuid, uuid, uuid, integer, jsonb, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_till_share_context(),
  public.issue_4490_till_sc_left(uuid),
  public.issue_4490_till_set_split(uuid, text, jsonb, uuid, integer),
  public.issue_4490_till_pay_share(uuid, uuid, text, bigint, bigint, bigint, uuid, uuid, uuid, integer),
  public.issue_4490_till_card_prepare_share(uuid, uuid, uuid, integer),
  public.issue_4490_till_card_start_share(uuid, uuid, text, bigint, uuid, uuid, uuid, integer, jsonb, text),
  public.issue_4490_till_sale_extras(uuid),
  public.issue_4490_till_take_payment(uuid, text, bigint, bigint, bigint, uuid, uuid, uuid, integer),
  public.issue_4490_till_card_prepare(uuid, uuid, integer),
  public.issue_4490_till_card_start(uuid, text, bigint, uuid, uuid, uuid, integer, jsonb, text)
TO service_role;

COMMIT;
