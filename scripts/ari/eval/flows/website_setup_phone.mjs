/**
 * #3355 P10 — website_setup_phone (SPEC §7.4, P4 / #2830).
 *
 * B-New's owner opens Website setup from the Website screen (a structured
 * kickoff, never owner words), answers each card with its real form control
 * and confirms each save, until the phone card: the country chip (GB) plus
 * the number as typed. Asserts on the SAVED brand: the phone is E.164 equal
 * to the chip's dial code plus the number, and no client-authored
 * "Continue Website setup" message was written to the chat.
 *
 * Setup (local only): any live Website setup run for B-New is cancelled and
 * its phone cleared, so the phone card is asked fresh every run.
 *
 * Mutation check: make the phone answer save `values.response` as typed
 * (skip the chip's dial code in `websiteSetup.ts`) and `saved phone` reads
 * "07700 900123", not "+447700900123"; bring back the Host's client
 * continuation send and `client continuation messages` is 1.
 */

import { compareFacts, driveFlow } from "./lib.mjs";

export const meta = {
  id: "website_setup_phone",
  brand: "new",
  account: "new_owner",
  capabilities: ["ari.brand.update_context"],
};

const PHONE_TYPED = "07700 900123";
const PHONE_E164 = "+447700900123";

function fieldIdOf(artefact) {
  const blocks = artefact?.rendition?.blocks ?? [];
  for (const block of blocks) {
    if (block?.field?.id) return block.field.id;
    if (block?.type === "choices" && block.id) return block.id;
  }
  return null;
}

const BRAND_ANSWERS = {
  description: {
    answer: { response: "Candlelit supper clubs in East London, every month." },
  },
  city_country: { answer: { response: "London, United Kingdom" } },
  contact_email: { answer: { response: "hello@lantern.example.test" } },
};

export async function run(ctx) {
  const brandId = ctx.brands[meta.brand];
  // Fresh state for this eval (local only).
  await ctx.rest.update(
    "ari_flow_runs",
    `brand_id=eq.${brandId}&flow_key=eq.website_setup&status=in.(active,awaiting_owner,awaiting_approval,awaiting_handoff,blocked)`,
    { status: "cancelled", current_artefact: null },
  );
  await ctx.rest.update("brands", `id=eq.${brandId}`, { contact_phone: null });

  const session = await ctx.session(meta.account, meta.brand);
  let phoneAnswered = false;
  const state = await driveFlow(session, {
    start: () =>
      session.send({
        website_setup_kickoff: {},
        workflow_context: "website_setup",
      }),
    maxSteps: 30,
    script: {
      offer: () => ({ answer: { choices: ["events"] }, text: "Events" }),
      brand: (artefact) => {
        const field = fieldIdOf(artefact);
        if (phoneAnswered) return { stop: true };
        if (field === "contact_phone") {
          phoneAnswered = true;
          return {
            answer: { country: "GB", response: PHONE_TYPED },
            text: `+44 ${PHONE_TYPED}`,
          };
        }
        const move = BRAND_ANSWERS[field];
        if (!move) {
          throw new Error(
            `unscripted Website brand field "${field}": ${
              JSON.stringify(artefact.rendition?.blocks ?? []).slice(0, 300)
            }`,
          );
        }
        return move;
      },
    },
  });
  const [brand] = await ctx.rest.select(
    "brands",
    `select=contact_phone&id=eq.${brandId}`,
  );
  const messages = session.conversationId
    ? await ctx.rest.select(
      "agent_messages",
      `select=role,content&conversation_id=eq.${session.conversationId}&role=eq.user`,
    )
    : [];
  const continuations = messages.filter((row) =>
    /^continue website setup/i.test(String(row.content ?? "").trim())
  );
  return {
    state,
    facts: compareFacts([
      { fact: "phone card answered", expected: true, actual: phoneAnswered },
      { fact: "saved phone (E.164 = chip + number)", expected: PHONE_E164, actual: brand?.contact_phone ?? null },
      {
        fact: "phone saved through a confirmed proposal",
        expected: true,
        actual: state.executed.length > 0 &&
          state.proposals.some((p) =>
            JSON.stringify(p.args ?? {}).includes(PHONE_E164)
          ),
      },
      {
        fact: "client continuation messages",
        expected: 0,
        actual: continuations.length,
      },
    ]),
  };
}
