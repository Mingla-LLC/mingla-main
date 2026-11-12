// Issue #4402 — the six-segment setup meter on creator cards and the record.
// Green = done, amber = needs a Mingla person, grey = the creator's turn, red =
// failed. Always labelled in words ("3 of 6 steps done"), never colour alone.

const TONE_CLASS = {
  done: "bg-[var(--color-success-700)]",
  you: "bg-[var(--color-warning-700)]",
  bad: "bg-[var(--color-error-700)]",
  creator: "bg-[var(--gray-200)]",
};

/**
 * @param {{ tones: Array<"done"|"you"|"bad"|"creator">, size?: "sm"|"lg" }} props
 */
export function CreatorStepMeter({ tones, size = "sm" }) {
  const list = Array.isArray(tones) ? tones : [];
  const done = list.filter((t) => t === "done").length;
  return (
    <span
      role="img"
      aria-label={`${done} of ${list.length || 6} steps done`}
      className={`grid grid-cols-6 gap-0.5 ${size === "lg" ? "h-1.5" : "h-1"}`}
    >
      {list.map((tone, i) => (
        <i key={i} className={`block rounded-full ${TONE_CLASS[tone] ?? TONE_CLASS.creator}`} />
      ))}
    </span>
  );
}
