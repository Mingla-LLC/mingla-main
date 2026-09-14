import type { SealedMarketingAudienceKind } from "../../types/marketing";
import { supabase } from "../supabase";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label}: expected UUID, got ${JSON.stringify(value)}`);
  }
}

export async function getOrCreateMarketingCircleAudience(input: {
  actor_id: string;
  brand_id: string;
  audience_kind: "brand_followers" | "brand_circle_extended";
}): Promise<{ audienceId: string }> {
  assertUuid(input.actor_id, "getOrCreateMarketingCircleAudience.actor_id");
  assertUuid(input.brand_id, "getOrCreateMarketingCircleAudience.brand_id");
  const { data, error } = await supabase.rpc(
    "biz_get_or_create_marketing_circle_audience_v1",
    {
      p_actor_id: input.actor_id,
      p_brand_id: input.brand_id,
      p_audience_kind: input.audience_kind,
    },
  );
  if (error) throw error;
  return data as { audienceId: string };
}

export async function getMarketingAudienceKind(
  audienceId: string,
): Promise<SealedMarketingAudienceKind | null> {
  assertUuid(audienceId, "getMarketingAudienceKind.audience_id");
  const { data, error } = await supabase
    .from("marketing_audiences")
    .select("query_definition")
    .eq("id", audienceId)
    .maybeSingle();
  if (error) throw error;
  const kind = (data as { query_definition?: { kind?: unknown } } | null)
    ?.query_definition?.kind;
  return kind === "all_brand_people" || kind === "manual_group" ||
      kind === "brand_followers" || kind === "brand_circle_extended"
    ? kind
    : null;
}
