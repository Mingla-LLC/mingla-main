-- ISSUE-1003 [Venue Website Grader growth tool — test cut] — lead + report
-- storage for the public growth tools. One row per anonymous tool run: the
-- normalized input, the generated report JSON, the (later) gated email, an
-- optional place_pool match, attribution (pid/utm), and a SALTED IP HASH for
-- rate limiting (raw IP is NEVER stored — same posture as job_applications).
--
-- ACCESS MODEL: RLS ENABLED with ZERO policies — deny-all for anon AND
-- authenticated clients. Only the service role (growth-tools-run /
-- growth-tools-gate edge functions) reads or writes rows.
--
-- SAFE-MIGRATION: purely additive (one new table + indexes), idempotent
-- (IF NOT EXISTS). Reversible (see ROLLBACK below). NOT applied here — the
-- orchestrator applies on deploy.

CREATE TABLE IF NOT EXISTS public.tool_leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Which growth tool produced this row. 'venues' is the only live tool in
    -- the #1003 test cut; the other values are reserved for the planned cuts.
    tool text NOT NULL
        CONSTRAINT tool_leads_tool_check
        CHECK (tool IN ('venues', 'events', 'trips', 'experiences')),
    -- Normalized run input, e.g. {name, city, website, place_id?}.
    input jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Full generated report JSON (null until generation succeeds).
    report jsonb,
    -- Captured at the email gate (growth-tools-gate) — null before gating.
    email text,
    -- place_pool row the run matched against (soft reference, no FK: pool rows
    -- may be pruned independently of lead history).
    place_match_id uuid,
    -- Attribution: landing pid + raw utm params passed through by the client.
    pid text,
    utm jsonb,
    -- Salted SHA-256 of the caller IP (rate limiting). Raw IP is NEVER stored.
    ip_hash text,
    status text NOT NULL DEFAULT 'created'
        CONSTRAINT tool_leads_status_check
        CHECK (status IN (
            'created', 'report_ready', 'gated_email', 'emailed', 'failed'
        )),
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tool_leads IS
    'ISSUE-1003 Venue Website Grader (growth tools, test cut): one row per anonymous tool run — input, generated report, gated email, place_pool match, attribution, salted ip hash. RLS deny-all: service-role edge functions (growth-tools-run / growth-tools-gate) are the ONLY readers/writers.';
COMMENT ON COLUMN public.tool_leads.ip_hash IS
    'sha256(ip + salt) hex — rate-limit key. The raw IP is never persisted.';

-- Deny-all: RLS on, NO policies. anon/authenticated see nothing; the service
-- role bypasses RLS.
ALTER TABLE public.tool_leads ENABLE ROW LEVEL SECURITY;

-- Gated-lead lookups + exports by email.
CREATE INDEX IF NOT EXISTS idx_tool_leads_email
    ON public.tool_leads (email);
-- Recency scans (ops dashboards, cleanup).
CREATE INDEX IF NOT EXISTS idx_tool_leads_created_at
    ON public.tool_leads (created_at DESC);
-- Rate-limit window count: rows for one ip_hash in the last 24h.
CREATE INDEX IF NOT EXISTS idx_tool_leads_ip_hash_created_at
    ON public.tool_leads (ip_hash, created_at DESC);

-- ROLLBACK (manual, if ever needed — forward-only pipeline, documented per
-- safe-migration protocol):
--   DROP INDEX IF EXISTS public.idx_tool_leads_ip_hash_created_at;
--   DROP INDEX IF EXISTS public.idx_tool_leads_created_at;
--   DROP INDEX IF EXISTS public.idx_tool_leads_email;
--   DROP TABLE IF EXISTS public.tool_leads;
