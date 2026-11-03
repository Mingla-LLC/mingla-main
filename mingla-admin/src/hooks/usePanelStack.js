// Issue #4255 — the address side of the two panels (components/ui/PanelStack).
//
// A page passes its own address (useHashQuery) and gets:
//   side        panel two from `side=<kind>:<id>`, or null
//   trail       the items panel two showed before, for its Back button
//   openSide    open an item in panel two (a new history entry, so the
//               browser's Back closes it again)
//   closeSide   close panel two
//   back        show the item panel two showed before
//   titles      what each panel is called (its Drawer says), for Back words
// Panel one stays exactly as the page names it, so what is typed there is
// never touched by any of this.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cleanSide, parseSide, popTrail, pushTrail, sameSide, withSide } from "../lib/panelStack";

export function usePanelStack(search, setSearch) {
  const side = useMemo(() => parseSide(search), [search]);
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
      const clean = cleanSide(next);
      if (!clean) return;
      const current = parseSide(searchRef.current);
      if (sameSide(current, clean)) return;
      setTrail((list) => pushTrail(list, current ? { side: current, title: titles.current[2] } : null, clean));
      setSearch(withSide(searchRef.current, clean));
    },
    [setSearch]
  );

  const closeSide = useCallback(() => {
    setTrail([]);
    if (parseSide(searchRef.current)) setSearch(withSide(searchRef.current, null), { replace: true });
  }, [setSearch]);

  const trailRef = useRef(trail);
  useEffect(() => {
    trailRef.current = trail;
  }, [trail]);
  const back = useCallback(() => {
    const { trail: rest, back: entry } = popTrail(trailRef.current);
    setTrail(rest);
    if (entry) setSearch(withSide(searchRef.current, entry.side), { replace: true });
  }, [setSearch]);

  const links = useMemo(() => ({ openSide }), [openSide]);
  return { side, trail, openSide, closeSide, back, titles, links };
}
