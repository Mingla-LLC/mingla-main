import { ArrowDown, ArrowUp, RefreshCw, Trash2 } from "lucide-react";

export function BlogBlockToolbar({ block, onMove, onRemove, onStyle, onSwap }) {
  return <div className="absolute -left-12 top-2 z-[2] flex flex-col rounded-lg border border-[var(--gray-200)] bg-white p-1 opacity-0 shadow-sm transition group-hover:opacity-100 group-focus-within:opacity-100">
    <button type="button" aria-label="Move block up" className="rounded p-1.5 hover:bg-[var(--gray-100)]" onClick={() => onMove(-1)}><ArrowUp className="h-4 w-4" /></button>
    <button type="button" aria-label="Move block down" className="rounded p-1.5 hover:bg-[var(--gray-100)]" onClick={() => onMove(1)}><ArrowDown className="h-4 w-4" /></button>
    {onSwap ? <button type="button" aria-label={`Swap ${block.type}`} title="Swap" className="rounded p-1.5 hover:bg-[var(--gray-100)]" onClick={onSwap}><RefreshCw className="h-4 w-4" /></button> : null}
    <button type="button" aria-label={`Remove ${block.type} block`} className="rounded p-1.5 text-red-600 hover:bg-red-50" onClick={onRemove}><Trash2 className="h-4 w-4" /></button>
    {onStyle ? <select aria-label="Place card style" value={block.style || "card"} onChange={(event) => onStyle(event.target.value)} className="mt-1 w-9 rounded border border-[var(--gray-200)] bg-white text-[10px]"><option value="card">Card</option><option value="compact">Compact</option></select> : null}
  </div>;
}
