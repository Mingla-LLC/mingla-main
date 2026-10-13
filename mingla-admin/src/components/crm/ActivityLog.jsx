import { Badge } from "../ui/Badge";
import { Skeleton } from "../ui/Skeleton";
import { LABEL_CLASS } from "./fields";
import { activityActor, activityLine, activityVia, relativeTime, safeHttpUrl } from "../../lib/crmModel";

/** A card's history, newest first. */
export function ActivityLog({ activity, def, config, loading = false }) {
  const entries = Array.isArray(activity) ? activity : [];
  return (
    <div>
      <span className={LABEL_CLASS}>Activity</span>
      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton height={14} width="70%" />
          <Skeleton height={14} width="50%" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">
          Nothing logged yet. Log your first touch above.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--gray-200)]">
          {entries.map((entry) => {
            const line = activityLine(entry, def, config);
            const via = activityVia(entry);
            const link = safeHttpUrl(line.ref);
            return (
              <li key={entry.id} className="py-2 text-sm">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <b className="text-[var(--color-text-primary)]" title={entry.actor_email || undefined}>
                    {activityActor(entry)}
                  </b>
                  {via && <Badge variant="brand">via {via}</Badge>}
                  <span
                    className="text-xs text-[var(--color-text-tertiary)]"
                    title={new Date(entry.occurred_at).toLocaleString()}
                  >
                    {relativeTime(entry.occurred_at)}
                  </span>
                  {line.badge && <Badge variant="info">{line.badge}</Badge>}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[var(--color-text-primary)]">
                  {line.headline}
                </p>
                {line.body && (
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[var(--color-text-secondary)]">
                    {line.body}
                  </p>
                )}
                {line.ref &&
                  (link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-block break-all text-xs text-[var(--color-brand-700)] underline"
                    >
                      Open the message
                    </a>
                  ) : (
                    <p className="mt-0.5 break-all text-xs text-[var(--color-text-tertiary)]">Message: {line.ref}</p>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
