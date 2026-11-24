// #4571 design v5: the host's ops_host_next row from HostNextContext, or null
// (creators, or not loaded yet). Shared by the card's status line and NextEventLine.
import { useContext } from "react";
import { HostNextContext } from "./useOpsWork";

export function useHostNextRow(record) {
  const ctx = useContext(HostNextContext);
  if (!ctx || !record) return null;
  return ctx[record.id] || null;
}
