// #3720 Completion Wave 4 — governed Product Inbox ↔ Mingla Avengers bridge.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  ProductAvengersClient,
  type PublicProductReview,
} from "../_shared/productAvengers.ts";
import {
  buildFeatureGuideDriftNote,
  type FeatureGuideDriftRow,
  featureGuideWeekStart,
  pinnedFeatureSources,
} from "../_shared/featureGuideDrift.ts";
import { runReleaseBridges } from "../_shared/opsBridges.ts";

type Json = Record<string, unknown>;
type AdminClient = ReturnType<typeof createClient>;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function clients(
  request: Request,
): { admin: AdminClient; user: AdminClient; serviceRoleKey: string } {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !serviceRoleKey) {
    throw new Error("SERVER_CONFIG_MISSING");
  }
  return {
    admin: createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    user: createClient(url, anon, {
      global: {
        headers: { Authorization: request.headers.get("Authorization") ?? "" },
      },
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    serviceRoleKey,
  };
}

function safeCode(error: unknown): string {
  const value = error instanceof Error ? error.message : "SYNC_FAILED";
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(value) ? value : "SYNC_FAILED";
}

async function requireAdmin(user: AdminClient): Promise<boolean> {
  const result = await user.rpc("admin_team_my_access");
  if (result.error || !result.data || typeof result.data !== "object") {
    return false;
  }
  const access = result.data as { role?: unknown; status?: unknown };
  return access.status === "active" &&
    (access.role === "owner" || access.role === "admin");
}

async function reviewFor(
  admin: AdminClient,
  signalId: string,
): Promise<PublicProductReview> {
  const result = await admin
    .from("product_avengers_reviews")
    .select(
      "signal_id,public_title,public_problem_statement,public_outcome,public_acceptance_criteria,board_work_type,board_product,board_theme,board_priority,board_estimate,board_horizon,board_quarter",
    )
    .eq("signal_id", signalId)
    .single();
  if (result.error || !result.data) throw new Error("PUBLIC_REVIEW_MISSING");
  return result.data as PublicProductReview;
}

async function linkedIssueNumber(
  admin: AdminClient,
  signalId: string,
): Promise<number> {
  const link = await admin
    .from("product_signal_avengers_links")
    .select("item_id")
    .eq("signal_id", signalId)
    .single();
  if (link.error || !link.data?.item_id) {
    throw new Error("AVENGERS_LINK_MISSING");
  }
  const item = await admin
    .from("product_avengers_items")
    .select("issue_number")
    .eq("id", link.data.item_id)
    .single();
  const number = Number(item.data?.issue_number);
  if (item.error || !Number.isInteger(number) || number < 1) {
    throw new Error("AVENGERS_LINK_MISSING");
  }
  return number;
}

async function processCommand(
  admin: AdminClient,
  github: ProductAvengersClient,
  commandId: string,
): Promise<Json | null> {
  const claimed = await admin.rpc("issue_3720_claim_product_avengers_command", {
    p_command_id: commandId,
  });
  if (claimed.error) throw new Error("COMMAND_CLAIM_FAILED");
  if (!claimed.data) return null;
  const command = claimed.data as {
    id: string;
    signal_id: string;
    action: string;
    payload?: Json;
  };
  try {
    const review = await reviewFor(admin, command.signal_id);
    if (command.action === "search") {
      const candidates = await github.searchIssues(review);
      const completed = await admin.rpc(
        "issue_3720_complete_product_avengers_search",
        {
          p_command_id: command.id,
          p_candidates: candidates,
        },
      );
      if (completed.error) throw new Error("SEARCH_COMMIT_FAILED");
      return {
        command_id: command.id,
        action: command.action,
        candidate_count: candidates.length,
      };
    }

    let issueNumber: number;
    let linkKind: "existing" | "created" | null = null;
    if (command.action === "link_existing") {
      issueNumber = Number(command.payload?.issue_number);
      if (!Number.isInteger(issueNumber) || issueNumber < 1) {
        throw new Error("CANDIDATE_INVALID");
      }
      linkKind = "existing";
      await github.ensureProjectItem(issueNumber);
    } else if (command.action === "create_issue") {
      issueNumber = await github.createIssue(review);
      const { itemId } = await github.ensureProjectItem(issueNumber);
      await github.applyReviewedFields(itemId, review, true);
      linkKind = "created";
    } else {
      issueNumber = await linkedIssueNumber(admin, command.signal_id);
      if (command.action === "update_board") {
        const { itemId } = await github.ensureProjectItem(issueNumber);
        await github.applyReviewedFields(itemId, review, false);
      } else if (command.action !== "refresh") {
        throw new Error("COMMAND_ACTION_INVALID");
      }
    }

    const snapshot = await github.snapshot(issueNumber);
    const applied = await admin.rpc(
      "issue_3720_apply_product_avengers_snapshot",
      {
        p_command_id: command.id,
        p_signal_id: command.signal_id,
        p_link_kind: linkKind,
        p_snapshot: snapshot,
      },
    );
    if (applied.error) throw new Error("SNAPSHOT_COMMIT_FAILED");
    return {
      command_id: command.id,
      action: command.action,
      issue_number: issueNumber,
    };
  } catch (error) {
    const code = safeCode(error);
    await admin.rpc("issue_3720_fail_product_avengers_command", {
      p_command_id: command.id,
      p_error_code: code,
    });
    throw new Error(code);
  }
}

async function reconcile(
  admin: AdminClient,
  github: ProductAvengersClient,
): Promise<Json> {
  let commandCount = 0;
  let refreshed = 0;
  let failed = 0;
  const pending = await admin
    .from("product_avengers_commands")
    .select("id")
    .in("state", ["pending", "running"])
    .order("requested_at", { ascending: true })
    .limit(20);
  if (pending.error) throw new Error("COMMAND_LIST_FAILED");
  for (const row of pending.data ?? []) {
    try {
      const result = await processCommand(admin, github, String(row.id));
      if (result) commandCount += 1;
    } catch {
      failed += 1;
    }
  }

  let featureGuideDrift = "not_due";
  try {
    featureGuideDrift = await postWeeklyFeatureGuideDrift(admin, github);
  } catch {
    featureGuideDrift = "failed";
    failed += 1;
  }

  const items = await admin
    .from("product_avengers_items")
    .select("issue_number")
    .order("synced_at", { ascending: true })
    .limit(100);
  if (items.error) throw new Error("ITEM_LIST_FAILED");
  for (const item of items.data ?? []) {
    try {
      const snapshot = await github.snapshot(Number(item.issue_number));
      const applied = await admin.rpc(
        "issue_3720_apply_product_avengers_snapshot",
        {
          p_command_id: null,
          p_signal_id: null,
          p_link_kind: null,
          p_snapshot: snapshot,
        },
      );
      if (applied.error) throw new Error("SNAPSHOT_COMMIT_FAILED");
      refreshed += 1;
    } catch {
      failed += 1;
    }
  }
  // #3980 synced program: release records, main commits, the production
  // migrations status and engineering cards, after the #3720 steps.
  let bridges: Json = {};
  try {
    const result = await runReleaseBridges(admin, github, {
      log: (line) => console.log(JSON.stringify(line)),
    });
    failed += result.failed;
    bridges = {
      release_records: result.release_records,
      main_commits: result.main_commits,
      statuses_posted: result.statuses_posted,
      engineering_cards: result.engineering_cards,
      deferred: result.deferred,
      github_budget: result.github_budget,
    };
  } catch {
    failed += 1;
  }
  return {
    ok: true,
    commands_processed: commandCount,
    items_refreshed: refreshed,
    feature_guide_drift: featureGuideDrift,
    ...bridges,
    failed,
  };
}

async function postWeeklyFeatureGuideDrift(
  admin: AdminClient,
  github: ProductAvengersClient,
): Promise<string> {
  const generatedAt = new Date();
  const weekStart = featureGuideWeekStart(generatedAt);
  const claimed = await admin.rpc("issue_3720_claim_feature_guide_drift", {
    p_week_start: weekStart,
  });
  if (claimed.error?.code === "PGRST202") return "not_ready";
  if (claimed.error) throw new Error("DRIFT_CLAIM_FAILED");
  if (claimed.data !== true) return "not_due";

  try {
    const snapshot = await admin.rpc("issue_3720_feature_guide_drift_snapshot");
    if (snapshot.error || !Array.isArray(snapshot.data)) {
      throw new Error("DRIFT_SNAPSHOT_FAILED");
    }
    const entries = snapshot.data as FeatureGuideDriftRow[];
    const sources = pinnedFeatureSources(entries);
    const changedSources = await github.changedPinnedSources(sources);
    const body = buildFeatureGuideDriftNote({
      weekStart,
      generatedAt,
      entries,
      changedSources,
    });
    const marker = `feature-guide-drift:${weekStart}`;
    const commentId = await github.ensureIssueComment(3720, marker, body);
    const completed = await admin.rpc(
      "issue_3720_complete_feature_guide_drift",
      {
        p_week_start: weekStart,
        p_comment_id: commentId,
        p_summary: {
          catalog_count: entries.length,
          needs_review_count: entries.filter((entry) =>
            entry.effective_status === "Needs review"
          ).length,
          source_change_count: changedSources.length,
        },
      },
    );
    if (completed.error) throw new Error("DRIFT_COMPLETE_FAILED");
    return "posted";
  } catch (error) {
    await admin.rpc("issue_3720_fail_feature_guide_drift", {
      p_week_start: weekStart,
      p_error_code: safeCode(error),
    });
    throw error;
  }
}

export async function handleProductAvengers(
  request: Request,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return json(405, { code: "METHOD_NOT_ALLOWED" });
  }
  let server: ReturnType<typeof clients>;
  let github: ProductAvengersClient;
  try {
    server = clients(request);
    github = new ProductAvengersClient(
      Deno.env.get("SPRINT_ROLLOVER_TOKEN") ?? "",
    );
  } catch (error) {
    return json(503, { code: safeCode(error) });
  }
  const body = await request.json().catch(() => null) as {
    mode?: unknown;
    command_id?: unknown;
  } | null;
  const authorization = request.headers.get("Authorization") ?? "";
  const serviceCaller = authorization === `Bearer ${server.serviceRoleKey}`;
  try {
    if (body?.mode === "reconcile") {
      if (!serviceCaller) return json(403, { code: "FORBIDDEN" });
      return json(200, await reconcile(server.admin, github));
    }
    if (
      body?.mode !== "command" || typeof body.command_id !== "string" ||
      !UUID.test(body.command_id)
    ) {
      return json(400, { code: "BAD_REQUEST" });
    }
    if (!await requireAdmin(server.user)) {
      return json(403, { code: "FORBIDDEN" });
    }
    const result = await processCommand(server.admin, github, body.command_id);
    return result
      ? json(200, { ok: true, ...result })
      : json(409, { code: "COMMAND_NOT_AVAILABLE" });
  } catch (error) {
    return json(502, { code: safeCode(error) });
  }
}

if (import.meta.main) Deno.serve(handleProductAvengers);
