/**
 * Independent #873 fails-on-revert guard.
 *
 * This suite intentionally spans the action edge, canonical SQL owner, and
 * shared Business route/component because the dangerous failures occur at
 * their boundaries: forged cursors, kill-switch races, ambiguous replay, and
 * stale UI state. It performs no provider or database I/O.
 */
const actionSource = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const migrationSource = await Deno.readTextFile(
  new URL("../../migrations/20270319000873_issue_0873_guest_status_roster.sql", import.meta.url),
);
const componentSource = await Deno.readTextFile(
  new URL("../../../mingla-business/src/components/guests/GuestRosterExperience.tsx", import.meta.url),
);
const hookSource = await Deno.readTextFile(
  new URL("../../../mingla-business/src/hooks/useGuestRoster.ts", import.meta.url),
);
const serviceSource = await Deno.readTextFile(
  new URL("../../../mingla-business/src/services/guestRosterService.ts", import.meta.url),
);
const routeSource = await Deno.readTextFile(
  new URL("../../../mingla-business/app/event/[id]/guests/index.tsx", import.meta.url),
);

function requireTokens(source: string, tokens: string[], contract: string): void {
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`${contract}: missing ${token}`);
  }
}

Deno.test("#873 tester: cursor is keyset/query/watermark bound and rejects forged tuples", () => {
  if (/\bOFFSET\b/i.test(migrationSource)) {
    throw new Error("guest roster restored forbidden offset pagination");
  }
  requireTokens(migrationSource, [
    "'queryHash',v_query_hash",
    "'watermark',v_watermark",
    "issue_1770_frame",
    "hmac(",
    "guest_roster_cursor_stale",
    "v_cursor_rank",
    "v_cursor_activity",
    "v_cursor_key",
    "guest_roster_cursor_forged",
  ], "cursor binding");
  // A query hash and watermark are visible to the caller. The server must also
  // prove that the supplied tuple is an actual row boundary; range checks alone
  // let callers skip/duplicate arbitrary rows.
  if (!migrationSource.includes("guest_roster_cursor_forged")) {
    throw new Error("cursor tuple is caller-forgeable despite a valid visible hash/watermark");
  }
  requireTokens(componentSource, ["Load more guests", "isFetchNextPageError"], "load-more UI");
  if (serviceSource.includes("for (let pageIndex")) {
    throw new Error("client eagerly stitched every page again");
  }
  // A realtime/poll invalidation must discard retained pageParams. Otherwise
  // page 1 advances the watermark and page 2 immediately fails as stale.
  if (!hookSource.includes("removeQueries") && !hookSource.includes("resetQueries")) {
    throw new Error("infinite roster invalidation reuses stale later-page cursors");
  }
  if (!componentSource.includes("query.refreshFromFirstPage")) {
    throw new Error("manual/stale load-more recovery reuses retained infinite pageParams");
  }
});

Deno.test("#873 tester: execute is durably single-claim and kill-switch safe before provider I/O", () => {
  requireTokens(migrationSource, [
    "selected_count",
    "guest_roster_action_disabled",
    "bulkActionsEnabled",
    "singleActionsEnabled",
  ], "execute-time rollout");
  requireTokens(actionSource, [
    '"biz_guest_roster_get_preview"',
    '"biz_guest_roster_consume_preview"',
    "p_client_request_id: body.previewId",
    "clientRequestId: body.previewId",
    "offeringDispatch(new Request",
  ], "action execution boundary");

  const getIndex = actionSource.indexOf('"biz_guest_roster_get_preview"');
  const dispatchIndex = actionSource.indexOf("offeringDispatch(new Request", getIndex);
  const consumeIndex = actionSource.indexOf('"biz_guest_roster_consume_preview"', dispatchIndex);
  if (!(getIndex >= 0 && dispatchIndex > getIndex && consumeIndex > dispatchIndex)) {
    throw new Error("unexpected preview/dispatch/consume sequence");
  }
  // The durable preview row must bind exactly one execution identity before
  // provider I/O. A React ref is insufficient for concurrent requests,
  // remounts, process death, and ambiguous responses.
  const getPreviewDefinition = migrationSource.slice(
    migrationSource.indexOf("CREATE OR REPLACE FUNCTION public.biz_guest_roster_get_preview"),
    migrationSource.indexOf("CREATE OR REPLACE FUNCTION public.biz_guest_roster_consume_preview"),
  );
  if (!getPreviewDefinition.includes("execute_client_request_id=")) {
    throw new Error("preview execution identity is not durably claimed before provider I/O");
  }
  // The final SQL execution boundary must recheck the current rollout so a
  // flag flip between preview lookup/quote and send-group creation fails shut.
  const finalExecution = migrationSource.slice(
    migrationSource.indexOf("CREATE OR REPLACE FUNCTION public.biz_execute_offering_delivery_retry"),
    migrationSource.indexOf("CREATE OR REPLACE FUNCTION public.biz_export_brand_people"),
  );
  if (!finalExecution.includes("biz_guest_roster_rollout")) {
    throw new Error("final retry execution has a kill-switch TOCTOU gap");
  }
  const finalReminderExecution = migrationSource.slice(
    migrationSource.indexOf("CREATE OR REPLACE FUNCTION public.biz_execute_guest_roster_send_group"),
    migrationSource.indexOf("CREATE OR REPLACE FUNCTION public.biz_execute_offering_delivery_retry"),
  );
  requireTokens(finalReminderExecution, [
    "brandPersonIds",
    "biz_guest_roster_project",
    "canRemind",
    "guest_roster_status_changed",
  ], "final reminder eligibility");
  requireTokens(migrationSource, [
    "REVOKE ALL ON FUNCTION public.biz_execute_offering_delivery_retry(uuid,uuid,uuid[],text[],uuid,jsonb) FROM PUBLIC,anon,authenticated",
    "GRANT EXECUTE ON FUNCTION public.biz_execute_offering_delivery_retry(uuid,uuid,uuid[],text[],uuid,jsonb) TO service_role",
    "REVOKE ALL ON FUNCTION public.biz_execute_guest_roster_send_group(uuid,uuid,text,jsonb,text[],uuid,jsonb) FROM PUBLIC,anon,authenticated",
    "GRANT EXECUTE ON FUNCTION public.biz_execute_guest_roster_send_group(uuid,uuid,text,jsonb,text[],uuid,jsonb) TO service_role",
  ], "retry wrapper ACL");
});

Deno.test("#873 tester: exact RSVP, orthogonal filters, qualifying ticket, and private search remain server-owned", () => {
  requireTokens(migrationSource, [
    "WHEN x.rsvp_status='maybe' THEN 'maybe'",
    "'rsvpStatus',c.rsvp_status",
    "'rsvpApprovalStatus',c.approval_status",
    "WHEN 'delivery_failed' THEN r->>'invitationStatus'='failed'",
    "WHEN 'suppressed' THEN r->>'invitationStatus'='suppressed_or_skipped'",
    "WHEN 'ticketed' THEN (r->'party'->>'activeTickets')::integer>0",
    "contact.provenance_scope='brand_owned'",
    "contact.is_exportable",
    "jsonb_array_elements_text(r->'orderIds')",
    "o.payment_status='cancelled'",
    "holder.source_kind='ticket_holder'",
  ], "server roster truth");
  if (migrationSource.includes("transferred_to_email")) {
    throw new Error("roster invented a transferee identity outside the canonical #1770 source-link owner");
  }
  if (migrationSource.includes("WHEN 'maybe' THEN false")) {
    throw new Error("Maybe filter was hard-disabled");
  }
  if (!migrationSource.includes("c.primary_status IN ('not_responded','maybe')")) {
    throw new Error("Maybe RSVP is not reminder-eligible");
  }
  if (migrationSource.includes("'canRetry',c.primary_status='invite_failed' AND c.retryable")) {
    throw new Error("retry eligibility is incorrectly coupled to the primary label instead of latest failed channel evidence");
  }
  if (
    !migrationSource.includes("row_number() OVER") ||
    !migrationSource.includes("PARTITION BY a.channel") ||
    !migrationSource.includes("a.channel_rank=1")
  ) {
    throw new Error("row retry eligibility is not derived from latest-by-channel failure truth");
  }
  const canonicalPopulation = migrationSource.slice(
    migrationSource.indexOf("canonical_people AS ("),
    migrationSource.indexOf("), projected AS ("),
  );
  if (canonicalPopulation.includes("rsvp_plus_one")) {
    throw new Error("nested RSVP plus-one was promoted to an invented top-level person row");
  }
});

Deno.test("#873 tester: stale/offline preview and rollout access fail visibly closed", () => {
  requireTokens(componentSource, [
    "executeRequest.current = null",
    "setActionPreview(null)",
    "query.isStaleTruth || query.isOffline",
    "couldn't confirm the queue result",
  ], "stale and ambiguous UI");
  requireTokens(routeSource, [
    "guestRosterAccess.isPending",
    "Loading guest status…",
    "guestRosterAccess.isError",
    "No guest view is shown until access is confirmed.",
    "guestRosterAccess.refetch()",
  ], "access fail-closed UI");
  const accessErrorIndex = routeSource.indexOf("guestRosterAccess.isError");
  const legacyReturnIndex = routeSource.indexOf("return (", routeSource.indexOf("if (guestRosterAccess.data?.enabled === true)"));
  if (accessErrorIndex < 0 || legacyReturnIndex < 0 || accessErrorIndex > legacyReturnIndex) {
    throw new Error("access loading/error can fall through to the legacy roster");
  }
});
