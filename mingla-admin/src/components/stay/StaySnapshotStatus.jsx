import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { formatDateTime } from "../../lib/formatters";
import { staySnapshotState } from "./staySnapshotState";

export function StaySnapshotStatus({ snapshotAt }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const state = staySnapshotState(snapshotAt, now);
  if (state === "missing") {
    return <Badge variant="warning">Snapshot unavailable — reload before acting</Badge>;
  }
  if (state === "stale") {
    return (
      <span className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
        <Badge variant="warning" dot>Stale — reload before acting</Badge>
        <span className="text-xs text-[var(--color-text-tertiary)]">Captured {formatDateTime(snapshotAt)}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
      <Badge variant="success" dot>Fresh</Badge>
      <span className="text-xs text-[var(--color-text-tertiary)]">Captured {formatDateTime(snapshotAt)}</span>
    </span>
  );
}
