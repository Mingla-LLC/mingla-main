/**
 * #4514 wave 4 review — the words of one delivery log line (pure, so tests and
 * the lazy FormRequestLog share it). Words, never colour alone.
 */

import { FORM_REQUEST_LOG_COPY as COPY } from "../components/forms/brandFormsCopy";
import type { FormRequestLogRow } from "../services/brandFormRequestService";

export const logWhen = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

/** "Ada D. · Ask · Text · Sent · 4 Mar, 18:02". */
export function logLine(row: FormRequestLogRow): string {
  const parts = [row.name, COPY.kind[row.kind]];
  if (row.channel !== null) parts.push(COPY.channel[row.channel]);
  const reason = row.reason !== null ? COPY.reason[row.reason] : undefined;
  parts.push(reason !== undefined ? `${COPY.status[row.status]} (${reason})` : COPY.status[row.status]);
  parts.push(logWhen(row.settledAt ?? row.createdAt));
  return parts.join(" · ");
}
