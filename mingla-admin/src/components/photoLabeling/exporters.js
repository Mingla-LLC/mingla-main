// ORCH-0708 Phase 0 — exporters
//
// Browser-side download helpers. Anchors export emits a system-prompt
// injection block (text). Fixtures export emits a JSON file matching the
// photo_aesthetic_golden_fixtures.json schema referenced in spec §24.
//
// Both pull data via labelsService — only COMMITTED rows are exported.

import { fetchAnchorLabels, fetchFixtureLabels } from "./labelsService";

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Anchors export — system-prompt-injection text block ─────────────────────

export async function exportAnchorsJson() {
  const all = await fetchAnchorLabels();
  const committed = all.filter((l) => l.committed_at && l.label_category);
  if (committed.length === 0) {
    throw new Error("No committed anchors to export. Commit anchors first.");
  }

  const lines = [];
  lines.push("# Photo-aesthetic calibration anchors (operator-labeled)");
  lines.push("# Generated: " + new Date().toISOString());
  lines.push("# Total committed anchors: " + committed.length);
  lines.push("");

  for (const a of committed) {
    const place = a.place || {};
    lines.push("## " + (a.label_category || "uncategorized"));
    lines.push("- place: " + (place.name || "unknown") + " (" + (place.primary_type || "—") + ")");
    if (place.rating != null) {
      lines.push("- rating: " + Number(place.rating).toFixed(1) + " / " + (place.review_count ?? "?") + " reviews");
    }
    if (place.address) lines.push("- address: " + place.address);
    if (place.stored_photo_urls?.length) {
      lines.push("- photos: " + place.stored_photo_urls.slice(0, 5).join(", "));
    }
    lines.push("- expected_aggregate:");
    lines.push("```json");
    lines.push(JSON.stringify(a.expected_aggregate || {}, null, 2));
    lines.push("```");
    if (a.notes) {
      lines.push("- operator notes: " + a.notes);
    }
    lines.push("");
  }

  downloadFile(
    `photo_aesthetic_anchors_${new Date().toISOString().slice(0, 10)}.txt`,
    lines.join("\n"),
    "text/plain",
  );
  return committed.length;
}

// ── Fixtures export — JSON matching photo_aesthetic_golden_fixtures schema ──

export async function exportFixturesJson() {
  const all = await fetchFixtureLabels();
  const committed = all.filter((l) => l.committed_at);
  if (committed.length === 0) {
    throw new Error("No committed fixtures to export. Commit fixtures first.");
  }

  const fixtures = committed.map((f) => {
    const place = f.place || {};
    return {
      place_pool_id: f.place_pool_id,
      city: f.city,
      place: {
        name: place.name,
        primary_type: place.primary_type,
        rating: place.rating,
        review_count: place.review_count,
        address: place.address,
        stored_photo_urls: (place.stored_photo_urls || []).slice(0, 5),
      },
      expected_aggregate: f.expected_aggregate,
      notes: f.notes || null,
      labeled_at: f.labeled_at,
      committed_at: f.committed_at,
    };
  });

  const payload = {
    generated_at: new Date().toISOString(),
    schema_version: "photo_aesthetic_golden_fixtures.v1",
    total: fixtures.length,
    fixtures,
  };

  downloadFile(
    `photo_aesthetic_golden_fixtures_${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2),
    "application/json",
  );
  return committed.length;
}
