import { ScrollViewStyleReset } from "expo-router/html";
import { type PropsWithChildren } from "react";

// ORCH-0964: web-only HTML document for mingla-business.
//
// The public brand/event pages hard-crash the MOBILE browser renderer because
// stacked `backdrop-filter: blur()` (expo-blur BlurView + other glass surfaces)
// overwhelm the mobile compositor — confirmed: injecting `backdrop-filter:none`
// before any app JS flips the page from crash to alive. A component-level guard
// was too late (the crash hits at ~34 DOM nodes, before those components mount),
// so the kill must be in the <head> here, parsed before any JS / first paint.
// Disables backdrop-filter for every element under 768px (phones/small tablets);
// desktop web (>= 768px) keeps its glass, native apps are unaffected (web-only file).
const MOBILE_WEB_BLUR_KILL = `@media (max-width: 767px) {
  *, *::before, *::after {
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
}`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: MOBILE_WEB_BLUR_KILL }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
