"use client";

import { useState } from "react";

type PreviewViewport = "mobile" | "tablet" | "desktop";

const VIEWPORT_WIDTH: Record<PreviewViewport, string> = {
  mobile: "320px",
  tablet: "768px",
  desktop: "min(100%, 1440px)",
};

export default function PreviewChrome({
  frameSrc,
  closeUrl,
  publishUrl,
  revision,
  expiresAt,
}: {
  frameSrc: string;
  closeUrl: string;
  publishUrl: string;
  revision: string;
  expiresAt: number;
}) {
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");
  const [refresh, setRefresh] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <main className="studio-preview-shell">
      {/*
        #2830 — ONE ROW. This toolbar previously wrapped to four rows on a
        phone (a `flex-wrap` rule, a `flex-basis: 100%` meta row, and a
        separate full-width banner), costing more vertical space than the
        website being previewed. The banner's guarantee is NOT dropped: it
        becomes the always-visible "Not live" pill below, which carries the
        same `role="status"` and stays on screen for the whole session rather
        than being a block a reader scrolls past.
      */}
      <header className="studio-preview-toolbar">
        <a className="studio-icon-button" href={closeUrl} aria-label="Close preview and return to Mingla">
          <span aria-hidden="true">&#8249;</span>
        </a>
        <div className="studio-preview-switcher" role="group" aria-label="Preview width">
          {(["mobile", "tablet", "desktop"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={viewport === value}
              onClick={() => setViewport(value)}
              data-viewport={value}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="studio-preview-pill"
          aria-expanded={detailsOpen}
          aria-label={`Not live. Revision ${revision}, expires ${new Date(expiresAt * 1000).toLocaleTimeString()}. Show preview details.`}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <span role="status">Not live</span>
        </button>
        <span className="studio-preview-spacer" />
        <button
          type="button"
          className="studio-icon-button"
          aria-label="Refresh preview"
          onClick={() => setRefresh((value) => value + 1)}
        >
          <span aria-hidden="true">&#8635;</span>
        </button>
        <button
          type="button"
          className="studio-icon-button studio-preview-details-toggle"
          aria-expanded={detailsOpen}
          aria-label={`Preview details. Revision ${revision}, expires ${new Date(expiresAt * 1000).toLocaleTimeString()}`}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <span aria-hidden="true">&#8230;</span>
        </button>
        <a className="studio-primary-button studio-preview-publish" href={publishUrl}>
          Publish
        </a>
      </header>
      {detailsOpen ? (
        <div className="studio-preview-details">
          <span>Revision {revision}</span>
          <span>Expires {new Date(expiresAt * 1000).toLocaleTimeString()}</span>
          <span>Publishing is always a separate confirmation.</span>
          <button
            type="button"
            className="studio-preview-details-refresh"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh preview
          </button>
        </div>
      ) : null}
      <div className="studio-preview-canvas">
        <iframe
          key={refresh}
          title="Private preview — not live"
          src={frameSrc}
          style={{ width: VIEWPORT_WIDTH[viewport] }}
        />
      </div>
    </main>
  );
}
