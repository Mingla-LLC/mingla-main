import { Skeleton } from "../ui/Skeleton";

export function DraftQueueSkeleton({ still = false }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-busy="true" aria-label="Loading drafts">
      {[0, 1].map((n) => <div key={n} className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
        <Skeleton width="45%" height={18} className={still ? "!animate-none" : ""} />
        <div className="mt-3"><Skeleton width="70%" height={13} className={still ? "!animate-none" : ""} /></div>
        <div className="mt-6 space-y-2"><Skeleton width="100%" height={14} className={still ? "!animate-none" : ""} /><Skeleton width="92%" height={14} className={still ? "!animate-none" : ""} /><Skeleton width="75%" height={14} className={still ? "!animate-none" : ""} /></div>
        <div className="mt-6 flex gap-2"><Skeleton width={190} height={44} className={still ? "!animate-none" : ""} /><Skeleton width={84} height={44} className={still ? "!animate-none" : ""} /></div>
      </div>)}
    </div>
  );
}
