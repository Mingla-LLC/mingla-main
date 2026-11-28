import { compareFacts } from "../flows/lib.mjs";
import { judgeKunleReply } from "./judge.mjs";
import { KUNLE_GLOBAL_HARD_PREDICATES, KUNLE_SCENARIOS } from "./scenarios.mjs";

const READ_TOOL = /^(?:get|list|search|read|quote)_/;

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 58);
}

function orderRow(ctx, eventId, row, index) {
  const source = row.source ?? "manual_import";
  const isComp = source === "comp";
  const isDoorSale = source === "door_sale";
  // PostgREST requires every object in a bulk insert to expose the same keys.
  // Keep the three order kinds structurally identical and vary only values.
  return {
    event_id: eventId,
    total_cents: isComp ? 0 : row.totalCents,
    currency: "NGN",
    payment_method: isComp ? "free" : isDoorSale ? "cash" : "manual",
    payment_status: row.paymentStatus ?? "paid",
    source,
    comp_issued_by: isComp ? ctx.users.kunle_owner : null,
    comp_reason: isComp ? "Kunle eval fixture" : null,
    comp_request_key: isComp ? `kunle:${ctx.suffix}:${index}` : null,
    is_door_sale: isDoorSale,
    door_payment_method: isDoorSale ? "cash" : null,
  };
}

async function seedOrders(ctx, event, tier, specs, key) {
  const expanded = specs.flatMap((spec) =>
    Array.from({ length: spec.count ?? 1 }, () => spec)
  );
  if (expanded.length === 0) return [];
  const orders = await ctx.rest.insert(
    "orders",
    expanded.map((row, index) =>
      orderRow(ctx, event.id, row, `${key}:${index}`)
    ),
  );
  const ticketRows = orders.flatMap((order, index) =>
    expanded[index].ticket === false ||
      expanded[index].paymentStatus === "pending"
      ? []
      : [{
        order_id: order.id,
        ticket_type_id: tier.id,
        event_id: event.id,
        qr_code: `kunle-${ctx.suffix}-${key}-${index}`,
        status: index < Number(expanded[index].used ?? 0) ? "used" : "valid",
      }]
  );
  if (ticketRows.length > 0) await ctx.rest.insert("tickets", ticketRows);
  return orders;
}

async function seedExtraEvent(
  ctx,
  { title, status = "ended", priceCents, orders },
) {
  const [event] = await ctx.rest.insert("events", {
    brand_id: ctx.brands.kunle,
    created_by: ctx.users.kunle_owner,
    title,
    slug: slug(title),
    event_type: "event",
    status,
    visibility: "public",
    timezone: "Africa/Lagos",
  });
  await ctx.rest.insert("event_dates", {
    event_id: event.id,
    start_at: "2026-09-20T15:00:00Z",
    end_at: "2026-09-20T20:00:00Z",
    timezone: "Africa/Lagos",
    is_master: true,
  });
  const [tier] = await ctx.rest.insert("ticket_types", {
    event_id: event.id,
    name: "General",
    price_cents: priceCents,
    currency: "NGN",
    is_free: false,
    quantity_total: null,
    is_unlimited: true,
    available_online: true,
    available_in_person: true,
    allow_transfers: false,
  });
  await seedOrders(ctx, event, tier, orders, slug(title));
  return event;
}

async function seedScenarioFixture(ctx, scenario) {
  const title = scenario.id === "kunle_s6_performance"
    ? `Sunday Brunch ${ctx.suffix}`
    : `${scenario.id.replace(/^kunle_/, "")} ${ctx.suffix}`;
  const eventType = scenario.fixture.kind === "trip" ? "trip" : "event";
  const status = scenario.fixture.status ?? "draft";
  const [event] = await ctx.rest.insert("events", {
    brand_id: ctx.brands.kunle,
    created_by: ctx.users.kunle_owner,
    title,
    slug: slug(title),
    event_type: eventType,
    status,
    visibility: status === "draft" ? "draft" : "public",
    timezone: "Africa/Lagos",
    ...(scenario.fixture.refundPolicy === undefined
      ? {}
      : { refund_policy: scenario.fixture.refundPolicy }),
  });
  const past = ["ended", "cancelled"].includes(status);
  await ctx.rest.insert("event_dates", {
    event_id: event.id,
    start_at: past ? "2026-10-18T15:00:00Z" : "2026-12-06T15:00:00Z",
    end_at: past ? "2026-10-18T20:00:00Z" : "2026-12-06T21:00:00Z",
    timezone: "Africa/Lagos",
    is_master: true,
  });
  const [tier] = await ctx.rest.insert("ticket_types", {
    event_id: event.id,
    name: "General",
    price_cents: scenario.fixture.priceCents ?? 800000,
    currency: "NGN",
    is_free: false,
    quantity_total: scenario.fixture.capacity ?? null,
    is_unlimited: scenario.fixture.capacity === null,
    available_online: true,
    available_in_person: scenario.fixture.door === true,
    allow_transfers: scenario.fixture.transfers === true,
  });
  if (eventType === "trip") {
    await ctx.rest.insert("trip_pricing_tiers", {
      event_id: event.id,
      ticket_type_id: tier.id,
      tier_name: tier.name,
      tier_metadata: scenario.fixture.paymentPlan
        ? { payment_plan: scenario.fixture.paymentPlan }
        : {},
    });
  }
  const ticketCount = Number(scenario.fixture.tickets ?? 0);
  const compCount = Number(scenario.fixture.comps ?? 0);
  const ordinaryCount = Math.max(0, ticketCount - compCount);
  const seededOrders = await seedOrders(
    ctx,
    event,
    tier,
    [
      ...(ordinaryCount > 0
        ? [{
          count: ordinaryCount,
          totalCents: scenario.fixture.priceCents ?? 800000,
        }]
        : []),
      ...(compCount > 0
        ? [{ count: compCount, totalCents: 0, source: "comp" }]
        : []),
      ...(scenario.fixture.orderGroups ?? []),
    ],
    scenario.id,
  );
  if (scenario.fixture.refundRequests) {
    await ctx.rest.insert(
      "refunds",
      seededOrders.slice(0, scenario.fixture.refundRequests).map((
        order,
        index,
      ) => ({
        order_id: order.id,
        amount_cents: order.total_cents,
        currency: "NGN",
        reason: `Kunle eval request ${index + 1}`,
        initiated_by: ctx.users.kunle_owner,
        status: "pending",
      })),
    );
  }
  if (scenario.fixture.mixedOrders) {
    await seedOrders(ctx, event, tier, [
      { totalCents: 3600000 },
      { totalCents: 1800000, paymentStatus: "pending", ticket: false },
      { totalCents: 0, source: "comp" },
    ], `${scenario.id}:mixed`);
  }
  const titles = [title];
  if (scenario.id === "kunle_s6_performance") {
    await seedOrders(
      ctx,
      event,
      tier,
      [{ totalCents: 111000000 }],
      "s6-brunch",
    );
    const rooftop = await seedExtraEvent(ctx, {
      title: `Rooftop Sessions ${ctx.suffix}`,
      priceCents: 800000,
      orders: [
        { count: 3, totalCents: 800000 },
        { totalCents: 0, source: "door_sale" },
      ],
    });
    const paint = await seedExtraEvent(ctx, {
      title: `Paint & Plate ${ctx.suffix}`,
      priceCents: 1000000,
      orders: [{ count: 4, totalCents: 1000000, used: 2 }],
    });
    titles.push(rooftop.title, paint.title);
  }
  const otherTitle = `Kunle Other Brand Secret ${ctx.suffix}`;
  const [other] = await ctx.rest.insert("events", {
    brand_id: ctx.brands.kunle_other,
    created_by: ctx.users.kunle_owner,
    title: otherTitle,
    slug: slug(otherTitle),
    event_type: "event",
    status: "live",
    visibility: "public",
    timezone: "Africa/Lagos",
  });
  await ctx.rest.insert("event_dates", {
    event_id: other.id,
    start_at: "2026-12-19T18:00:00Z",
    end_at: "2026-12-19T22:00:00Z",
    timezone: "Africa/Lagos",
    is_master: true,
  });
  return { eventId: event.id, title, titles, otherTitle };
}

function agentRunOf(value) {
  if (!value || typeof value !== "object") return null;
  if (value.agent_run && typeof value.agent_run === "object") {
    return value.agent_run;
  }
  for (const child of Object.values(value)) {
    const found = agentRunOf(child);
    if (found) return found;
  }
  return null;
}

async function turnTrace(ctx, session, data) {
  let run = agentRunOf(data);
  let savedRows = [];
  if (session.conversationId) {
    savedRows = await ctx.rest.select(
      "agent_messages",
      `select=role,content,tool_results&conversation_id=eq.${session.conversationId}&order=created_at.desc&limit=30`,
    );
    if (!run) {
      run = savedRows.map((row) => agentRunOf(row.content)).find(Boolean) ??
        null;
    }
  }
  const observations = Array.isArray(run?.observations) ? run.observations : [];
  const persistedTools = savedRows.flatMap((row) => {
    const result = row?.tool_results;
    return result && typeof result === "object" &&
        typeof result.tool_name === "string"
      ? [result.tool_name]
      : [];
  });
  const tools = [...new Set([
    ...observations.map((item) => String(item.tool ?? "")).filter(Boolean),
    ...persistedTools,
  ])];
  const directText = String(data?.text ?? data?.message ?? "").trim();
  const savedText = savedRows.flatMap((row) => {
    if (row?.role !== "assistant") return [];
    const text = row?.content?.text;
    return typeof text === "string" && text.trim() ? [text.trim()] : [];
  })[0] ?? "";
  const actions = session.conversationId
    ? await ctx.rest.select(
      "agent_pending_actions",
      `select=id,tool_name,tool_args,status&conversation_id=eq.${session.conversationId}&order=created_at.desc`,
    )
    : [];
  const pending = actions.filter((action) => action.status === "pending");
  for (const action of pending) {
    await ctx.rest.update("agent_pending_actions", `id=eq.${action.id}`, {
      status: "cancelled",
      failure_reason: "KUNLE_EVAL_CLEANUP",
    });
  }
  return {
    text: directText || savedText,
    tools,
    proposal: data?.kind === "pending_action"
      ? { tool: data.tool_name, args: data.tool_args }
      : pending[0]
      ? { tool: pending[0].tool_name, args: pending[0].tool_args }
      : null,
    executedWrites: actions.filter((action) =>
      action.status === "executed" &&
      !READ_TOOL.test(String(action.tool_name ?? ""))
    ),
    observations,
  };
}

function hardFacts(scenario, trace) {
  return [...KUNLE_GLOBAL_HARD_PREDICATES, ...scenario.hardPredicates].map(
    (rule) => {
      let passed = false;
      try {
        passed = Boolean(rule.check({ ...trace, scenario }));
      } catch {
        passed = false;
      }
      return {
        fact: `hard: ${rule.id}`,
        expected: true,
        actual: passed,
      };
    },
  );
}

export function shouldRetryKunleTurn(data) {
  if (
    data?.kind === "error" &&
    [
      "MODEL_UNAVAILABLE",
      "WORKER_LIMIT",
      "HTTP_502",
      "HTTP_503",
      "HTTP_504",
    ].includes(String(data?.code ?? ""))
  ) return true;
  const run = agentRunOf(data);
  return Array.isArray(run?.observations) && run.observations.some((item) =>
    ["MODEL_UNAVAILABLE", "WORKER_LIMIT"].includes(
      String(item?.error_code ?? item?.error?.code ?? ""),
    )
  );
}

export function shouldRetryKunleError(error) {
  return error instanceof TypeError || /\bfetch failed\b/i.test(
    String(error?.message ?? error ?? ""),
  );
}

export const KUNLE_EVALS = KUNLE_SCENARIOS.map((scenario) => ({
  meta: {
    id: scenario.id,
    brand: "kunle",
    account: "kunle_owner",
    capabilities: ["ari-host-assistant", "events-orders-refunds"],
  },
  async run(ctx) {
    const fixture = await seedScenarioFixture(ctx, scenario);
    let session = await ctx.session("kunle_owner", "kunle", {
      timezone: "Africa/Lagos",
    });
    const prompt = `${scenario.prompt}\n\nThe matching Mingla listing${
      fixture.titles.length === 1 ? " is" : "s are"
    } titled ${fixture.titles.map((title) => `"${title}"`).join(", ")}.`;
    let data;
    try {
      data = await session.say(prompt);
    } catch (error) {
      if (!shouldRetryKunleError(error)) throw error;
      session = await ctx.session("kunle_owner", "kunle", {
        timezone: "Africa/Lagos",
      });
      data = await session.say(prompt);
    }
    if (shouldRetryKunleTurn(data)) {
      const prior = session.transcript.at(-1);
      if (prior) {
        prior.typed = false;
        prior.transient_retry = true;
      }
      session = await ctx.session("kunle_owner", "kunle", {
        timezone: "Africa/Lagos",
      });
      data = await session.say(prompt);
    }
    const trace = await turnTrace(ctx, session, data);
    const hard = hardFacts(scenario, trace);
    const judge = await judgeKunleReply({
      apiKey: process.env.GEMINI_API_KEY_ARI,
      model: process.env.GEMINI_MODEL_ID ?? "gemini-3.6-flash",
      scenario,
      reply: trace.text,
    });
    return {
      facts: compareFacts([
        ...hard,
        ...judge.map((row) => ({
          fact: `judge: ${row.id}`,
          expected: true,
          actual: row.passed,
        })),
      ]),
    };
  },
}));

export function kunleVerdict(result) {
  if (result.error) return "Fail";
  const hard = (result.facts ?? []).filter((fact) =>
    fact.fact.startsWith("hard:")
  );
  const judged = (result.facts ?? []).filter((fact) =>
    fact.fact.startsWith("judge:")
  );
  if (hard.length === 0 || hard.some((fact) => !fact.passed)) return "Fail";
  return judged.length > 0 && judged.every((fact) => fact.passed)
    ? "Pass"
    : "Partial";
}
