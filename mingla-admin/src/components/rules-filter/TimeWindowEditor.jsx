import { Clock } from "lucide-react";

// [TRANSITIONAL] Empty stub. Routing is wired so when vibes (DEC-034 v2) ship,
// only the body needs to fill in. Exit condition: vibes activation dispatch.
export function TimeWindowEditor() {
  return (
    <div className="p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-[var(--color-brand-50)] mx-auto mb-3 flex items-center justify-center">
        <Clock className="w-6 h-6 text-[var(--color-brand-500)]" />
      </div>
      <p className="text-[14px] font-medium text-[var(--color-text-primary)] mb-1">
        Time-window rule editor
      </p>
      <p className="text-[12px] text-[var(--color-text-secondary)] max-w-[280px] mx-auto">
        Coming with vibes activation. This rule type is reserved for vibe rules
        (Brunch, Dinner, Late-Night).
      </p>
    </div>
  );
}
