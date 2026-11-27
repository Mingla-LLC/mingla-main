// #4636 — the Sections outline: every section top to bottom, click to select,
// drag to reorder (dnd-kit, already an Admin dependency; Space + arrows with a
// keyboard), plus Up / Down buttons, and "Add section".
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, ArrowDown, ArrowUp, GripVertical, Plus } from "lucide-react";
import { MiniButton } from "./editorUi";

function Row({ s, i, n, name, selected, invalid, canEdit, onSelect, onMove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id, disabled: !canEdit });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-section-row={i}
      className={`mb-1.5 flex items-center gap-1 rounded-lg border px-1.5 py-1 ${selected ? "border-[#eb7825] bg-[var(--a-chip)]" : "border-[var(--a-line)] bg-[var(--a-panel)]"} ${s.hidden ? "opacity-55" : ""} ${isDragging ? "z-10 shadow-lg" : ""}`}>
      {canEdit ? (
        <button type="button" className="cursor-grab touch-none p-0.5 text-[var(--a-dim)]" aria-label={`Drag ${name} to reorder`} {...attributes} {...listeners}>
          <GripVertical size={14} />
        </button>
      ) : null}
      <button type="button" className="min-w-0 flex-1 truncate text-left text-[13px]" onClick={() => onSelect(i)} aria-current={selected ? "true" : undefined}>
        {name}{s.hidden ? " (hidden)" : ""}
      </button>
      {invalid ? <AlertCircle size={14} className="shrink-0 text-[var(--color-error-700)]" aria-label="Has a problem" /> : null}
      {canEdit ? (
        <>
          <MiniButton aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => onMove(i, i - 1)}><ArrowUp size={12} /></MiniButton>
          <MiniButton aria-label={`Move ${name} down`} disabled={i === n - 1} onClick={() => onMove(i, i + 1)}><ArrowDown size={12} /></MiniButton>
        </>
      ) : null}
    </li>
  );
}

export function SectionList({ sections, nameOf, selected, invalid, canEdit, onSelect, onMove, onAdd, pageName }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = sections.findIndex((s) => s.id === active.id);
    const to = sections.findIndex((s) => s.id === over.id);
    if (from >= 0 && to >= 0) onMove(from, to);
  };
  return (
    <div data-section-list="">
      <h3 className="text-[13px] font-semibold">Sections on {pageName}</h3>
      <p className="mb-2 text-xs text-[var(--a-dim)]">Top to bottom, as visitors see them.{canEdit ? " Drag or use the arrows to reorder." : ""}</p>
      {sections.length ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ol>
              {sections.map((s, i) => <Row key={s.id} s={s} i={i} n={sections.length} name={nameOf(s)} selected={i === selected} invalid={invalid.has(i)} canEdit={canEdit} onSelect={onSelect} onMove={onMove} />)}
            </ol>
          </SortableContext>
        </DndContext>
      ) : <p className="rounded-xl border border-dashed border-[var(--a-line)] p-3 text-xs text-[var(--a-dim)]">No sections yet.{canEdit ? " Add the first one." : ""}</p>}
      {canEdit ? <MiniButton className="mt-1 w-full" onClick={() => onAdd(sections.length)} data-add-section=""><Plus size={12} /> Add section</MiniButton> : null}
    </div>
  );
}
