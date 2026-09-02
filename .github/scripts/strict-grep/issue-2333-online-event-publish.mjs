#!/usr/bin/env node
// issue #2333 [online-event-publish] — structural enforcement for the four DRAFT
// invariants in the SPEC §6, registered here because S3/S4 finally created the code
// they gate (S1+S2 deferred them: two of the four gated files did not exist yet).
//
// THE ONE THING THIS FILE EXISTS FOR. `events.is_online` is written
//   is_online: draft.format === "online" || draft.format === "hybrid"
// (mingla-business/src/utils/serverDraftEventMapper.ts:708). Every guard and every
// carve-out in #2333 is ONE CONJUNCT away from a version that compiles, passes the
// online happy path, and is wrong:
//   * an is_online-keyed `city_required` exempts HYBRID from a city the client REQUIRES
//     for hybrid (validateWhere:382-406) — #2333 in reverse.
//   * an is_online-keyed discovery carve-out broadcasts every HYBRID event, which has a
//     real venue in a real city, into every market on earth.
// Both produce a feed and a publish flow that look plausible. Only the conjunct differs.
//
// The self-test performs TRUE source mutations and proves each load-bearing token fails
// on revert.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const walkSourceFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : walkSourceFiles(absolute);
    }
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [absolute] : [];
  });

/** Strip SQL line comments — every #2333 migration EXPLAINS the is_online trap in prose
 *  directly above the guard it gates, and business_publish_event_draft legitimately
 *  WRITES is_online in its UPDATE. Scanning raw text would be a check that carries no
 *  information (issue #2113). */
const sqlCode = (s) => s.replace(/--[^\n]*/g, "");
/** Same for TS/TSX. */
const tsCode = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// The SECOND live copy of the S4b class bug used to live in RsvpCreatorWizard.tsx, pinned
// by EXACT COUNT rather than ignored, and registered as a discovery on #2333 for the
// orchestrator to dispatch. That dispatch was issue #3047, and it PAID the debt: the RSVP
// publish failure path no longer toasts "Could not save this publish. Try again." — it
// keeps the confirm dialog open and renders the real reason in its errorMessage slot,
// terminal-aware (a 404 from a missing RPC is never presented as retryable).
//
// The allowlist is therefore EMPTY, which makes this assertion strictly stronger than it
// was: any file in mingla-business/src that reintroduces the string fails the gate. Do not
// re-add an entry here to make a red run green — fix the copy instead.
const RETRY_LIE = "Could not save this publish. Try again.";
const KNOWN_RETRY_LIE_FILES = [];

export function check(sources) {
  const failures = [];
  const {
    publishMig,
    patchMig,
    discoverMig,
    guards,
    wizard,
    editor,
    validation,
    card,
    retryLieOccurrences,
  } = sources;

  // ── I-2333-CITY-GUARDS-ARE-FORMAT-AWARE-NOT-ONLINE-AWARE ────────────────────────
  // The publish guard reads format off the SAME jsonb node v_city comes from.
  for (const token of [
    "v_format := lower(NULLIF(btrim(COALESCE(v_business_draft->>'format', '')), ''))",
    "IF v_city IS NULL AND v_format IS DISTINCT FROM 'online' THEN",
    "RAISE EXCEPTION 'city_required'",
  ]) {
    if (!sqlCode(publishMig).includes(token))
      failures.push(`publish city_required guard is not format-keyed: missing ${token}`);
  }
  // The patch guard has NO format argument, so it reads the durable stored signal.
  for (const token of [
    "lower(btrim(\n       COALESCE(v_event.theme->'business_event'->>'format', ''),",
    "RAISE EXCEPTION 'city_required'",
  ]) {
    if (!sqlCode(patchMig).includes(token))
      failures.push(`patch city_required guard is not format-keyed: missing ${token}`);
  }
  // THE TRAP. Neither city_required guard block may mention is_online in EXECUTABLE
  // code. Bounded to the span between the v_city read and the next guard so the
  // legitimate `is_online = COALESCE(...)` write in the UPDATE is not a false positive.
  for (const [label, sql] of [
    ["publish", publishMig],
    ["patch", patchMig],
  ]) {
    const code = sqlCode(sql);
    const from = code.indexOf("v_city :=");
    const to = code.indexOf("party_types_required");
    if (from === -1 || to === -1 || to <= from) {
      failures.push(`${label} migration: could not bound the city_required guard block`);
      continue;
    }
    if (code.slice(from, to).includes("is_online")) {
      failures.push(
        `${label} city_required guard keys on is_online — is_online is TRUE for HYBRID ` +
          `(serverDraftEventMapper.ts:708), so this exempts hybrid from a city the client requires`,
      );
    }
  }

  // ── I-2333-ONLINE-ONLY-CARVE-OUT-IS-FORMAT-SCOPED ───────────────────────────────
  const discover = sqlCode(discoverMig);
  if (
    !discover.includes(
      "e.is_online IS TRUE\n              AND lower(btrim(\n                COALESCE(e.theme->'business_event'->>'format', ''),",
    )
  ) {
    failures.push(
      "the discovery carve-out is not `is_online IS TRUE AND format = 'online'` — a bare " +
        "is_online arm broadcasts every HYBRID event into every market on earth",
    );
  }
  // The two pre-existing arms must survive: the carve-out widens location, it does not
  // replace it.
  for (const token of [
    "e.city = ANY (p_cities)",
    "public.ST_DWithin(",
    "AND e.visibility = 'public'",
    "AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)",
  ]) {
    if (!discover.includes(token))
      failures.push(`discovery carve-out removed an unrelated predicate: ${token}`);
  }
  // CREATE OR REPLACE only — a DROP would revoke the grants.
  if (/DROP\s+FUNCTION[^;]*pg_discover_business_events/i.test(discover)) {
    failures.push(
      "the discovery migration DROPs pg_discover_business_events — CREATE OR REPLACE only, " +
        "a DROP revokes the existing ACL",
    );
  }

  // ── I-2333-ONLINE-FORMAT-IS-DURABLE ─────────────────────────────────────────────
  // S2 and S3 both key on theme.business_event.format. The publish theme rewrite must
  // keep MERGING business_draft through rather than replacing theme wholesale, or
  // `format` stops existing and both degrade.
  if (!sqlCode(publishMig).includes("theme = (v_theme - 'business_draft') || jsonb_build_object(")) {
    failures.push(
      "the publish theme rewrite no longer merges onto the existing theme — " +
        "theme.business_event.format is load-bearing for 20270427002334 and ...335",
    );
  }
  // `format` must NEVER join the strip list.
  const stripBlock = sqlCode(publishMig).match(/\(v_business_draft([\s\S]{0,600}?)\)\s*\|\|/);
  if (!stripBlock) {
    failures.push("could not locate the publish theme strip list");
  } else if (/-\s*'format'/.test(stripBlock[1])) {
    failures.push(
      "publish strips 'format' out of business_event — that silently un-publishes every " +
        "online event from Discover and re-bricks its editing",
    );
  }

  // ── I-2333-UNMAPPED-SERVER-GUARD-NEVER-INVITES-RETRY ────────────────────────────
  const wizardCode = tsCode(wizard);
  if (wizardCode.includes(RETRY_LIE)) {
    failures.push(
      "EventCreatorWizard still tells a host to retry an unmapped server guard — " +
        "city_required sat behind that string for two days while retrying was impossible",
    );
  }
  if (!wizardCode.includes("handleShowToast(describeUnmappedPublishGuard(code))")) {
    failures.push("EventCreatorWizard's unmapped-guard fallback does not use the tested helper");
  }
  for (const token of [
    "const UNMAPPED_GUARD_TOKEN_SHAPE = /^[a-z][a-z0-9_]{2,63}$/",
    'console.error("[#2333] unmapped publish guard", s)',
    "export const describeUnmappedPublishGuard",
  ]) {
    if (!tsCode(guards).includes(token))
      failures.push(`the unmapped-guard describer lost a load-bearing part: ${token}`);
  }
  if (/Try again/i.test(tsCode(guards).slice(tsCode(guards).indexOf("describeUnmappedPublishGuard")))) {
    failures.push("describeUnmappedPublishGuard invites a retry");
  }
  for (const token of [
    'console.error("[#2333] unmapped edit guard", s)',
    "export const describeUnmappedEditGuard",
    "Your published event was not changed",
  ]) {
    if (!tsCode(guards).includes(token))
      failures.push(`the edit-context unmapped-guard describer lost a load-bearing part: ${token}`);
  }
  const editGuardStart = tsCode(guards).indexOf("export const describeUnmappedEditGuard");
  const editGuardEnd = tsCode(guards).indexOf("export const brandStripeOnboardingRoute");
  const editGuardCode = tsCode(guards).slice(editGuardStart, editGuardEnd);
  if (/couldn't publish|draft is saved|Try again/i.test(editGuardCode)) {
    failures.push("describeUnmappedEditGuard makes a publish, draft, or retry claim");
  }
  // Compare the repository occurrence SET, not the size of the allowlist declared in
  // this gate (#2113). A new live copy and a vanished allowlisted copy both fail.
  if (
    retryLieOccurrences.length !== KNOWN_RETRY_LIE_FILES.length ||
    retryLieOccurrences.some((name, index) => name !== KNOWN_RETRY_LIE_FILES[index])
  ) {
    failures.push(
      `retry-lie occurrence set changed: expected ${KNOWN_RETRY_LIE_FILES.join(", ")}; ` +
        `found ${retryLieOccurrences.join(", ") || "none"}`,
    );
  }

  // ── S4a: city_required is mapped, provider-neutral union ONLY ───────────────────
  const guardCode = tsCode(guards);
  for (const token of [
    '| "city_required"',
    '| "edit_where"',
    "city_required(?:$|[^a-z0-9_])/.test(s)",
    'title: "Add where it\'s happening"',
    'action: "edit_where"',
  ]) {
    if (!guardCode.includes(token))
      failures.push(`paidPublishGuards lost the city_required mapping: ${token}`);
  }
  // It must NOT be smuggled into the money-guard union.
  const moneyUnion = guardCode.match(
    /export type PaidPublishGuardReason =([\s\S]*?);/,
  );
  if (!moneyUnion) {
    failures.push("could not locate PaidPublishGuardReason");
  } else if (moneyUnion[1].includes("city_required")) {
    failures.push(
      "city_required leaked into PaidPublishGuardReason — that union is the MONEY guards, " +
        "and edit paths would route a missing city to payment onboarding",
    );
  }
  // The Fix-jump must reach the Where step, and the switch must be exhaustive.
  if (!/case "edit_where":[\s\S]{0,200}?setCurrentStep\(2\);/.test(wizardCode)) {
    failures.push("the edit_where guard action does not jump to the Where step (index 2)");
  }
  if (!wizardCode.includes("const exhaustive: never = guardCopy.action;")) {
    failures.push(
      "the guard-action switch is not exhaustive — a new action would silently reuse " +
        "another step's jump",
    );
  }

  // ── S4c: the edit-screen copy stops naming a field the online step never renders ──
  const editCode = tsCode(editor);
  if (!editCode.includes('liveEvent.format === "online"')) {
    failures.push(
      "EditPublishedScreen's city_required copy is unconditional again — it tells an " +
        "online host to pick a venue address the online Where step never renders",
    );
  }
  if (!editCode.includes(": describeUnmappedEditGuard(code);")) {
    failures.push(
      "EditPublishedScreen's terminal server-guard fallback is not using the " +
        "context-correct describeUnmappedEditGuard",
    );
  }

  // ── S4d: known map hosts are denied, and it is NOT an allow-list ────────────────
  const validationCode = tsCode(validation);
  for (const token of [
    "const isMapLocationUrl",
    '"maps.app.goo.gl"',
    '"maps.apple.com"',
    "isMapLocationUrl(d.onlineUrl)",
    "That's a map location, not a joining link.",
  ]) {
    if (!validationCode.includes(token))
      failures.push(`the conferencing-link map deny lost a part: ${token}`);
  }
  // Seth's decision (OQ-2): deny known map hosts ONLY. An allow-list of video providers
  // silently rejects self-hosted and regional tools, trading this dead end for a new one.
  if (/ALLOWED_(CONFERENCING|VIDEO|MEETING)_HOSTS/.test(validationCode)) {
    failures.push(
      "an allow-list of conferencing providers was introduced — Seth's OQ-2 decision is " +
        "deny-known-map-hosts ONLY; an allow-list rejects self-hosted and regional tools",
    );
  }

  // ── S3 co-requisite: the consumer card's Online badge ───────────────────────────
  // Seth (OQ-1): the badge is a HARD CO-REQUISITE of the carve-out, not a follow-up.
  // Without it every market's grid gains cards with a blank location line.
  const cardCode = tsCode(card);
  for (const token of [
    "const isOnlineEvent",
    'data.format === "online"',
    // Anchored on the JSX attribute, NOT the bare token: `styles.onlineBadgeText`
    // contains `styles.onlineBadge` as a substring, so a bare check would stay green
    // after the badge View lost its style. (Caught by the self-test, mutation 23.)
    "style={styles.onlineBadge}",
  ]) {
    if (!cardCode.includes(token))
      failures.push(
        `BusinessEventCard lost the Online badge (${token}) — it is a co-requisite of the ` +
          `discovery carve-out, not a follow-up`,
      );
  }

  return failures;
}

const sources = {
  publishMig: read(
    "supabase/migrations/20270427002333_issue_2333_publish_online_city_optional.sql",
  ),
  patchMig: read(
    "supabase/migrations/20270427002334_issue_2333_patch_taxonomy_online_city_optional.sql",
  ),
  discoverMig: read(
    "supabase/migrations/20270427002335_issue_2333_discover_online_carveout.sql",
  ),
  guards: read("mingla-business/src/utils/paidPublishGuards.ts"),
  wizard: read("mingla-business/src/components/event/EventCreatorWizard.tsx"),
  editor: read("mingla-business/src/components/event/EditPublishedScreen.tsx"),
  validation: read("mingla-business/src/utils/draftEventValidation.ts"),
  card: read("app-mobile/src/components/discover/BusinessEventCard.tsx"),
  retryLieOccurrences: walkSourceFiles(path.join(root, "mingla-business/src"))
    .flatMap((absolute) => {
      const relative = path.relative(root, absolute);
      return tsCode(fs.readFileSync(absolute, "utf8")).includes(RETRY_LIE)
        ? [relative]
        : [];
    })
    .sort(),
};

if (process.argv.includes("--self-test")) {
  const good = check(sources);
  const mutations = [
    // The is_online trap, at each of the three sites it can be introduced.
    {
      ...sources,
      publishMig: sources.publishMig.replace(
        "IF v_city IS NULL AND v_format IS DISTINCT FROM 'online' THEN",
        "IF v_city IS NULL AND (p_draft_payload->>'is_online') IS DISTINCT FROM 'true' THEN",
      ),
    },
    {
      ...sources,
      patchMig: sources.patchMig.replace(
        "lower(btrim(\n       COALESCE(v_event.theme->'business_event'->>'format', ''),",
        "v_event.is_online IS NOT TRUE",
      ),
    },
    {
      ...sources,
      discoverMig: sources.discoverMig.replace(
        "e.is_online IS TRUE\n              AND lower(btrim(\n                COALESCE(e.theme->'business_event'->>'format', ''),",
        "e.is_online IS TRUE",
      ),
    },
    // Losing the carve-out entirely.
    {
      ...sources,
      discoverMig: sources.discoverMig.replace(
        "AND lower(btrim(\n                COALESCE(e.theme->'business_event'->>'format', ''),",
        "",
      ),
    },
    // Widening location by deleting an unrelated predicate.
    {
      ...sources,
      discoverMig: sources.discoverMig.replace("AND e.visibility = 'public'", ""),
    },
    {
      ...sources,
      discoverMig: sources.discoverMig.replace(
        "AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)",
        "",
      ),
    },
    // A DROP that would revoke the grants.
    {
      ...sources,
      discoverMig:
        "DROP FUNCTION IF EXISTS public.pg_discover_business_events(text[]);\n" +
        sources.discoverMig,
    },
    // Theme durability.
    {
      ...sources,
      publishMig: sources.publishMig.replace(
        "theme = (v_theme - 'business_draft') || jsonb_build_object(",
        "theme = jsonb_build_object(",
      ),
    },
    {
      ...sources,
      publishMig: sources.publishMig.replace(
        "        - 'city'          -- ORCH-0824: promoted to city column",
        "        - 'city'\n        - 'format'",
      ),
    },
    // The retry lie coming back.
    {
      ...sources,
      wizard: sources.wizard.replace(
        "handleShowToast(describeUnmappedPublishGuard(code));",
        `handleShowToast("${RETRY_LIE}");`,
      ),
    },
    { ...sources, guards: sources.guards.replace("export const describeUnmappedPublishGuard", "const describeUnmappedPublishGuard") },
    {
      ...sources,
      guards: sources.guards.replace(
        'console.error("[#2333] unmapped publish guard", s);',
        "",
      ),
    },
    {
      ...sources,
      guards: sources.guards.replace(
        "const UNMAPPED_GUARD_TOKEN_SHAPE = /^[a-z][a-z0-9_]{2,63}$/",
        "const UNMAPPED_GUARD_TOKEN_SHAPE = /city_required/",
      ),
    },
    // city_required mapping.
    {
      ...sources,
      guards: sources.guards.replace(
        "if (/(?:^|[^a-z0-9_])city_required(?:$|[^a-z0-9_])/.test(s)) {",
        "",
      ),
    },
    {
      ...sources,
      guards: sources.guards.replace(
        'export type PaidPublishGuardReason =\n  | "stripe_charges_disabled"',
        'export type PaidPublishGuardReason =\n  | "city_required"\n  | "stripe_charges_disabled"',
      ),
    },
    {
      ...sources,
      wizard: sources.wizard.replace('case "edit_where":', 'case "edit_nowhere":'),
    },
    {
      ...sources,
      wizard: sources.wizard.replace(
        "const exhaustive: never = guardCopy.action;",
        "const exhaustive = guardCopy.action;",
      ),
    },
    // Edit-screen copy going unconditional again.
    {
      ...sources,
      editor: sources.editor.replace('liveEvent.format === "online"', "false"),
    },
    {
      ...sources,
      editor: sources.editor.replace(
        ": describeUnmappedEditGuard(code);",
        ": describeUnmappedPublishGuard(code);",
      ),
    },
    {
      ...sources,
      retryLieOccurrences: [
        ...sources.retryLieOccurrences,
        "mingla-business/src/components/event/FakeRetryLie.tsx",
      ].sort(),
    },
    // The map deny.
    { ...sources, validation: sources.validation.replace("isMapLocationUrl(d.onlineUrl)", "false") },
    { ...sources, validation: sources.validation.replace('"maps.apple.com",', "") },
    {
      ...sources,
      validation:
        sources.validation + "\nconst ALLOWED_CONFERENCING_HOSTS = ['zoom.us'];\n",
    },
    // The consumer badge — the S3 co-requisite.
    { ...sources, card: sources.card.replace("const isOnlineEvent", "const unusedFlag") },
    { ...sources, card: sources.card.replace('data.format === "online"', "data.venueName === null") },
    { ...sources, card: sources.card.replace("styles.onlineBadge", "styles.infoChipVenue") },
  ];
  const undetected = mutations.filter((m) => check(m).length === 0);
  if (good.length || undetected.length) {
    console.error("issue-2333 self-test FAIL", { good, undetected: undetected.length });
    process.exit(1);
  }
  console.log(
    "issue-2333 self-test PASS: clean sources pass; every is_online-trap, theme-durability, " +
      "retry-lie, guard-mapping, map-deny and Online-badge revert fails.",
  );
  process.exit(0);
}

const failures = check(sources);
if (failures.length) {
  console.error(
    "issue-2333-online-event-publish FAIL:\n" + failures.map((f) => `  - ${f}`).join("\n"),
  );
  process.exit(1);
}
console.log("issue-2333-online-event-publish PASS.");
