// Issue #4270 (Wave 7) — the plan items a Brand group's plan lines can name:
// the brand's plan from 60 days ago to 59 days ahead (the 120-day most the
// server reads at once), so a line can open the post or task it is about.
// A new plan line whose title matches nothing reads the plan again, at most
// once every 2 s. Staff without Hosts and Creators access (no record) read
// nothing: their lines stay plain text.
import { useCallback, useEffect, useRef, useState } from "react";
import * as ops from "../services/opsService";
import { addDays, todayIso } from "../lib/opsModel";
import { matchPlanLine } from "../lib/brandGroupInbox";

export function useBrandGroupPlanItems(recordId, { brandName = "", lines = [] } = {}) {
  const [items, setItems] = useState([]);
  const [plan, setPlan] = useState(null);
  const seq = useRef(0);
  const timer = useRef(null);
  const linesRef = useRef(lines);
  const checked = useRef(new Set());
  useEffect(() => { linesRef.current = lines; });

  const load = useCallback(async () => {
    if (!recordId) { setItems([]); setPlan(null); return; }
    const mine = ++seq.current;
    const today = todayIso();
    const seen = (Array.isArray(linesRef.current) ? linesRef.current : []).map((line) => line?.id).filter(Boolean);
    try {
      const data = await ops.fetchBrandPlan(recordId, addDays(today, -60), addDays(today, 59), today);
      if (mine !== seq.current) return;
      for (const id of seen) checked.current.add(id);
      setPlan(data || null);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      // Lines that cannot be matched stay plain text; say why in the console.
      if (mine === seq.current) console.warn("[BrandGroup] plan items not loaded:", error?.message || error);
    }
  }, [recordId]);

  useEffect(() => {
    checked.current = new Set();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new host card starts empty, then loads
    setItems([]);
    setPlan(null);
    void load();
  }, [load]);

  // A plan line that arrived after the last read and names something not in
  // the list: read again, once, 2 s later.
  useEffect(() => {
    if (!recordId || seq.current === 0) return undefined;
    const fresh = (Array.isArray(lines) ? lines : [])
      .some((line) => line?.id && !checked.current.has(line.id) && !matchPlanLine(line.content, items, brandName));
    if (!fresh) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void load(); }, 2_000);
    return () => clearTimeout(timer.current);
  }, [recordId, lines, items, brandName, load]);

  return { items, plan, reload: load };
}
