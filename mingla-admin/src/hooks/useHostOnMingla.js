// Issue #4270 (Wave 2) — the host card's one server read, shared by its To
// do, On Mingla and Brand and team blocks.
import { useCallback, useEffect, useRef, useState } from "react";
import * as ops from "../services/opsService";
import { todayIso } from "../lib/opsModel";

/**
 * The host card's one server read (ops_host_on_mingla), shared by To do, On
 * Mingla and Brand and team: { loading, data, error, retry }. A failed
 * refresh keeps what was shown.
 */
export function useHostOnMingla(recordId, brandId = "") {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!recordId) return;
    const mine = ++seq.current;
    try {
      const data = await ops.fetchHostOnMingla(recordId, todayIso());
      if (mine === seq.current) setState({ loading: false, data, error: null });
    } catch (error) {
      if (mine === seq.current) setState((prev) => ({ loading: false, data: prev.data, error }));
    }
  }, [recordId]);
  useEffect(() => { setState({ loading: true, data: null, error: null }); load(); }, [load, brandId]);
  return { ...state, retry: load };
}
