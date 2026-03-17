export function Skeleton({ width, height, rounded, className = "", style = {} }) {
  return (
    <div
      className={`skeleton-shimmer ${className}`}
      style={{
        width: width || "100%",
        height: height || 16,
        borderRadius: rounded === "full" ? 9999 : 6,
        ...style,
      }}
      aria-hidden="true"
    />
  );
}

export function StatCardSkeleton() {
  return (
    <div className="bg-[var(--color-background-primary)] border border-[var(--gray-200)] border-l-[3px] border-l-[var(--gray-200)] rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <Skeleton width={40} height={40} rounded="full" />
        <Skeleton width={48} height={16} />
      </div>
      <Skeleton width="50%" height={14} style={{ marginBottom: 6 }} />
      <Skeleton width="70%" height={28} />
    </div>
  );
}

export function TableRowSkeleton({ columns = 4 }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton height={16} width={120} />
        </td>
      ))}
    </tr>
  );
}

export function ListItemSkeleton() {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1">
        <Skeleton width={128} height={16} style={{ marginBottom: 6 }} />
        <Skeleton width={192} height={12} />
      </div>
      <Skeleton width={64} height={12} />
    </div>
  );
}
