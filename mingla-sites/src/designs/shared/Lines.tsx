import { Fragment, type ReactElement } from "react";

/**
 * #4572 item 7a — an offering's summary keeps the host's paragraphs and
 * "- " lines: each line break becomes a <br>. The text stays plain text (no
 * markup is ever parsed), and no design stylesheet changes (they are
 * immutable). Meta descriptions and JSON-LD still read it as one line.
 */
export function Lines({ text }: { text: string }): ReactElement {
  const lines = text.split("\n");
  return <>{lines.map((line, index) => <Fragment key={index}>{index ? <br /> : null}{line}</Fragment>)}</>;
}

