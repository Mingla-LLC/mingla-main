// Issue #4130 (Wave 5) — load one Data room section.
//
// Returns { status, envelope, data, error, reload }; status is loading |
// error | ready. A section is fetched only while a tab that shows it is open
// (`enabled`), and again when the "as of" day changes or on Retry. A failed
// load is an error with a message, never empty numbers.
import { useCallback, useEffect, useState } from "react";
import { getDataRoomSection } from "../services/dataRoomAnalyticsService";

export function useDataRoomSection(section, asOf, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const key = `${section}|${asOf || ""}|${attempt}`;
  const [result, setResult] = useState({ key: null, envelope: null, error: "" });

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    getDataRoomSection(section, asOf)
      .then((envelope) => { if (live) setResult({ key, envelope, error: "" }); })
      .catch((e) => { if (live) setResult({ key, envelope: null, error: e?.message || "Couldn't load these numbers." }); });
    return () => { live = false; };
  }, [section, asOf, enabled, key]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const settled = result.key === key;
  const status = !settled ? "loading" : result.error ? "error" : "ready";
  const envelope = settled ? result.envelope : null;
  return { status, envelope, data: envelope?.data ?? null, error: settled ? result.error : "", reload };
}
