// Issue #4255 — the address side of the two panels (components/ui/PanelStack).
//
// A page passes its own address (useHashQuery) and gets:
//   side        panel two from `side=<kind>:<id>`, or null
//   trail       the items panel two showed before, for its Back button
//   openSide    open an item in panel two (a new history entry, so the
//               browser's Back closes it again)
//   closeSide   close panel two
//   back        show the item panel two showed before
//   backTo      #4270 W7: pop the trail back to one of its entries (the
//               breadcrumb), in one step
//   titles      what each panel is called (its Drawer says), for Back words
// Panel one stays exactly as the page names it, so what is typed there is
// never touched by any of this.
//
// #4270 W7: `{ kinds }` names what this page's panel can show (a Brand group
// also opens a brand's Calendar); every other page keeps SIDE_KINDS.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SIDE_KINDS, cleanSide, parseSide, popTrail, pushTrail, sameSide, withSide } from "../lib/panelStack";

export function usePanelStack(search, setSearch, { kinds = SIDE_KINDS } = {}) {
  const side = useMemo(() => parseSide(search, kinds), [search, kinds]);
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);
  const titles = useRef({ 1: "", 2: "" });
  const [trail, setTrail] = useState([]);

  // The address changed by itself (the browser's Back, a pasted link): keep
  // the trail in step with it.
  const sideKey = side ? `${side.kind}:${side.id}` : "";
  useEffect(() => {
    setTrail((list) => {
      if (!sideKey) return list.length ? [] : list;
      const last = list[list.length - 1];
      if (last && `${last.side.kind}:${last.side.id}` === sideKey) return list.slice(0, -1);
      return list;
    });
  }, [sideKey]);

  const openSide = useCallback(
    (next) => {
      const clean = cleanSide(next, kinds);
      if (!clean) return;
      const current = parseSide(searchRef.current, kinds);
      if (sameSide(current, clean, kinds)) return;
      setTrail((list) => pushTrail(list, current ? { side: current, title: titles.current[2] } : null, clean, kinds));
      setSearch(withSide(searchRef.current, clean, kinds));
    },
    [setSearch, kinds]
  );

  const closeSide = useCallback(() => {
    setTrail([]);
    if (parseSide(searchRef.current, kinds)) setSearch(withSide(searchRef.current, null, kinds), { replace: true });
  }, [setSearch, kinds]);

  const trailRef = useRef(trail);
  useEffect(() => {
    trailRef.current = trail;
  }, [trail]);
  const back = useCallback(() => {
    const { trail: rest, back: entry } = popTrail(trailRef.current);
    setTrail(rest);
    if (entry) setSearch(withSide(searchRef.current, entry.side, kinds), { replace: true });
  }, [setSearch, kinds]);

  // The breadcrumb: show trail[index] again, dropping it and everything after.
  const backTo = useCallback((index) => {
    const list = trailRef.current;
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return;
    const entry = list[index];
    setTrail(list.slice(0, index));
    setSearch(withSide(searchRef.current, entry.side, kinds), { replace: true });
  }, [setSearch, kinds]);

  const links = useMemo(() => ({ openSide }), [openSide]);
  return { side, trail, setTrail, openSide, closeSide, back, backTo, titles, links };
}
