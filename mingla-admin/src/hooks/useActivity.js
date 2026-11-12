// Issue #4398 — Messages > Mingla activity: one read of team_activity when
// Messages opens, and again after Mark all read.
import { useCallback, useEffect, useState } from "react";
import { getActivity } from "../services/dashboardService";

export function useActivity() {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    try { setState({ data: await getActivity(14), error: null, loading: false }); }
    catch (error) { setState((s) => ({ data: s.data, error, loading: false })); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { ...state, refetch: load };
}
