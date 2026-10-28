import { Fragment, type ReactNode } from "react";
import type {
  RichTextBlock,
  RichTextDoc,
  RichTextInline,
  RichTextText,
} from "../../contracts/generated/richText.ts";
import { isSafeHref } from "../../contracts/generated/safety.ts";

/*
 * #2829 S-11 — the ONLY way rich text reaches a published page: the closed
 * tree from site-contracts, rendered element by element. There is no HTML
 * string anywhere on this path (no dangerouslySetInnerHTML), so a writer can
 * format text but cannot put markup, script or styling on a site. Links are
 * re-checked with the same safe-link rule the contract applied.
 */

function marked(node: RichTextText, key: number): ReactNode {
  let out: ReactNode = node.text;
  for (const mark of node.marks ?? []) {
    if (mark === "bold") out = <strong>{out}</strong>;
    else if (mark === "italic") out = <em>{out}</em>;
    else if (mark === "underline") out = <u>{out}</u>;
    else if (mark === "strike") out = <s>{out}</s>;
    else if (mark === "code") out = <code>{out}</code>;
  }
  return <Fragment key={key}>{out}</Fragment>;
}

function inlines(nodes: RichTextInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === "text") return marked(node, index);
    if (node.type === "break") return <br key={index} />;
    if (!isSafeHref(node.href)) return <Fragment key={index}>{inlines(node.children)}</Fragment>;
    const external = !node.href.startsWith("/");
    return (
      <a key={index} href={node.href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
        {inlines(node.children)}
        {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
      </a>
    );
  });
}

function block(node: RichTextBlock, index: number): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={index}>{inlines(node.children)}</p>;
    case "heading": {
      const Heading = node.level === 2 ? "h2" : node.level === 3 ? "h3" : "h4";
      return <Heading key={index}>{inlines(node.children)}</Heading>;
    }
    case "quote":
      return <blockquote key={index}><p>{inlines(node.children)}</p></blockquote>;
    case "list": {
      const List = node.ordered ? "ol" : "ul";
      return <List key={index}>{node.items.map((item, itemIndex) => <li key={itemIndex}>{inlines(item.children)}</li>)}</List>;
    }
  }
}

/** Renders the tree's blocks as siblings (the caller supplies the wrapper). */
export function RichText({ doc }: { doc: RichTextDoc | null | undefined }) {
  if (!doc || doc.type !== "doc" || !Array.isArray(doc.children)) return null;
  return <>{doc.children.map(block)}</>;
}
