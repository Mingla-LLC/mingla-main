#!/usr/bin/env node
/**
 * issue #2291 — the empty-marketing-send guard, and the constraint that backs it.
 * Invariant: I-2291-NO-EMPTY-MARKETING-SEND.
 *
 * WHAT SHIPPED, AND WHY A GATE. `sendEmail` in `marketing-send` read
 * `body_html ?? ""` and `subject ?? ""` and carried straight on. Nothing
 * upstream refused an empty email — not the DB CHECK, not a trigger (none
 * exist), not `mkt_claim_campaigns`, not `biz_confirm_marketing_book_send_v1`,
 * not the renderer, not the Resend adapter — and cron
 * `orch_0815_b_marketing_send` dispatches whatever is `scheduled` every minute
 * under the service role, with no human in the loop. The identical guard for
 * SMS (`sms_body_empty`) had existed ten lines away the whole time.
 *
 * This gate exists because the failure mode is INVISIBLE: delete the two throws
 * and every other test in the repository still passes, the function still
 * compiles, still deploys, still sends — it just sends nothing, to real
 * customers. There is no symptom until an inbox receives a blank email.
 *
 * REQUIRE, in `supabase/functions/marketing-send/index.ts` (comments stripped):
 *   1. `throw new Error("email_body_empty")` exists.
 *   2. `throw new Error("email_subject_empty")` exists. Seth's call on #2291:
 *      a blank subject line is its own deliverability and trust failure, and
 *      the DB constraint deliberately does NOT enforce subject (nine live
 *      drafts carry a blank one), so DISPATCH is the only place it is caught.
 *   3. `throw new Error("sms_body_empty")` still exists — the guard the email
 *      one mirrors. Losing it would re-open the same hole on the other channel.
 *   4. Both email throws sit AFTER the `body_html` read and BEFORE the first
 *      `marketing_messages` INSERT. Placement is the contract: a refused
 *      campaign must write zero message rows and issue zero provider HTTP. A
 *      guard moved below the insert still throws and still reads green to a
 *      naive presence check, while leaving orphan rows and a partial send.
 *
 * REQUIRE, in the #2291 migration:
 *   5. `marketing_campaigns_payload_content_required` is added `NOT VALID`.
 *      Eleven live draft rows violate it and are user data.
 *   6. Its predicate is wrapped in `coalesce(`. THIS IS THE WHOLE CONSTRAINT.
 *      Without it the predicate returns SQL NULL — which a CHECK treats as
 *      PASS — for every payload MISSING a key, including the exact
 *      `{kind:"email", body:"…"}` shape #2291 was filed about. The SPEC
 *      specified it uncoalesced; measured against production, it accepted the
 *      issue's own payload.
 *   7. Its predicate mentions `status` — the DRAFT EXEMPTION, a decided
 *      amendment on #2291. A draft may be empty; that is how writing a campaign
 *      starts, and all 11 live violators are drafts created by autosave. Drop
 *      the exemption and composer autosave of a NEW draft fails with
 *      `check_violation`, which gets the whole constraint reverted — and then
 *      there is neither the constraint nor the exemption. Pinned here so the
 *      trade-off is re-argued rather than quietly undone. Note the exemption
 *      costs nothing: the predicate is evaluated against the row an UPDATE
 *      would PRODUCE, so the draft -> scheduled transition on an empty campaign
 *      is still refused by the database.
 *
 * BAN, across `supabase/migrations/`:
 *   8. `VALIDATE CONSTRAINT marketing_campaigns_payload_content_required`.
 *      Validating would fail on eleven live rows and, worse, would strand
 *      eleven operators inside drafts they can no longer save.
 *
 * `--self-test` drives the pure core with fixtures. Exit 0 clean / 1 violation.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const SEND = "supabase/functions/marketing-send/index.ts";
const MIGRATIONS_DIR = "supabase/migrations";
const CONSTRAINT = "marketing_campaigns_payload_content_required";

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const stripSqlComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

const THROWS = [
  {
    id: "email_body_empty",
    re: /throw\s+new\s+Error\(\s*["']email_body_empty["']\s*\)/,
    why:
      'the email body guard. Without it an empty `body_html` is rendered and POSTed to Resend — a blank email in a paying customer\'s inbox, dispatched by the every-minute cron with no human in the loop',
  },
  {
    id: "email_subject_empty",
    re: /throw\s+new\s+Error\(\s*["']email_subject_empty["']\s*\)/,
    why:
      "the email subject guard. The DB constraint deliberately allows a blank subject at rest (nine live drafts carry one), so dispatch is the ONLY place a blank subject line is caught",
  },
  {
    id: "sms_body_empty",
    re: /throw\s+new\s+Error\(\s*["']sms_body_empty["']\s*\)/,
    why:
      "the SMS body guard that the email guards were modelled on. It predates #2291 and must not be lost with them",
  },
];

/** Pure core over a {relPath: content} map so --self-test can inject fixtures. */
export function checkEmptySendGuard(files, failures) {
  const rawSend = files[SEND];
  if (rawSend === undefined) {
    failures.push(`${SEND}: not found — this gate cannot verify the send guard (path out of sync).`);
  } else {
    const send = stripComments(rawSend);
    for (const { id, re, why } of THROWS) {
      if (!re.test(send)) {
        failures.push(`${SEND}: \`${id}\` is GONE. It is ${why} (#2291).`);
      }
    }

    // 4 — placement. Index-based: the first `marketing_messages` insert in file
    // order is the one inside sendEmail's recipient loop.
    const idxRead = send.search(/channel_payload\.body_html/);
    const idxInsert = send.search(
      /\.from\(\s*["']marketing_messages["']\s*\)[\s\S]{0,200}?\.insert\(/,
    );
    for (const id of ["email_body_empty", "email_subject_empty"]) {
      const idxThrow = send.search(
        new RegExp(`throw\\s+new\\s+Error\\(\\s*["']${id}["']\\s*\\)`),
      );
      if (idxThrow === -1) continue; // already reported above
      if (idxRead !== -1 && idxThrow < idxRead) {
        failures.push(
          `${SEND}: \`${id}\` fires BEFORE the payload is read. It cannot be guarding anything (#2291).`,
        );
      }
      if (idxInsert !== -1 && idxThrow > idxInsert) {
        failures.push(
          `${SEND}: \`${id}\` sits AFTER the first marketing_messages INSERT. A refused campaign must write ZERO message rows and issue ZERO provider requests — a guard below the insert leaves orphan rows and a partial send while still looking present (#2291).`,
        );
      }
    }
  }

  // 5 + 6 — the constraint that backs the guard.
  const migrations = Object.entries(files).filter(([rel]) =>
    rel.startsWith(MIGRATIONS_DIR + "/") && rel.endsWith(".sql")
  );
  const owner = migrations.find(([, raw]) =>
    new RegExp(`ADD\\s+CONSTRAINT\\s+${CONSTRAINT}`, "i").test(stripSqlComments(raw))
  );
  if (owner === undefined) {
    failures.push(
      `${MIGRATIONS_DIR}/: no migration adds \`${CONSTRAINT}\`. #2291's database half is gone.`,
    );
  } else {
    const [rel, raw] = owner;
    const sql = stripSqlComments(raw);
    const stmt = sql.slice(sql.search(new RegExp(`ADD\\s+CONSTRAINT\\s+${CONSTRAINT}`, "i")));
    const body = stmt.slice(0, stmt.indexOf(";") === -1 ? stmt.length : stmt.indexOf(";") + 1);
    if (!/NOT\s+VALID/i.test(body)) {
      failures.push(
        `${rel}: \`${CONSTRAINT}\` is not NOT VALID. Eleven live draft rows violate it and are user data — validating strands their owners inside drafts they can no longer save (#2291).`,
      );
    }
    if (!/coalesce\s*\(/i.test(body)) {
      failures.push(
        `${rel}: \`${CONSTRAINT}\`'s predicate has lost its \`coalesce(..., false)\`. Without it the CASE returns SQL NULL for a payload MISSING a key — and a CHECK treats NULL as SATISFIED — so the constraint silently accepts \`{"kind":"email"}\` and the exact \`{kind, subject, body}\` shape #2291 was filed about. The constraint becomes decorative (#2291).`,
      );
    }
    if (!/\bstatus\b/i.test(body)) {
      failures.push(
        `${rel}: \`${CONSTRAINT}\` has lost its DRAFT EXEMPTION (no \`status\` in the predicate). A draft must be allowed to be empty — that is how writing a campaign starts, and all 11 live violators are drafts autosave created. Without the exemption, composer autosave of a NEW draft fails with check_violation and this constraint gets reverted wholesale. The exemption costs nothing: the draft -> scheduled UPDATE is still checked (#2291).`,
      );
    }
  }

  // 7 — validating it is banned outright.
  for (const [rel, raw] of migrations) {
    if (new RegExp(`VALIDATE\\s+CONSTRAINT\\s+${CONSTRAINT}`, "i").test(stripSqlComments(raw))) {
      failures.push(
        `${rel}: VALIDATE CONSTRAINT ${CONSTRAINT} is banned. It fails on eleven live rows and strands their owners (#2291).`,
      );
    }
  }
}

function walk(dirAbs, out) {
  if (!fs.existsSync(dirAbs)) return;
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (files) => {
    const f = [];
    checkEmptySendGuard(files, f);
    return f;
  };

  const goodSend = `
async function sendEmail(supabase, campaign, options) {
  const resolved = await resolveAudience(supabase, audience.query_definition, campaign.id);
  const subject = campaign.channel_payload.subject ?? "";
  const bodyHtml = campaign.channel_payload.body_html ?? "";
  if (bodyHtml.trim().length === 0) throw new Error("email_body_empty");
  if (subject.trim().length === 0) throw new Error("email_subject_empty");
  for (const contact of resolved.rows) {
    const { error } = await supabase.from("marketing_messages").insert({ id: messageId });
  }
}
async function sendSms(supabase, campaign, options) {
  const rawBody = (campaign.channel_payload.body ?? "").trim();
  if (rawBody.length === 0) throw new Error("sms_body_empty");
}
`;
  const goodMigration = `
ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_payload_content_required CHECK (
    coalesce(
      CASE WHEN status = 'draft' THEN true
           ELSE CASE channel_payload->>'kind' WHEN 'email' THEN true ELSE false END
      END, false)
  ) NOT VALID;
`;
  const MIG = "supabase/migrations/20270425002291_issue_2291_campaign_payload_shape.sql";
  const good = { [SEND]: goodSend, [MIG]: goodMigration };
  if (run(good).length !== 0) {
    selfFailures.push("compliant fixture wrongly flagged: " + JSON.stringify(run(good)));
  }

  // 1 — each throw deleted, individually.
  for (const { id } of THROWS) {
    const gutted = {
      ...good,
      [SEND]: goodSend.replace(new RegExp(`\\s*if \\([^\\n]*throw new Error\\("${id}"\\);`), ""),
    };
    if (run(gutted).length === 0) selfFailures.push(`deleting ${id} was NOT flagged — this gate is decorative`);
  }

  // 2 — a COMMENTED-OUT guard must not count as present. This is the exact way
  // a fails-on-revert proof can lie, so the gate must see through it.
  const commentedOut = {
    ...good,
    [SEND]: goodSend.replace(
      'if (bodyHtml.trim().length === 0) throw new Error("email_body_empty");',
      '// if (bodyHtml.trim().length === 0) throw new Error("email_body_empty");',
    ),
  };
  if (run(commentedOut).length === 0) {
    selfFailures.push("a COMMENTED-OUT email_body_empty guard was accepted as present");
  }

  // 3 — the guard moved BELOW the first marketing_messages insert.
  const movedBelow = {
    ...good,
    [SEND]: `
async function sendEmail(supabase, campaign, options) {
  const subject = campaign.channel_payload.subject ?? "";
  const bodyHtml = campaign.channel_payload.body_html ?? "";
  for (const contact of resolved.rows) {
    const { error } = await supabase.from("marketing_messages").insert({ id: messageId });
    if (bodyHtml.trim().length === 0) throw new Error("email_body_empty");
    if (subject.trim().length === 0) throw new Error("email_subject_empty");
  }
}
function sendSms() { if (x) throw new Error("sms_body_empty"); }
`,
  };
  if (run(movedBelow).length === 0) {
    selfFailures.push("a guard moved BELOW the first marketing_messages INSERT was not flagged");
  }

  // 4 — the migration losing NOT VALID.
  const validated = { ...good, [MIG]: goodMigration.replace(" NOT VALID", "") };
  if (run(validated).length === 0) selfFailures.push("dropping NOT VALID was not flagged");

  // 5 — THE SPEC'S ORIGINAL BUG: the predicate without coalesce.
  const uncoalesced = {
    ...good,
    [MIG]: `
ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_payload_content_required CHECK (
    CASE WHEN status = 'draft' THEN true
         ELSE CASE channel_payload->>'kind' WHEN 'email' THEN true ELSE false END
    END
  ) NOT VALID;
`,
  };
  const uncoalescedFailures = run(uncoalesced);
  if (uncoalescedFailures.length === 0) {
    selfFailures.push("the uncoalesced (NULL-returning, therefore inert) predicate was not flagged");
  } else if (!uncoalescedFailures.some((f) => /coalesce/.test(f))) {
    // Isolation: the fixture keeps NOT VALID and the status arm, so the ONLY
    // thing wrong with it is the missing coalesce. If the failure that fires is
    // some other rule, this assertion is passing for the wrong reason.
    selfFailures.push(
      "the uncoalesced predicate was flagged, but NOT by the coalesce rule: " +
        JSON.stringify(uncoalescedFailures),
    );
  }

  // 5b — THE DRAFT EXEMPTION dropped. Isolated the same way: coalesce and
  // NOT VALID are intact, only `status` is gone.
  const noExemption = {
    ...good,
    [MIG]: `
ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_payload_content_required CHECK (
    coalesce(CASE channel_payload->>'kind' WHEN 'email' THEN true ELSE false END, false)
  ) NOT VALID;
`,
  };
  const noExemptionFailures = run(noExemption);
  if (noExemptionFailures.length === 0) {
    selfFailures.push("dropping the draft exemption was NOT flagged");
  } else if (!noExemptionFailures.some((f) => /DRAFT EXEMPTION/.test(f))) {
    selfFailures.push(
      "the missing draft exemption was flagged, but not by its own rule: " +
        JSON.stringify(noExemptionFailures),
    );
  }

  // 6 — the migration deleted entirely.
  const noMigration = { [SEND]: goodSend };
  if (run(noMigration).length === 0) selfFailures.push("a missing #2291 migration was not flagged");

  // 7 — someone VALIDATEs the constraint in a later migration.
  const validating = {
    ...good,
    "supabase/migrations/20270501000000_later.sql":
      "ALTER TABLE public.marketing_campaigns VALIDATE CONSTRAINT marketing_campaigns_payload_content_required;",
  };
  if (run(validating).length === 0) selfFailures.push("a later VALIDATE CONSTRAINT was not flagged");

  // 8 — SQL comments must not satisfy the requirements either.
  const sqlCommented = {
    ...good,
    [MIG]: goodMigration.split("\n").map((l) => "-- " + l).join("\n"),
  };
  if (run(sqlCommented).length === 0) {
    selfFailures.push("a fully commented-out migration was accepted as adding the constraint");
  }

  // 9 — ...and a migration may DISCUSS the ban in prose without tripping it.
  const prose = {
    ...good,
    [MIG]: goodMigration +
      "\n-- Do NOT run VALIDATE CONSTRAINT marketing_campaigns_payload_content_required.\n",
  };
  if (run(prose).length !== 0) {
    selfFailures.push("prose explaining the ban was wrongly flagged: " + JSON.stringify(run(prose)));
  }

  // 10 — the send file vanishing must fail loudly, never silently pass.
  if (run({ [MIG]: goodMigration }).length === 0) {
    selfFailures.push("a missing marketing-send/index.ts read as compliant");
  }

  // 11 — P-vacuous: an empty file map discovers nothing and must FAIL.
  if (run({}).length === 0) {
    selfFailures.push("an EMPTY file map passed — matched-nothing-therefore-green");
  }

  if (selfFailures.length) {
    console.error("#2291 marketing-empty-send-guard self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "#2291 marketing-empty-send-guard self-test PASS (12 cases: each of the three\n" +
      "  throws deleted, a commented-out guard, a guard moved below the first\n" +
      "  marketing_messages INSERT, NOT VALID dropped, the SPEC's uncoalesced\n" +
      "  NULL-returning predicate and the dropped draft exemption (both isolated to\n" +
      "  their own rule), the migration deleted, a later VALIDATE\n" +
      "  CONSTRAINT, a fully commented-out migration, prose about the ban, a\n" +
      "  missing send file, and the empty-map vacuity check).",
  );
  process.exit(0);
}

// ---- Live mode
const files = {};
const sendAbs = path.join(root, SEND);
if (fs.existsSync(sendAbs)) files[SEND] = fs.readFileSync(sendAbs, "utf8");
const migAbs = [];
walk(path.join(root, MIGRATIONS_DIR), migAbs);
for (const abs of migAbs) {
  if (!abs.endsWith(".sql")) continue;
  files[path.relative(root, abs)] = fs.readFileSync(abs, "utf8");
}

const failures = [];
checkEmptySendGuard(files, failures);

if (failures.length > 0) {
  console.error(
    "#2291 (I-2291-NO-EMPTY-MARKETING-SEND) FAIL — an empty marketing message must be\n" +
      "impossible to dispatch, from any origin, and the constraint behind that guard must\n" +
      "stay NOT VALID and non-decorative.\n\nFailures:\n  " + failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "#2291 PASS — email body + subject guards present, ahead of the first message row;\n" +
    "sms guard intact; the content constraint is NOT VALID, coalesced, draft-exempt,\n" +
    "and never validated.",
);
