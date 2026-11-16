// #4452 §5.7 — the Email composer's body editor, extracted so the forms
// automation email step uses the SAME editor (extract, do not fork). It owns
// the block list editing: rich text (heading, paragraph, bold, italic,
// underline, link, lists), image, GIF, divider and blog-post blocks, the
// format bar and the body token menu. The host owns the document
// (value / onChange), uploads (imageUpload) and the blog-post picker.
//
// Props: { value, onChange(updater), tokens: [{value,label,example}],
//          imageUpload?(file), uploading?, onPickBlogPost?(blockId|""),
//          unavailableBlogPostIds?: Set }
// Ref:   flush(doc) -> the document with the focused block's live HTML.
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { AlignLeft, Bold, FileImage, Heading2, Image as ImageIcon, Italic, Link, List, ListOrdered, Minus, Newspaper, Sparkles, Underline, X } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import { EditableRichBlock } from "./EditableRichBlock";
import { BlogPostSnapshot } from "./BlogPostSnapshot";
import { escapeHtml } from "./richText";
import { appendDivider, appendText, flushActive, removeBlock as removeFrom, safeLinkHref, updateBlock as updateIn } from "../../lib/emailDocument";

export const EmailBodyEditor = forwardRef(function EmailBodyEditor(
  { value, onChange, tokens, imageUpload, uploading = false, onPickBlogPost, unavailableBlogPostIds, emptyDocument },
  ref,
) {
  const { addToast } = useToast();
  const [activeBlockId, setActiveBlockId] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const editorRefs = useRef(new Map());
  const imageInputRef = useRef(null);
  const gifInputRef = useRef(null);
  const linkRangeRef = useRef(null);

  useImperativeHandle(ref, () => ({
    flush(doc) {
      const editor = activeBlockId ? editorRefs.current.get(activeBlockId) : null;
      return flushActive(doc, activeBlockId, editor ? editor.innerHTML : undefined);
    },
  }), [activeBlockId]);

  function updateBlock(id, patch) {
    onChange((current) => updateIn(current, id, patch));
  }

  function removeBlock(id) {
    onChange((current) => removeFrom(current, id, emptyDocument));
  }

  function format(command, arg = null) {
    const editor = editorRefs.current.get(activeBlockId);
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, arg);
    updateBlock(activeBlockId, { html: editor.innerHTML });
  }

  function openLinkDialog() {
    const editor = editorRefs.current.get(activeBlockId);
    if (!editor) {
      addToast({ variant: "error", title: "Place the cursor in the email body first" });
      return;
    }
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    linkRangeRef.current = range && editor.contains(range.commonAncestorContainer)
      ? range.cloneRange()
      : null;
    setLinkText(selection?.toString() || "");
    setLinkUrl("");
    setLinkOpen(true);
  }

  function confirmLink() {
    const editor = editorRefs.current.get(activeBlockId);
    if (!editor) return;
    const href = safeLinkHref(linkUrl);
    if (!href) {
      addToast({ variant: "error", title: "Use a valid https:// or mailto: link" });
      return;
    }
    const label = linkText.trim();
    if (!label) {
      addToast({ variant: "error", title: "Add link text" });
      return;
    }
    editor.focus();
    const selection = window.getSelection();
    if (selection && linkRangeRef.current) {
      selection.removeAllRanges();
      selection.addRange(linkRangeRef.current);
    }
    document.execCommand(
      "insertHTML",
      false,
      `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
    );
    updateBlock(activeBlockId, { html: editor.innerHTML });
    setLinkOpen(false);
  }

  function insertToken(token) {
    const editor = editorRefs.current.get(activeBlockId);
    if (!editor) return;
    editor.focus();
    document.execCommand("insertText", false, token);
    updateBlock(activeBlockId, { html: editor.innerHTML });
  }

  function addDivider() {
    onChange((current) => appendDivider(current));
  }

  async function upload(event) {
    const file = event.target.files?.[0];
    try {
      if (file) await imageUpload?.(file);
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = "";
      if (gifInputRef.current) gifInputRef.current.value = "";
    }
  }

  return (
    <>
    <div data-email-body-editor="" className="overflow-hidden rounded-xl border border-[var(--gray-300)] bg-[var(--color-background-primary)] focus-within:border-[var(--color-brand-400)] focus-within:ring-2 focus-within:ring-[var(--color-brand-100)]">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--gray-200)] bg-[var(--gray-50)] p-2">
        <button type="button" title="Heading" aria-label="Heading" onClick={() => format("formatBlock", "h2")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><Heading2 className="h-4 w-4" /></button>
        <button type="button" title="Paragraph" aria-label="Paragraph" onClick={() => format("formatBlock", "p")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><AlignLeft className="h-4 w-4" /></button>
        <button type="button" title="Bold" aria-label="Bold" onClick={() => format("bold")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><Bold className="h-4 w-4" /></button>
        <button type="button" title="Italic" aria-label="Italic" onClick={() => format("italic")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><Italic className="h-4 w-4" /></button>
        <button type="button" title="Underline" aria-label="Underline" onClick={() => format("underline")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><Underline className="h-4 w-4" /></button>
        <button type="button" title="Link" aria-label="Link" onClick={openLinkDialog} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><Link className="h-4 w-4" /></button>
        <button type="button" title="Bullet list" aria-label="Bullet list" onClick={() => format("insertUnorderedList")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><List className="h-4 w-4" /></button>
        <button type="button" title="Numbered list" aria-label="Numbered list" onClick={() => format("insertOrderedList")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><ListOrdered className="h-4 w-4" /></button>
        <span className="mx-1 h-5 w-px shrink-0 bg-[var(--gray-300)]" />
        {imageUpload && <button type="button" title="Add image" onClick={() => imageInputRef.current?.click()} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]"><ImageIcon className="h-4 w-4" /> Image</button>}
        {imageUpload && <button type="button" title="Add GIF" onClick={() => gifInputRef.current?.click()} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]"><FileImage className="h-4 w-4" /> GIF</button>}
        <button type="button" title="Add divider" onClick={addDivider} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]"><Minus className="h-4 w-4" /> Divider</button>
        {onPickBlogPost && <button type="button" title="Add blog post" onClick={() => onPickBlogPost?.("")} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]"><Newspaper className="h-4 w-4" /> Blog post</button>}
        {uploading && <Spinner size="xs" />}
        <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => upload(event)} />
        <input ref={gifInputRef} type="file" accept="image/gif" hidden onChange={(event) => upload(event)} />
      </div>

      <div className="min-h-[260px] space-y-2 p-4">
        {value.map((block) => (
          <div key={block.id} className="group relative">
            {block.type === "rich_text" && (
              <EditableRichBlock
                html={block.html}
                editorRef={(node) => { if (node) editorRefs.current.set(block.id, node); else editorRefs.current.delete(block.id); }}
                onFocus={() => setActiveBlockId(block.id)}
                onHtmlChange={(html) => updateBlock(block.id, { html })}
                className="min-h-12 rounded-lg px-2 py-1 text-sm leading-7 text-[var(--color-text-primary)] outline-none hover:bg-[var(--gray-50)] focus:bg-[var(--gray-50)] [&_a]:text-[var(--color-brand-600)] [&_a]:underline [&_h2]:my-2 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:list-disc"
              />
            )}
            {block.type === "divider" && <hr className="my-5 border-0 border-t border-[var(--gray-300)]" />}
            {block.type === "image" && (
              <div className="rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] p-3">
                <img src={block.url} alt={block.alt} className="max-h-72 w-full rounded-lg object-contain" />
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Input label="Alt text (required)" value={block.alt} onChange={(event) => updateBlock(block.id, { alt: event.target.value })} placeholder="Describe the image" />
                  <Input label="Image link (optional)" value={block.link || ""} onChange={(event) => updateBlock(block.id, { link: event.target.value })} placeholder="https://…" />
                </div>
              </div>
            )}
            {block.type === "blog_post" && (
              <div className="rounded-xl border border-[var(--gray-300)] bg-[var(--gray-50)] p-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="mr-auto text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Blog post</span>
                  <div className="flex rounded-lg bg-[var(--gray-200)] p-0.5" aria-label="Blog post layout">
                    {[["card", "Card with cover"], ["row", "Compact row"], ["link", "Title link only"]].map(([style, label]) => (
                      <button key={style} type="button" title={label} aria-pressed={block.style === style} onClick={() => updateBlock(block.id, { style })} className={`rounded-md px-2 py-1 text-[11px] font-semibold ${block.style === style ? "bg-white text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-secondary)]"}`}>{label}</button>
                    ))}
                  </div>
                  <button type="button" onClick={() => onPickBlogPost?.(block.id)} className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline">Swap</button>
                  <button type="button" aria-label="Remove blog post" onClick={() => removeBlock(block.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-red-50 hover:text-red-700"><X className="h-4 w-4" /></button>
                </div>
                {unavailableBlogPostIds?.has?.(block.postId) && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">This post is no longer published. Swap or remove it.</p>}
                <BlogPostSnapshot block={block} />
                <div className="mt-3">
                  <Input label="Button text" maxLength={40} value={block.buttonText} onChange={(event) => updateBlock(block.id, { buttonText: event.target.value })} placeholder="Add button text" />
                  <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">Links to usemingla.com/blog/{block.snapshot?.slug || "…"}. Title, summary and cover come from the post and update if the post is edited before sending.</p>
                </div>
              </div>
            )}
            {block.type !== "blog_post" && value.length > 1 && (
              <button type="button" title="Remove block" onClick={() => removeBlock(block.id)} className="absolute -right-1 -top-1 hidden h-7 w-7 items-center justify-center rounded-full border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-tertiary)] shadow-sm hover:text-red-600 group-hover:flex"><X className="h-3.5 w-3.5" /></button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => onChange((current) => appendText(current))} className="text-xs font-semibold text-[var(--color-brand-600)] hover:underline">+ Add text block</button>
      </div>

      <div className="flex items-center justify-end border-t border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2"><details className="relative"><summary className="flex cursor-pointer list-none items-center gap-1 rounded-md border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-2 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)]"><Sparkles className="h-3.5 w-3.5" /> Insert ▾</summary><div className="absolute bottom-full right-0 z-30 mb-1 w-44 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1 shadow-lg">{tokens.map((token) => <button key={token.value} type="button" onClick={() => insertToken(token.value)} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--gray-50)]">{token.label}</button>)}</div></details></div>
    </div>

    <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Add hyperlink" size="sm">
      <ModalBody>
        <div className="space-y-3">
          <Input label="Text to display" value={linkText} onChange={(event) => setLinkText(event.target.value)} placeholder="Read the update" />
          <Input label="Destination" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://… or mailto:…" />
          <p className="text-xs text-[var(--color-text-tertiary)]">Only secure web links and valid email links are accepted.</p>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={() => setLinkOpen(false)}>Cancel</Button>
        <Button onClick={confirmLink}>Insert link</Button>
      </ModalFooter>
    </Modal>
    </>
  );
});
