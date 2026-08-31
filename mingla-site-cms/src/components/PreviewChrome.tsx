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
  return (
    <main className="studio-preview-shell">
      <header className="studio-preview-toolbar">
        <a className="studio-text-button" href={closeUrl}>
          Close
        </a>
        <div className="studio-preview-switcher" role="group" aria-label="Preview width">
          {(["mobile", "tablet", "desktop"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={viewport === value}
              onClick={() => setViewport(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <div className="studio-preview-meta">
          <span>Revision {revision}</span>
          <span>Expires {new Date(expiresAt * 1000).toLocaleTimeString()}</span>
        </div>
        <button
          type="button"
          className="studio-secondary-button"
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </button>
        <a className="studio-primary-button" href={publishUrl}>
          Publish this revision
        </a>
      </header>
      <div className="studio-preview-banner" role="status">
        Private preview — not live. Publishing is always a separate confirmation.
      </div>
      <div className="studio-preview-canvas">
        <iframe
          key={refresh}
          title="Private Restaurant Website v1 preview — not live"
          src={frameSrc}
          style={{ width: VIEWPORT_WIDTH[viewport] }}
        />
      </div>
    </main>
  );
}
