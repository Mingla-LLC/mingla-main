// #3720 — pure Feature Guide drift-note rules shared by the Avengers sync path.

export type FeatureGuideDriftRow = {
  capability_key: string;
  title: string;
  effective_status: string;
  verification_due_at: string | null;
  pinned_source_urls: string[] | null;
};

export type PinnedFeatureSource = {
  capabilityKey: string;
  title: string;
  commit: string;
  path: string;
  url: string;
};

export type FeatureGuideDriftInput = {
  weekStart: string;
  generatedAt: Date;
  entries: FeatureGuideDriftRow[];
  changedSources: PinnedFeatureSource[];
};

const SOURCE_URL =
  /^https:\/\/github\.com\/Mingla-LLC\/mingla-main\/blob\/([0-9a-f]{40})\/(.+)$/i;

export function featureGuideWeekStart(now: Date): string {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

export function parsePinnedFeatureSource(
  capabilityKey: string,
  title: string,
  url: string,
): PinnedFeatureSource | null {
  const match = SOURCE_URL.exec(url);
  if (!match) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  if (
    !path || path.startsWith("/") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) return null;
  return { capabilityKey, title, commit: match[1].toLowerCase(), path, url };
}

export function pinnedFeatureSources(
  entries: FeatureGuideDriftRow[],
): PinnedFeatureSource[] {
  const sources: PinnedFeatureSource[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const url of entry.pinned_source_urls ?? []) {
      const source = parsePinnedFeatureSource(
        entry.capability_key,
        entry.title,
        url,
      );
      if (!source) continue;
      const key =
        `${source.capabilityKey}\u0000${source.commit}\u0000${source.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push(source);
    }
  }
  return sources;
}

function dateLabel(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? "invalid date"
    : parsed.toISOString().slice(0, 10);
}

function bullet(key: string, title: string, suffix = ""): string {
  return `- \`${key}\` — ${title}${suffix}`;
}

export function buildFeatureGuideDriftNote(
  input: FeatureGuideDriftInput,
): string {
  const now = input.generatedAt.valueOf();
  const horizon = now + 14 * 24 * 60 * 60 * 1000;
  const upcoming = input.entries
    .filter((entry) => {
      if (!entry.verification_due_at) return false;
      const due = new Date(entry.verification_due_at).valueOf();
      return Number.isFinite(due) && due > now && due <= horizon;
    })
    .sort((a, b) =>
      String(a.verification_due_at).localeCompare(
        String(b.verification_due_at),
      ) || a.capability_key.localeCompare(b.capability_key)
    );
  const needsReview = input.entries
    .filter((entry) => entry.effective_status === "Needs review")
    .sort((a, b) => a.capability_key.localeCompare(b.capability_key));
  const changed = [...input.changedSources]
    .sort((a, b) =>
      a.capabilityKey.localeCompare(b.capabilityKey) ||
      a.path.localeCompare(b.path)
    );

  const lines = [
    `<!-- feature-guide-drift:${input.weekStart} -->`,
    `## Feature Guide weekly drift — ${
      input.generatedAt.toISOString().slice(0, 10)
    }`,
    "",
    `${input.entries.length} catalog entries checked against their current truth status and pinned source blobs on \`main\`.`,
    "",
    `### Review due within 14 days (${upcoming.length})`,
    ...(upcoming.length
      ? upcoming.map((entry) =>
        bullet(
          entry.capability_key,
          entry.title,
          ` — due ${dateLabel(String(entry.verification_due_at))}`,
        )
      )
      : ["- None."]),
    "",
    `### Needs review now (${needsReview.length})`,
    ...(needsReview.length
      ? needsReview.map((entry) => bullet(entry.capability_key, entry.title))
      : ["- None."]),
    "",
    `### Pinned source changed on main (${changed.length})`,
    ...(changed.length
      ? changed.map((source) =>
        bullet(
          source.capabilityKey,
          source.title,
          ` — \`${source.path}\` changed since \`${
            source.commit.slice(0, 12)
          }\``,
        )
      )
      : ["- None."]),
    "",
    "Admin/Support should review each listed entry and apply a current evidence packet before changing its truth status.",
  ];
  return lines.join("\n");
}
