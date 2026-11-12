/**
 * Issue #3355 — "Import my contacts": a contact list through Ari, on the
 * flow engine (no model turn needed).
 *
 *   contact_access  the brand can use contact import at all (feature flag);
 *   contact_list    the owner attaches or pastes the list; Ari reads every
 *                   row into name, phone (E.164, brand country default) and
 *                   email (`contactList.ts`), then the EXISTING contact import
 *                   (#1775, `contact-import`) checks it against the brand's
 *                   contacts. Nothing is added to the contacts here;
 *   contact_review  what will happen, in plain words, and the permission
 *                   question the existing import requires. "Yes" becomes ONE
 *                   protected confirmation card (`manage_brand_people`
 *                   action "import"); the save is the existing import's own
 *                   execute, which records the owner's confirmation;
 *   summary         the counts read back from the saved import.
 *
 * Permission: the existing model is the #1775 attestation — the owner
 * confirms, in fixed words recorded with their name and the date, that the
 * people agreed to hear from the brand. There is no import without it, so a
 * "No" imports nothing. Ari never marks anyone as agreeing on its own.
 */

import { renderContactImportAttestation } from "../contactImportContract.ts";
import { FORM_ANSWER } from "./runner.ts";
import {
  type ContactListRow,
  contactListCsv,
  parseContactList,
} from "./contactList.ts";
import {
  type AnswerOutcome,
  type AskSpec,
  type ContactImportCounts,
  type ContactImportPreview,
  ContactImportRefused,
  type FlowAnswer,
  type FlowAnswerValues,
  type FlowContext,
  type FlowDefinition,
  type FlowRun,
  type ProbeResult,
  type StepDefinition,
} from "./types.ts";

export const IMPORT_CONTACTS_FLOW_KEY = "import_contacts";
export const CONTACT_LIST_STEP = "contact_list";
export const CONTACT_REVIEW_STEP = "contact_review";
export const CONTACT_IMPORT_FLAG = "contact_import_v1";

/** What the run keeps after the list was checked (never the whole list). */
export interface ContactImportAnswer {
  batch_id: string;
  preview_token: string;
  file_sha256: string;
  counts: ContactImportCounts;
  /** Data rows Ari read from the owner's list. */
  total: number;
  /** Rows Ari left out (no usable phone or email, conflicting duplicate). */
  skipped: number;
  /** Rows listed twice and merged into one. */
  merged: number;
  /** Plain words, one per row Ari changed or left out (capped). */
  problems: string[];
  problem_count: number;
  /** Rows the import will put in People to check (name doesn't match). */
  review: string[];
  /** A few rows as they will be saved. */
  sample: string[];
  source: string;
}

const MAX_LISTED = 8;
const MAX_SAMPLE = 3;

// ── Intent ──────────────────────────────────────────────────────────────────

const IMPORT_VERB =
  /\b(?:import|upload|add|bring in|load|move|transfer|save)\b/i;
const LIST_NOUN =
  /\b(?:contacts?|contact list|mailing list|email list|e-mail list|customer list|subscriber list|subscribers|phone list|phone numbers|address book)\b/i;
const NOT_IMPORT =
  /^(?:how|what|why|where|when|which|who|do i|does|is|are|should)\b|\b(?:export|download|delete|remove|send|blast|message)\b/i;

/**
 * Deterministic "import my contacts" / "upload a contact list". A question
 * about importing ("how do I import contacts?") is not an intent; the verb
 * comes before the list noun.
 */
export function isContactImportIntent(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 300) return false;
  if (NOT_IMPORT.test(normalized)) return false;
  const verb = IMPORT_VERB.exec(normalized);
  if (!verb) return false;
  const noun = LIST_NOUN.exec(normalized.slice(verb.index));
  return !!noun && noun.index <= 60;
}

// ── Plain words ─────────────────────────────────────────────────────────────

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function people(count: number, one: string, many: string): string {
  return count === 1 ? `1 person ${one}` : `${count} people ${many}`;
}

function listWords(lines: string[], total: number): string {
  const shown = lines.slice(0, MAX_LISTED).map((line) => `- ${line}`);
  if (total > shown.length) {
    shown.push(`- and ${total - shown.length} more like these.`);
  }
  return shown.join("\n");
}

function sampleLine(row: ContactListRow): string {
  return [row.name || "No name", row.email, row.phone].filter(Boolean).join(
    " · ",
  );
}

export function importableCount(counts: ContactImportCounts): number {
  return counts.addedCount + counts.updatedCount + counts.reviewCount;
}

/** The permission question, in the existing import's own words. */
export function permissionWords(brandName: string): string {
  return `Before I add them: did these people agree to hear from ${brandName}? Saying yes means: "${
    renderContactImportAttestation(brandName)
  }"`;
}

/** The review card's words, built only from what the import reported. */
export function reviewText(answer: ContactImportAnswer, brandName: string): string {
  const c = answer.counts;
  const already = c.updatedCount + c.unchangedCount;
  const lines = [
    `I read ${plural(answer.total, "row", "rows")} from ${answer.source}. Here's what I'll do:`,
    `- ${plural(c.addedCount, "new contact", "new contacts")} to add`,
    already > 0
      ? `- ${people(already, "is", "are")} already on your list${
        c.updatedCount > 0
          ? ` (${c.updatedCount} with a new phone or email I'll add)`
          : ", nothing to change"
      }`
      : "",
    c.reviewCount > 0
      ? `- ${
        people(c.reviewCount, "needs", "need")
      } a check: the phone or email is already on your list under another name, so I'll put ${
        c.reviewCount === 1 ? "it" : "them"
      } in People to review instead of merging`
      : "",
    answer.skipped > 0
      ? `- ${plural(answer.skipped, "row", "rows")} will be skipped`
      : "",
    answer.merged > 0
      ? `- ${plural(answer.merged, "person was", "people were")} listed twice, so I merged them`
      : "",
    c.alreadySuppressedCount > 0
      ? `- ${plural(c.alreadySuppressedCount, "person has", "people have")} unsubscribed before and will stay unsubscribed`
      : "",
  ].filter(Boolean);
  const parts = [lines.join("\n")];
  if (answer.problems.length > 0) {
    parts.push(
      `Rows I changed or left out:\n${listWords(answer.problems, answer.problem_count)}`,
    );
  }
  if (answer.review.length > 0) {
    parts.push(`To check in People:\n${listWords(answer.review, c.reviewCount)}`);
  }
  if (answer.sample.length > 0) {
    parts.push(
      `How they'll be saved:\n${answer.sample.map((line) => `- ${line}`).join("\n")}`,
    );
  }
  if (importableCount(c) > 0) {
    parts.push(permissionWords(brandName));
  } else {
    parts.push(
      "Everyone on this list is already in your contacts with the same details, so there's nothing to add.",
    );
  }
  return parts.join("\n\n");
}

/** The closing words, built only from the counts read back after saving. */
export function savedText(
  saved: ContactImportCounts,
  answer: ContactImportAnswer | null,
): string {
  const bits = [
    `${plural(saved.addedCount, "contact", "contacts")} added`,
    saved.updatedCount > 0
      ? `${saved.updatedCount} updated with a new phone or email`
      : "",
    saved.unchangedCount > 0
      ? `${saved.unchangedCount} already there with the same details`
      : "",
  ].filter(Boolean);
  const lines = [
    `Saved, and I checked your contacts: ${bits.join(", ")}.`,
    saved.reviewCount > 0
      ? `${plural(saved.reviewCount, "person is", "people are")} waiting in People for you to check, because the name didn't match the one you already have.`
      : "",
    answer && answer.skipped > 0
      ? `${plural(answer.skipped, "row", "rows")} from your list ${
        answer.skipped === 1 ? "wasn't" : "weren't"
      } added, as listed before.`
      : "",
    "Because you confirmed they agreed to hear from you, they can be included in your blasts and outreach. Anyone who has unsubscribed stays unsubscribed and is never sent one.",
  ];
  return lines.filter(Boolean).join(" ");
}

// ── Steps ───────────────────────────────────────────────────────────────────

function answerOf(run: FlowRun): ContactImportAnswer | null {
  const value = run.answers.contact_import?.value;
  return value && typeof value === "object" && !Array.isArray(value) &&
      typeof (value as ContactImportAnswer).batch_id === "string"
    ? value as ContactImportAnswer
    : null;
}

function problemOf(ctx: FlowContext): string | null {
  const problem = ctx.state?.data?.problem;
  return typeof problem === "string" ? problem : null;
}

function attemptOf(ctx: FlowContext): number {
  const attempt = ctx.state?.data?.attempt;
  return typeof attempt === "number" ? attempt : 0;
}

function retry(ctx: FlowContext, problem: string): AnswerOutcome {
  return {
    record: { state: "asked", data: { problem, attempt: attemptOf(ctx) + 1 } },
  };
}

const LIST_TITLE = "Add your contact list";
export const LIST_QUESTION =
  "Attach your list with the paperclip — a spreadsheet saved as CSV, a text file or a Word document — or paste it here, one person per line. I'll pick out each person's name, phone number and email, and show you what I'll add before anything is saved. If it's a PDF or an Excel file, save it as CSV or copy the rows and paste them. You can also import it yourself in Mingla Host: open Blast, go to People and tap Import.";

function listQuestion(ctx: FlowContext): AskSpec {
  const problem = problemOf(ctx);
  const attempt = attemptOf(ctx);
  return {
    kind: "question",
    answer_mode: "form",
    reuse_key: `contacts:list:${attempt}`,
    title: LIST_TITLE,
    text: problem ? `${problem}\n\n${LIST_QUESTION}` : LIST_QUESTION,
    options: [{ id: "cancel", label: "Stop" }],
    rendition: {
      schema_version: 2,
      rendition_id: `contacts-setup:list`,
      kind: "contacts-setup",
      eyebrow: "Contacts",
      title: LIST_TITLE,
      body: problem ?? LIST_QUESTION,
      ...(problem ? { tone: "warning" } : {}),
      state: "ready",
      blocks: [{
        type: "input",
        version: 1,
        id: "contact-list-answer",
        field: {
          id: "contact_list",
          label: "Your list",
          value: "",
          placeholder: "Ada Obi, ada@mail.com, 0803 123 4567",
          editable: true,
          kind: "text",
        },
      }],
      actions: [{
        id: "continue-with-ari",
        label: "Check my list",
        style: "primary",
        behavior: { type: "submit", message: "Use my answer" },
      }],
    },
    record: { data: { attempt } },
  };
}

const CONTACT_SIGNAL = /@|\d[\d\s().-]{5,}\d/;
const NOT_A_LIST =
  /^(?:how|why|what|can|could|should|do|does|is|are|will|would|stop|cancel|never\s?mind|forget it|not now|skip|later)\b|\?\s*$/i;

/** A typed or pasted reply is the list when it carries a phone or an email. */
export function typedList(text: string): FlowAnswerValues | null {
  const trimmed = text.trim();
  if (!trimmed || !CONTACT_SIGNAL.test(trimmed)) return null;
  if (NOT_A_LIST.test(trimmed) && trimmed.split("\n").length === 1) return null;
  return { choices: [], country: null, response: trimmed };
}

function refusalWords(error: unknown): string {
  if (error instanceof ContactImportRefused) {
    if (error.code === "FORBIDDEN") {
      return "Only the owner, a brand admin or a marketing manager can import contacts for this brand, so nothing was added.";
    }
    if (error.code === "NO_IMPORTABLE_ROWS") {
      return "None of these rows has a phone number or email I can add, so nothing was saved.";
    }
    if (error.code === "ROW_LIMIT_EXCEEDED" || error.code === "FILE_TOO_LARGE") {
      return "That list is too big to check in one go (the limit is 10,000 people). Split it into smaller lists and send them one at a time. Nothing was saved.";
    }
  }
  return "I couldn't check that list just now, so nothing was saved. Try sending it again in a moment.";
}

const accessStep: StepDefinition = {
  key: "contact_access",
  title: "Contact import",
  kind: "check",
  depends_on: [],
  policy: "blocking",
  async probe(ctx): Promise<ProbeResult> {
    const on = ctx.deps.featureFlag
      ? await ctx.deps.featureFlag(CONTACT_IMPORT_FLAG)
      : false;
    if (on) {
      return {
        done: true,
        evidence: { probe: "contact_import_enabled", observed: true },
      };
    }
    return {
      done: false,
      ask: {
        kind: "question",
        reuse_key: "contacts:access",
        title: "Contact import isn't on yet",
        text:
          "Importing a contact list isn't switched on for your brand yet, so I can't add one. Nothing was changed.",
        options: [{ id: "cancel", label: "Okay" }],
        record: {},
      },
    };
  },
  onAnswer(_ctx, choiceId) {
    if (choiceId !== "cancel") return Promise.resolve(null);
    return Promise.resolve({
      record: { state: "skipped" },
      cancel_run: true,
      ack: "Okay. Nothing was changed.",
    });
  },
};

const listStep: StepDefinition = {
  key: CONTACT_LIST_STEP,
  title: LIST_TITLE,
  kind: "question",
  depends_on: ["contact_access"],
  policy: "blocking",
  probe(ctx): Promise<ProbeResult> {
    const answer = answerOf(ctx.run);
    if (answer) {
      return Promise.resolve({
        done: true,
        evidence: {
          probe: "contact_import_previewed",
          observed: { batch_id: answer.batch_id, counts: answer.counts },
        },
      });
    }
    return Promise.resolve({ done: false, ask: listQuestion(ctx) });
  },
  textAnswer: (_ctx, text) => typedList(text),
  async onAnswer(ctx, choiceId, answer?: FlowAnswer) {
    if (choiceId === "cancel") {
      return {
        record: { state: "skipped" },
        cancel_run: true,
        ack: "Okay, I've stopped. Nothing was saved.",
      };
    }
    if (choiceId !== FORM_ANSWER || !answer?.values) return null;
    const text = answer.values.response;
    const facts = ctx.deps.brandFacts ? await ctx.deps.brandFacts() : null;
    const parsed = parseContactList(text, facts?.country_code ?? null);
    if (parsed.total === 0 || parsed.rows.length === 0) {
      const why = parsed.problems.slice(0, MAX_LISTED).map((p) => `- ${p.words}`)
        .join("\n");
      return retry(
        ctx,
        `I couldn't find anyone to add: no row has a phone number or email I can use. Nothing was saved.${
          why ? `\n${why}` : ""
        }`,
      );
    }
    if (!ctx.deps.contactImportPreview) {
      return retry(ctx, refusalWords(null));
    }
    let preview: ContactImportPreview;
    try {
      preview = await ctx.deps.contactImportPreview(contactListCsv(parsed.rows));
    } catch (error) {
      return retry(ctx, refusalWords(error));
    }
    // CSV row n (2 = first contact) is parsed.rows[n - 2].
    const review = preview.rows
      .filter((row) => row.outcome === "review")
      .map((row) => parsed.rows[row.row_number - 2])
      .filter((row): row is ContactListRow => !!row)
      .map((row) => `${sampleLine(row)} (row ${row.row})`);
    const fileName = /^Attached (.+)$/.exec(answer.display_text)?.[1];
    const value: ContactImportAnswer = {
      batch_id: preview.batch_id,
      preview_token: preview.preview_token,
      file_sha256: preview.file_sha256,
      counts: preview.counts,
      total: parsed.total,
      skipped: parsed.skipped,
      merged: parsed.merged,
      problems: parsed.problems.slice(0, MAX_LISTED).map((p) => p.words),
      problem_count: parsed.problems.length,
      review: review.slice(0, MAX_LISTED),
      sample: parsed.rows.slice(0, MAX_SAMPLE).map(sampleLine),
      source: fileName ? fileName.slice(0, 80) : "your list",
    };
    return {
      record: { state: "pending" },
      answers: { contact_import: { value, source: "engine" } },
    };
  },
};

function reviewQuestion(
  ctx: FlowContext,
  answer: ContactImportAnswer,
  failed: string | null,
): AskSpec {
  const count = importableCount(answer.counts);
  const text = reviewText(answer, ctx.brandName);
  return {
    kind: "question",
    reuse_key: `contacts:review:${answer.batch_id}${failed ? ":failed" : ""}`,
    title: "Check your contact list",
    text: failed
      ? `That import didn't save: ${failed} Nothing was added.\n\n${text}`
      : text,
    options: count > 0
      ? [
        {
          id: "import",
          label: `Yes, they agreed — import ${count}`,
        },
        { id: "no_consent", label: "No, or I'm not sure" },
        { id: "reupload", label: "Use a different list" },
        { id: "cancel", label: "Stop" },
      ]
      : [
        { id: "reupload", label: "Use a different list" },
        { id: "cancel", label: "Stop" },
      ],
    record: {},
  };
}

/** The protected card's rows: what the owner is confirming, in plain words. */
export function importProposalRows(
  answer: ContactImportAnswer,
  brandName: string,
): { label: string; value: string }[] {
  const c = answer.counts;
  return [
    { label: "Brand", value: brandName },
    { label: "New contacts", value: String(c.addedCount) },
    ...(c.updatedCount > 0
      ? [{ label: "Updated", value: String(c.updatedCount) }]
      : []),
    ...(c.reviewCount > 0
      ? [{ label: "To check in People", value: String(c.reviewCount) }]
      : []),
    ...(answer.skipped > 0
      ? [{ label: "Skipped rows", value: String(answer.skipped) }]
      : []),
    {
      label: "Permission",
      value:
        `You confirm they agreed to hear from ${brandName} by email and text, and that ${brandName} collected this list itself.`,
    },
  ].slice(0, 6);
}

/** The confirmed write's arguments: the staged import, nothing else. */
export function importProposalArgs(
  brandId: string,
  answer: ContactImportAnswer,
): Record<string, unknown> {
  return {
    brand_id: brandId,
    action: "import",
    import_batch_id: answer.batch_id,
    import_preview_token: answer.preview_token,
    import_file_sha256: answer.file_sha256,
  };
}

const reviewStep: StepDefinition = {
  key: CONTACT_REVIEW_STEP,
  title: "Check your contact list",
  kind: "proposal",
  depends_on: [CONTACT_LIST_STEP],
  policy: "blocking",
  subject_tools: ["manage_brand_people"],
  async probe(ctx): Promise<ProbeResult> {
    const answer = answerOf(ctx.run);
    if (!answer) {
      return { done: false, ask: listQuestion(ctx) };
    }
    // After a confirm (or on any later read while it was waiting), the
    // import itself says whether it saved: the run never trusts the card.
    if (
      ctx.deps.contactImportStatus &&
      (ctx.run.subject_id === answer.batch_id ||
        ctx.state?.state === "awaiting_approval")
    ) {
      let status = null;
      try {
        status = await ctx.deps.contactImportStatus(answer.batch_id);
      } catch (_error) {
        // Unreadable just now: not proven saved, so not done.
        status = null;
      }
      if (status && status.state === "completed") {
        return {
          done: true,
          evidence: {
            probe: "contact_import_readback",
            observed: {
              batch_id: status.batch_id,
              state: status.state,
              counts: status.counts,
            },
          },
        };
      }
    }
    if (
      ctx.state?.state === "awaiting_approval" && !ctx.failed &&
      (await ctx.deps.hasOpenProposal?.())
    ) {
      return { done: false, wait: true };
    }
    return {
      done: false,
      ask: reviewQuestion(
        ctx,
        answer,
        ctx.failed
          ? (ctx.failed.message || "the import couldn't finish just now.")
          : null,
      ),
    };
  },
  onAnswer(ctx, choiceId) {
    const answer = answerOf(ctx.run);
    if (!answer) return Promise.resolve(null);
    switch (choiceId) {
      case "import": {
        const count = importableCount(answer.counts);
        if (count === 0) return Promise.resolve(null);
        return Promise.resolve({
          record: { state: "awaiting_approval" },
          propose: {
            tool_name: "manage_brand_people",
            tool_args: importProposalArgs(ctx.run.brand_id, answer),
            rows: importProposalRows(answer, ctx.brandName),
            rows_only: true,
            card_title: `Import ${plural(count, "contact", "contacts")}`,
          },
        });
      }
      case "no_consent":
        return Promise.resolve({
          record: { state: "skipped" },
          cancel_run: true,
          ack:
            "Then I won't add them. Mingla only adds a list when the people on it agreed to hear from you, so nobody gets a blast they didn't ask for. Nothing was saved. If you collect their permission later, ask me again.",
        });
      case "reupload":
        return Promise.resolve({
          record: { state: "pending" },
          answers: { contact_import: { value: null, source: "owner" } },
          ack: "Okay — send the list you'd like to use instead.",
        });
      case "cancel":
        return Promise.resolve({
          record: { state: "skipped" },
          cancel_run: true,
          ack: "Okay, I've stopped. Nothing was saved.",
        });
      default:
        return Promise.resolve(null);
    }
  },
};

export const IMPORT_CONTACTS_FLOW: FlowDefinition = {
  key: IMPORT_CONTACTS_FLOW_KEY,
  version: 1,
  title: "Import contacts",
  subject: "brand",
  concurrency: "one_per_subject",
  noun: "contact list",
  readiness: {
    draft: "draft_save",
    publish: "draft_save",
    publish_paid: null,
  },
  subject_tools: ["manage_brand_people"],
  subject_table: null,
  steps: [accessStep, listStep, reviewStep],
  summarize(run) {
    const evidence = run.step_states[CONTACT_REVIEW_STEP]?.evidence;
    const observed = evidence?.observed as
      | { counts?: ContactImportCounts }
      | undefined;
    if (!evidence || !observed?.counts) return null;
    return {
      title: "Contacts imported",
      text: savedText(observed.counts, answerOf(run)),
      evidence,
    };
  },
};
