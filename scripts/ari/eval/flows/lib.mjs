/**
 * #3355 P10 — shared client for Ari's live flow evals.
 *
 * LOCAL ONLY. Every URL this module talks to must be a loopback host; the
 * check runs before any request. The evals drive the real local agent-chat
 * and agent-confirm-action exactly as the Host does (structured flow answers
 * and confirms, never free-form model output) and read the saved records back
 * with the service role.
 *
 * Secrets are read from the environment (or a KEY=VALUE env file) and never
 * printed.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Throws unless `url` is http(s) on a loopback host. */
export function assertLocalUrl(url, label = "URL") {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error(`${label} is not a URL; refusing to run`);
  }
  if (!["http:", "https:", "postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${label} must be http(s) or postgres; refusing to run`);
  }
  if (!LOOPBACK.has(parsed.hostname)) {
    throw new Error(
      `${label} host "${parsed.hostname}" is not local; these evals and seeds run only against a local stack`,
    );
  }
  return parsed;
}

/** Loads KEY=VALUE lines into process.env without printing anything. */
export function loadEnvFile(path) {
  if (!path) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

export function option(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(
    prefix.length,
  ) ?? fallback;
}

/**
 * The local stack. `ARI_EVAL_URL` is the proxy that routes agent-* functions
 * to the local function servers and everything else to local Core.
 */
export function localConfig() {
  loadEnvFile(option("env-file") ?? process.env.ARI_EVAL_ENV_FILE ?? null);
  const url = (process.env.ARI_EVAL_URL ?? "http://127.0.0.1:56333").replace(
    /\/$/,
    "",
  );
  assertLocalUrl(url, "ARI_EVAL_URL");
  if (process.env.SUPABASE_DB_URL) {
    assertLocalUrl(process.env.SUPABASE_DB_URL, "SUPABASE_DB_URL");
  }
  if (process.env.DB_URL) assertLocalUrl(process.env.DB_URL, "DB_URL");
  const anonKey = process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anonKey || !serviceKey) {
    throw new Error(
      "ANON_KEY and SERVICE_ROLE_KEY are required (pass --env-file=<local env>)",
    );
  }
  return { url, anonKey, serviceKey };
}

async function json(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

/** Service-role REST helpers (readback and seeding). */
export function serviceRest(config) {
  const headers = {
    apikey: config.serviceKey,
    authorization: `Bearer ${config.serviceKey}`,
    "content-type": "application/json",
  };
  async function call(method, path, body, extra = {}) {
    const response = await fetch(`${config.url}${path}`, {
      method,
      headers: { ...headers, ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await json(response);
    if (!response.ok) {
      throw new Error(
        `${method} ${path.split("?")[0]} failed (${response.status}): ${
          data?.message ?? data?.msg ?? data?.code ?? "error"
        }`,
      );
    }
    return data;
  }
  return {
    select: (table, query) => call("GET", `/rest/v1/${table}?${query}`),
    insert: (table, rows) =>
      call("POST", `/rest/v1/${table}`, rows, {
        prefer: "return=representation",
      }),
    update: (table, query, patch) =>
      call("PATCH", `/rest/v1/${table}?${query}`, patch, {
        prefer: "return=representation",
      }),
    remove: (table, query) =>
      call("DELETE", `/rest/v1/${table}?${query}`, undefined, {
        prefer: "return=representation",
      }),
    rpc: (name, args) => call("POST", `/rest/v1/rpc/${name}`, args),
    auth: (method, path, body) => call(method, `/auth/v1${path}`, body),
  };
}

export async function signIn(config, email, password) {
  const response = await fetch(
    `${config.url}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: config.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  const body = await json(response);
  if (!response.ok || !body?.access_token) {
    throw new Error(`local sign-in failed for a seeded test account`);
  }
  return { token: body.access_token, userId: body.user?.id ?? null };
}

const ARI_UI = Object.freeze({
  protocol_version: 2,
  max_schema_version: 2,
  block_version: 1,
  action_version: 1,
  block_types: [
    "paragraph",
    "list",
    "key_value",
    "metrics",
    "table",
    "timeline",
    "progress",
    "choices",
    "input",
    "code",
    "sources",
    "callout",
  ],
  graphic_types: ["event", "media", "site", "research", "social"],
  platform: "web",
  app_version: "flow-eval",
  runtime_version: null,
});

function unwrap(envelope, status) {
  if (!envelope || envelope.protocol_version !== 1) {
    return {
      kind: "error",
      code: envelope?.code ?? `HTTP_${status}`,
      message: envelope?.message ?? envelope?.raw ?? "no envelope",
    };
  }
  if (envelope.kind === "error") {
    return {
      kind: "error",
      code: envelope.code,
      message: envelope.user_message,
    };
  }
  return envelope.data ?? { kind: "error", code: "EMPTY", message: "empty" };
}

/**
 * One signed-in Host session talking to Ari for one brand, the way the Host
 * app does: owner text only to start, then structured answers and confirms.
 */
export class AriSession {
  constructor(config, auth, brandId, { timezone = "Europe/London" } = {}) {
    this.config = config;
    this.auth = auth;
    this.brandId = brandId;
    this.timezone = timezone;
    this.conversationId = null;
    this.transcript = [];
  }

  async #post(fn, body) {
    const response = await fetch(`${this.config.url}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        apikey: this.config.anonKey,
        authorization: `Bearer ${this.auth.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return unwrap(await json(response), response.status);
  }

  async send(extra) {
    const data = await this.#post("agent-chat", {
      conversation_id: this.conversationId,
      client_turn_id: randomUUID(),
      client_timezone: this.timezone,
      locale: "en-GB",
      brand_id: this.brandId,
      ari_ui: ARI_UI,
      ...extra,
    });
    if (data.conversation_id) this.conversationId = data.conversation_id;
    this.transcript.push({ sent: summarizeSent(extra), got: summarize(data) });
    return data;
  }

  /** Owner words (the first message that starts a flow). */
  say(message) {
    return this.send({ message });
  }

  /** A chip answer on the current card. */
  choose(artefact, choiceId, displayText) {
    return this.send({
      flow_answer: {
        run_id: artefact.run_id,
        step_key: artefact.step_key,
        question_id: artefact.question_id,
        choice_id: choiceId,
        display_text: displayText ?? choiceId,
      },
    });
  }

  /** A form answer (text, choices, phone chip + number, picked place). */
  answer(artefact, values, displayText) {
    return this.send({
      flow_answer: {
        run_id: artefact.run_id,
        step_key: artefact.step_key,
        question_id: artefact.question_id,
        choice_id: "answer",
        display_text: (displayText ?? values.response ?? "answer").slice(
          0,
          200,
        ) || "answer",
        values: {
          choices: values.choices ?? [],
          country: values.country ?? null,
          response: values.response ?? "",
          ...(values.place ? { place: values.place } : {}),
        },
      },
    });
  }

  async confirm(pendingActionId) {
    const data = await this.#post("agent-confirm-action", {
      action: "confirm",
      continuation: "server",
      pending_action_id: pendingActionId,
      ari_ui: ARI_UI,
    });
    this.transcript.push({
      sent: `confirm`,
      got: summarize(data),
    });
    return data;
  }
}

function summarizeSent(extra) {
  if (extra.message) return `say: ${extra.message}`;
  if (extra.flow_answer) {
    return `answer ${extra.flow_answer.step_key}: ${extra.flow_answer.display_text}`;
  }
  return "send";
}

function summarize(data) {
  const artefact = artefactOf(data);
  return {
    kind: data.kind,
    code: data.code,
    step: artefact?.step_key ?? null,
    tool: data.tool_name ?? null,
    text: String(data.text ?? data.message ?? data.next?.text ?? "").slice(
      0,
      240,
    ),
  };
}

/** The current card in a chat or confirm response, if any. */
export function artefactOf(data) {
  if (!data) return null;
  if (data.flow) return data.flow;
  if (data.next?.artefact) return data.next.artefact;
  if (data.kind === "question_stale") return data.next ?? null;
  return null;
}

/**
 * Drives a flow the way an owner would: answer each card from `script`
 * (keyed by step_key, then by the card's question key when one step asks more
 * than one thing) and confirm each protected proposal, until `until(state)`
 * says stop. A card the script does not know fails the eval: the eval must
 * name every question it expects, so a new or reordered question is visible.
 *
 * script[step_key] = (artefact, state) => one of
 *   { choose: "<option id>", text?: "<display>" }
 *   { answer: { response?, choices?, country?, place? }, text?: "<display>" }
 *   { stop: true }
 */
export async function driveFlow(session, {
  start,
  script,
  confirmTools = null,
  maxSteps = 40,
}) {
  const state = {
    steps: [],
    proposals: [],
    executed: [],
    refusals: [],
    texts: [],
    last: null,
  };
  let data = await start();
  for (let index = 0; index < maxSteps; index += 1) {
    state.last = data;
    const text = data.text ?? data.next?.text ?? data.message ?? "";
    if (text) state.texts.push(String(text));
    if (data.kind === "error") {
      throw new Error(`Ari returned ${data.code}: ${data.message}`);
    }
    if (data.kind === "pending_action") {
      state.proposals.push({ tool: data.tool_name, args: data.tool_args });
      if (confirmTools && !confirmTools.includes(data.tool_name)) {
        throw new Error(`unexpected proposal ${data.tool_name}`);
      }
      const confirmed = await session.confirm(data.pending_action_id);
      if (confirmed.kind === "executed") {
        state.executed.push({ tool: confirmed.tool_name, result: confirmed.result });
      } else {
        state.refusals.push({
          tool: data.tool_name,
          kind: confirmed.kind,
          code: confirmed.code,
          message: confirmed.message,
        });
        if (confirmed.kind === "error" && !artefactOf(confirmed)) {
          return state;
        }
      }
      data = confirmed;
      continue;
    }
    const artefact = artefactOf(data);
    if (!artefact) return state;
    state.steps.push(artefact.step_key);
    const repeats = state.steps.slice(-4);
    if (repeats.length === 4 && repeats.every((key) => key === artefact.step_key)) {
      throw new Error(
        `stuck on card "${artefact.step_key}": ${String(artefact.text ?? "").slice(0, 200)}`,
      );
    }
    const handler = script[artefact.step_key];
    if (!handler) {
      throw new Error(
        `unscripted card "${artefact.step_key}" (${
          artefact.title ?? ""
        }: ${String(artefact.text ?? "").slice(0, 160)}) options=[${
          (artefact.options ?? []).map((o) => o.id).join(",")
        }]`,
      );
    }
    const move = await handler(artefact, state);
    if (!move || move.stop) return state;
    if (move.choose) {
      const option = (artefact.options ?? []).find((o) => o.id === move.choose);
      if (!option) {
        throw new Error(
          `card "${artefact.step_key}" has no option "${move.choose}" (has ${
            (artefact.options ?? []).map((o) => o.id).join(",")
          })`,
        );
      }
      data = await session.choose(artefact, move.choose, move.text ?? option.label);
    } else if (move.answer) {
      data = await session.answer(artefact, move.answer, move.text);
    } else {
      throw new Error(`script for "${artefact.step_key}" returned no move`);
    }
  }
  throw new Error(`flow did not finish within ${maxSteps} steps`);
}

/**
 * Compares expected facts with saved facts. Each fact prints, pass or fail.
 * `expected` may be a value (deep-equal) or a predicate `(actual) => boolean`
 * with a `label`.
 */
export function compareFacts(rows) {
  return rows.map(({ fact, expected, actual, label }) => {
    const passed = typeof expected === "function"
      ? Boolean(expected(actual))
      : JSON.stringify(actual) === JSON.stringify(expected);
    return {
      fact,
      expected: typeof expected === "function" ? label ?? "predicate" : expected,
      actual,
      passed,
    };
  });
}

/** A short unique suffix so every run's records are its own. */
export function runSuffix() {
  return randomUUID().slice(0, 6);
}

/** A picked place, the shape the Host's address search submits. */
export function place({
  venue,
  address,
  city,
  country,
  lat,
  lng,
  featureType = "poi",
  placeId,
}) {
  return {
    venue_name: venue,
    address,
    city,
    country_code: country,
    lat,
    lng,
    feature_type: featureType,
    ...(placeId ? { place_id: placeId } : {}),
  };
}
