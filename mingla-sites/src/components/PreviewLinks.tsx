"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, type AnchorHTMLAttributes, type ComponentProps, type FormHTMLAttributes, type ReactNode } from "react";
import { previewFormTarget, previewHref, previewRenderHref, type PreviewLinkTarget } from "../lib/sharedPreviewHref";

/*
 * #2830 — a private preview stays a private preview.
 *
 * The renderers are the same ones the live site uses, so their links name the
 * live address. On a site with no publication that address does not exist, and
 * on any site it is not the draft the owner is reviewing. Inside this scope
 * every same-site link names the same page of the preview, on the same artifact,
 * in the HTML itself. Outside it (every public page) nothing changes.
 *
 * In a preview `SiteRouteLink` draws a plain anchor rather than the framework's
 * link, because the framework's link prefetches its target: that is what asked
 * for the public paths in the first place.
 */
export type PreviewScope = {
  target: PreviewLinkTarget;
  /** The page showing (`about`, or empty for home). */
  path: string;
  /** The artifact key this preview's own assets carry (a share link has one too, server-side). */
  assetKey: string;
};

const PreviewScopeContext = createContext<PreviewScope | null>(null);

/** The key this preview's own assets carry, or null on a public page. */
export function usePreviewAssetKey(): string | null {
  return useContext(PreviewScopeContext)?.assetKey ?? null;
}

export function PreviewLinkScope({ scope, children }: { scope: PreviewScope; children: ReactNode }) {
  const { target } = scope;
  useEffect(() => {
    // The safety net, for an address the render could not judge (an absolute
    // link on this site's own origin). Capture phase: a link's own handler would
    // otherwise navigate to the live page first.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank") return;
      const next = previewHref(anchor.href, window.location.origin, target);
      if (!next) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(next);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [target]);
  return <PreviewScopeContext.Provider value={scope}>{children}</PreviewScopeContext.Provider>;
}

/** The site's `next/link`: unchanged on a public page, a plain in-preview anchor in a preview. */
export function SiteRouteLink({ href, prefetch, replace, scroll, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const scope = useContext(PreviewScopeContext);
  if (!scope) return <Link href={href} prefetch={prefetch} replace={replace} scroll={scroll} {...rest} />;
  return <a href={previewRenderHref(href, scope.target)} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} />;
}

/** A plain link that may name a page of the site. */
export function SiteAnchor({ href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const scope = useContext(PreviewScopeContext);
  return <a href={scope ? previewRenderHref(href, scope.target) : href} {...rest} />;
}

/** A GET search form; `action` absent means the page showing. */
export function SiteSearchForm({ action, children, ...rest }: Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "method"> & { action?: string }) {
  const scope = useContext(PreviewScopeContext);
  if (!scope) return <form action={action} method="get" {...rest}>{children}</form>;
  const { action: previewAction, fields } = previewFormTarget(action ?? scope.path, scope.target);
  return (
    <form action={previewAction} method="get" {...rest}>
      {fields.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {children}
    </form>
  );
}

/** The page's address as the site knows it, inside a preview too (`/preview` is no page of the site). */
export function useSitePathname(): string {
  const pathname = usePathname();
  const scope = useContext(PreviewScopeContext);
  return scope ? `/${scope.path}` : pathname ?? "/";
}
