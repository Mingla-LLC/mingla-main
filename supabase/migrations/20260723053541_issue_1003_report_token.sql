-- ISSUE-1003 — email-verified report access. Entering an email no longer
-- unlocks the page; the full report is reachable only via a tokenized link
-- emailed to that address (so we only reveal the feature to real emails).
ALTER TABLE public.tool_leads ADD COLUMN IF NOT EXISTS report_token text;
