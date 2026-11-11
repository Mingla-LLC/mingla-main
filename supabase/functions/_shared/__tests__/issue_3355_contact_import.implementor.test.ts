// Issue #3355 — contact-list import through Ari (implementor happy path +
// adversarial). Drives the shipped parser (ariFlows/contactList.ts), the
// shipped flow (ariFlows/contactImport.ts) through the shipped runner and
// decideFlowTurn, and the shipped confirmed write (ariContactImportWrite.ts)
// with a fake contact-import that behaves like #1775's.
//
// MINGLA-INVARIANT: I-ARI-CONTACT-IMPORT-ONE-PATH | issue #3355 | Ari imports a contact list only through the existing contact import (#1775): the flow stages the list with its inspect/preview and the confirmed write runs its execute. Ari never writes Brand People rows for an import itself.
// MINGLA-INVARIANT: I-ARI-CONTACT-IMPORT-NO-INVENTED-CONSENT | issue #3355 | An import carries the owner's permission only after they chose "Yes, they agreed" and confirmed the protected card; "No, or I'm not sure" imports nothing.
// MINGLA-INVARIANT: I-ARI-CONTACT-IMPORT-NEVER-SILENT-DROP | issue #3355 | Every row Ari leaves out or changes (no phone or email, unreadable phone, duplicate) is listed to the owner in plain words.
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_contact_import.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { runFlowStep, type RunnerOutcome } from "../ariFlows/runner.ts";
import type { FlowStore } from "../ariFlows/store.ts";
import type {
  ContactImportCounts,
  ContactImportPreview,
  ContactImportStatus,
  FlowAnswer,
  FlowArtefact,
  FlowProbeDeps,
  FlowRun,
  FlowStepRecord,
} from "../ariFlows/types.ts";
import { ContactImportRefused } from "../ariFlows/types.ts";
import { findFlowDefinition } from "../ariFlows/index.ts";
import {
  contactListCsv,
  contactPhone,
  parseContactList,
} from "../ariFlows/contactList.ts";
import {
  CONTACT_LIST_STEP,
  CONTACT_REVIEW_STEP,
  IMPORT_CONTACTS_FLOW_KEY,
  isContactImportIntent,
} from "../ariFlows/contactImport.ts";
import {
  contactListFromFiles,
  decideFlowTurn,
  startFlowFromTool,
  flowChoices,
} from "../ariFlows/edge.ts";
import {
  ARI_CONTACT_CSV_MAPPING,
  executeAriContactImport,
} from "../ariContactImportWrite.ts";
import { renderContactImportAttestation } from "../contactImportContract.ts";
import { buildProposalPresentation } from "../ariPresentation/registry.ts";
import { verifiedProposalArgs } from "../agentTicketPricing.ts";
import { ownerCopyViolations } from "../ariOwnerCopy.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";

const BRAND = "22222222-2222-4222-8222-222222222222";
const CHAT = "33333333-3333-4333-8333-333333333333";
const BATCH = "55555555-5555-4555-8555-555555555555";
const OP = "44444444-4444-4444-8444-444444444444";
const BRAND_NAME = "Coastline Collective";
const SHA = "a".repeat(64);
const TOKEN = "preview-token-preview-token-123";

class MemoryStore implements FlowStore {
  runs = new Map<string, FlowRun & { token: string | null }>();
  patches: Array<Record<string, unknown>> = [];
  start(args: Parameters<FlowStore["start"]>[0]) {
    const run = {
      id: crypto.randomUUID(),
      brand_id: args.brandId,
      flow_key: args.flowKey,
      flow_version: args.flowVersion,
      concurrency: args.concurrency,
      subject_id: null,
      conversation_id: args.conversationId,
      status: "active" as const,
      current_step_key: null,
      current_question_id: null,
      current_pending_action_id: null,
      current_artefact: null,
      step_states: {},
      answers: (args.answers ?? {}) as FlowRun["answers"],
      session_skips: [],
      revision: 1,
      started_by_me: true,
      started_by_name: "Ada Owner",
      lease_held: false,
      lease_held_by_me: false,
      lease_owner_name: null,
      token: null,
    };
    this.runs.set(run.id, run);
    return Promise.resolve({
      created: true,
      owned_by_other: false,
      owner_display_name: null,
      run: this.view(run),
    });
  }
  private view(run: FlowRun & { token: string | null }): FlowRun {
    const { token: _token, ...rest } = structuredClone(run);
    return rest;
  }
  lease(runId: string, token: string) {
    const run = this.runs.get(runId)!;
    if (["completed", "cancelled", "expired"].includes(run.status)) {
      return Promise.resolve({
        ok: false,
        reason: "terminal" as const,
        owner_display_name: null,
        run: this.view(run),
      });
    }
    run.token = token;
    return Promise.resolve({
      ok: true,
      reason: null,
      owner_display_name: null,
      run: this.view(run),
    });
  }
  advance(
    runId: string,
    token: string,
    rev: number,
    patch: Record<string, unknown>,
  ) {
    const run = this.runs.get(runId)!;
    if (run.token !== token) return Promise.reject(new Error("lease"));
    if (rev !== run.revision) return Promise.reject(new Error("revision"));
    const states = (patch.step_states ?? {}) as Record<string, FlowStepRecord>;
    for (const [key, value] of Object.entries(states)) {
      if (
        value.state === "done" &&
        (!value.evidence?.probe || !("observed" in value.evidence))
      ) {
        return Promise.reject(new Error(`flow_evidence_required:${key}`));
      }
    }
    if (
      patch.status === "completed" &&
      !(patch.completion_evidence as { probe?: string } | undefined)?.probe
    ) {
      return Promise.reject(new Error("flow_evidence_required:completion"));
    }
    this.patches.push(structuredClone(patch));
    Object.assign(run, {
      ...patch,
      step_states: { ...run.step_states, ...states },
      answers: { ...run.answers, ...(patch.answers as object ?? {}) },
      revision: run.revision + 1,
    });
    return Promise.resolve(this.view(run));
  }
  release(runId: string, token: string) {
    const run = this.runs.get(runId)!;
    if (run.token === token) run.token = null;
    return Promise.resolve();
  }
  getForConversation(conversationId: string) {
    const run = [...this.runs.values()].find((r) =>
      r.conversation_id === conversationId
    );
    return Promise.resolve(run ? this.view(run) : null);
  }
  getById(runId: string) {
    const run = this.runs.get(runId);
    return Promise.resolve(run ? this.view(run) : null);
  }
}

// ── A fake #1775 contact import (same outcomes, same counts) ────────────────
interface Person {
  name: string;
  email: string | null;
  phone: string | null;
}

interface StagedRow {
  row_number: number;
  name: string;
  email: string | null;
  phone: string | null;
  outcome: string;
  person: number | null;
}

class FakeImport {
  people: Person[] = [];
  staged: StagedRow[] = [];
  previews = 0;
  csvs: string[] = [];
  executions: Array<Record<string, unknown>> = [];
  executed: ContactImportCounts | null = null;
  flag = true;
  refusePreview: string | null = null;
  refuseExecute: string | null = null;

  private cells(line: string): string[] {
    return [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) =>
      m[1].replaceAll('""', '"')
    );
  }

  private match(email: string | null, phone: string | null): number[] {
    const found = new Set<number>();
    this.people.forEach((person, index) => {
      if (email && person.email === email) found.add(index);
      if (phone && person.phone === phone) found.add(index);
    });
    return [...found];
  }

  private counts(rows: StagedRow[]): ContactImportCounts {
    const n = (o: string) => rows.filter((r) => r.outcome === o).length;
    return {
      rowCount: rows.length,
      addedCount: n("added"),
      updatedCount: n("updated"),
      reviewCount: n("review"),
      invalidCount: n("invalid"),
      duplicateCount: n("duplicate"),
      unchangedCount: n("unchanged"),
      alreadySuppressedCount: 0,
    };
  }

  preview(csv: string): Promise<ContactImportPreview> {
    this.previews += 1;
    this.csvs.push(csv);
    if (this.refusePreview) {
      return Promise.reject(
        new ContactImportRefused(this.refusePreview, this.refusePreview),
      );
    }
    const [header, ...lines] = csv.split("\n");
    assertEquals(header, "Name,Email,Phone");
    this.staged = lines.map((line, i) => {
      const [name, email, phone] = this.cells(line);
      const hits = this.match(email || null, phone || null);
      let outcome = "added";
      let person: number | null = null;
      if (hits.length > 1) outcome = "review";
      else if (hits.length === 1) {
        person = hits[0];
        const existing = this.people[person];
        if (name && existing.name.toLowerCase() !== name.toLowerCase()) {
          outcome = "review";
        } else {
          outcome = (email && existing.email !== email) ||
              (phone && existing.phone !== phone)
            ? "updated"
            : "unchanged";
        }
      }
      return {
        row_number: i + 2,
        name,
        email: email || null,
        phone: phone || null,
        outcome,
        person,
      };
    });
    return Promise.resolve({
      batch_id: BATCH,
      preview_token: TOKEN,
      file_sha256: SHA,
      counts: this.counts(this.staged),
      rows: this.staged.map((r) => ({
        row_number: r.row_number,
        outcome: r.outcome,
        reason: null,
      })),
    });
  }

  execute(body: Record<string, unknown>): Record<string, unknown> {
    this.executions.push(body);
    for (const row of this.staged) {
      if (row.outcome === "added") {
        this.people.push({ name: row.name, email: row.email, phone: row.phone });
      } else if (row.outcome === "updated" && row.person !== null) {
        const p = this.people[row.person];
        p.email = p.email ?? row.email;
        p.phone = p.phone ?? row.phone;
      }
    }
    this.executed = this.counts(this.staged);
    return { batchId: BATCH, state: "completed", counts: this.executed };
  }

  status(id: string): Promise<ContactImportStatus | null> {
    if (id !== BATCH || !this.executed) {
      return Promise.resolve(
        this.staged.length
          ? { batch_id: id, state: "previewed", counts: this.counts(this.staged) }
          : null,
      );
    }
    return Promise.resolve({
      batch_id: id,
      state: "completed",
      counts: this.executed,
    });
  }

  /** The user client the confirmed write invokes (functions.invoke). */
  client() {
    // deno-lint-ignore no-this-alias
    const world = this;
    return {
      from(table: string) {
        assertEquals(table, "brands");
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({ data: { name: BRAND_NAME }, error: null }),
        };
        return chain;
      },
      functions: {
        invoke(name: string, init: { body: Record<string, unknown> }) {
          assertEquals(name, "contact-import");
          if (world.refuseExecute) {
            const code = world.refuseExecute;
            return Promise.resolve({
              data: null,
              error: {
                name: "FunctionsHttpError",
                context: {
                  json: () =>
                    Promise.resolve({
                      ok: false,
                      error: { code, message: "x" },
                    }),
                },
              },
            });
          }
          return Promise.resolve({
            data: { ok: true, data: world.execute(init.body) },
            error: null,
          });
        },
      },
    };
  }

  probes(country: string | null = "NG", openProposal = () => false): FlowProbeDeps {
    return {
      readiness: () => Promise.reject(new Error("not used")),
      subjectExists: () => Promise.resolve(false),
      setAside: () => Promise.resolve("brand"),
      hasOpenProposal: () => Promise.resolve(openProposal()),
      brandFacts: () =>
        Promise.resolve({
          default_timezone: null,
          country_code: country,
          default_currency: null,
        }),
      featureFlag: (key) => Promise.resolve(key === "contact_import_v1" && this.flag),
      contactImportPreview: (csv) => this.preview(csv),
      contactImportStatus: (id) => this.status(id),
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
async function start(store: MemoryStore): Promise<FlowRun> {
  const def = findFlowDefinition(IMPORT_CONTACTS_FLOW_KEY)!;
  return (await store.start({
    brandId: BRAND,
    flowKey: def.key,
    flowVersion: def.version,
    concurrency: def.concurrency,
    conversationId: CHAT,
    answers: {},
  })).run;
}

async function cur(store: MemoryStore): Promise<FlowRun> {
  return (await store.getForConversation(CHAT))!;
}

function choice(run: FlowRun, id: string): FlowAnswer {
  return {
    run_id: run.id,
    step_key: run.current_step_key!,
    question_id: run.current_question_id!,
    choice_id: id,
    display_text: run.current_artefact?.options.find((o) => o.id === id)
      ?.label ?? id,
  };
}

function pasted(run: FlowRun, response: string): FlowAnswer {
  return {
    run_id: run.id,
    step_key: run.current_step_key!,
    question_id: run.current_question_id!,
    choice_id: "answer",
    display_text: "my list",
    values: { choices: [], country: null, response },
  };
}

const SEEN: string[] = [];
function seen(outcome: RunnerOutcome): RunnerOutcome {
  if ("text" in outcome && typeof outcome.text === "string") {
    SEEN.push(outcome.text);
  }
  const artefact = (outcome as { artefact?: FlowArtefact | null }).artefact;
  if (artefact) {
    SEEN.push(artefact.title, artefact.text);
    artefact.options.forEach((o) => SEEN.push(o.label));
  }
  if (outcome.kind === "propose") {
    outcome.rows.forEach((r) => SEEN.push(r.label, r.value));
    if (outcome.card_title) SEEN.push(outcome.card_title);
  }
  return outcome;
}

async function step(
  store: MemoryStore,
  world: FakeImport,
  input: Partial<Parameters<typeof runFlowStep>[1]> = {},
  country: string | null = "NG",
): Promise<RunnerOutcome> {
  const run = input.run ?? await cur(store);
  return seen(
    await runFlowStep({ store, probes: world.probes(country) }, {
      run,
      trigger: "turn",
      brandName: BRAND_NAME,
      ...input,
    }),
  );
}

/** Paste, review, import, confirm: the whole happy path. */
async function importAll(
  store: MemoryStore,
  world: FakeImport,
  list: string,
  country: string | null = "NG",
) {
  await start(store);
  const ask = await step(store, world, {}, country);
  assertEquals(ask.kind, "artefact");
  const review = await step(store, world, {
    trigger: "answer",
    answer: pasted(await cur(store), list),
  }, country);
  assertEquals(review.kind, "artefact");
  const propose = await step(store, world, {
    trigger: "answer",
    answer: choice(await cur(store), "import"),
  }, country);
  assertEquals(propose.kind, "propose");
  if (propose.kind !== "propose") throw new Error("no proposal");
  const write = DOMAIN_TOOLS.find((t) => t.name === "manage_brand_people")!;
  const result = await write.executor(
    propose.tool_args,
    world.client() as never,
    "user-1",
    { operationId: OP },
  );
  const done = await step(store, world, {
    trigger: "confirm",
    confirmed: { tool_name: "manage_brand_people", result },
  }, country);
  return { review, propose, result, done };
}

const MIXED_CSV = [
  "Full Name,E-mail,Mobile",
  "Ada Obi,ADA@obi-mail.co,0803 123 4567",
  "Tunde Bello,tunde@bello.ng,+234 (0) 805 222 3333",
  "Jane Smith,jane@smith.co.uk,+44 7700 900123",
  "Kola Ade,kola@ade.ng,2348051112222",
  "Mary Lee,mary@lee.co.uk,(+44) 7700-900-456",
  "No Contact,,",
  "Bad Phone,bad@phone.co,12345",
  "Ada Obi,ada@obi-mail.co,",
].join("\n");

// ── Reading the list ────────────────────────────────────────────────────────
Deno.test("a CSV with headers: mixed UK and NG phones become E.164 with the brand country default", () => {
  const parsed = parseContactList(MIXED_CSV, "NG");
  assert(parsed.had_header);
  assertEquals(parsed.total, 8);
  assertEquals(parsed.rows.map((r) => [r.row, r.name, r.email, r.phone]), [
    [2, "Ada Obi", "ada@obi-mail.co", "+2348031234567"],
    [3, "Tunde Bello", "tunde@bello.ng", "+2348052223333"],
    [4, "Jane Smith", "jane@smith.co.uk", "+447700900123"],
    [5, "Kola Ade", "kola@ade.ng", "+2348051112222"],
    [6, "Mary Lee", "mary@lee.co.uk", "+447700900456"],
    [8, "Bad Phone", "bad@phone.co", null],
  ]);
  assertEquals(parsed.skipped, 1);
  assertEquals(parsed.merged, 1);
});

Deno.test("the same numbers on a UK brand: national numbers read as UK, coded ones keep their country", () => {
  const list = [
    "Phone,Name",
    "07700 900123,Jane",
    "+234 803 123 4567,Ada",
    "2348051112222,Kola",
    "0044 7700 900456,Mary",
  ].join("\n");
  const parsed = parseContactList(list, "GB");
  assertEquals(parsed.rows.map((r) => r.phone), [
    "+447700900123",
    "+2348031234567",
    "+2348051112222",
    "+447700900456",
  ]);
  // The same parser as the brand phone field: a Nigerian national number
  // under a UK brand is never turned into a UK number, and the row says why.
  const wrong = contactPhone("0803 123 4567", "GB");
  assertEquals(wrong.ok, false);
  if (!wrong.ok) {
    assertEquals(
      wrong.problem,
      "The phone looks like a Nigerian number. Write it with +234 in front and I can add it.",
    );
  }
  const noCountry = contactPhone("0803 123 4567", null);
  assertEquals(noCountry.ok, false);
  assertEquals(contactPhone("+447700900123", null), {
    ok: true,
    e164: "+447700900123",
  });
});

Deno.test("pasted text with no headers is read by content", () => {
  const parsed = parseContactList(
    [
      "Ada Obi ada@obi.co 08031234567",
      "jane@smith.co.uk; Jane Smith",
      "(0805) 111-2222 Sam",
      "Tunde Bello\t+447700900123\ttunde@bello.ng",
    ].join("\n"),
    "NG",
  );
  assertEquals(parsed.had_header, false);
  assertEquals(parsed.rows.map((r) => [r.row, r.name, r.email, r.phone]), [
    [1, "Ada Obi", "ada@obi.co", "+2348031234567"],
    [2, "Jane Smith", "jane@smith.co.uk", null],
    [3, "Sam", null, "+2348051112222"],
    [4, "Tunde Bello", "tunde@bello.ng", "+447700900123"],
  ]);
});

Deno.test("a value in the wrong column is read for what it is", () => {
  const parsed = parseContactList(
    "Name,Email,Phone\nada@obi.co,08031234567,Ada Obi\nKemi,+2348051112222,kemi@x.ng",
    "NG",
  );
  assertEquals(parsed.rows.map((r) => [r.email, r.phone]), [
    ["ada@obi.co", "+2348031234567"],
    ["kemi@x.ng", "+2348051112222"],
  ]);
});

Deno.test("duplicates inside the list are merged or kept apart, and always listed", () => {
  const parsed = parseContactList(
    [
      "Name,Email,Phone",
      "Ada Obi,ada@obi.co,",
      "Ada Obi,,08031234567",
      "Ada Obi,ada@obi.co,08031234567",
      "Kemi,,08031234567",
      "Ada Obi,ada.other@obi.co,08031234567",
    ].join("\n"),
    "NG",
  );
  assertEquals(parsed.rows.length, 2, "row 3 has no shared detail yet");
  const kinds = parsed.problems.map((p) => [p.row, p.kind]);
  assertEquals(kinds, [
    [4, "duplicate_conflict"],
    [5, "duplicate_conflict"],
    [6, "duplicate_merged"],
  ]);
  assertMatch(parsed.problems[0].words, /belong to two different people/);
  // Row 6 shares row 3's phone and name, so its email fills row 3's gap.
  assertEquals(parsed.rows[1].email, "ada.other@obi.co");
  assertMatch(parsed.problems[1].words, /Kemi \(row 5\): skipped, same phone as row 3 but a different name/);
});

Deno.test("rows with no contact detail are skipped and listed, never silently dropped", () => {
  const parsed = parseContactList(
    "Name,Email,Phone\nNo One,,\nBad Email,ada@,\nTest,guest@example.com,\nOk,ok@ok.co,",
    "NG",
  );
  assertEquals(parsed.rows.map((r) => r.row), [5]);
  assertEquals(parsed.skipped, 3);
  assertEquals(parsed.problems.map((p) => p.row), [2, 3, 4]);
  for (const p of parsed.problems) assertMatch(p.words, /skipped/);
  assertEquals(parsed.total, parsed.rows.length + parsed.skipped + parsed.merged);
});

Deno.test("the CSV handed to the existing import is three plain columns, formulas defused", () => {
  const csv = contactListCsv([
    { row: 2, name: '=HYPERLINK("x")', email: "a@b.co", phone: "+447700900123" },
    { row: 3, name: 'Ada "Ace" Obi', email: null, phone: "+2348031234567" },
  ]);
  assertEquals(
    csv,
    'Name,Email,Phone\n"\'=HYPERLINK(""x"")","a@b.co","+447700900123"\n"Ada ""Ace"" Obi","","+2348031234567"',
  );
  assertEquals(ARI_CONTACT_CSV_MAPPING, {
    Email: "email",
    Name: "full_name",
    Phone: "phone",
  });
});

// ── Intent ──────────────────────────────────────────────────────────────────
Deno.test("'Import my contacts' starts the flow; questions about importing do not", () => {
  for (
    const text of [
      "Import my contacts",
      "Upload a contact list",
      "I want to add my mailing list",
      "Can you import these contacts for me",
      "upload my email list for blasts",
    ]
  ) assert(isContactImportIntent(text), text);
  for (
    const text of [
      "How do I import contacts?",
      "Export my contacts",
      "Send a blast to my contacts",
      "Create an event",
      "Show me my contacts",
    ]
  ) assert(!isContactImportIntent(text), text);
});

// ── The flow ────────────────────────────────────────────────────────────────
Deno.test("happy path: paste, plain-words review, one protected card, saved counts read back", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  world.people.push({ name: "Jane Smith", email: "jane@smith.co.uk", phone: null });
  world.people.push({ name: "Tunde B", email: "tunde@bello.ng", phone: null });
  const { review, propose, result, done } = await importAll(
    store,
    world,
    MIXED_CSV,
  );

  // The existing import got the normalised list, not the raw paste.
  assertEquals(world.previews, 1);
  assertMatch(world.csvs[0], /"Ada Obi","ada@obi-mail\.co","\+2348031234567"/);
  assertMatch(world.csvs[0], /"Mary Lee","mary@lee\.co\.uk","\+447700900456"/);

  if (review.kind !== "artefact") throw new Error("no review");
  const text = review.artefact.text;
  assertMatch(text, /I read 8 rows from your list/);
  assertMatch(text, /- 4 new contacts to add/);
  assertMatch(text, /- 1 person is already on your list \(1 with a new phone or email I'll add\)/);
  assertMatch(text, /- 1 person needs a check/);
  assertMatch(text, /- 1 row will be skipped/);
  assertMatch(text, /No Contact \(row 7\): skipped, no phone number or email\./);
  assertMatch(text, /Bad Phone \(row 8\): added with their email only\. Nigerian numbers have 10 digits after the 0 — you entered 5\./);
  assertMatch(text, /Tunde Bello · tunde@bello\.ng · \+2348052223333 \(row 3\)/);
  assertMatch(text, /did these people agree to hear from Coastline Collective\?/);
  assert(text.includes(renderContactImportAttestation(BRAND_NAME)));
  assertEquals(review.artefact.options.map((o) => o.id), [
    "import",
    "no_consent",
    "reupload",
    "cancel",
  ]);
  assertEquals(review.artefact.options[0].label, "Yes, they agreed — import 6");

  if (propose.kind !== "propose") throw new Error("no proposal");
  assertEquals(propose.tool_name, "manage_brand_people");
  assertEquals(propose.tool_args, {
    brand_id: BRAND,
    action: "import",
    import_batch_id: BATCH,
    import_preview_token: TOKEN,
    import_file_sha256: SHA,
  });
  assertEquals(propose.card_title, "Import 6 contacts");
  assert(propose.rows_only);
  const rows = Object.fromEntries(propose.rows.map((r) => [r.label, r.value]));
  assertEquals(rows["New contacts"], "4");
  assertEquals(rows["Updated"], "1");
  assertEquals(rows["To check in People"], "1");
  assertEquals(rows["Skipped rows"], "1");

  // The write ran the existing import's execute with the owner's
  // attestation in the import's own words, keyed by the confirmation.
  assertEquals(world.executions.length, 1);
  const body = world.executions[0];
  assertEquals(body.action, "execute");
  assertEquals(body.accepted, true);
  assertEquals(body.idempotencyKey, OP);
  assertEquals(body.attestationText, renderContactImportAttestation(BRAND_NAME));
  assertEquals(body.normalizedMapping, ARI_CONTACT_CSV_MAPPING);
  assertEquals((result as { id: string }).id, BATCH);

  // The confirm card's counts equal the counts read back after saving.
  if (done.kind !== "completed") throw new Error(`not completed: ${done.kind}`);
  const run = await cur(store);
  assertEquals(run.status, "completed");
  const observed = run.step_states[CONTACT_REVIEW_STEP].evidence!
    .observed as { counts: ContactImportCounts };
  assertEquals(String(observed.counts.addedCount), rows["New contacts"]);
  assertEquals(String(observed.counts.updatedCount), rows["Updated"]);
  assertEquals(String(observed.counts.reviewCount), rows["To check in People"]);
  assertMatch(done.text, /Saved, and I checked your contacts: 4 contacts added, 1 updated with a new phone or email/);
  assertMatch(done.text, /1 person is waiting in People/);
  assertMatch(done.text, /Anyone who has unsubscribed stays unsubscribed/);
  assertEquals(world.people.length, 6);
});

Deno.test("the protected card shows the plain heading and only the engine's rows", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  await start(store);
  await step(store, world);
  await step(store, world, {
    trigger: "answer",
    answer: pasted(await cur(store), "Ada, ada@obi.co\nTunde, 08031234567"),
  });
  const propose = await step(store, world, {
    trigger: "answer",
    answer: choice(await cur(store), "import"),
  });
  if (propose.kind !== "propose") throw new Error("no proposal");
  const args = verifiedProposalArgs(propose.tool_args, {
    flow_rows: propose.rows,
    flow_rows_only: true,
    flow_title: propose.card_title,
  }, propose.tool_name);
  const presentation = buildProposalPresentation("manage_brand_people", args);
  assertEquals(presentation.title, "Import 2 contacts");
  assertEquals(presentation.fields.map((f) => f.label), [
    "Brand",
    "New contacts",
    "Permission",
  ]);
  assert(
    presentation.fields.every((f) => !/token|[0-9a-f]{64}/i.test(f.value)),
    "no token or file digest on the card",
  );
  // The import action is a confirmed write, never an inline read.
  assert(!isReadOnlyAgentToolCall("manage_brand_people", propose.tool_args));
});

Deno.test("no consent is invented: 'No, or I'm not sure' imports nothing", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  await start(store);
  await step(store, world);
  await step(store, world, {
    trigger: "answer",
    answer: pasted(await cur(store), "Ada Obi, ada@obi.co, 08031234567"),
  });
  const out = await step(store, world, {
    trigger: "answer",
    answer: choice(await cur(store), "no_consent"),
  });
  assertEquals(out.kind, "cancelled");
  if (out.kind !== "cancelled") throw new Error("not cancelled");
  assertMatch(out.text, /Then I won't add them/);
  assertMatch(out.text, /Nothing was saved/);
  assertEquals(world.executions.length, 0);
  assertEquals(world.people.length, 0);
  // Nothing the flow stores claims permission on the owner's behalf.
  const run = await cur(store);
  assertNotMatch(JSON.stringify(run.answers), /accepted|attest|consent/i);
});

Deno.test("the write refuses a list Ari has not checked", async () => {
  const write = DOMAIN_TOOLS.find((t) => t.name === "manage_brand_people")!;
  const world = new FakeImport();
  await assertRejects(
    () =>
      write.executor(
        { brand_id: BRAND, action: "import" },
        world.client() as never,
        "user-1",
        { operationId: OP },
      ),
    Error,
    "needs a list Ari has checked first",
  );
  assertEquals(world.executions.length, 0);
});

Deno.test("problem rows never block: they are listed and the good rows can be imported", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  const { review, done } = await importAll(
    store,
    world,
    "Name,Email,Phone\nAda,ada@obi.co,\nNobody,,\nBroken,,123\nTunde,,08031234567",
  );
  if (review.kind !== "artefact") throw new Error("no review");
  assertMatch(review.artefact.text, /Nobody \(row 3\): skipped, no phone number or email\./);
  assertMatch(review.artefact.text, /Broken \(row 4\): skipped\. Nigerian numbers have 10 digits after the 0 — you entered 3\./);
  assertEquals(review.artefact.options[0].label, "Yes, they agreed — import 2");
  assertEquals(done.kind, "completed");
  assertEquals(world.people.map((p) => p.name), ["Ada", "Tunde"]);
});

Deno.test("a list with nobody usable asks again with the reasons; nothing is checked or saved", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  await start(store);
  await step(store, world);
  const again = await step(store, world, {
    trigger: "answer",
    answer: pasted(await cur(store), "Name,Email\nNobody,\nAlso nobody,not-an-email"),
  });
  if (again.kind !== "artefact") throw new Error("no card");
  assertEquals(again.artefact.step_key, CONTACT_LIST_STEP);
  assertMatch(again.artefact.text, /couldn't find anyone to add/);
  assertMatch(again.artefact.text, /Also nobody \(row 3\): skipped\. The email address isn't complete\./);
  assertEquals(world.previews, 0);
});

Deno.test("duplicates against existing contacts: unchanged, new details, conflicting name", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  world.people.push({ name: "Ada Obi", email: "ada@obi.co", phone: "+2348031234567" });
  world.people.push({ name: "Jane Smith", email: "jane@smith.co.uk", phone: null });
  world.people.push({ name: "Tunde Bello", email: "tunde@bello.ng", phone: null });
  await start(store);
  await step(store, world);
  const review = await step(store, world, {
    trigger: "answer",
    answer: pasted(
      await cur(store),
      "Ada Obi, ada@obi.co, 08031234567\nJane Smith, jane@smith.co.uk, +447700900123\nT. Bello, tunde@bello.ng",
    ),
  });
  if (review.kind !== "artefact") throw new Error("no review");
  assertMatch(review.artefact.text, /- 0 new contacts to add/);
  assertMatch(review.artefact.text, /- 2 people are already on your list \(1 with a new phone or email I'll add\)/);
  assertMatch(review.artefact.text, /- 1 person needs a check/);
  assertMatch(review.artefact.text, /T\. Bello · tunde@bello\.ng \(row 3\)/);
});

Deno.test("everyone already there: nothing to import, no import button", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  world.people.push({ name: "Ada Obi", email: "ada@obi.co", phone: null });
  await start(store);
  await step(store, world);
  const review = await step(store, world, {
    trigger: "answer",
    answer: pasted(await cur(store), "Ada Obi, ada@obi.co"),
  });
  if (review.kind !== "artefact") throw new Error("no review");
  assertMatch(review.artefact.text, /nothing to add/);
  assertEquals(review.artefact.options.map((o) => o.id), ["reupload", "cancel"]);
});

Deno.test("'Use a different list' asks for the list again", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  await start(store);
  await step(store, world);
  await step(store, world, {
    trigger: "answer",
    answer: pasted(await cur(store), "Ada, ada@obi.co"),
  });
  const again = await step(store, world, {
    trigger: "answer",
    answer: choice(await cur(store), "reupload"),
  });
  if (again.kind !== "artefact") throw new Error("no card");
  assertEquals(again.artefact.step_key, CONTACT_LIST_STEP);
  assertMatch(again.text, /send the list you'd like to use instead/);
});

Deno.test("a refused save comes back on the review card with the reason; nothing is imported", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  await start(store);
  await step(store, world);
  await step(store, world, {
    trigger: "answer",
    answer: pasted(await cur(store), "Ada, ada@obi.co"),
  });
  const propose = await step(store, world, {
    trigger: "answer",
    answer: choice(await cur(store), "import"),
  });
  if (propose.kind !== "propose") throw new Error("no proposal");
  world.refuseExecute = "PREVIEW_STALE_OR_TAMPERED";
  const write = DOMAIN_TOOLS.find((t) => t.name === "manage_brand_people")!;
  let message = "";
  try {
    await write.executor(propose.tool_args, world.client() as never, "u", {
      operationId: OP,
    });
  } catch (error) {
    message = (error as Error).message;
  }
  assertMatch(message, /more than a day old/);
  const back = await step(store, world, {
    trigger: "confirm",
    failed: { tool_name: "manage_brand_people", message },
  });
  if (back.kind !== "artefact") throw new Error(`no card: ${back.kind}`);
  assertEquals(back.artefact.step_key, CONTACT_REVIEW_STEP);
  assertMatch(back.artefact.text, /^That import didn't save: the checked list is more than a day old/);
  assertEquals(world.people.length, 0);
});

Deno.test("contact import switched off: plain words, nothing asked for", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  world.flag = false;
  await start(store);
  const out = await step(store, world);
  if (out.kind !== "artefact") throw new Error("no card");
  assertMatch(out.artefact.text, /isn't switched on for your brand yet/);
  const stop = await step(store, world, {
    trigger: "answer",
    answer: choice(await cur(store), "cancel"),
  });
  assertEquals(stop.kind, "cancelled");
});

Deno.test("a refused check (role) is said plainly and the list card stays", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  world.refusePreview = "FORBIDDEN";
  await start(store);
  await step(store, world);
  const again = await step(store, world, {
    trigger: "answer",
    answer: pasted(await cur(store), "Ada, ada@obi.co"),
  });
  if (again.kind !== "artefact") throw new Error("no card");
  assertMatch(again.artefact.text, /Only the owner, a brand admin or a marketing manager can import contacts/);
});

// ── Files: CSV read, PDF and Excel answered plainly ─────────────────────────
Deno.test("an attached CSV is the list; a PDF gets plain words and the same card", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  const base = {
    service: {} as never,
    userClient: {} as never,
    userId: "user-1",
    brand: { id: BRAND, name: BRAND_NAME },
    conversationId: CHAT,
    flowAnswer: null,
    engineEnabled: true,
    otherLaneActive: false,
    store,
    probes: world.probes("GB"),
  };
  // #3355 Wave E (D3a): the model starts the import with start_flow; typed
  // words alone no longer start it.
  const pdf = await startFlowFromTool({
    ...base,
    message: "Import these contacts",
    call: { flow_key: "import_contacts" },
    attachments: () =>
      Promise.resolve([{ file_type: "pdf", name: "guests.pdf", text: null }]),
  });
  if (pdf.kind !== "reply") throw new Error(`not a reply: ${pdf.kind}`);
  assertMatch(pdf.text, /can't read a contact list out of a PDF/);
  assertEquals(pdf.artefact?.step_key, CONTACT_LIST_STEP);

  const csv = await decideFlowTurn({
    ...base,
    message: "",
    attachments: () =>
      Promise.resolve([{
        file_type: "csv",
        name: "guests.csv",
        text: "Name,Mobile,Email\nJane Smith,07700 900123,jane@smith.co.uk",
      }]),
  });
  if (csv.kind !== "reply") throw new Error(`not a reply: ${csv.kind}`);
  assertEquals(csv.artefact?.step_key, CONTACT_REVIEW_STEP);
  assertMatch(csv.text, /I read 1 row from guests\.csv/);
  assertMatch(world.csvs[0], /"Jane Smith","jane@smith\.co\.uk","\+447700900123"/);
});

Deno.test("a list attached with the request is read straight away", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  // #3355 Wave E (D3a): started by the model's start_flow.
  const out = await startFlowFromTool({
    call: { flow_key: "import_contacts" },
    service: {} as never,
    userClient: {} as never,
    userId: "user-1",
    brand: { id: BRAND, name: BRAND_NAME },
    conversationId: CHAT,
    message: "Upload my contact list",
    flowAnswer: null,
    engineEnabled: true,
    otherLaneActive: false,
    store,
    probes: world.probes("NG"),
    attachments: () =>
      Promise.resolve([{
        file_type: "text",
        name: "list.txt",
        text: "Ada Obi ada@obi.co 08031234567",
      }]),
  });
  if (out.kind !== "reply") throw new Error(`not a reply: ${out.kind}`);
  assertEquals(out.artefact?.step_key, CONTACT_REVIEW_STEP);
  assertEquals(world.previews, 1);
});

Deno.test("contactListFromFiles: Word and text files are read, images are not", () => {
  const run = { id: "r", current_question_id: "q" } as FlowRun;
  const read = contactListFromFiles(run, [
    { file_type: "docx", name: "a.docx", text: "Ada ada@obi.co" },
    { file_type: "image", name: "b.png", text: null },
  ]);
  assertEquals(read.kind, "answer");
  const none = contactListFromFiles(run, [
    { file_type: "image", name: "b.png", text: null },
  ]);
  assertEquals(none.kind, "unreadable");
  if (none.kind === "unreadable") assertMatch(none.text, /CSV/);
});

// ── Plain copy ──────────────────────────────────────────────────────────────
Deno.test("every owner-visible line the import flow produced is copy-gate clean and fits the card", () => {
  assert(SEEN.length > 20, "the flow tests above produced owner copy");
  for (const text of SEEN) {
    assertEquals(ownerCopyViolations(text, "prose"), [], text);
    assertNotMatch(text, /E\.164|batch|preview token|attestation|mapping|undefined|null/i, text);
  }
});

Deno.test("the review card's choices fit the Host card", async () => {
  const store = new MemoryStore();
  const world = new FakeImport();
  await start(store);
  await step(store, world);
  const review = await step(store, world, {
    trigger: "answer",
    answer: pasted(await cur(store), "Ada, ada@obi.co"),
  });
  if (review.kind !== "artefact") throw new Error("no review");
  const choices = flowChoices(review.artefact);
  assert(choices && choices.options.length <= 40);
  for (const option of review.artefact.options) {
    assert(option.label.length <= 60, option.label);
  }
});
