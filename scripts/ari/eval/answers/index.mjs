/**
 * #3355 rework 3 — Ari's answer-quality evals (tester retest 3: no eval asked
 * a read, how-to or "remember" question and graded the answer text).
 *
 * Each eval drives the real agent-chat (and agent-confirm-action where a card
 * is confirmed) on the LOCAL stack and grades the words the host reads:
 *   - read: "is <code> active and when does it end?" after the code was made
 *     through Ari — the answer says it is active and names 19 December;
 *   - how-to: publishing, payouts, refunds, drafts — a real answer, never a
 *     "nothing saved" line;
 *   - remember: a note is saved and Ari's reply says so truthfully;
 *   - support: a ticket is created on a confirmed card, and a later "did it go
 *     through?" is never told "nothing sent";
 *   - the receipt turn never shows "I couldn't format that answer";
 *   - read in brand time (rework 3b): "when does <code> end?" says 11:59 pm,
 *     the Lagos end, never the UTC-converted 10:59.
 * Score (run-live.mjs suite "answers"): facts passed / facts compared.
 * Every code and note is the run's own (suffix); nothing touches production.
 */

import { compareFacts } from "../flows/lib.mjs";

const NOTHING_SAVED =
  /haven't saved or sent anything|Nothing has been saved or sent|no card or receipt/i;
const COULDNT_FORMAT = /couldn't format that answer/i;
const DECEMBER_19 =
  /\b19(?:th)?\s+(?:of\s+)?Dec(?:ember)?\b|\bDec(?:ember)?\s+19(?:th)?\b/i;

const textOf = (data) =>
  String(data?.text ?? data?.message ?? data?.next?.text ?? "");

async function pendingFor(ctx, session, toolName) {
  const rows = await ctx.rest.select(
    "agent_pending_actions",
    `select=id,tool_name,tool_args,status&conversation_id=eq.${session.conversationId}&status=eq.pending&order=created_at.desc`,
  );
  return rows.find((row) => !toolName || row.tool_name === toolName) ?? null;
}

async function cancelOpen(ctx, session) {
  if (!session.conversationId) return;
  const rows = await ctx.rest.select(
    "agent_pending_actions",
    `select=id&conversation_id=eq.${session.conversationId}&status=eq.pending`,
  );
  for (const row of rows) {
    await ctx.rest.update("agent_pending_actions", `id=eq.${row.id}`, {
      status: "cancelled",
      failure_reason: "EVAL_CLEANUP",
    });
  }
}

/** A code made and confirmed through Ari, then asked about. */
const readCodeActive = {
  meta: {
    id: "answer_read_code_active_and_end",
    brand: "ng",
    account: "ng_owner",
    capabilities: ["ari-host-assistant", "events-discount-codes"],
  },
  async run(ctx) {
    const code = `RD${
      ctx.suffix.replace(/[^0-9a-z]/gi, "").toUpperCase().slice(0, 4)
    }10`;
    const session = await ctx.session("ng_owner", "ng", {
      timezone: "Africa/Lagos",
    });
    await session.say(
      `Create a discount code for my events using "${code}" as the code and 10% off this code and let it run from now until 19th of December 2026.`,
    );
    const card = await pendingFor(ctx, session, "create_discount");
    const confirmed = card ? await session.confirm(card.id) : null;
    const asked = await session.say(
      `Quick question: is ${code} active, and when does it end?`,
    );
    const answer = textOf(asked);
    await cancelOpen(ctx, session);
    return {
      facts: compareFacts([
        {
          fact: "the card was proposed",
          expected: true,
          actual: Boolean(card),
        },
        {
          fact: "receipt turn has no 'couldn't format' line",
          expected: (value) => !COULDNT_FORMAT.test(value),
          label: "no format error",
          actual: textOf(confirmed),
        },
        {
          fact: "answer names the code",
          expected: (value) => value.toUpperCase().includes(code),
          label: code,
          actual: answer,
        },
        {
          fact: "answer says it is active",
          expected: (value) =>
            /\b(?:active|live|running|in use|can use)\b/i.test(value),
          label: "active",
          actual: answer,
        },
        {
          fact: "answer gives the 19 December end",
          expected: (value) => DECEMBER_19.test(value),
          label: "19 December",
          actual: answer,
        },
        {
          fact: "answer is never 'nothing saved'",
          expected: (value) => !NOTHING_SAVED.test(value),
          label: "no false state",
          actual: answer,
        },
      ]),
    };
  },
};

/**
 * #3355 rework 3b: "when does <code> end?" is answered in the brand's own
 * time. Rework 3's device check got "10:59 PM West Africa Time" for an end of
 * 23:59:59 Lagos (the model converted the UTC ends_at itself). Graded on the
 * words "11:59 pm" (I-ARI-READS-IN-BRAND-TIME).
 */
const readCodeEndLocal = {
  meta: {
    id: "answer_read_code_end_local_time",
    brand: "ng",
    account: "ng_owner",
    capabilities: ["ari-host-assistant", "events-discount-codes"],
  },
  async run(ctx) {
    const code = `FV${
      ctx.suffix.replace(/[^0-9a-z]/gi, "").toUpperCase().slice(0, 4)
    }10`;
    const session = await ctx.session("ng_owner", "ng", {
      timezone: "Africa/Lagos",
    });
    await session.say(
      `Create a discount code for my events using "${code}" as the code and 10% off this code and let it run from now until 19th of December 2026.`,
    );
    const card = await pendingFor(ctx, session, "create_discount");
    if (card) await session.confirm(card.id);
    const asked = await session.say(`When does ${code} end?`);
    const answer = textOf(asked);
    await cancelOpen(ctx, session);
    return {
      facts: compareFacts([
        {
          fact: "the card was proposed",
          expected: true,
          actual: Boolean(card),
        },
        {
          fact: "answer gives the 19 December end",
          expected: (value) => DECEMBER_19.test(value),
          label: "19 December",
          actual: answer,
        },
        {
          fact: "answer gives 11:59 pm (brand time)",
          expected: (value) => /\b11[:.]59\s*(?:pm|p\.m\.)/i.test(value),
          label: "11:59 pm",
          actual: answer,
        },
        {
          fact: "answer never gives the wrong 10:59",
          expected: (value) => !/\b10[:.]59\b/.test(value),
          label: "no 10:59",
          actual: answer,
        },
      ]),
    };
  },
};

/** A how-to question: a real answer, and never a write-state line. */
function howTo(id, question, mustMatch, label) {
  return {
    meta: {
      id,
      brand: "ng",
      account: "ng_owner",
      capabilities: ["ari-host-assistant"],
    },
    async run(ctx) {
      const session = await ctx.session("ng_owner", "ng", {
        timezone: "Africa/Lagos",
      });
      const reply = await session.say(question);
      const answer = textOf(reply);
      await cancelOpen(ctx, session);
      return {
        facts: compareFacts([
          {
            fact: "a real answer (not blanked)",
            expected: (value) => value.trim().length >= 60,
            label: ">= 60 characters",
            actual: answer,
          },
          {
            fact: `answer covers ${label}`,
            expected: (value) => mustMatch.test(value),
            label,
            actual: answer,
          },
          {
            fact: "answer is never 'nothing saved'",
            expected: (value) => !NOTHING_SAVED.test(value),
            label: "no false state",
            actual: answer,
          },
          {
            fact: "no proposal card for a question",
            expected: "text",
            actual: reply?.kind === "pending_action" ? "proposal" : "text",
          },
        ]),
      };
    },
  };
}

/** "Remember …": the note is saved and the reply says so truthfully. */
const rememberNote = {
  meta: {
    id: "answer_remember_note_truthful",
    brand: "ng",
    account: "ng_owner",
    capabilities: ["ari-host-assistant"],
  },
  async run(ctx) {
    // A time of its own per run, so the note is new (a repeated note is
    // deduplicated by ari_remember_note).
    const seed = parseInt(ctx.suffix.slice(0, 4), 16);
    const marker = `${6 + (seed % 4)}:${
      String(5 + (seed % 11) * 5).padStart(2, "0")
    }pm`;
    const session = await ctx.session("ng_owner", "ng", {
      timezone: "Africa/Lagos",
    });
    const reply = await session.say(
      `Please remember this for the future: our doors always open at ${marker} for every event.`,
    );
    const answer = textOf(reply);
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const notes = await ctx.rest.select(
      "ari_memory_notes",
      `select=id,content,updated_at&active=eq.true&updated_at=gte.${since}&content=ilike.*${
        encodeURIComponent(marker)
      }*`,
    );
    const saved = notes.length > 0;
    await cancelOpen(ctx, session);
    return {
      facts: compareFacts([
        { fact: "the note was saved", expected: true, actual: saved },
        {
          fact: "the reply is truthful about the save",
          expected: (value) =>
            saved
              ? !NOTHING_SAVED.test(value) &&
                /\b(?:saved|remember|remembered|noted|got it|i'll keep|will keep|kept|updated|added|stored)\b/i
                  .test(value)
              : !/\b(?:saved|noted)\b/i.test(value),
          label: saved ? "confirms the save" : "claims no save",
          actual: answer,
        },
      ]),
    };
  },
};

/** A support ticket on a confirmed card, then "did it go through?". */
const supportTicket = {
  meta: {
    id: "answer_support_ticket_truthful",
    brand: "ng",
    account: "ng_owner",
    capabilities: ["ari-host-assistant"],
  },
  async run(ctx) {
    const session = await ctx.session("ng_owner", "ng", {
      timezone: "Africa/Lagos",
    });
    await session.say(
      `Please open a support ticket for me: my payout from last weekend (${ctx.suffix}) hasn't arrived.`,
    );
    const card = await pendingFor(ctx, session, "create_support_ticket");
    const confirmed = card ? await session.confirm(card.id) : null;
    const asked = await session.say("Did my support request go through?");
    const answer = textOf(asked);
    await cancelOpen(ctx, session);
    return {
      facts: compareFacts([
        {
          fact: "a support ticket card was proposed",
          expected: true,
          actual: Boolean(card),
        },
        {
          fact: "receipt turn has no 'couldn't format' line",
          expected: (value) => !COULDNT_FORMAT.test(value),
          label: "no format error",
          actual: textOf(confirmed),
        },
        {
          fact: "a sent request is never told as unsent",
          expected: (value) => !NOTHING_SAVED.test(value),
          label: "no false state",
          actual: answer,
        },
        {
          fact: "the answer is about the request",
          expected: (value) =>
            /\b(?:request|ticket|support|team|sent|went through)\b/i.test(
              value,
            ),
          label: "about the request",
          actual: answer,
        },
      ]),
    };
  },
};

export const ANSWER_EVALS = [
  readCodeActive,
  readCodeEndLocal,
  howTo(
    "answer_howto_publishing",
    "How do I publish my event so people can buy tickets?",
    /\bpublish/i,
    "publishing",
  ),
  howTo(
    "answer_howto_payouts",
    "When and how do I get paid for my ticket sales?",
    /\b(?:payout|paid|bank)\b/i,
    "payouts",
  ),
  howTo(
    "answer_howto_refunds",
    "How do refunds work for my guests?",
    /\brefund/i,
    "refunds",
  ),
  howTo(
    "answer_howto_drafts",
    "Do drafts show on Explore before I publish them?",
    /\b(?:no|not|private|only|until|after)\b[\s\S]*\bpublish/i,
    "drafts stay off Explore until published",
  ),
  rememberNote,
  supportTicket,
];

export const ANSWER_EVAL_IDS = ANSWER_EVALS.map((item) => item.meta.id);
