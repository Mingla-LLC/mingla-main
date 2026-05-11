# SPEC ORCH-0795 — Scanner Auto-Provision + UX Honesty

| Field | Value |
|---|---|
| ORCH-ID | ORCH-0795 |
| Severity | S0-critical (launch blocker for B4 Scanner cycle) |
| Owner side | Backend (DB trigger + backfill) + Mobile (mingla-business UI) |
| Dispatcher | Claude `mingla-orchestrator` (intake + investigation already proven) |
| Investigation | none filed — root cause proven inline at intake; evidence chain reproduced in §1 |
| Working tree | `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` |
| Confidence | H |
| Status | Awaiting implementor dispatch |

---

## 1. Context and proof chain (already proven, do NOT re-investigate)

### 1.1 Symptom

Brand owner (sethogieva@gmail.com) cannot scan any ticket for any event they created. Scanner camera UI shows `"Scan failed"` overlay on every QR read. Real failure is the edge function returning HTTP 403 with body `{"error":"scan_failed","detail":"scanner_not_authorized"}` — masked by supabase-js's generic `FunctionsHttpError.message` (`"Edge Function returned a non-2xx status code"`).

### 1.2 Five-layer evidence

| Layer | Evidence |
|---|---|
| **Runtime** | Edge function logs (last hour, 2026-05-11): 5/5 POST to `/functions/v1/scan-ticket` returned **403**, function id `86579af3-1e41-46c9-8fa3-e52548b73260` v22. |
| **Code (edge fn)** | [supabase/functions/scan-ticket/index.ts:40-42](../../supabase/functions/scan-ticket/index.ts#L40-L42): 403 path triggered only when `error.message.includes("scanner_not_authorized")`. |
| **Schema (RPC)** | `biz_ticket_scan` at [supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql:29-38](../../supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql#L29-L38) raises `scanner_not_authorized` unless `event_scanners` has an active row for `(p_event_id, p_scanner_user_id)` with `permissions->>'scan'` truthy. |
| **Data** | Read-only probe via Supabase MCP: account `b17e3e15-218d-475b-8c80-32d4948d6905` (sethogieva@gmail.com) owns **17 events** via `brands.account_id`. Has **0** rows in `event_scanners`. Entire `event_scanners` table holds **4 rows** total across all users (all from the InviteScannerSheet path). |
| **Code (grep)** | Only INSERT path to `event_scanners` is the operator-to-operator invitation flow ([InviteScannerSheet.tsx](../../mingla-business/src/components/scanners/InviteScannerSheet.tsx) → edge fn `accept-scanner-invitation`). No trigger, no RPC, no backfill ever inserts the brand owner. |
| **Code (UI)** | [mingla-business/app/event/[id]/scanner/index.tsx:344-349](../../mingla-business/app/event/[id]/scanner/index.tsx#L344-L349) catches the error and renders generic `"Scan failed"` overlay using `error.message` (which is the SDK-generic string), throwing away the 403 body. |

### 1.3 Six-field root cause

| Field | Value |
|---|---|
| File + line | (semantic) — absence of any path that INSERTs into `event_scanners` for brand owners/event managers at event-create time |
| Exact code | N/A — gap, not a defect line |
| What it does | New events have zero scanner rows; only explicitly-invited scanners get rows via `accept-scanner-invitation` |
| What it should do | Every newly-created event auto-provisions a scanner row for every user with `biz_brand_effective_rank >= event_manager` on the event's brand (i.e. account_owner, brand_admin, event_manager). Backfill applies the same rule to all pre-existing events. |
| Causal chain | Event INSERT under standard RLS → no scanner row written → brand owner navigates to `/event/[id]/scanner` → camera reads QR → `scan-ticket` edge fn → `biz_ticket_scan` RPC → authorization gate fails (no row) → `RAISE EXCEPTION 'scanner_not_authorized'` → edge fn maps to HTTP 403 → mobile shows `"Scan failed"`. |
| Verification step | SELECT count(*) FROM events e WHERE NOT EXISTS (SELECT 1 FROM event_scanners es WHERE es.event_id = e.id AND es.removed_at IS NULL); — must equal 0 after fix. |

### 1.4 Precedent pattern

The B2a V3 RC-3 fix at [supabase/migrations/20260514000000_b2a_v3_brand_owner_team_member_trigger.sql](../../supabase/migrations/20260514000000_b2a_v3_brand_owner_team_member_trigger.sql) solved the parallel problem for `brand_team_members` (brand owners had no team-member row, blocking the V3 ToS gate). Pattern: SECURITY DEFINER AFTER INSERT trigger + one-time backfill block + DO-block verification probes that `RAISE EXCEPTION` if the migration's intent isn't reflected in catalog state. This SPEC mirrors that pattern exactly.

---

## 2. Scope

In scope:

1. New DB migration: AFTER INSERT trigger on `public.events` that auto-provisions `event_scanners` rows for all rank ≥ event_manager users on the event's brand at insert time.
2. One-time backfill block within the same migration covering all existing non-deleted events.
3. Migration verification probes (trigger registered, trigger attached, zero orphans post-backfill).
4. UI honesty: [mingla-business/app/event/[id]/scanner/index.tsx:303-357](../../mingla-business/app/event/[id]/scanner/index.tsx#L303-L357) consumes the real edge-function error body and renders distinct overlays for `scanner_not_authorized` vs. generic failure.
5. Service layer: [mingla-business/src/services/scanTicketService.ts](../../mingla-business/src/services/scanTicketService.ts) preserves the error context so the UI can read `body.error` and `body.detail`.
6. New invariant proposal `I-PROPOSED-AZ EVENT_HAS_MANAGER_SCANNER` (DRAFT → ACTIVE on CLOSE).
7. Strict-grep CI gate enforcing the invariant.

Non-goals (explicit):

- No changes to the `accept-scanner-invitation` flow. Per-event invitations of non-manager users (e.g., assigning a hired door scanner with `brand_team_members.role = 'scanner'` brand-wide) continue through existing path.
- No new admin-side UI for managing the auto-provisioned rows. They're managed by the existing InviteScannerSheet remove path.
- No re-authorization of `finance_manager` or `marketing_manager` roles for scanning. Threshold is `event_manager` exactly, matching existing `events` RLS.
- No backfill into `scanner_invitations` (the auto-provisioned rows skip the invitation lifecycle by design — these are managers who don't need to be "invited" to scan their own brand's events).
- No change to `biz_ticket_scan` RPC, scan-ticket edge function, RLS policies, or `permissions` jsonb default shape.
- No mobile rework of the operator/brand sign-up flow.

Assumptions:

- `brands.account_id` is non-null for every active brand (enforced by `biz_prevent_brand_account_id_change` + NOT NULL column constraint per baseline_squash:7826 region).
- `events.created_by` is non-null at insert (NOT NULL column).
- All currently-existing `event_scanners` rows are valid (no cleanup of historical data).
- `auth.users` foreign-key references in `event_scanners.user_id` and `event_scanners.assigned_by` remain intact for the auto-provisioned users (none of the 4 existing rows reference deleted users — verify in pre-flight).

---

## 3. Decisions (with rationale)

### 3.1 Who gets auto-provisioned

**Decision:** Every user with `biz_brand_effective_rank(event.brand_id, user_id) >= biz_role_rank('event_manager') = 40` on the event's brand at the moment of event INSERT.

That resolves to:

- The brand's `account_id` user (rank 60, account_owner)
- Every active accepted `brand_team_members` row with role in `{event_manager, brand_admin, account_owner}` (ranks 40 / 50 / 60)

**Why event_manager threshold (not lower, not higher):** mirrors the existing RLS policy `"Event manager plus can insert events"` at baseline_squash:14246. If a user can create the event, they can scan its tickets. Brand-wide `scanner` role (rank 10) is intentionally below threshold — those users are pre-hired door staff who get added per-event via the existing invitation flow. Including them automatically would over-provision and conflict with the InviteScannerSheet's per-event permission shape (`canAcceptPayments` toggle).

**Why not just the account_owner:** brand_admin and event_manager users explicitly hired to run events would still hit the same bug. Fixing only the owner leaves a known-broken sub-path.

### 3.2 Implementation surface

**Decision:** AFTER INSERT FOR EACH ROW trigger on `public.events`, SECURITY DEFINER.

**Why trigger, not RPC modification:** events are inserted via the standard RLS path under `"Event manager plus can insert events"` policy — there is no central "create event" RPC. `business_publish_event_draft` does UPDATE only (verified at [migration:36-440](../../supabase/migrations/20260525000000_orch_0792_publish_writes_event_dates.sql#L36-L440); no `INSERT INTO public.events` in the body). A trigger on `events` is the only surface that catches every INSERT path (draft create, future RPC paths, admin direct inserts, future seeders).

**Why SECURITY DEFINER:** identical reasoning to the brand-team-member precedent — the inserting principal at row-zero may not yet satisfy RLS-defined gates on `event_scanners` (note: the existing INSERT policy at baseline_squash:14266 requires `assigned_by = auth.uid()`, which would force the trigger to either match the inserter exactly OR run as definer to bypass the WITH CHECK). The function explicitly `SET search_path TO 'public', 'pg_temp'` to neutralise the elevated privilege.

### 3.3 `assigned_by` semantics

**Decision:** `assigned_by = NEW.created_by` for self-provisioned rows where the created_by user qualifies (the common path — brand owner creates their own event). For OTHER auto-provisioned users on the same event (a brand_admin who didn't create the event but qualifies), `assigned_by = NEW.created_by` as well (the person who triggered the creation is recorded as the assigner). For backfill rows where `created_by` may reference a deleted user, fall back to `b.account_id` (brand owner) — verified non-null upstream.

**Why not NULL:** `event_scanners_assigned_by_fkey` is a `NOT NULL` foreign key to `auth.users(id)` per the column definition at baseline_squash:8237 (`assigned_by uuid NOT NULL`). Cannot be NULL without an `ALTER COLUMN` migration, which is out of scope.

**Why not a system sentinel user:** no system sentinel `auth.users` row exists today. Creating one is a larger architectural decision than this spec covers.

**Audit-trail loss tolerance:** the `assigned_by = created_by` self-assignment IS distinguishable from human-invited assignments by joining `event_scanners` ↔ `scanner_invitations` (the latter only exists for invited rows). Acceptable.

### 3.4 `permissions` jsonb default

**Decision:** `'{"scan": true, "take_payments": false}'::jsonb` — exactly matches the column default at baseline_squash:8236.

**Why explicit:** RPC reads `COALESCE((es.permissions ->> 'scan')::boolean, true)` — the default is fine, but writing it explicitly future-proofs against column-default changes.

### 3.5 Soft-delete resurrection

**Decision:** Skip. If a row exists for `(event_id, user_id)` with `removed_at IS NOT NULL`, the trigger does NOT resurrect it. Backfill also skips.

**Why:** a soft-deleted row means someone explicitly removed that user from the event's scanner list. The structural fix should not undo deliberate operator actions. If the brand owner deleted themselves from an event's scanner list (somehow), they can re-add via the standard manage path.

**Operational consequence:** in the unlikely case where an existing event has a soft-deleted owner scanner row, the backfill leaves that owner unable to scan until they explicitly re-add. Acceptable — none of the 4 existing `event_scanners` rows are soft-deleted (verify in pre-flight; if any are, surface to operator before close).

### 3.6 Idempotency

**Decision:** Trigger uses `WHERE NOT EXISTS (SELECT 1 FROM event_scanners es WHERE es.event_id = NEW.id AND es.user_id = candidate.user_id AND es.removed_at IS NULL)` to skip existing active rows. Backfill block uses the same guard. Both safe to re-run.

**Why not `ON CONFLICT`:** the unique index `idx_event_scanners_event_user_active` is *partial* (`WHERE removed_at IS NULL`). Postgres rejects `ON CONFLICT` against partial indexes unless the WHERE matches verbatim, which makes the constraint name brittle and intent unclear. Explicit `NOT EXISTS` is clearer and survives index rename.

### 3.7 Concurrency

**Decision:** No advisory locks needed. `AFTER INSERT FOR EACH ROW` runs in the same transaction as the INSERT; concurrent event creates won't collide because each runs with a different `NEW.id`. The candidate-user lookup may include users freshly added to `brand_team_members` in another transaction, but that's harmless (they'd get provisioned for events created from that point onward).

---

## 4. Database layer

### 4.1 New migration file

Filename: `supabase/migrations/20260526000000_orch_0795_event_scanner_auto_provision.sql`

Migration timestamp must be strictly greater than the latest deployed migration (`20260525000003`), so `20260526000000` is the next slot in the established pattern. **Do not** use a `20260515000018+` slot — those were taken by prior ORCH-0783/0786/0787/0789/0790/0791/0792 work.

### 4.2 Trigger function

```sql
CREATE OR REPLACE FUNCTION public.biz_event_auto_provision_scanners()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Defensive: brand_id is NOT NULL at column level but guard explicitly so a
  -- future schema relaxation doesn't turn this trigger into a NULL-brand writer.
  IF NEW.brand_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Insert one row per qualifying user (rank >= event_manager on the brand)
  -- who does not already have an active scanner row for this event.
  --
  -- Candidates = union of:
  --   (a) brand owner (brands.account_id)
  --   (b) accepted, non-removed brand_team_members with role in
  --       {event_manager, brand_admin, account_owner}
  --
  -- Idempotency: NOT EXISTS guard skips active rows; soft-deleted
  -- (removed_at IS NOT NULL) rows are intentionally NOT resurrected
  -- (see SPEC §3.5).
  INSERT INTO public.event_scanners (
    event_id,
    user_id,
    permissions,
    assigned_by,
    assigned_at,
    removed_at
  )
  SELECT
    NEW.id                                                       AS event_id,
    candidate.user_id                                            AS user_id,
    '{"scan": true, "take_payments": false}'::jsonb              AS permissions,
    COALESCE(NEW.created_by, b.account_id)                       AS assigned_by,
    NEW.created_at                                               AS assigned_at,
    NULL::timestamptz                                            AS removed_at
  FROM public.brands b
  CROSS JOIN LATERAL (
    -- (a) brand owner
    SELECT b.account_id AS user_id
    WHERE b.account_id IS NOT NULL
    UNION
    -- (b) brand_team_members with rank >= event_manager
    SELECT m.user_id
    FROM public.brand_team_members m
    WHERE m.brand_id = b.id
      AND m.removed_at IS NULL
      AND m.accepted_at IS NOT NULL
      AND public.biz_role_rank(m.role) >= public.biz_role_rank('event_manager')
  ) AS candidate
  WHERE b.id = NEW.brand_id
    AND b.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_scanners es
      WHERE es.event_id = NEW.id
        AND es.user_id = candidate.user_id
        AND es.removed_at IS NULL
    );

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.biz_event_auto_provision_scanners() OWNER TO postgres;

COMMENT ON FUNCTION public.biz_event_auto_provision_scanners() IS
  'ORCH-0795: AFTER INSERT ON events trigger fn — auto-provisions event_scanners rows for every brand member with biz_brand_effective_rank >= event_manager. Idempotent. Does not resurrect soft-deleted rows. Mirrors biz_create_brand_owner_team_member precedent (20260514000000).';
```

### 4.3 Trigger

```sql
DROP TRIGGER IF EXISTS biz_event_auto_provision_scanners_after_insert ON public.events;

CREATE TRIGGER biz_event_auto_provision_scanners_after_insert
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_event_auto_provision_scanners();

COMMENT ON TRIGGER biz_event_auto_provision_scanners_after_insert ON public.events IS
  'ORCH-0795: ensures every new event has at least one event_scanners row for the brand owner + every event_manager+ brand member. Closes the auto-provision gap that surfaced as scanner_not_authorized 403s for brand owners scanning their own events.';
```

### 4.4 One-time backfill block

```sql
-- One-time backfill — catches every existing event with no active scanner
-- row for a qualifying user.
INSERT INTO public.event_scanners (
  event_id,
  user_id,
  permissions,
  assigned_by,
  assigned_at,
  removed_at
)
SELECT
  e.id                                                           AS event_id,
  candidate.user_id                                              AS user_id,
  '{"scan": true, "take_payments": false}'::jsonb                AS permissions,
  COALESCE(e.created_by, b.account_id)                           AS assigned_by,
  e.created_at                                                   AS assigned_at,
  NULL::timestamptz                                              AS removed_at
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
CROSS JOIN LATERAL (
  SELECT b.account_id AS user_id
  WHERE b.account_id IS NOT NULL
  UNION
  SELECT m.user_id
  FROM public.brand_team_members m
  WHERE m.brand_id = b.id
    AND m.removed_at IS NULL
    AND m.accepted_at IS NOT NULL
    AND public.biz_role_rank(m.role) >= public.biz_role_rank('event_manager')
) AS candidate
WHERE e.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.event_scanners es
    WHERE es.event_id = e.id
      AND es.user_id = candidate.user_id
      AND es.removed_at IS NULL
  );

DO $$
DECLARE
  v_inserted int;
BEGIN
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'ORCH-0795 backfill: inserted % event_scanners rows', v_inserted;
END$$;
```

Note: the `GET DIAGNOSTICS` block above sits OUTSIDE the INSERT statement; the implementor must structure the migration so the `RAISE NOTICE` correctly captures the prior statement's row count, or wrap the INSERT in a DO-block. Either form is acceptable; the row-count log MUST be present so the operator can read the deploy output.

### 4.5 Verification probes (mandatory)

```sql
-- Probe 1: trigger function registered
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'biz_event_auto_provision_scanners'
  ) THEN
    RAISE EXCEPTION 'ORCH-0795 probe failed: trigger function not registered';
  END IF;
END$$;

-- Probe 2: trigger attached to public.events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'biz_event_auto_provision_scanners_after_insert'
      AND tgrelid = 'public.events'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'ORCH-0795 probe failed: trigger not attached to public.events';
  END IF;
END$$;

-- Probe 3: backfill closure — every non-deleted event with a non-deleted brand
-- whose account_id is non-null MUST now have at least one active event_scanners
-- row (the brand owner, at minimum).
DO $$
DECLARE
  v_orphans int;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  WHERE e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND b.account_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_scanners es
      WHERE es.event_id = e.id
        AND es.user_id = b.account_id
        AND es.removed_at IS NULL
    );

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'ORCH-0795 probe failed: % events still lack an active scanner row for their brand owner after backfill',
      v_orphans;
  END IF;
END$$;
```

### 4.6 RLS impact

None. The existing RLS policies on `event_scanners` already permit:

- Brand owners (rank 60) to read their auto-provisioned rows via "Scanners and managers read event_scanners" (`user_id = auth.uid()` OR `biz_is_event_manager_plus_for_caller`).
- The `biz_ticket_scan` RPC runs SECURITY DEFINER so RLS doesn't apply to its SELECT.

No RLS migration needed.

### 4.7 What this does NOT change

- `event_scanners` table schema, defaults, constraints, indexes, RLS policies.
- `biz_ticket_scan` RPC body, signature, or permissions.
- `scan-ticket` edge function body or routing.
- Any existing scanner-invitation flow.

---

## 5. Mobile layer (mingla-business)

### 5.1 Service: `scanTicketService.ts`

File: [mingla-business/src/services/scanTicketService.ts](../../mingla-business/src/services/scanTicketService.ts)

Current behavior at line 19: `if (error) throw new Error(error.message);` — throws away `error.context` (the Response body). Must preserve the context so the UI can extract `body.error` and `body.detail`.

Change:

```ts
// scanTicketService.ts
import { supabase } from "./supabase";

export type ServerScanResult = {
  result: "success" | "duplicate" | "wrong_event" | "not_found" | "void";
  scanId: string | null;
  ticketId: string | null;
  orderId: string | null;
  buyerName: string | null;
  ticketName: string | null;
};

export type ScanTicketErrorCode =
  | "scanner_not_authorized"
  | "auth_required"
  | "scan_payload_required"
  | "qr_token_pepper_missing"
  | "scan_failed"
  | "network"
  | "unknown";

export class ScanTicketError extends Error {
  code: ScanTicketErrorCode;
  status: number | null;
  detail: string | null;
  constructor(opts: {
    code: ScanTicketErrorCode;
    status: number | null;
    detail: string | null;
    message: string;
  }) {
    super(opts.message);
    this.name = "ScanTicketError";
    this.code = opts.code;
    this.status = opts.status;
    this.detail = opts.detail;
  }
}

export const scanTicket = async (
  eventId: string,
  qrPayload: string,
): Promise<ServerScanResult> => {
  const { data, error } = await supabase.functions.invoke("scan-ticket", {
    body: { eventId, qrPayload },
  });
  if (error) {
    // Parse FunctionsHttpError context using duck-typing (RN polyfill realm
    // breaks instanceof Response — same reason edgeFunctionError.ts util exists).
    const ctx = (error as { context?: unknown }).context;
    let status: number | null = null;
    let bodyErr: string | null = null;
    let bodyDetail: string | null = null;

    if (ctx && typeof (ctx as { status?: unknown }).status === "number") {
      status = (ctx as { status: number }).status;
    }
    if (ctx && typeof (ctx as { text?: unknown }).text === "function") {
      try {
        const raw = await (ctx as Response).text();
        try {
          const body = JSON.parse(raw);
          if (typeof body?.error === "string") bodyErr = body.error;
          if (typeof body?.detail === "string") bodyDetail = body.detail;
        } catch {
          // non-JSON body — leave fields null
        }
      } catch {
        // body stream unreadable — leave fields null
      }
    }

    const code: ScanTicketErrorCode =
      bodyDetail === "scanner_not_authorized"
        ? "scanner_not_authorized"
        : bodyErr === "auth_required" || status === 401
          ? "auth_required"
          : bodyErr === "scan_payload_required"
            ? "scan_payload_required"
            : bodyErr === "qr_token_pepper_missing"
              ? "qr_token_pepper_missing"
              : bodyErr === "scan_failed"
                ? "scan_failed"
                : "unknown";

    throw new ScanTicketError({
      code,
      status,
      detail: bodyDetail,
      message: error.message ?? "Scan failed",
    });
  }
  return data as ServerScanResult;
};
```

Key contract guarantees:

- Existing callers that `throw new Error(error.message)`'d still see a thrown error with a message — no API break.
- New callers may `instanceof ScanTicketError` and branch on `code`.
- Body stream read uses `.text()` first, then `JSON.parse`, per CLAUDE memory ("Supabase Error Handling in React Native"). MUST NOT call `.json()` directly.

### 5.2 Component: `scanner/index.tsx`

File: [mingla-business/app/event/[id]/scanner/index.tsx](../../mingla-business/app/event/[id]/scanner/index.tsx)

Change at lines 344-349 (the catch block in `handleBarcodeScanned`):

```tsx
} catch (error) {
  const friendly =
    error instanceof ScanTicketError && error.code === "scanner_not_authorized"
      ? {
          message: "You're not authorized to scan this event",
          detail: "Ask the event owner to add you as a scanner.",
        }
      : error instanceof ScanTicketError && error.code === "auth_required"
        ? {
            message: "Please sign in again",
            detail: "Your session expired.",
          }
        : {
            message: "Scan failed",
            detail:
              error instanceof Error && error.message
                ? error.message
                : undefined,
          };
  showResult({
    kind: "not_found",
    message: friendly.message,
    detail: friendly.detail,
  });
  void Haptics.notificationAsync(
    Haptics.NotificationFeedbackType.Error,
  );
}
```

Import: add `import { ScanTicketError } from "../../../../src/services/scanTicketService";` to the imports block.

Note: the `kind: "not_found"` reuse keeps the existing close-icon overlay treatment (`semantic.error` red). A future refinement may add a dedicated `kind` for `not_authorized` if design wants a different chrome — out of scope for this SPEC.

### 5.3 Optional polish (deferred, NOT in this spec)

- Adding a dedicated `kind: "not_authorized"` to the `ScanResult` union and `overlaySpec` — would let the overlay use a distinct icon (e.g., `flag` instead of `close`) for the not-authorized state. Defer to a follow-up if design asks.

---

## 6. Invariants

### 6.1 New invariant (DRAFT → ACTIVE on CLOSE)

**`I-PROPOSED-AZ EVENT_HAS_MANAGER_SCANNER`**

**Statement:** Every `public.events` row with `deleted_at IS NULL` AND a `public.brands` parent with `deleted_at IS NULL` AND `account_id IS NOT NULL` MUST have at least one `public.event_scanners` row with `removed_at IS NULL` for `user_id = brands.account_id` (the brand owner) at minimum, and SHOULD have additional active rows for every `brand_team_members` user whose role rank ≥ `event_manager` at the time of event creation.

**Rationale:** Without this invariant, the scanner camera produces 403s for brand owners on their own events, blocking the entire ticket-scanning flow. Surfaced and proven by ORCH-0795 with 17 events / 0 owner-scanner rows in production.

**Enforcement mechanism:**

1. DB trigger `biz_event_auto_provision_scanners_after_insert` writes the rows at INSERT time.
2. Backfill DO-block guarantees zero orphans at migration apply.
3. Migration verification probe `RAISE EXCEPTION` if any orphan post-backfill.
4. Strict-grep CI gate `.github/scripts/strict-grep/orch-0795-event-scanner-auto-provision.mjs` asserts the migration's trigger and function definitions remain present and unmodified.

**Test that catches regression:**

- Migration verification probe (Probe 3 at §4.5).
- Strict-grep gate in CI.
- Independent tester probe: `SELECT count(*) FROM events e JOIN brands b ON b.id = e.brand_id WHERE e.deleted_at IS NULL AND b.deleted_at IS NULL AND b.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM event_scanners es WHERE es.event_id = e.id AND es.user_id = b.account_id AND es.removed_at IS NULL);` — MUST equal 0.

**Status:** DRAFT — flips to ACTIVE on ORCH-0795 CLOSE.

### 6.2 Invariants preserved (must not regress)

- `I-CATEGORY-DERIVED-ON-DROP`, `I-CATEGORY-SLUG-CANONICAL` — untouched (this spec doesn't write to `place_pool`).
- `I-PROPOSED-AX EVENT_HAS_MASTER_DATE`, `I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY` — untouched (this spec doesn't touch `event_dates` or the publish RPC).
- `I-PROPOSED-AU`, `I-PROPOSED-AV`, `I-PROPOSED-AW` — untouched.
- Existing event_scanners RLS policies — untouched.

### 6.3 Strict-grep gate (new file)

File: `.github/scripts/strict-grep/orch-0795-event-scanner-auto-provision.mjs`

Pattern set (must register into the existing strict-grep workflow per CLAUDE memory `feedback_strict_grep_registry_pattern.md` — one new script + one new job, do NOT create a parallel workflow file):

1. Latest migration matching `supabase/migrations/*orch_0795*event_scanner_auto_provision.sql` must exist.
2. That migration must contain `CREATE OR REPLACE FUNCTION public.biz_event_auto_provision_scanners`.
3. That migration must contain `CREATE TRIGGER biz_event_auto_provision_scanners_after_insert\n  AFTER INSERT ON public.events`.
4. That migration must contain `biz_role_rank('event_manager')` to prove the threshold wasn't accidentally lowered/raised.
5. `scanTicketService.ts` must export `class ScanTicketError` and `type ScanTicketErrorCode`.
6. `scanner/index.tsx` must reference `ScanTicketError` and `"scanner_not_authorized"` literally.

---

## 7. Success criteria

| # | Criterion | How to verify |
|---|-----------|---------------|
| SC-1 | After migration apply, zero events lack a brand-owner scanner row | Probe 3 (§4.5) returns 0 — checked during `supabase db push` |
| SC-2 | Creating a new event auto-provisions the owner's scanner row in the same transaction | Insert a test event, query `event_scanners` immediately, observe owner row present |
| SC-3 | A scan attempt by the brand owner on their own event returns `success` (not 403) when the QR + ticket are valid | Live-fire from iOS Simulator: create event → buy valid ticket → scan → overlay shows "checked in", scan_events row inserted with result='success' |
| SC-4 | A scan attempt by a user NOT on `event_scanners` for the event renders the new "not authorized" overlay (NOT generic "Scan failed") | Sign in as unrelated test user, attempt scan, assert overlay message text |
| SC-5 | Soft-deleted scanner rows are NOT resurrected by trigger or backfill | Manually `UPDATE event_scanners SET removed_at = now() WHERE id = X`, run trigger via new event, assert no resurrection |
| SC-6 | Re-running the migration (idempotency) inserts 0 additional rows | Apply migration twice via test branch, second apply logs `inserted 0 event_scanners rows` |
| SC-7 | RLS reads of `event_scanners` continue to function for managers + scanner-self | Existing test suite must remain green; tester adds one new probe SELECTing as the auto-provisioned owner |
| SC-8 | Mobile build compiles, type-checks, and existing scanner tests continue to pass | `cd mingla-business && npx tsc --noEmit && npx jest --testPathPattern scanner` |
| SC-9 | The new `ScanTicketError` is thrown for 403/scanner_not_authorized cases with `code === "scanner_not_authorized"` and `detail === "scanner_not_authorized"` | New unit test in `scanTicketService.test.ts` mocking a FunctionsHttpError with `context = Response('{"error":"scan_failed","detail":"scanner_not_authorized"}', { status: 403 })` |
| SC-10 | Strict-grep gate passes in CI for the new patterns | `.github/workflows/strict-grep-mingla-business.yml` job succeeds on a clean checkout |

---

## 8. Test cases

| Test | Layer | Scenario | Input | Expected |
|------|-------|----------|-------|----------|
| T-01 | DB | Insert new event | `INSERT INTO events (brand_id, created_by, title, slug)` for brand owned by user U | 1 `event_scanners` row appears for U with `permissions->>'scan' = 'true'`, `removed_at IS NULL`, `assigned_by = U` |
| T-02 | DB | Insert event with brand_admin team member | brand has owner U1 and brand_admin U2 (rank 50) | 2 `event_scanners` rows appear — one for U1, one for U2 |
| T-03 | DB | Insert event with finance_manager team member | brand has owner U1 and finance_manager U3 (rank 30, below threshold) | 1 `event_scanners` row appears — for U1 only |
| T-04 | DB | Insert event when owner already has soft-deleted scanner row | pre-insert `event_scanners (U1, event_X, removed_at=now())` then insert event_X | trigger does NOT add new active row for U1 on event_X (soft-delete respected — SPEC §3.5) |
| T-05 | DB | Backfill on existing events | apply migration with 17 owner-orphan events | 17 owner rows inserted; rerun adds 0 |
| T-06 | DB | Probe 3 zero-orphans | post-backfill | Probe 3 RAISE EXCEPTION returns 0 events |
| T-07 | Edge fn | scan-ticket with auto-provisioned owner | owner signed in, valid QR for valid ticket | `result = "success"`, HTTP 200, `scan_events` row inserted with `result='success'` |
| T-08 | Edge fn | scan-ticket with unauthorized user | random user signed in, valid QR for someone else's event | HTTP 403, body `{"error":"scan_failed","detail":"scanner_not_authorized"}` |
| T-09 | Service | `scanTicket` throws ScanTicketError on 403 | mock FunctionsHttpError | thrown error is `instanceof ScanTicketError`, `code === "scanner_not_authorized"`, `status === 403`, `detail === "scanner_not_authorized"` |
| T-10 | Component | scanner UI shows "not authorized" overlay | mock service to throw `ScanTicketError(code: scanner_not_authorized)` | overlay renders message `"You're not authorized to scan this event"` + detail `"Ask the event owner to add you as a scanner."` |
| T-11 | Component | scanner UI shows generic overlay on unknown error | mock service to throw generic Error | overlay renders `"Scan failed"` with error.message as detail (regression check) |
| T-12 | iOS Sim | live-fire owner scans own ticket | iOS Simulator, signed-in operator, real valid QR | success overlay + haptic |
| T-13 | Android Emu | live-fire owner scans own ticket | Android Emulator, same setup | success overlay + haptic |
| T-14 | Web | live-fire owner scans own ticket via web build of mingla-business | Web Chrome, same setup | NOTE: mingla-business camera UI is iOS+Android-first; if web is unsupported per current product, tester documents as N/A and operator confirms acceptance. Do NOT silently CONDITIONAL PASS — ask operator per CLAUDE memory `feedback_tester_canonical_and_platform_parity.md`. |
| T-15 | RLS regression | existing scanner-invitation flow | invite a non-manager user via InviteScannerSheet, accept invitation | `event_scanners` row added by `accept-scanner-invitation` edge fn as before — no regression |
| T-16 | RLS regression | manager reads scanner list | brand admin SELECTs `event_scanners` for their brand's event | Returns rows per existing "Scanners and managers read event_scanners" policy |

---

## 9. Implementation order

1. Create migration `20260526000000_orch_0795_event_scanner_auto_provision.sql` per §4.
2. Update `mingla-business/src/services/scanTicketService.ts` per §5.1 (NEW class + parsing).
3. Update `mingla-business/app/event/[id]/scanner/index.tsx` per §5.2 (catch block + import).
4. Add new strict-grep script `.github/scripts/strict-grep/orch-0795-event-scanner-auto-provision.mjs` per §6.3.
5. Register strict-grep script as a new job in the existing workflow per CLAUDE memory `feedback_strict_grep_registry_pattern.md` (one new script + one new job, do NOT create a parallel workflow file).
6. Add unit test `mingla-business/src/services/__tests__/scanTicketService.test.ts` covering SC-9 / T-09.
7. Run `cd mingla-business && npx tsc --noEmit` + `npx jest --testPathPattern scanner` + `npx jest --testPathPattern scanTicketService` locally. All green.
8. Write implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0795_SCANNER_AUTO_PROVISION.md` per the standard template, including:
   - Old → new diff receipts for each file
   - Local migration dry-run output (apply against a local branch or stage)
   - Local test output (tsc + jest)
   - Pre-flight check: confirm no existing `event_scanners` rows have `removed_at IS NOT NULL` for any of Seth's 17 events (if any exist, surface to operator BEFORE proceeding to CLOSE — those owners would be left unable to scan per §3.5)
9. Return to operator. Operator runs `supabase db push --linked` (operator owns migration apply per CLAUDE memory `feedback_orchestrator_deploys_edge_functions.md`). Orchestrator does NOT need to deploy any edge function — no edge function source was modified.

DIAG markers `[ORCH-0795-DIAG]` are permitted during implement+test but MUST be reaped before CLOSE (per META-ORCH-0744-PROCESS / I-PROPOSED-L).

---

## 10. Rollback plan

If a post-deploy issue surfaces:

1. **DB-only rollback (preferred):** drop the trigger and function, optionally hard-delete the backfill rows that were inserted within the last N minutes.
   ```sql
   DROP TRIGGER IF EXISTS biz_event_auto_provision_scanners_after_insert ON public.events;
   DROP FUNCTION IF EXISTS public.biz_event_auto_provision_scanners();
   -- Optional: hard-delete backfill rows (use the migration apply timestamp)
   DELETE FROM public.event_scanners
   WHERE assigned_at < '<deploy_timestamp_iso>'  -- only the trigger-written rows
     AND removed_at IS NULL
     AND assigned_by IN (
       SELECT b.account_id FROM public.brands b
       WHERE b.account_id = event_scanners.assigned_by  -- self-assigned only
     );
   ```
   Note: backfill rows are safe to leave in place — they grant `scan` permission to legitimate brand owners and don't damage anything. The DELETE is OPTIONAL.

2. **Mobile rollback (independent):** the mobile changes are additive and non-breaking. If a UI regression appears, revert the two files via git and ship an OTA. The new `ScanTicketError` class is an extension of `Error`, so legacy `instanceof Error` checks continue to work.

3. **Cascade:** none. No other migration depends on this one. The change is self-contained.

4. **Forward-fix preferred:** if probes pass and live-fire succeeds for the brand owner, prefer forward-fix on any new finding rather than reverting — reverting would re-block ticket scanning entirely.

---

## 11. References

- Investigation evidence: §1 (proven inline at intake — no separate INVESTIGATION_*.md filed)
- Precedent migration: [supabase/migrations/20260514000000_b2a_v3_brand_owner_team_member_trigger.sql](../../supabase/migrations/20260514000000_b2a_v3_brand_owner_team_member_trigger.sql)
- Authorization gate: [supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql:29-38](../../supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql#L29-L38)
- Role rank function: [supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:3315-3327](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L3315-L3327)
- Brand effective rank function: [supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:2987-3016](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L2987-L3016)
- event_scanners table: [supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:8232-8246](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L8232-L8246)
- event_scanners RLS policies: [supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:14262-14270, 14468](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L14262-L14270)
- Edge function: [supabase/functions/scan-ticket/index.ts](../../supabase/functions/scan-ticket/index.ts)
- Service: [mingla-business/src/services/scanTicketService.ts](../../mingla-business/src/services/scanTicketService.ts)
- Component: [mingla-business/app/event/[id]/scanner/index.tsx](../../mingla-business/app/event/[id]/scanner/index.tsx)
- Error util reference (RN-safe pattern): [app-mobile/src/utils/edgeFunctionError.ts](../../app-mobile/src/utils/edgeFunctionError.ts)
- Strict-grep registry pattern (CLAUDE memory): `feedback_strict_grep_registry_pattern.md`
- RN error parsing rule (CLAUDE memory): `Supabase Error Handling in React Native` section of MEMORY.md
- Orchestrator deploys edge functions (CLAUDE memory): `feedback_orchestrator_deploys_edge_functions.md` — N/A here (no edge fn changes), but documents the operator vs. orchestrator split for DB migration apply.
