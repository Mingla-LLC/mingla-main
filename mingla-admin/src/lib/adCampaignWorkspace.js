const ATTENTION_DELIVERY_STATES = new Set([
  "ERROR",
  "FAILED",
  "REJECTED",
  "DISAPPROVED",
  "WITH_ISSUES",
  "ACCOUNT_DISABLED",
  "PENDING_BILLING_INFO",
]);

export function campaignNeedsAttention(campaign, now = new Date()) {
  if (!campaign || typeof campaign !== "object") return false;
  if (campaign.currency_status !== "aligned") {
    return true;
  }
  if (
    ATTENTION_DELIVERY_STATES.has(
      String(campaign.delivery_status ?? "").toUpperCase(),
    )
  ) {
    return true;
  }
  if (campaign.status !== "ACTIVE") return false;
  const syncedAt = Date.parse(campaign.status_synced_at ?? "");
  return (
    !Number.isFinite(syncedAt) || now.getTime() - syncedAt > 2 * 60 * 60 * 1000
  );
}

export function campaignLifecycle(campaign, now = new Date()) {
  if (campaignNeedsAttention(campaign, now)) return "needs_attention";
  if (["ARCHIVED", "DELETED"].includes(campaign?.status)) return "ended";
  if (campaign?.status === "ACTIVE") return "live";
  const startsAt = Date.parse(campaign?.starts_at ?? "");
  if (
    campaign?.status === "PAUSED" &&
    Number.isFinite(startsAt) &&
    startsAt > now.getTime()
  ) {
    return "scheduled";
  }
  return "paused";
}

export function filterAndSortCampaigns(
  campaigns,
  {
    query = "",
    lifecycle = "all",
    platform = "all",
    owner = "all",
    sort = "newest",
  } = {},
  now = new Date(),
) {
  const needle = query.trim().toLocaleLowerCase();
  const rows = (Array.isArray(campaigns) ? campaigns : []).filter(
    (campaign) => {
      if (
        lifecycle !== "all" &&
        campaignLifecycle(campaign, now) !== lifecycle
      ) {
        return false;
      }
      if (platform !== "all" && campaign.platform !== platform) return false;
      if (owner !== "all" && campaign.owner_kind !== owner) return false;
      if (!needle) return true;
      return [
        campaign.name,
        campaign.owner_label,
        campaign.platform,
        campaign.objective,
        campaign.delivery_status,
      ].some((value) =>
        String(value ?? "")
          .toLocaleLowerCase()
          .includes(needle),
      );
    },
  );

  return rows.sort((left, right) => {
    if (sort === "oldest") {
      return (
        Date.parse(left.created_at ?? 0) - Date.parse(right.created_at ?? 0)
      );
    }
    if (sort === "name") {
      return String(left.name ?? "").localeCompare(String(right.name ?? ""));
    }
    if (sort === "attention") {
      const attentionDelta =
        Number(campaignNeedsAttention(right, now)) -
        Number(campaignNeedsAttention(left, now));
      if (attentionDelta !== 0) return attentionDelta;
    }
    return Date.parse(right.created_at ?? 0) - Date.parse(left.created_at ?? 0);
  });
}
