/**
 * Issue #3355 P3 — deterministic readiness answers (no model).
 *
 * "What does my brand still need before I can sell paid tickets?" is answered
 * straight from the canonical checklist (`brand_readiness`, P2) in plain
 * words, in well under a second: what blocks the action and who can fix it,
 * what can wait, and the money position (can sell vs can be paid out). Items
 * irrelevant to the action are left out.
 */

import {
  type BrandReadiness,
  type BrandReadinessItem,
  readinessMoneySentence,
} from "../agentReadinessTools.ts";
import type { ReadinessAction } from "../readinessCatalog.ts";
import { itemRelevantTo, listWords } from "./brandGate.ts";
import { READINESS_ACTION_WORDS } from "./index.ts";

function blockerLine(item: BrandReadinessItem): string {
  if (item.fix.can_caller_fix) {
    return item.fix.route
      ? `${item.label}: you can sort this in ${item.fix.route_label}.`
      : `${item.label}: ${item.fix.route_label}.`;
  }
  return `${item.label}: only ${item.fix.who_can_fix} can do this.`;
}

function waitLabel(item: BrandReadinessItem): string {
  return item.deferral ? `${item.label} (set aside for now)` : item.label;
}

const MONEY_ACTIONS: ReadonlySet<string> = new Set([
  "publish_paid",
  "trip_installments",
  "stay_publish",
  "bank_setup",
  "refund",
]);

export function buildReadinessAnswer(args: {
  readiness: BrandReadiness;
  action: ReadinessAction | "all";
  brandName: string;
}): { text: string; firstFixRoute: string | null } {
  const { readiness, action, brandName } = args;
  if (action === "all") {
    const open = readiness.items.filter((item) => item.severity !== "done");
    if (open.length === 0) {
      return {
        text: `${brandName}'s checklist is complete. ${
          readinessMoneySentence(readiness.money)
        }`,
        firstFixRoute: null,
      };
    }
    const groups: Array<[string, (item: BrandReadinessItem) => boolean]> = [
      [
        "Brand profile",
        (item) =>
          ["identity", "contact", "location", "media"].includes(item.group),
      ],
      ["Website", (item) => item.group === "website"],
      ["Payments", (item) => item.group === "money"],
    ];
    const lines = groups.flatMap(([title, match]) => {
      const labels = open.filter(match).map(waitLabel);
      return labels.length > 0 ? [`${title}: ${listWords(labels)}.`] : [];
    });
    return {
      text: [
        `Here's what ${brandName} still has open:`,
        ...lines,
        readinessMoneySentence(readiness.money),
      ].join("\n"),
      firstFixRoute: open.find((item) => item.fix.can_caller_fix)?.fix.route ??
        null,
    };
  }
  const words = READINESS_ACTION_WORDS[action];
  const relevant = readiness.items.filter((item) =>
    itemRelevantTo(item, action) && item.severity !== "done"
  );
  const blocking = relevant.filter((item) => item.blocks_action);
  const canWait = relevant.filter((item) => !item.blocks_action);
  const parts: string[] = [];
  if (blocking.length === 0) {
    parts.push(`Nothing is stopping ${brandName} from being able to ${words}.`);
  } else {
    parts.push(
      `Before ${brandName} can ${words}, ${
        blocking.length === 1 ? "this needs" : "these need"
      } doing:`,
    );
    parts.push(...blocking.map((item) => `- ${blockerLine(item)}`));
  }
  if (canWait.length > 0) {
    parts.push(
      `These would help but can wait: ${listWords(canWait.map(waitLabel))}.`,
    );
  }
  // #2830 P4: the money sentence only when the lines above don't already
  // say it — when a payment item is listed (blocking or can-wait), the
  // closing sentence repeated those same blockers in other words.
  const moneyListed = relevant.some((item) => item.key.startsWith("money."));
  if (MONEY_ACTIONS.has(action) && !moneyListed) {
    parts.push(readinessMoneySentence(readiness.money));
  }
  return {
    text: parts.join("\n"),
    firstFixRoute:
      blocking.find((item) => item.fix.can_caller_fix && item.fix.route)?.fix
        .route ?? null,
  };
}
