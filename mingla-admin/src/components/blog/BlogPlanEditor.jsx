import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Input } from "../ui/Input";
import { Modal, ModalBody } from "../ui/Modal";
import { BlogPlacePicker } from "./BlogPlacePicker";

export function BlogPlanEditor({ api, block, places, onChange }) {
  const [selected, setSelected] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const stops = block.stops || [];
  const stopNames = block.stopNames || {};
  const available = places.filter((place) => !stops.includes(place.placeId));
  const move = (index, direction) => {
    const to = index + direction;
    if (to < 0 || to >= stops.length) return;
    const next = [...stops];
    [next[index], next[to]] = [next[to], next[index]];
    onChange({ stops: next });
  };
  const addStop = (placeId, label) => {
    if (!placeId || stops.includes(placeId) || stops.length >= 6) return;
    onChange({ stops: [...stops, placeId], stopNames: { ...stopNames, [placeId]: label || placeId } });
  };
  return <div className="space-y-3">
    <Input label="Plan title" value={block.title || ""} maxLength={80} onChange={(event) => onChange({ title: event.target.value })} />
    <div><p className="text-xs text-[var(--color-text-secondary)]">{stops.length} stops · choose 2–6 places.</p><ol className="mt-2 space-y-1">{stops.map((placeId, index) => {
      const place = places.find((item) => item.placeId === placeId);
      return <li key={placeId} className="flex items-center gap-2 rounded-lg bg-[var(--gray-50)] px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{index + 1}. {place?.placeName || stopNames[placeId] || placeId}</span><button type="button" aria-label={`Move stop ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></button><button type="button" aria-label={`Move stop ${index + 1} down`} disabled={index === stops.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></button><button type="button" className="text-xs font-semibold text-red-600" onClick={() => onChange({ stops: stops.filter((id) => id !== placeId) })}>Remove</button></li>;
    })}</ol></div>
    {stops.length < 6 ? <div className="flex flex-wrap gap-2"><select aria-label="Add a place stop" value={selected} onChange={(event) => setSelected(event.target.value)} className="h-10 min-w-52 flex-1 rounded-lg border border-[var(--gray-300)] px-3 text-sm"><option value="">Choose a place card…</option>{available.map((place) => <option key={place.placeId} value={place.placeId}>{place.placeName || place.placeId}</option>)}</select><button type="button" disabled={!selected} onClick={() => { const place=available.find((item)=>item.placeId===selected);addStop(selected,place?.placeName);setSelected(""); }} className="rounded-lg bg-[var(--color-brand-500)] px-3 text-sm font-semibold text-white disabled:opacity-40">Add stop</button><button type="button" onClick={() => setSearchOpen(true)} className="rounded-lg border border-[var(--gray-300)] px-3 text-sm font-semibold">Search places</button></div> : null}
    <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title="Add a place to this plan"><ModalBody><BlogPlacePicker api={api} onPick={(row) => { addStop(row.id, row.name); setSearchOpen(false); }} /></ModalBody></Modal>
  </div>;
}
