import { useState } from "react";
import { Plus } from "lucide-react";
import { createBlock } from "../../lib/blogEditorState";

const OPTIONS = [
  ["paragraph", "Paragraph", { html: "" }], ["heading", "Heading", { level: 2, text: "" }],
  ["list", "List", { ordered: false, items: [""] }], ["quote", "Quote", { html: "" }], ["callout", "Callout", { html: "", tone: "note" }],
  ["image", "Image", { mediaId: "", alt: "" }], ["gallery", "Gallery", { items: [], layout: "pair" }], ["video", "Video", { provider: "youtube", videoId: "", title: "" }],
  ["place", "Place", { placeId: "", style: "card" }], ["offering", "Event or offering", { eventId: "", displayTitle: "" }], ["plan", "Plan", { title: "", stops: [] }],
  ["city", "City page", { citySlug: "raleigh-nc" }], ["button", "Button", { label: "Open in Mingla", target: { kind: "page", path: "/" } }],
  ["divider", "Divider", {}], ["embed", "Embed", { provider: "youtube", url: "" }],
];

export function BlogInsertMenu({ onInsert }) {
  const [open, setOpen] = useState(false);
  return <div className="relative"><button type="button" onClick={() => setOpen(!open)} className="inline-flex h-11 items-center gap-2 rounded-lg border border-dashed border-[var(--color-brand-300)] px-4 text-sm font-semibold text-[var(--color-brand-700)]"><Plus className="h-4 w-4" />Insert block</button>{open ? <div className="absolute left-0 z-20 mt-2 grid w-[420px] max-w-[80vw] grid-cols-2 gap-1 rounded-xl border border-[var(--gray-200)] bg-white p-2 shadow-xl">{OPTIONS.map(([type,label,fields]) => <button key={type} type="button" className="rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--gray-50)]" onClick={() => { onInsert(createBlock(type, fields)); setOpen(false); }}>{label}</button>)}</div> : null}</div>;
}
