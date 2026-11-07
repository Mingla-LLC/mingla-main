// #4304 — Ari create_discount sends the one shape the SQL writer accepts, and
// a refused discount write reaches the Host as a plain sentence.
//
// Production 2026-11-06 17:19 UTC (agent_pending_actions): create_discount
// failed "EDGE_FAILED: brand-discount-upsert: Edge Function returned a non-2xx
// status code" for the args replayed below. Proven locally on PostgreSQL 17
// with the shipped DDL + issue_3872_upsert_discount: the event target carrying
// BOTH target_id and listing_kind violates brand_discount_targets.bdt_shape.
// deno-lint-ignore-file no-explicit-any
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { canonicalizeAgentProposalArgs } from "../agentTools.ts";
import { ToolError } from "../agentToolHelpers.ts";
import { OWNER_SPOKEN_REFUSAL_CODES } from "../agentToolAuthorization.ts";
import {
  DISCOUNT_WRITE_REFUSAL_COPY,
  DOMAIN_REFUSED_CODE,
} from "../ariRefusalCopy.ts";
import { DISCOUNT_PROPOSAL_REFUSED_CODE } from "../ariDiscountArgs.ts";

const BRAND = "6f7d1c52-0d4e-4a43-9a0e-1f6b7f2a9b10";
const EVENT = "3c1b5a8e-7d2f-4e61-8a4b-2b9c0d1e2f30";

// The exact failing production proposal (target uuid replaced).
const WYTHE20 = {
  brand_id: BRAND,
  code: "WYTHE20",
  kind: "code",
  name: "Wythe Weekender 20% Off",
  value_type: "percent",
  value_bps: 2000,
  scope_kind: "listings",
  targets: [{ target_id: EVENT, target_kind: "event", listing_kind: "event" }],
};

const tool = () => {
  const found = DOMAIN_TOOLS.find((t) => t.name === "create_discount");
  assert(found);
  return found;
};

function recordingClient(
  error: unknown = null,
): { client: any; calls: Array<{ name: string; body: any }> } {
  const calls: Array<{ name: string; body: any }> = [];
  return {
    calls,
    client: {
      functions: {
        invoke: (name: string, init: { body: unknown }) => {
          calls.push({ name, body: init.body });
          return Promise.resolve(
            error ? { data: null, error } : { data: { discount: {} }, error },
          );
        },
      },
    },
  };
}

const httpError = (status: number, body: unknown) => ({
  message: "Edge Function returned a non-2xx status code",
  context: new Response(JSON.stringify(body), { status }),
});

async function thrown(run: () => Promise<unknown>): Promise<ToolError> {
  try {
    await run();
  } catch (err) {
    assert(err instanceof ToolError, `expected ToolError, got ${err}`);
    return err;
  }
  throw new Error("expected a throw");
}

function refusalOf(run: () => unknown): ToolError {
  try {
    run();
  } catch (err) {
    assert(err instanceof ToolError);
    return err;
  }
  throw new Error("expected a refusal");
}

// MINGLA-INVARIANT: I-4304-ARI-DISCOUNT-TARGET-SHAPE | issue #4304 | An Ari discount target is either a specific listing (target_kind + target_id) or a whole listing kind (listing_kind), never both, matching bdt_shape.
Deno.test("#4304 the production WYTHE20 proposal is canonicalised before the card", () => {
  const canonical = canonicalizeAgentProposalArgs("create_discount", WYTHE20);
  assertEquals(canonical.targets, [{ target_kind: "event", target_id: EVENT }]);
  assertEquals(canonical.code, "WYTHE20");
  assertEquals(canonical.value_bps, 2000);
  assertFalse("value_minor" in canonical);
  // Idempotent: confirm-action re-canonicalises the stored proposal.
  assertEquals(
    canonicalizeAgentProposalArgs("create_discount", canonical),
    canonical,
  );
});

Deno.test("#4304 replaying the production args sends a bdt_shape-valid target", async () => {
  const { client, calls } = recordingClient();
  await tool().executor(WYTHE20, client, "user-1");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "brand-discount-upsert");
  const payload = calls[0].body.payload;
  assertEquals(payload.targets, [{ targetKind: "event", targetId: EVENT }]);
  for (const target of payload.targets) {
    assertFalse("listingKind" in target, "specific listing has no kind");
  }
  assertEquals(payload.code, "WYTHE20");
  assertEquals(payload.valueType, "percent");
  assertEquals(payload.valueBps, 2000);
  assertEquals(payload.valueMinor, undefined);
  assertEquals(payload.source, "ari");
});

Deno.test("#4304 whole-kind targets carry listing_kind and never a target_id", () => {
  const canonical = canonicalizeAgentProposalArgs("create_discount", {
    ...WYTHE20,
    scope_kind: "listing_kinds",
    targets: [
      { target_kind: "listing_kind", listing_kind: "trip", target_id: EVENT },
      { target_kind: "event", listing_kind: "experience" },
      { target_kind: "listing_kind", listing_kind: "trip" },
    ],
  });
  assertEquals(canonical.targets, [
    { target_kind: "listing_kind", listing_kind: "trip" },
    { target_kind: "listing_kind", listing_kind: "experience" },
  ]);
});

Deno.test("#4304 value fields follow the value type", () => {
  const percent = canonicalizeAgentProposalArgs("create_discount", {
    ...WYTHE20,
    value_minor: 500,
  });
  assertEquals(percent.value_bps, 2000);
  assertFalse("value_minor" in percent);
  const amount = canonicalizeAgentProposalArgs("create_discount", {
    ...WYTHE20,
    value_type: "amount",
    value_minor: 500,
  });
  assertEquals(amount.value_minor, 500);
  assertFalse("value_bps" in amount);
});

Deno.test("#4304 codes are normalised like SQL and refused in plain words when they can't fit", () => {
  const spaced = canonicalizeAgentProposalArgs("create_discount", {
    ...WYTHE20,
    code: " wythe-20 ",
  });
  assertEquals(spaced.code, "WYTHE20");
  for (const bad of ["AB", "SUMMER20!", "A".repeat(17), "", undefined]) {
    const error = refusalOf(() =>
      canonicalizeAgentProposalArgs("create_discount", {
        ...WYTHE20,
        code: bad,
      })
    );
    assertEquals(error.code, DISCOUNT_PROPOSAL_REFUSED_CODE);
    assert(error.message.includes("4 to 16 letters or numbers"));
    assert(!/[a-z]+_[a-z]+/.test(error.message), "no codes in owner words");
  }
  // Said to the Host before any card, not a 400 toast.
  assert(OWNER_SPOKEN_REFUSAL_CODES.has(DISCOUNT_PROPOSAL_REFUSED_CODE));
  // Automatic discounts carry no code at all.
  const automatic = canonicalizeAgentProposalArgs("create_discount", {
    ...WYTHE20,
    kind: "automatic",
    code: "IGNORED",
  });
  assertFalse("code" in automatic);
});

Deno.test("#4304 a target Ari can't place is asked about, not sent", () => {
  const error = refusalOf(() =>
    canonicalizeAgentProposalArgs("create_discount", {
      ...WYTHE20,
      targets: [{ target_kind: "event" }],
    })
  );
  assertEquals(error.code, DISCOUNT_PROPOSAL_REFUSED_CODE);
});

Deno.test("#4304 each writer refusal becomes the owner sentence, typed DOMAIN_REFUSED", async () => {
  for (
    const [detail, status] of [
      ["code_taken", 409],
      ["code_shape_invalid", 422],
      ["value_shape_invalid", 422],
      ["currency_missing", 422],
      ["target_shape_invalid", 422],
      ["target_not_discountable", 409],
      ["name_invalid", 422],
    ] as const
  ) {
    const { client } = recordingClient(
      httpError(status, { error: "discount_write_failed", detail }),
    );
    const error = await thrown(() => tool().executor(WYTHE20, client, "u"));
    assertEquals(error.code, DOMAIN_REFUSED_CODE, detail);
    assertEquals(error.message, DISCOUNT_WRITE_REFUSAL_COPY[detail]);
    assert(error.message.endsWith("Nothing was saved."));
  }
  // A genuine internal fault stays ambiguous (receipt recovery) and keeps the
  // writer's detail for diagnosis.
  const { client } = recordingClient(
    httpError(500, { error: "internal", detail: "internal" }),
  );
  const internal = await thrown(() => tool().executor(WYTHE20, client, "u"));
  assertEquals(internal.code, "EDGE_FAILED");
  assertEquals(
    internal.message,
    "brand-discount-upsert: Edge Function returned a non-2xx status code (internal)",
  );
});
