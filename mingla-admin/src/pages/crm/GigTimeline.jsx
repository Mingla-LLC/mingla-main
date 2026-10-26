export function GigTimeline({ events = [] }) {
  if (!events.length) return <p className="text-sm text-[var(--color-text-secondary)]">No contract events yet.</p>;
  return (
    <ol className="space-y-3" aria-label="Shared contract timeline">
      {events.map((event) => (
        <li key={event.id} className="border-l-2 border-[var(--gray-300)] pl-4">
          <p className="text-sm font-semibold capitalize text-[var(--color-text-primary)]">{String(event.kind).replaceAll("_", " ")}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">{event.actor} · {new Date(event.at).toLocaleString()}</p>
        </li>
      ))}
    </ol>
  );
}
