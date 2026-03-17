const SIZES = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-10 w-10 border-[3px]",
};

export function Spinner({ size = "md", className = "" }) {
  return (
    <div
      className={[
        "rounded-full border-[var(--gray-200)] animate-[spin_0.6s_linear_infinite]",
        SIZES[size] || SIZES.md,
        className,
      ].join(" ")}
      style={{ borderTopColor: "#f97316" }}
      role="status"
      aria-label="Loading"
    />
  );
}

export function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
      <Spinner size="lg" />
      <p className="text-sm text-[var(--color-text-secondary)]">Loading...</p>
    </div>
  );
}
