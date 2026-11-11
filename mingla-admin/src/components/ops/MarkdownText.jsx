// Issue #4255 (W3) — Markdown from a card's description or a thread message,
// shown as React elements (never as HTML), so nothing typed can run in the
// page. Headings, lists, checklists, dividers, code, bold, italic, strike,
// https links, and @mentions of the people the message names.
import { Fragment } from "react";

const INLINE = /(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\(https:\/\/[^)\s]+\)|https:\/\/[^\s<>()]+|\*[^*\s][^*]*\*|_[^_\s][^_]*_|@[A-Za-z][\w.'-]*(?: [A-Z][\w'-]*)?)/g;

function inline(text, names, keyBase) {
  const out = [];
  let last = 0;
  let i = 0;
  const s = String(text || "");
  for (const m of s.matchAll(INLINE)) {
    const t = m[0];
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = `${keyBase}-${i += 1}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("~~")) out.push(<s key={k}>{t.slice(2, -2)}</s>);
    else if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const close = t.indexOf("](");
      out.push(<a key={k} href={t.slice(close + 2, -1)} target="_blank" rel="noopener noreferrer">{t.slice(1, close)}</a>);
    } else if (t.startsWith("https://")) out.push(<a key={k} href={t} target="_blank" rel="noopener noreferrer">{t}</a>);
    else if (t.startsWith("@")) {
      const word = t.slice(1);
      const hit = names.find((n) => word.toLowerCase().startsWith(n.toLowerCase()));
      if (hit) {
        out.push(<span key={k} className="mingla-mention">@{hit}</span>);
        if (word.length > hit.length) out.push(word.slice(hit.length));
      } else out.push(t);
    } else if (t.startsWith("*") || t.startsWith("_")) out.push(<em key={k}>{t.slice(1, -1)}</em>);
    else out.push(t);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Split Markdown into blocks: { type, ... }. */
function markdownBlocks(md) {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { blocks.push({ type: "p", lines: para }); para = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara(); flushList();
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i += 1; }
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); flushList(); blocks.push({ type: h[1].length <= 2 ? "h2" : "h3", text: h[2] }); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); blocks.push({ type: "hr" }); continue; }
    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const kind = task ? "task" : bullet ? "ul" : num ? "ol" : null;
    if (kind) {
      flushPara();
      if (!list || list.type !== kind) { flushList(); list = { type: kind, items: [] }; }
      list.items.push(task ? { text: task[2], done: task[1].toLowerCase() === "x" } : { text: (bullet || num)[1] });
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList();
    para.push(line.replace(/\\$/, ""));
  }
  flushPara(); flushList();
  return blocks;
}

export function MarkdownText({ text, mentionNames = [], className = "" }) {
  const names = (Array.isArray(mentionNames) ? mentionNames : []).filter(Boolean).sort((a, b) => b.length - a.length);
  const blocks = markdownBlocks(text);
  return (
    <div className={`mingla-prose min-w-0 break-words ${className}`}>
      {blocks.map((b, bi) => {
        const k = `b${bi}`;
        if (b.type === "h2") return <h2 key={k}>{inline(b.text, names, k)}</h2>;
        if (b.type === "h3") return <h3 key={k}>{inline(b.text, names, k)}</h3>;
        if (b.type === "hr") return <hr key={k} />;
        if (b.type === "code") return <pre key={k}><code>{b.text}</code></pre>;
        if (b.type === "ul" || b.type === "ol") {
          const Tag = b.type;
          return <Tag key={k}>{b.items.map((it, ii) => <li key={ii}>{inline(it.text, names, `${k}-${ii}`)}</li>)}</Tag>;
        }
        if (b.type === "task") {
          return (
            <ul key={k} data-type="taskList">
              {b.items.map((it, ii) => (
                <li key={ii}>
                  <label><input type="checkbox" checked={it.done} readOnly disabled aria-label={it.done ? "Done" : "Not done"} /></label>
                  <div className={it.done ? "line-through text-[var(--color-text-tertiary)]" : ""}>{inline(it.text, names, `${k}-${ii}`)}</div>
                </li>
              ))}
            </ul>
          );
        }
        return <p key={k}>{b.lines.map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l, names, `${k}-${li}`)}</Fragment>)}</p>;
      })}
    </div>
  );
}
