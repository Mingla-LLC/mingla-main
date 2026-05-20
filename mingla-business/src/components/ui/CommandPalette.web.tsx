/**
 * CommandPalette.web — ORCH-0891 M2 cmdk-backed ⌘K palette.
 *
 * Per SPEC §3.5.6 + DESIGN_SPEC §5. Mounted in `(tabs)/_layout.tsx` on
 * web only. Triggered by ⌘K / Ctrl+K from any tab on wide-desktop.
 *
 * # Behaviour
 * - Pressing ⌘K (or Ctrl+K on Windows/Linux) opens the palette.
 * - Pressing Esc closes it.
 * - Typing in the input filters commands via cmdk's built-in fuzzy match.
 * - Up/Down arrow keys navigate; Enter activates the highlighted item.
 * - Selecting a command navigates (or fires an action) and closes the palette.
 * - Backdrop click closes (cmdk default).
 *
 * # Group order (fixed per DESIGN_SPEC §5.2)
 *   1. Jump to       — Overview / Audiences / Campaigns / Templates
 *   2. Actions       — New campaign
 *   3. Recent campaigns   (up to 5 most-recent by created_at DESC)
 *   4. Recent audiences   (up to 5)
 *   5. Recent templates   (up to 5)
 *
 * # Visual contract (DESIGN_SPEC §5.1)
 * - Modal width: 640px max, min 480px, content `calc(100vw - 96px)`
 * - Modal max height: 60vh
 * - Background: #0c0e12 (canvas.discover) — OPAQUE, not glass
 * - Border: 1px rgba(255,255,255,0.12)
 * - Border radius: 24px (radius.xl)
 * - Backdrop: rgba(0,0,0,0.7) — heavier than Sheet.web.tsx (palette is
 *   power-user surface, more contrast)
 * - Input height: 56pt with left search icon + right ESC pill
 * - Group heading: typography.labelCap, text.tertiary, padding 8pt h + 4pt v
 * - Result row: 44pt tall, padding 16pt h + 4pt v
 * - Hover/highlighted row: accent.tint background, accent.warm text
 *
 * # Invariants honoured
 * - **I-DESKTOP-GATE-VIA-HOOK** — mount in (tabs)/_layout.tsx gates via
 *   `useResponsiveLayout().isWideDesktop`.
 * - **I-RN-COLOR-FORMATS** — all colors via designSystem.ts tokens
 *   (rendered as CSS in this `*.web.tsx` carve-out per established pattern).
 *
 * Per SPEC_ORCH-0891 §3.5.6 + DESIGN_SPEC §5.
 */

import React, { useEffect } from "react";
import { Command } from "cmdk";
import { useRouter } from "expo-router";

import { useAuth } from "../../context/AuthContext";
import { useAudienceList } from "../../hooks/marketing/useAudienceList";
import { useCampaigns } from "../../hooks/marketing/useCampaigns";
import { useUserTemplates } from "../../hooks/marketing/useUserTemplates";
import { useCommandPalette } from "../../hooks/useCommandPaletteState";

const RECENT_LIMIT = 5;

/**
 * CommandPalette — render-only. The global ⌘K keydown listener lives
 * inside this component's effect so mounting in `(tabs)/_layout.tsx`
 * Just Works™ — no separate hook needed.
 *
 * Mount in `(tabs)/_layout.tsx` web-only:
 *   {isWideDesktop ? <CommandPalette /> : null}
 */
export const CommandPalette: React.FC = () => {
  const router = useRouter();
  const { user } = useAuth();
  const accountId = user?.id ?? null;

  const { isOpen, query, open, close, toggle, setQuery } = useCommandPalette();

  // Fetch recent items. React Query handles caching + auto-refetch on
  // window focus, so the palette always reflects current state.
  const campaignsQuery = useCampaigns({ account_id: accountId });
  const audiencesQuery = useAudienceList(accountId);
  const templatesQuery = useUserTemplates(accountId);

  const recentCampaigns = (campaignsQuery.data ?? []).slice(0, RECENT_LIMIT);
  const recentAudiences = audiencesQuery.entries.slice(0, RECENT_LIMIT);
  const recentTemplates = (templatesQuery.data ?? []).slice(0, RECENT_LIMIT);

  // Global ⌘K / Ctrl+K listener.
  useEffect(() => {
    if (typeof window === "undefined") return; // SSR safety

    const onKeyDown = (e: KeyboardEvent): void => {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const navigateAndClose = (path: string): void => {
    close();
    router.push(path as never);
  };

  return (
    <Command.Dialog
      open={isOpen}
      onOpenChange={(next: boolean) => {
        if (next) {
          open();
        } else {
          close();
        }
      }}
      label="Command palette"
      style={DIALOG_STYLE}
      // cmdk renders a `<div role="dialog">` we style directly via CSS-in-JS
      // inline style. The backdrop is a sibling div cmdk provides; styling
      // via the global stylesheet (below).
    >
      <CommandPaletteCss />
      <div style={INPUT_WRAPPER_STYLE}>
        <span style={INPUT_ICON_STYLE} aria-hidden="true">
          ⌕
        </span>
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Jump to or search…"
          style={INPUT_STYLE}
        />
        <span style={INPUT_ESC_HINT_STYLE} aria-hidden="true">
          ESC
        </span>
      </div>

      <div style={DIVIDER_STYLE} />

      <Command.List style={LIST_STYLE}>
        <Command.Empty style={EMPTY_STYLE}>
          No matches. Try a different keyword.
        </Command.Empty>

        <Command.Group heading="Jump to" style={GROUP_STYLE}>
          <Command.Item
            value="jump-overview"
            onSelect={() => navigateAndClose("/marketing")}
            style={ITEM_STYLE}
          >
            Overview
          </Command.Item>
          <Command.Item
            value="jump-audiences"
            onSelect={() => navigateAndClose("/marketing/audiences")}
            style={ITEM_STYLE}
          >
            Audiences
          </Command.Item>
          <Command.Item
            value="jump-campaigns"
            onSelect={() => navigateAndClose("/marketing/campaigns")}
            style={ITEM_STYLE}
          >
            Campaigns
          </Command.Item>
          <Command.Item
            value="jump-templates"
            onSelect={() => navigateAndClose("/marketing/templates")}
            style={ITEM_STYLE}
          >
            Templates
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Actions" style={GROUP_STYLE}>
          <Command.Item
            value="action-new-campaign"
            onSelect={() => navigateAndClose("/marketing/campaigns/compose")}
            style={ITEM_STYLE}
          >
            New campaign
          </Command.Item>
        </Command.Group>

        {recentCampaigns.length > 0 ? (
          <Command.Group heading="Recent campaigns" style={GROUP_STYLE}>
            {recentCampaigns.map((c) => (
              <Command.Item
                key={`campaign-${c.id}`}
                value={`campaign-${c.id}-${c.name}`}
                onSelect={() => navigateAndClose(`/marketing/campaigns/${c.id}`)}
                style={ITEM_STYLE}
              >
                {c.name}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}

        {recentAudiences.length > 0 ? (
          <Command.Group heading="Recent audiences" style={GROUP_STYLE}>
            {recentAudiences.map((a) => (
              <Command.Item
                key={`audience-${a.client_key}`}
                value={`audience-${a.client_key}-${a.display_name}`}
                onSelect={() => navigateAndClose("/marketing/audiences")}
                style={ITEM_STYLE}
              >
                {a.display_name}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}

        {recentTemplates.length > 0 ? (
          <Command.Group heading="Recent templates" style={GROUP_STYLE}>
            {recentTemplates.map((t) => (
              <Command.Item
                key={`template-${t.id}`}
                value={`template-${t.id}-${t.name}`}
                onSelect={() => navigateAndClose(`/marketing/templates/${t.id}`)}
                style={ITEM_STYLE}
              >
                {t.name}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
      </Command.List>
    </Command.Dialog>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────

const DIALOG_STYLE: React.CSSProperties = {
  position: "fixed",
  top: "20vh",
  left: "50%",
  transform: "translateX(-50%)",
  maxWidth: 640,
  minWidth: 480,
  width: "calc(100vw - 96px)",
  maxHeight: "60vh",
  background: "#0c0e12",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 24,
  boxShadow: "0 16px 40px rgba(0, 0, 0, 0.48)",
  zIndex: 200, // Higher than Sheet.web (100/101) — palette is top-level chrome
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const INPUT_WRAPPER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: 56,
  padding: "0 16px",
  gap: 12,
  flexShrink: 0,
};

const INPUT_ICON_STYLE: React.CSSProperties = {
  fontSize: 16,
  color: "rgba(255, 255, 255, 0.52)",
  flexShrink: 0,
};

const INPUT_STYLE: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  color: "rgba(255, 255, 255, 0.96)",
  fontSize: 16,
  lineHeight: 1.4,
  fontFamily: "inherit",
};

const INPUT_ESC_HINT_STYLE: React.CSSProperties = {
  fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  fontSize: 11,
  fontWeight: 500,
  color: "rgba(255, 255, 255, 0.52)",
  background: "rgba(255, 255, 255, 0.04)",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: 4,
  padding: "2px 6px",
  flexShrink: 0,
};

const DIVIDER_STYLE: React.CSSProperties = {
  height: 1,
  background: "rgba(255, 255, 255, 0.08)",
  flexShrink: 0,
};

const LIST_STYLE: React.CSSProperties = {
  overflowY: "auto",
  padding: "8px 0",
  flex: 1,
};

const GROUP_STYLE: React.CSSProperties = {
  padding: 0,
};

const ITEM_STYLE: React.CSSProperties = {
  height: 44,
  padding: "0 16px",
  display: "flex",
  alignItems: "center",
  color: "rgba(255, 255, 255, 0.96)",
  fontSize: 14,
  cursor: "pointer",
  userSelect: "none",
};

const EMPTY_STYLE: React.CSSProperties = {
  padding: "20px 16px",
  textAlign: "center",
  color: "rgba(255, 255, 255, 0.52)",
  fontSize: 14,
};

/**
 * CommandPaletteCss — injects the global CSS that cmdk's group headings,
 * highlighted-item state, and backdrop need. Mounted once inside the
 * palette component; safe to render multiple times (CSS is idempotent).
 *
 * - `[cmdk-group-heading]`: typography.labelCap — uppercase, 11px,
 *   text.tertiary, letter-spacing 1.2px.
 * - `[cmdk-item][data-selected="true"]`: accent.tint background + accent.warm
 *   text. cmdk applies this attribute on the highlighted item (arrow-key
 *   navigation OR hover).
 * - `[cmdk-overlay]`: backdrop styling (rgba(0,0,0,0.7), zIndex 199).
 */
const CommandPaletteCss: React.FC = () => (
  <style
    dangerouslySetInnerHTML={{
      __html: `
        [cmdk-group-heading] {
          padding: 8px 16px 4px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.52);
        }
        [cmdk-item][data-selected="true"] {
          background: rgba(235, 120, 37, 0.28);
          color: #eb7825;
        }
        [cmdk-item][data-disabled="true"] {
          opacity: 0.4;
          cursor: not-allowed;
        }
        [cmdk-overlay] {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          z-index: 199;
        }
        [cmdk-dialog] {
          /* dialog root styling lives in inline DIALOG_STYLE; this rule
             exists in case cmdk needs to override pointer-events or
             other defaults in future versions */
        }
      `,
    }}
  />
);

export default CommandPalette;
