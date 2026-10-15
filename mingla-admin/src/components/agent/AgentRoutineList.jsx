// Issue #3802 (Wave 4) — the one rendering of the routines returned by the
// server, shared by Guide and My agent.
import { CopyBlock } from "./CopyBlock";

export function AgentRoutineList({ routines }) {
  const rows = (Array.isArray(routines) ? routines : []).filter(
    (routine) => routine && typeof routine.title === "string" && typeof routine.text === "string"
  );
  return (
    <ul className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      {rows.map((routine) => (
        <li
          key={routine.name || routine.title}
          className="min-w-0 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4"
        >
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">{routine.title}</h4>
          <CopyBlock
            id={`agent-routine-${routine.name || "prompt"}`}
            text={routine.text}
            copyLabel="Copy prompt"
            buttonVariant="brandContrast"
            className="mt-3"
          />
        </li>
      ))}
    </ul>
  );
}
