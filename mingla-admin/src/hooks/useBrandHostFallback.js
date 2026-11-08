// Issue #4270 (Wave 7 rework, D-6) — the brand's host card when the staff
// inbox cannot say (its read is missing or failed, or it has not covered this
// group yet). This is the lookup the Brand group used before Wave 7
// (ops_brand_host_record), so a brand that has a host card never looks as if
// it had none and is never offered "Create host card".
//
// Kept out of BrandGroupsPanel.jsx so the Brand groups tab itself reaches only
// Support reads (#3988 capability contract); the host card is Hosts and
// Creators data, read only for staff who can open Hosts.
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBrandHostRecord } from "../services/opsService";

const IDLE = Object.freeze({ status: "idle", recordId: "", name: "" });

/** { status: "idle" | "loading" | "ready" | "none" | "error", recordId, name, retry }. */
export function useBrandHostFallback(brandId, enabled) {
  const [state, setState] = useState(IDLE);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    if (!enabled || !brandId) { setState(IDLE); return; }
    setState({ status: "loading", recordId: "", name: "" });
    try {
      const row = await fetchBrandHostRecord(brandId);
      if (mine !== seq.current) return;
      setState(row?.record_id
        ? { status: "ready", recordId: row.record_id, name: row.name || "Host" }
        : { status: "none", recordId: "", name: "" });
    } catch (error) {
      // The caller shows "can't be shown right now" with Try again; the
      // database's own words go to the console, never on screen.
      if (mine !== seq.current) return;
      console.warn("[BrandGroup] host card lookup failed:", error?.message || error);
      setState({ status: "error", recordId: "", name: "" });
    }
  }, [brandId, enabled]);
  useEffect(() => { void load(); }, [load]);
  return { ...state, retry: load };
}
