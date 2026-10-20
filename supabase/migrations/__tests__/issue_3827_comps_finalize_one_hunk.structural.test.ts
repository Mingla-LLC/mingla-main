/**
 * issue #3827 — guest-list comps: structural pins on the re-emitted functions.
 *
 *   (a) issue_1930_ticket_checkout_finalize_base changed by ONE hunk only: the
 *       per-ticket mint became a call to issue_3827_mint_ticket (plus the local
 *       that holds its result). Everything else is byte-identical to
 *       20271121003281.
 *   (b) issue_3827_mint_ticket's body IS the block that left finalize.
 *   (c) biz_guest_roster_project changed by its two additive guestList hunks only.
 *   (d) I-3827-ONE-MINT: no other latest function body mints a QR into tickets.
 *   (e) I-3827-MANUAL-ADMIT-ONE-LADDER: the admit delegates to biz_ticket_scan
 *       and never writes scan_events or tickets itself.
 */
// MINGLA-INVARIANT: I-3827-ONE-MINT | issue #3827 | every ticket QR is minted by issue_3827_mint_ticket
// MINGLA-INVARIANT: I-3827-MANUAL-ADMIT-ONE-LADDER | issue #3827 | a manual admit writes scan_events only through biz_ticket_scan
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const DIR = "supabase/migrations";
const MINE = `${DIR}/20271128013827_issue_3827_guest_list_comps.sql`;
const R2 = `${DIR}/20271121003281_issue_3281_r2_checkout_units.sql`;
const ROSTER = `${DIR}/20270319000873_issue_0873_guest_status_roster.sql`;

/** Every function definition in a file: name -> body text (definition through its closing dollar tag). */
function definitions(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?([A-Za-z0-9_]+)"?\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = head.exec(sql)) !== null) {
    const start = match.index;
    const asTag = /\bAS\s+(\$[A-Za-z0-9_]*\$)/g;
    asTag.lastIndex = start;
    const tag = asTag.exec(sql);
    if (tag === null) continue;
    const bodyStart = tag.index + tag[0].length;
    const end = sql.indexOf(tag[1], bodyStart);
    if (end < 0) continue;
    out.set(match[1].toLowerCase(), sql.slice(start, end + tag[1].length));
    head.lastIndex = end + tag[1].length;
  }
  return out;
}

function one(sql: string, name: string): string {
  const body = definitions(sql).get(name);
  assert(body !== undefined, `${name} not found`);
  return body;
}

const OLD_MINT_START = "      v_ticket_id := gen_random_uuid();\n      v_token := replace(";
const OLD_MINT_END = "        ), 1)\n      );\n";
const NEW_MINT_START = "      -- issue #3827 — THE ONE MINT.";
const NEW_MINT_END = "      v_qr := v_mint ->> 'qrPayload';\n";
const DECLARE_HUNK = "  -- issue #3827 — the mint helper's result.\n  v_mint jsonb;\n";

function cut(text: string, startMarker: string, endMarker: string): { before: string; block: string; after: string } {
  const i = text.indexOf(startMarker);
  assert(i >= 0, `start marker missing: ${startMarker.slice(0, 40)}`);
  const j = text.indexOf(endMarker, i);
  assert(j >= 0, `end marker missing: ${endMarker.slice(0, 40)}`);
  const k = j + endMarker.length;
  return { before: text.slice(0, i), block: text.slice(i, k), after: text.slice(k) };
}

Deno.test("#3827 (a) finalize differs from 20271121003281 by the mint hunk only", async () => {
  const before = one(await Deno.readTextFile(R2), "issue_1930_ticket_checkout_finalize_base");
  const after = one(await Deno.readTextFile(MINE), "issue_1930_ticket_checkout_finalize_base");
  const o = cut(before, OLD_MINT_START, OLD_MINT_END);
  const n = cut(after.replace(DECLARE_HUNK, ""), NEW_MINT_START, NEW_MINT_END);
  assertEquals(n.before, o.before, "finalize changed above the mint hunk");
  assertEquals(n.after, o.after, "finalize changed below the mint hunk");
  assert(after.includes(DECLARE_HUNK));
  assert(n.block.includes("public.issue_3827_mint_ticket("));
  assert(!n.block.includes("INSERT INTO public.tickets"));
});

Deno.test("#3827 (b) the mint helper body is the block that left finalize", async () => {
  const before = one(await Deno.readTextFile(R2), "issue_1930_ticket_checkout_finalize_base");
  const helper = one(await Deno.readTextFile(MINE), "issue_3827_mint_ticket");
  const old = cut(before, OLD_MINT_START, OLD_MINT_END).block;
  // Same statements once the finalize locals become the helper's parameters
  // and the six-space loop indent becomes the two-space function indent.
  const expected = old
    .split("\n")
    .map((line) => line.replace(/^ {4}/, ""))
    .join("\n")
    .replaceAll("v_qr_token_pepper", "p_qr_token_pepper")
    .replaceAll("v_item.ticket_type_id", "p_ticket_type_id")
    .replaceAll("v_order_id", "p_order_id")
    .replace(
      "v_ticket_id, p_order_id, p_ticket_type_id, v_session.event_id,\n    v_session.buyer_name, v_session.buyer_email, v_session.buyer_phone_e164,\n    v_qr, v_token_hash, 'valid', 'auto', v_now, v_now,",
      "v_ticket_id, p_order_id, p_ticket_type_id, p_event_id,\n    p_attendee_name, p_attendee_email, p_attendee_phone,\n    v_qr, v_token_hash, 'valid', 'auto', p_now, p_now,",
    );
  assert(helper.includes(expected.trimEnd()), "issue_3827_mint_ticket no longer holds the finalize mint block verbatim");
});

Deno.test("#3827 (c) biz_guest_roster_project changed by its guestList hunks only", async () => {
  const before = one(await Deno.readTextFile(ROSTER), "biz_guest_roster_project");
  const after = one(await Deno.readTextFile(MINE), "biz_guest_roster_project");
  const stripped = after
    .replace("    COALESCE(commerce.comp_active_tickets,0) AS comp_active_tickets,\n", "")
    .replace(
      "      count(t.id) FILTER (WHERE o.source='comp' AND o.payment_status IN ('paid','partial_refund') AND t.status IN ('valid','used'))::integer AS comp_active_tickets,\n",
      "",
    )
    .replace(
      "    'isExportable',c.person_id IS NOT NULL,\n    'guestList',(c.active_tickets>0 AND c.comp_active_tickets=c.active_tickets)\n",
      "    'isExportable',c.person_id IS NOT NULL\n",
    )
    .replace(
      "'isExportable',false,\n    'guestList',o.source='comp'\n",
      "'isExportable',false\n",
    );
  assertEquals(stripped, before);
});

Deno.test("#3827 (d) I-3827-ONE-MINT: only issue_3827_mint_ticket mints a QR into tickets", async () => {
  const latest = new Map<string, string>();
  const files = [...Deno.readDirSync(DIR)].filter((e) => e.isFile && e.name.endsWith(".sql")).map((e) => e.name).sort();
  for (const file of files) {
    for (const [name, body] of definitions(await Deno.readTextFile(`${DIR}/${file}`))) latest.set(name, body);
  }
  const minters = [...latest]
    .filter(([, body]) => body.includes("biz_ticket_checkout_qr_payload(") && /INSERT\s+INTO\s+public\.tickets/i.test(body))
    .map(([name]) => name)
    .sort();
  assertEquals(minters, ["issue_3827_mint_ticket"]);
});

Deno.test("#3827 (e) I-3827-MANUAL-ADMIT-ONE-LADDER: the admit is biz_ticket_scan", async () => {
  const admit = one(await Deno.readTextFile(MINE), "biz_ticket_admit_by_id");
  assert(admit.includes("public.biz_ticket_scan(p_event_id, v_ticket.qr_code, p_actor_id, p_qr_token_pepper)"));
  assert(!/INSERT\s+INTO\s+public\.scan_events/i.test(admit));
  assert(!/UPDATE\s+public\.tickets/i.test(admit));
});
