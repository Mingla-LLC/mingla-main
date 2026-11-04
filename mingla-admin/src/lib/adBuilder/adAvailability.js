/**
 * #4238 media-buyer — "Works here" per ad app and country, and the per-app
 * reach switch, as plain functions (node-testable; the panel renders them).
 *
 * A missing row means the app works there until staff mark it (Seth's
 * decision). Google has no reach switch (its reach planner needs Google's
 * allowlisting first).
 */

export const AVAILABILITY_APPS = ["meta", "tiktok", "snapchat", "google", "reddit"];
export const REACH_SWITCH_APPS = ["meta", "tiktok", "snapchat", "reddit"];

const APP_NAMES = {
  meta: "Facebook & Instagram",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  google: "Google",
  reddit: "Reddit",
};

export function appName(platform) {
  return APP_NAMES[platform] ?? platform;
}

/**
 * Rows for a country grid: one cell per app, "works" | "not_available" |
 * "not_checked" (no row).
 */
export function availabilityGrid(rows, countries) {
  const list = Array.isArray(rows) ? rows : [];
  return countries.map((country) => ({
    country,
    cells: AVAILABILITY_APPS.map((platform) => {
      const row = list.find(
        (item) => item.platform === platform && item.country_code === country,
      );
      return {
        platform,
        status: row ? row.status : "not_checked",
        reason: row?.reason ?? null,
      };
    }),
  }));
}

/** The countries to show: the ones staff marked, plus any extra asked for. */
export function availabilityCountries(rows, extra = []) {
  const set = new Set([
    ...(Array.isArray(rows) ? rows.map((row) => row.country_code) : []),
    ...extra.map((code) => String(code).trim().toUpperCase()),
  ]);
  return [...set].filter((code) => /^[A-Z]{2}$/.test(code)).sort();
}

/** Validate a staff edit before calling the RPC (the RPC re-checks). */
export function availabilityEditError({ platform, country, status, reason }) {
  if (!AVAILABILITY_APPS.includes(platform)) return "Pick an app.";
  if (!/^[A-Za-z]{2}$/.test(String(country ?? "").trim())) return "Use a two-letter country code.";
  if (!["works", "not_available", "not_checked"].includes(status)) return "Pick a status.";
  if (status === "not_available" && !String(reason ?? "").trim()) {
    return "Say why, in words a Host can read (for example: TikTok can't run ads in the United Kingdom on Mingla's account yet).";
  }
  return null;
}

/** The reach switch state per app from the Host-lane connection rows. */
export function reachSwitchStates(connections) {
  const list = Array.isArray(connections) ? connections : [];
  return REACH_SWITCH_APPS.map((platform) => {
    const row = list.find((item) => item.platform === platform && item.lane === "consumer");
    return {
      platform,
      connected: Boolean(row?.connected),
      enabled: row?.extra?.audience_estimate_certified === true,
    };
  });
}
