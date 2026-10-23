export const PAID_SOCIAL_PLATFORMS = ["meta", "snapchat", "tiktok"];

export const AUDIENCE_STATUS = {
  ready: { label: "Ready", variant: "success" },
  too_small: { label: "Too small", variant: "warning" },
  creating: { label: "Creating", variant: "info" },
  error: { label: "Error", variant: "error" },
};

export function audienceStatus(status) {
  return AUDIENCE_STATUS[status] ?? { label: "Unknown", variant: "default" };
}

export function formatAudienceSize(value) {
  return value !== null && value !== undefined && value !== "" &&
      Number.isFinite(Number(value))
    ? Number(value).toLocaleString()
    : "—";
}

export function audienceErrorCopy(row) {
  if (!row?.error) return null;
  if (/not.connected|credential|token|unauthorized|401/i.test(row.error)) {
    return "Reconnect this platform, then refresh the audience.";
  }
  if (/pixel/i.test(row.error)) {
    return "Reconnect the platform and confirm its web pixel, then refresh.";
  }
  if (/too.few|minimum|small/i.test(row.error)) {
    return "This audience needs at least 1,000 people before it can run.";
  }
  return "Refresh this audience. If it fails again, check the platform connection.";
}

export function audienceFilterValues(rows, key) {
  return [...new Set((rows ?? []).map((row) => row?.[key]).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}
