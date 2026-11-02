/**
 * Issue #3355 P9 — the pieces the experience and stay flows share with the
 * event and trip flows: one price question in the brand's own currency (the
 * Host's payout-country prompt first when the brand has none), and the plain
 * reason a confirmed write was refused.
 *
 * I-ARI-NO-INVENTED-FACTS: no default price. A price is saved only from the
 * owner's own words, in the brand's currency, at or above the payment
 * provider's minimum.
 */

import {
  currencyWords,
  PAYOUT_COUNTRY_TOOL,
  payoutCountryProposal,
} from "../moneyGate.ts";
import { payoutRailFor } from "../../payoutCountries.ts";
import { ticketPriceBelowMinimum } from "../../money/providerMinimums.ts";
import { formatMinor, minorFromMajor } from "../../money/formatMinor.ts";
import { assertOwnerCopy } from "../../ariOwnerCopy.ts";
import {
  currencyOf,
  examplePrice,
  formResponse,
  parseTypedPrice,
  PAYOUT_COUNTRY_KEY,
  payoutCountryQuestion,
  proposalOpen,
  retry,
  textQuestion,
  typedAnswer,
} from "./event.ts";
import type {
  FlowAnswerValue,
  FlowContext,
  ProbeResult,
  StepDefinition,
} from "../types.ts";

/** A price the owner gave, in minor units of the brand's currency. */
export type OwnerPrice = { price_minor: number; currency: string };

export function ownerAnswer(value: unknown): FlowAnswerValue {
  return { value, source: "owner" };
}

export function doneWith(probe: string, observed: unknown): ProbeResult {
  return { done: true, evidence: { probe, observed } };
}

/** The owner-safe reason this run's confirmed write was refused, if it was. */
export function failedReason(
  ctx: FlowContext,
  tool: string,
  fallback: string,
): string | null {
  if (
    ctx.state?.state !== "awaiting_approval" || ctx.trigger !== "confirm" ||
    ctx.failed?.tool_name !== tool
  ) return null;
  return assertOwnerCopy(ctx.failed.message, {
    fallback,
    surface: "flow_text",
    mode: "prose",
  });
}

export function priceAnswer(
  ctx: FlowContext,
  key: string,
): OwnerPrice | null {
  const value = ctx.run.answers[key]?.value;
  if (!value || typeof value !== "object") return null;
  const price = value as Partial<OwnerPrice>;
  return typeof price.price_minor === "number" &&
      typeof price.currency === "string"
    ? price as OwnerPrice
    : null;
}

/** "£45.00" in the brand's currency. */
export function priceWords(price: OwnerPrice): string {
  return formatMinor(price.price_minor, price.currency, "en") ??
    `${price.price_minor / 100} ${price.currency}`;
}

/**
 * One price question (the Host's payout-country prompt first when the brand
 * has no currency). The answer is stored under `answerKey`.
 */
export function offeringPriceStep(args: {
  key: string;
  noun: string;
  dependsOn: string;
  answerKey: string;
  title: string;
  /** Ask only when this says so (paid, and no price saved yet). */
  needed(ctx: FlowContext): Promise<boolean>;
  question(example: string, ctx: FlowContext): string;
  label: string;
  placeholder(example: string): string;
}): StepDefinition {
  const countryPrefix = `${args.noun}:${PAYOUT_COUNTRY_KEY}:`;
  const asking = (ctx: FlowContext) =>
    ctx.run.current_artefact?.reuse_key.startsWith(countryPrefix) === true;
  return {
    key: args.key,
    title: args.title,
    kind: "question",
    depends_on: [args.dependsOn],
    policy: "blocking",
    async probe(ctx) {
      if (!await args.needed(ctx)) return doneWith("no_price_needed", true);
      if (priceAnswer(ctx, args.answerKey)) {
        return doneWith(`owner_${args.answerKey}`, true);
      }
      const brand = await ctx.deps.brandFacts?.() ?? null;
      const currency = currencyOf(brand?.default_currency);
      const proposed = ctx.state?.state === "awaiting_approval";
      if (brand && !currency) {
        // A price needs a currency: the Host's payout-country prompt first.
        if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
          return { done: false, wait: true };
        }
        const failed = failedReason(
          ctx,
          PAYOUT_COUNTRY_TOOL,
          "The payout country didn't save, so nothing was changed.",
        );
        return {
          done: false,
          ask: payoutCountryQuestion(ctx, brand.country_code, failed, args.noun),
        };
      }
      const example = examplePrice(currency ?? "GBP");
      return {
        done: false,
        ...(proposed && currency && ctx.trigger === "confirm"
          ? {
            note: `Saved and checked: ${ctx.brandName}'s prices are in ${
              currencyWords(currency)
            }.`,
          }
          : {}),
        ask: textQuestion({
          ctx,
          noun: args.noun,
          key: args.answerKey,
          title: args.title,
          text: args.question(example, ctx),
          label: args.label,
          placeholder: args.placeholder(example),
        }),
      };
    },
    textAnswer: (_ctx, text) => typedAnswer(text),
    async onAnswer(ctx, choiceId, given) {
      const response = formResponse(choiceId, given);
      if (response === null) return null;
      if (asking(ctx)) {
        const rail = payoutRailFor(response);
        if (!rail) {
          return retry(
            ctx,
            "Pick the country your bank account is in from the list. Nothing was saved.",
          );
        }
        const { ack, propose } = payoutCountryProposal(ctx, rail);
        return {
          record: {
            state: "awaiting_approval",
            data: { country_code: rail.country },
          },
          ack,
          propose,
        };
      }
      const brand = await ctx.deps.brandFacts?.() ?? null;
      const currency = currencyOf(brand?.default_currency);
      if (!currency) return { record: { state: "pending" } };
      const parsed = parseTypedPrice(response);
      if (!parsed) {
        return retry(ctx, "I need a price, like the example. Nothing was saved.");
      }
      if (parsed.typed_currencies && !parsed.typed_currencies.includes(currency)) {
        return retry(
          ctx,
          `You typed ${parsed.typed_price}, but ${ctx.brandName}'s prices are in ${
            currencyWords(currency)
          }. Nothing was saved.`,
        );
      }
      const priceMinor = minorFromMajor(parsed.price_major, currency);
      const tooLow = ticketPriceBelowMinimum(priceMinor, currency);
      if (tooLow) return retry(ctx, `${tooLow} Nothing was saved.`);
      const value: OwnerPrice = { price_minor: priceMinor, currency };
      return {
        record: { state: "pending" },
        answers: { [args.answerKey]: ownerAnswer(value) },
      };
    },
  };
}
