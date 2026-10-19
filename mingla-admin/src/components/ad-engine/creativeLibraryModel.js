/**
 * Issue #3697 — the words and rules behind the Creative Library cards and the
 * Campaign Builder video rows. Pure functions, so node:test can pin them.
 *
 * Fit comes from the server (the one channel matrix, `fit` on each library
 * row). These helpers only turn it into copy. Fit is advice on a library card:
 * "Use in campaign" stays enabled whatever the tiles say. Only the Builder
 * blocks a misfit, for the platforms that campaign runs on.
 * Invariant I-ADS-MISFIT-BLOCKED-IN-BUILDER (declared in mingla-admin/src/pages/__tests__/creativeLibraryFit.issue3697.test.js)
 */

export const PLATFORM_NAMES = Object.freeze({
  meta: "Meta",
  tiktok: "TikTok",
  google: "Google",
  snapchat: "Snapchat",
  reddit: "Reddit",
});

/** Fit tiles on a card, in the design's fixed order (Reddit is not shown). */
export const FIT_TILE_PLATFORMS = Object.freeze(["meta", "tiktok", "google", "snapchat"]);

export function platformName(platform) {
  return PLATFORM_NAMES[platform] ?? String(platform ?? "");
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

const NEED_LABEL = {
  "at least 5 seconds": "at least 5 s",
  "at least 3 seconds": "at least 3 s",
  "720p or higher": "a short side of 720+",
};

function needLabel(need) {
  return NEED_LABEL[need] ?? need;
}

/** The one-line reason on a fit tile, from the matrix's need phrases. */
export function fitReason(needs) {
  const list = Array.isArray(needs) ? needs : [];
  if (list.length === 0) return "Fits";
  const tooLong = list.find((need) => /seconds or less$/.test(need));
  if (tooLong) return `Too long (max ${tooLong.replace(/ seconds or less$/, "")} s)`;
  if (list.includes("720p or higher")) return "Short side must be 720+";
  return `Needs ${list.map(needLabel).join(", ")}`;
}

/** `{ platform, name, state: fits|misfit|warn, symbol, reason }` for one tile. */
export function fitTile(tile) {
  const name = platformName(tile?.platform);
  if (!tile) return { platform: null, name, state: "misfit", symbol: "✕", reason: "Not checked" };
  if (!tile.fits) {
    return { platform: tile.platform, name, state: "misfit", symbol: "✕", reason: fitReason(tile.needs) };
  }
  if (tile.warn) {
    return { platform: tile.platform, name, state: "warn", symbol: "!", reason: "Fits · vertical works better" };
  }
  return { platform: tile.platform, name, state: "fits", symbol: "✓", reason: "Fits" };
}

export function cardFitTiles(creative) {
  const byPlatform = new Map((creative?.fit ?? []).map((tile) => [tile.platform, tile]));
  return FIT_TILE_PLATFORMS.map((platform) =>
    fitTile(byPlatform.get(platform) ?? { platform, fits: false, needs: [] })
  );
}

function spokenNeed(need) {
  return String(need).replace("×", " by ");
}

/** The fit grid's single aria-label sentence. */
export function fitSentence(tiles) {
  const fits = tiles.filter((tile) => tile.state !== "misfit").map((tile) => tile.name);
  const misfits = tiles.filter((tile) => tile.state === "misfit");
  const parts = [];
  if (fits.length > 0) parts.push(`Fits ${joinNames(fits)}.`);
  for (const tile of misfits) {
    parts.push(`Won't fit ${tile.name}: ${spokenNeed(tile.reason.replace(/^Needs /, "needs ")).toLowerCase()}.`);
  }
  return parts.join(" ");
}

/** "Video · 0:15". */
export function durationBadge(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function ratioLabel(width, height, aspect) {
  const ratio = Number(aspect) || (width && height ? width / height : NaN);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const known = [["9:16", 9 / 16], ["4:5", 4 / 5], ["1:1", 1], ["16:9", 16 / 9], ["1.91:1", 1.91]];
  const match = known.find(([, value]) => Math.abs(ratio - value) <= 0.04);
  return match ? match[0] : `${ratio.toFixed(2)}:1`;
}

export function relativeTime(iso, nowMs = Date.now()) {
  const at = Date.parse(iso ?? "");
  if (!Number.isFinite(at)) return null;
  const minutes = Math.round((nowMs - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The card's source line. */
export function sourceLine(creative, nowMs = Date.now()) {
  const brand = creative?.brand_name;
  switch (creative?.source) {
    case "event_cover":
      return brand ? `Event cover · ${brand}` : "Event cover";
    case "ari_upload":
      return brand ? `From Ari · ${brand}` : "From Ari";
    case "host_upload":
      return brand ? `From host · ${brand}` : "From host";
    default: {
      const when = relativeTime(creative?.created_at, nowMs);
      const who = creative?.created_by_name ? `Uploaded by ${creative.created_by_name}` : "Uploaded to Mingla";
      return when ? `${who} · ${when}` : who;
    }
  }
}

export function usageLine(creative) {
  const total = Number(creative?.usage?.campaign_count ?? 0);
  const running = Number(creative?.usage?.active_campaign_count ?? 0);
  if (total === 0) return "Not used yet";
  return `Used in ${total} campaign${total === 1 ? "" : "s"} · ${running} running`;
}

/**
 * What the card's primary action can do. Fit never disables it (answer 7):
 * only Host media under the Terms hold (L-08) and archived cards do.
 */
export function useInCampaignState(creative) {
  if (creative?.status === "archived") return { shown: false, disabled: true, reason: null };
  if (creative?.house_reuse_allowed !== true) {
    const brand = creative?.brand_name ?? "this host";
    return {
      shown: true,
      disabled: true,
      reason: `Only ${brand}'s own ads can use this until host-media Terms are approved.`,
    };
  }
  return { shown: true, disabled: false, reason: null };
}

/**
 * Archive / Restore / Delete are Mingla's to manage for house media only;
 * Host media is managed by the brand (the server enforces the same rule).
 */
export function canManageLifecycle(creative) {
  return creative?.house_reuse_allowed === true;
}

/** The first reason "Delete permanently" is unavailable, or null. */
export function purgeBlockedReason(blockers, creative) {
  const list = Array.isArray(blockers) ? blockers : [];
  if (list.includes("campaign") || list.includes("plan_version")) {
    const total = Number(creative?.usage?.campaign_count ?? 0);
    const running = Number(creative?.usage?.active_campaign_count ?? 0);
    return total > 0
      ? `Can't delete: used by ${total} campaign${total === 1 ? "" : "s"} (${running} running). Archive it instead.`
      : "Can't delete: a saved campaign plan uses it. Archive it instead.";
  }
  if (list.includes("platform_ref") || list.includes("status_event")) return "An ad platform still holds a copy.";
  if (list.includes("duplicate_creative")) return "Another library item uses the same file.";
  if (list.includes("live_surface")) return "Still the cover on an event or brand.";
  if (list.includes("legal_hold")) return "Under legal hold.";
  if (list.includes("not_archived")) return "Archive it first.";
  if (list.includes("not_video")) return "Only videos can be deleted here.";
  if (list.includes("already_purged")) return "Already deleted.";
  return null;
}

function actualFor(need, row) {
  if (need === "1080×1920" || need === "720p or higher") {
    return row?.width && row?.height ? `${row.width}×${row.height}` : null;
  }
  if (/seconds/.test(need)) {
    return Number.isFinite(Number(row?.duration_seconds)) ? `${Math.round(Number(row.duration_seconds))} s` : null;
  }
  if (/^9:16/.test(need)) return ratioLabel(row?.width, row?.height, row?.aspect_ratio);
  if (need === "sound") return "silent";
  return null;
}

/**
 * Builder row state for a library video and the campaign's platforms:
 * `{ selectable, misfits: [{platform, needs}], reason }`. A misfit is blocked
 * here — and only here — with a reason naming the platform and the need.
 */
export function builderVideoRow(row, platforms) {
  const fit = new Map((row?.fit ?? []).map((tile) => [tile.platform, tile]));
  const misfits = (platforms ?? [])
    .map((platform) => fit.get(platform) ?? { platform, fits: false, needs: ["a check"] })
    .filter((tile) => !tile.fits);
  if (misfits.length === 0) return { selectable: true, misfits: [], reason: null };
  if (misfits.length === 1) {
    const [only] = misfits;
    const need = only.needs[0] ?? "a different video";
    const actual = actualFor(need, row);
    return {
      selectable: false,
      misfits,
      reason: `Can't use with ${platformName(only.platform)}: it needs ${needLabel(need)}${actual ? `, and this video is ${actual}` : ""}.`,
    };
  }
  const short = misfits.filter((tile) => tile.needs.some((need) => /^at least \d+ seconds$/.test(need)));
  const parts = [];
  if (short.length > 0) {
    const need = short[0].needs.find((n) => /^at least/.test(n));
    parts.push(`Too short for ${joinNames(short.map((tile) => platformName(tile.platform)))} (need ${needLabel(need)})`);
  }
  for (const tile of misfits.filter((t) => !short.includes(t))) {
    parts.push(`${platformName(tile.platform)} needs ${tile.needs.map(needLabel).join(", ")}`);
  }
  const sentence = parts.length > 1
    ? `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}.`
    : `${parts[0]}.`;
  return { selectable: false, misfits, reason: sentence };
}

/** The Builder alert when a platform change makes the chosen video misfit. */
export function selectedVideoMisfitAlert(row, platforms) {
  const state = builderVideoRow(row, platforms);
  if (state.selectable) return null;
  const names = joinNames(state.misfits.map((tile) => platformName(tile.platform)));
  return `Your video doesn't fit ${names} any more. Pick another video or remove ${names}.`;
}

/** Drop-zone copy while files hover over it. */
export function dragSummary(counts) {
  const total = (counts?.videos ?? 0) + (counts?.images ?? 0) + (counts?.other ?? 0);
  const parts = [];
  if (counts?.videos) parts.push(`${counts.videos} video${counts.videos === 1 ? "" : "s"}`);
  if (counts?.images) parts.push(`${counts.images} image${counts.images === 1 ? "" : "s"}`);
  return {
    title: total > 0 ? `Drop to upload ${total} file${total === 1 ? "" : "s"}` : "Drop to upload",
    sub: parts.join(", "),
  };
}

export function refusalTitle(count) {
  return count === 1 ? "1 file wasn't added" : `${count} files weren't added`;
}
