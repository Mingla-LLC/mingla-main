// #4452 §7.4 Where it shows: every page and spot (live or draft) using this
// form, read from the pages' live and draft content, with "Open the page editor".
import { useCallback } from "react";
import { LayoutTemplate } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { LoadError } from "../ui/LoadError";
import { Skeleton } from "../ui/Skeleton";
import { useServerRead } from "../../hooks/useServerRead";
import { formsErrorWords } from "../../services/formsService";
import { formPlacements } from "../../services/websitePagesService";
import { Panel } from "./formsUi";

export function WhereTab({ form }) {
  const load = useCallback(() => formPlacements(form.id), [form.id]);
  const { status, data, error, retry } = useServerRead(load);
  return (
    <Panel title="Where this form shows" action={<Button variant="secondary" size="sm" icon={LayoutTemplate} onClick={() => { window.location.hash = "#/website-pages"; }}>Open the page editor</Button>} data-where-tab="">
      {status === "loading" ? <Skeleton height={80} /> : status === "error" ? <LoadError message={formsErrorWords(error)} onRetry={retry} /> : !data.length ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">Not on any page yet. Add it from the page editor.</p>
      ) : (
        <ul className="divide-y divide-[var(--a-line)]">
          {data.map((p) => (
            <li key={`${p.page_key}:${p.spot}:${p.state}`} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span><b className="font-semibold">{p.page_key}</b> <span className="text-[var(--color-text-tertiary)]">· {p.spot === "popup" ? "Pop-up form" : p.spot.replace(/-/g, " ")}</span></span>
              <Badge variant={p.state === "live" ? "live" : "draft"}>{p.state === "live" ? "Live" : "Draft"}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
