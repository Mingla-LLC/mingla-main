// Issue #4255 (W3) — the composer: the card's description and, in a compact
// form, its thread's message box. Tiptap (approved by Seth, 10 Nov) with
// bold, italic, strike, headings, bullet, numbered and check lists, links,
// code, @mentions of active teammates (and @everyone for admins in the
// thread), and a / menu for headings, checklist, divider and mention.
// Stored as Markdown: a mention is written as "@Name", so agents and emails
// read plain words.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { AtSign, Bold, Code, Heading2, Italic, Link2, List, ListChecks, ListOrdered, Strikethrough } from "lucide-react";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

// "@Name" in the Markdown; reloading reads it back as the same words.
const MarkdownMention = Mention.extend({
  renderMarkdown: (node) => `@${node?.attrs?.label || node?.attrs?.id || ""}`,
  parseMarkdown: undefined,
  markdownTokenizer: undefined,
});

const SLASH_ITEMS = [
  { id: "h2", label: "Heading", run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run() },
  { id: "h3", label: "Small heading", run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 3 }).run() },
  { id: "bullet", label: "Bullet list", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { id: "ordered", label: "Numbered list", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { id: "check", label: "Checklist", run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { id: "divider", label: "Divider", run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { id: "mention", label: "Mention someone", run: (e, r) => e.chain().focus().deleteRange(r).insertContent("@").run() },
];

/** Who a message mentions: the teammates' addresses, and whether it is everyone. */
function mentionsIn(json) {
  const emails = new Set();
  let everyone = false;
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "mention") {
      if (node.attrs?.id === "everyone") everyone = true;
      else if (node.attrs?.id) emails.add(String(node.attrs.id).toLowerCase());
    }
    (node.content || []).forEach(walk);
  };
  walk(json);
  return { emails: Array.from(emails), everyone };
}

function popupItems(kind, query, people, allowEveryone) {
  const q = String(query || "").toLowerCase();
  if (kind === "slash") return SLASH_ITEMS.filter((i) => i.label.toLowerCase().includes(q)).slice(0, 8);
  const list = (Array.isArray(people) ? people : [])
    .filter((p) => p && p.email && !p.invited)
    .map((p) => ({ id: p.email, label: p.name || p.email, hint: p.email }))
    .filter((p) => !q || p.label.toLowerCase().includes(q) || p.hint.toLowerCase().startsWith(q));
  const everyone = allowEveryone && (!q || "everyone".startsWith(q)) ? [{ id: "everyone", label: "everyone", hint: "Every active teammate" }] : [];
  return [...list.slice(0, 7), ...everyone];
}

/**
 * The popup state is driven by Tiptap's suggestion plugin (outside React);
 * `bridge` hands it the React setter.
 */
function suggestionFor(kind, bridge, getItems) {
  return {
    char: kind === "slash" ? "/" : "@",
    pluginKey: new PluginKey(`mingla-${kind}`),
    allowSpaces: kind === "mention",
    items: ({ query }) => getItems(kind, query),
    command: kind === "slash"
      ? ({ editor, range, props }) => props.run(editor, range)
      : ({ editor, range, props }) => editor.chain().focus().insertContentAt(range, [{ type: "mention", attrs: { id: props.id, label: props.label } }, { type: "text", text: " " }]).run(),
    render: () => ({
      onStart: (p) => bridge.current?.({ kind, items: p.items, index: 0, rect: p.clientRect?.() || null, command: p.command }),
      onUpdate: (p) => bridge.current?.((prev) => ({ kind, items: p.items, index: Math.min(prev?.index || 0, Math.max(0, p.items.length - 1)), rect: p.clientRect?.() || null, command: p.command })),
      onKeyDown: ({ event }) => bridge.key?.(event) || false,
      onExit: () => bridge.current?.(null),
    }),
  };
}

export const RichComposer = forwardRef(function RichComposer({
  value = "",
  onChange,
  onBlur,
  onSubmit,
  onPasteFiles,
  people = [],
  allowEveryone = false,
  placeholder = "",
  compact = false,
  disabled = false,
  label = "Description",
  toolbar = true,
  id,
}, ref) {
  const [popup, setPopup] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const bridge = useRef({ current: null, key: null });
  const peopleRef = useRef(people);
  const everyoneRef = useRef(allowEveryone);
  const submitRef = useRef(onSubmit);
  const changeRef = useRef(onChange);
  const blurRef = useRef(onBlur);
  const pasteRef = useRef(onPasteFiles);
  const popupRef = useRef(null);
  useEffect(() => {
    peopleRef.current = people; everyoneRef.current = allowEveryone; submitRef.current = onSubmit;
    changeRef.current = onChange; blurRef.current = onBlur; pasteRef.current = onPasteFiles; popupRef.current = popup;
  });

  const extensions = useMemo(() => {
    const getItems = (kind, query) => popupItems(kind, query, peopleRef.current, everyoneRef.current);
    const Slash = Extension.create({
      name: "minglaSlash",
      addProseMirrorPlugins() { return [Suggestion({ editor: this.editor, ...suggestionFor("slash", bridge.current, getItems) })]; },
    });
    // Enter sends in the thread; Shift+Enter is a new line.
    const SendOnEnter = Extension.create({
      name: "minglaSendOnEnter",
      addKeyboardShortcuts() {
        return {
          Enter: () => {
            if (!compact || popupRef.current) return false;
            submitRef.current?.();
            return true;
          },
        };
      },
    });
    return [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true, protocols: ["https"], HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      Markdown,
      MarkdownMention.configure({ HTMLAttributes: { class: "mention" }, suggestion: suggestionFor("mention", bridge.current, getItems) }),
      ...(compact ? [SendOnEnter] : [Slash]),
    ];
  }, [compact, placeholder]);

  const editor = useEditor({
    extensions,
    content: value || "",
    contentType: "markdown",
    editable: !disabled,
    editorProps: {
      attributes: {
        id: id || undefined,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        class: `mingla-prose min-w-0 break-words outline-none text-[13.5px] leading-relaxed text-[var(--color-text-primary)] ${compact ? "max-h-40 min-h-[40px] overflow-y-auto px-3 py-2" : "min-h-[180px] max-h-[460px] overflow-y-auto px-3 py-2.5"}`,
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (files.length && pasteRef.current) { pasteRef.current(files); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => changeRef.current?.(e.getMarkdown()),
    onBlur: ({ editor: e }) => blurRef.current?.(e.getMarkdown()),
  }, [extensions]);

  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);

  // Arrow keys, Enter and Esc drive the open popup.
  useEffect(() => {
    bridge.current.current = setPopup;
    bridge.current.key = (event) => {
    const p = popupRef.current;
    if (!p || !p.items.length) { if (event.key === "Escape" && p) { setPopup(null); return true; } return false; }
    if (event.key === "ArrowDown") { setPopup({ ...p, index: (p.index + 1) % p.items.length }); return true; }
    if (event.key === "ArrowUp") { setPopup({ ...p, index: (p.index - 1 + p.items.length) % p.items.length }); return true; }
    if (event.key === "Enter" || event.key === "Tab") { p.command(p.items[p.index]); return true; }
    if (event.key === "Escape") { setPopup(null); return true; }
    return false;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    editor,
    markdown: () => editor?.getMarkdown() || "",
    mentions: () => mentionsIn(editor?.getJSON()),
    clear: () => editor?.commands.clearContent(true),
    focus: () => editor?.commands.focus("end"),
    setMarkdown: (md) => editor?.commands.setContent(md || "", { contentType: "markdown", emitUpdate: false }),
    isEmpty: () => !editor || editor.isEmpty,
  }), [editor]);

  const tool = (labelText, icon, run, active) => (
    <button key={labelText} type="button" aria-label={labelText} title={labelText} aria-pressed={active ? "true" : "false"} disabled={disabled || !editor}
      onMouseDown={(e) => e.preventDefault()} onClick={run}
      className={`inline-grid h-8 w-8 place-items-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] disabled:opacity-40 ${active ? "bg-[var(--gray-100)] text-[var(--color-text-primary)]" : ""} ${FOCUS}`}>
      {icon}
    </button>
  );
  const ch = () => editor?.chain().focus();
  const setLink = () => {
    const url = linkUrl.trim();
    if (!url) { ch()?.extendMarkRange("link").unsetLink().run(); setLinkOpen(false); return; }
    if (!/^https:\/\/\S+$/.test(url)) return;
    ch()?.extendMarkRange("link").setLink({ href: url }).run();
    setLinkOpen(false); setLinkUrl("");
  };

  return (
    <div data-composer={compact ? "thread" : "description"} className={`relative min-w-0 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] focus-within:border-[var(--gray-400)] ${disabled ? "opacity-60" : ""}`}>
      {toolbar && !compact && (
        <div role="toolbar" aria-label={`${label} formatting`} className="flex min-w-0 flex-wrap items-center gap-0.5 border-b border-[var(--gray-200)] px-1.5 py-1">
          {tool("Bold", <Bold aria-hidden="true" className="h-4 w-4" />, () => ch()?.toggleBold().run(), editor?.isActive("bold"))}
          {tool("Italic", <Italic aria-hidden="true" className="h-4 w-4" />, () => ch()?.toggleItalic().run(), editor?.isActive("italic"))}
          {tool("Strikethrough", <Strikethrough aria-hidden="true" className="h-4 w-4" />, () => ch()?.toggleStrike().run(), editor?.isActive("strike"))}
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-[var(--gray-200)]" />
          {tool("Heading", <Heading2 aria-hidden="true" className="h-4 w-4" />, () => ch()?.toggleHeading({ level: 2 }).run(), editor?.isActive("heading"))}
          {tool("Bullet list", <List aria-hidden="true" className="h-4 w-4" />, () => ch()?.toggleBulletList().run(), editor?.isActive("bulletList"))}
          {tool("Numbered list", <ListOrdered aria-hidden="true" className="h-4 w-4" />, () => ch()?.toggleOrderedList().run(), editor?.isActive("orderedList"))}
          {tool("Checklist", <ListChecks aria-hidden="true" className="h-4 w-4" />, () => ch()?.toggleTaskList().run(), editor?.isActive("taskList"))}
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-[var(--gray-200)]" />
          {tool("Link", <Link2 aria-hidden="true" className="h-4 w-4" />, () => { setLinkUrl(editor?.getAttributes("link")?.href || ""); setLinkOpen((o) => !o); }, editor?.isActive("link"))}
          {tool("Code", <Code aria-hidden="true" className="h-4 w-4" />, () => ch()?.toggleCode().run(), editor?.isActive("code"))}
          {tool("Mention someone", <AtSign aria-hidden="true" className="h-4 w-4" />, () => ch()?.insertContent("@").run(), false)}
        </div>
      )}
      {linkOpen && (
        <form className="flex min-w-0 items-center gap-1.5 border-b border-[var(--gray-200)] px-2 py-1.5" onSubmit={(e) => { e.preventDefault(); setLink(); }}>
          <label className="sr-only" htmlFor={`${id || "composer"}-link`}>Link address</label>
          <input id={`${id || "composer"}-link`} autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" className={`min-h-9 min-w-0 flex-1 rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-[13px] ${FOCUS}`} />
          <button type="submit" className={`min-h-9 rounded-md px-2 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`}>{linkUrl.trim() ? "Add link" : "Remove link"}</button>
          <button type="button" onClick={() => setLinkOpen(false)} className={`min-h-9 rounded-md px-2 text-[12.5px] text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Cancel</button>
        </form>
      )}
      <EditorContent editor={editor} />
      {popup && popup.items.length > 0 && (
        <ul role="listbox" aria-label={popup.kind === "slash" ? "Blocks" : "Teammates"} data-composer-popup={popup.kind}
          className="absolute left-2 z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1 shadow-[var(--shadow-lg)]"
          style={compact ? { bottom: "100%" } : { top: "100%" }}>
          {popup.items.map((item, i) => (
            <li key={item.id} role="option" aria-selected={i === popup.index}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); popup.command(item); }}
                className={`flex w-full min-w-0 flex-col items-start rounded-md px-2 py-1.5 text-left text-[13px] ${i === popup.index ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "text-[var(--color-text-primary)] hover:bg-[var(--gray-100)]"}`}>
                <span className="font-semibold">{popup.kind === "slash" ? item.label : `@${item.label}`}</span>
                {item.hint && <span className="text-[11.5px] text-[var(--color-text-tertiary)]">{item.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
