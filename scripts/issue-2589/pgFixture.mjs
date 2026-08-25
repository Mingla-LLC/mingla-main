/**
 * #2589 — the #2587 disposable PostgreSQL boundary, with this issue's migration
 * loaded on top and with real ticket inventory the share path can actually read.
 *
 * WHY IT EXTENDS RATHER THAN COPIES. #2587 already stands up a real database and
 * loads the address-privacy predicate and the whole content-share storage layer
 * VERBATIM out of the migrations. That harness is reused unchanged — this file
 * adds nothing to it and modifies none of it — because #2589's claims are about
 * the SAME rows written by the SAME mint RPC, and reusing the fixture is what
 * makes "privacy did not regress" a real assertion rather than a parallel
 * universe that happens to agree.
 *
 * WHAT THIS ADDS, and why each piece is honest:
 *
 *   1. `20270529002589`'s objects, extracted VERBATIM. If that migration is
 *      edited, the extraction stops matching and this suite goes red rather than
 *      quietly testing a stale copy. The fingerprint arithmetic under test is
 *      therefore the arithmetic that will be deployed, not a restatement of it.
 *
 *   2. A real `pg_privileged_ticket_types_remaining`, replacing #2587's
 *      always-empty stub. The volatile fact at the centre of #2589 is derived
 *      from that RPC's output, so a stub that returns nothing would make every
 *      churn assertion vacuous: `availability` would be absent from `facts`, and
 *      "the volatile fact does not mint a version" would be true for the wrong
 *      reason. Inventory is now a table this suite can move, so a "ticket sale"
 *      is a real change to a real read.
 *
 * NEVER touches a cluster or database it did not create. When PGHOST is set (CI
 * runs beside a postgres service) it creates its own database on that server and
 * drops it afterwards; otherwise it initialises a throwaway cluster in a temp
 * directory and tears the whole thing down.
 */
import { extractVerbatim, lit, ROOT, startFixtureDatabase } from "../issue-2587/pgFixture.mjs";

export { extractVerbatim, lit, ROOT };

export const MIGRATION_2589 = "supabase/migrations/20270529002589_issue_2589_share_version_identity_only.sql";

/** The blocks this fixture pins, and where they come from. */
export const VERBATIM_2589 = {
  identityProjection: {
    file: MIGRATION_2589,
    startsWith: "CREATE OR REPLACE FUNCTION public.issue_2589_share_version_identity_facts(p_facts jsonb)",
    endsWith: "GRANT EXECUTE ON FUNCTION public.issue_2589_share_version_identity_facts(jsonb)\n  TO service_role;",
  },
  mintRpc: {
    file: MIGRATION_2589,
    startsWith: "CREATE OR REPLACE FUNCTION public.upsert_content_share_version(\n  p_entity_kind text,",
    endsWith: "GRANT EXECUTE ON FUNCTION public.upsert_content_share_version(text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb)\n  TO service_role;",
  },
};

/**
 * Inventory the share path really reads.
 *
 * `ticketTruthAt` turns the rows this RPC returns into `facts.availability`.
 * Backing it with a table means "a ticket sold" is a genuine data change on the
 * genuine read, so an assertion that a sale mints no version cannot pass just
 * because the number was never there.
 */
const REAL_INVENTORY_DDL = `
CREATE TABLE public.issue_2589_remaining (
  ticket_type_id uuid PRIMARY KEY,
  remaining integer NOT NULL
);
CREATE OR REPLACE FUNCTION public.pg_privileged_ticket_types_remaining(p_event_id uuid)
RETURNS TABLE(ticket_type_id uuid, remaining integer)
LANGUAGE sql STABLE AS $fixture$
  SELECT r.ticket_type_id, r.remaining
  FROM public.issue_2589_remaining r
  JOIN public.ticket_types t ON t.id = r.ticket_type_id
  WHERE t.event_id = p_event_id
$fixture$;
CREATE OR REPLACE FUNCTION public.pg_privileged_event_tier_allin(p_event_id uuid)
RETURNS TABLE(ticket_type_id uuid, all_in_cents integer, currency text)
LANGUAGE sql STABLE AS $fixture$
  SELECT t.id, t.price_cents, t.currency FROM public.ticket_types t WHERE t.event_id = p_event_id
$fixture$;
`;

export async function startIssue2589Database() {
  const pg = await startFixtureDatabase();
  const identityProjection = extractVerbatim(
    VERBATIM_2589.identityProjection.file, VERBATIM_2589.identityProjection.startsWith, VERBATIM_2589.identityProjection.endsWith,
  );
  const mintRpc = extractVerbatim(
    VERBATIM_2589.mintRpc.file, VERBATIM_2589.mintRpc.startsWith, VERBATIM_2589.mintRpc.endsWith,
  );
  pg.exec(REAL_INVENTORY_DDL);
  pg.exec(identityProjection);
  pg.exec(mintRpc);
  return { ...pg, verbatim2589: { identityProjection, mintRpc } };
}

/**
 * Restores the PRE-#2589 fingerprint arithmetic — the shipped defect, byte for
 * byte — so a test can prove its detector actually catches it. Used only by the
 * negative control, and always paired with a restore.
 */
export function installPreFixFingerprint(pg, mintRpc) {
  const reverted = mintRpc.replace(
    "public.issue_2589_share_version_identity_facts(p_facts)::text",
    "p_facts::text",
  );
  if (reverted === mintRpc) throw new Error("#2589 negative control: the fingerprint line is not where it was expected");
  pg.exec(reverted);
}
