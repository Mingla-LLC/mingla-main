// Issue #4130 (Wave 6) — failed announcement pushes, read from the rows
// issue_3720_admin_announcement_deliveries returns (one per announcement,
// `delivery` = community_get_announcement_notification_status).
//
// Pure module: the Support banner, the Announcements table and the tests read it.

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * The push numbers of one announcement row: how many pushes failed for good
 * (not waiting on a retry), how many were tried, and the campaign Retry uses.
 */
export function pushDelivery(row) {
  const delivery = row?.delivery || {};
  const channels = delivery.channels || {};
  const failed = count(channels.push_failed);
  const accepted = count(channels.push_accepted);
  const retrying = count(channels.push_retrying);
  return {
    failed,
    retrying,
    tried: accepted + failed + retrying,
    campaignId: typeof delivery.campaign_id === "string" && delivery.campaign_id ? delivery.campaign_id : null,
  };
}

/**
 * The announcements whose pushes failed and can be sent again (they have a
 * campaign), newest first, as { id, title, sentAt, campaignId, failed, tried }.
 */
export function announcementsWithFailedPushes(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((row) => ({ row, push: pushDelivery(row) }))
    .filter(({ push }) => push.failed > 0 && push.campaignId)
    .map(({ row, push }) => ({
      id: row.id,
      title: typeof row.title === "string" ? row.title : "",
      sentAt: row.published_at || row.scheduled_at || row.updated_at || null,
      campaignId: push.campaignId,
      failed: push.failed,
      tried: push.tried,
    }))
    .sort((left, right) => String(right.sentAt || "").localeCompare(String(left.sentAt || "")));
}
