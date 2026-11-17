import type { Metadata } from "next";

/*
 * #4453 M8 — what someone sees when a private preview link has expired, been
 * turned off, or never existed. One answer for all three: the page cannot tell
 * a stranger which one it was, and it names no brand or site.
 */
export const metadata: Metadata = {
  title: "This preview link isn't working",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function SharedPreviewUnavailable() {
  return (
    <main
      data-shared-preview-unavailable="1"
      style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem", fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", lineHeight: 1.55, background: "#101013", color: "#f0eee9" }}
    >
      <div style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.75rem" }}>This preview link isn&apos;t working</h1>
        <p style={{ margin: 0 }}>It may have expired or been turned off by the person who sent it. Ask them for a new link.</p>
      </div>
    </main>
  );
}
