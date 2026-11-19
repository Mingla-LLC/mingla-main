/**
 * #4453 (contract section I) — the workspace brand switcher.
 *
 * One component for the app top bar and for any brand-scoped screen. It shows
 * the brand of the screen you are on (the `brandId` prop, else the brand the
 * route names, else the current brand), and switching on a brand-scoped screen
 * opens the SAME screen for the chosen brand.
 *
 *   <WorkspaceBrandSwitcher brandId={brandId} compact />
 *
 * The root shell is the only file that imports this one: it hands it to
 * every top bar and brand screen through the workspace route context
 * (`useContext(WorkspaceRouteContext).Switcher`), so it loads with the root
 * layout and none of it sits in the shared boot chunk. The menu loads the
 * first time it opens. Web >= 1024 gets a popover under the chip; phones and
 * native get a sheet that drops from the top. A top bar that owns a full switcher sheet (create,
 * continue setup, delete) passes it as `onOpenSheet`: phones open that sheet,
 * and the desktop popover offers it as "Manage brands".
 */
import React, { Suspense, useCallback, useMemo, useRef, useState } from "react";
import type { View } from "react-native";

import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useWorkspaceBrand } from "../../hooks/useWorkspaceBrand";
import { BrandChip } from "../ui/BrandChip";
import type { BrandMenuAnchor } from "./WorkspaceBrandMenu";
import type { WorkspaceBrandSwitcherProps } from "./workspaceBrandContext";

export type { WorkspaceBrandSwitcherProps } from "./workspaceBrandContext";

// The menu loads through the brand sheet's module, not its own file: the two
// share their search field, copy and switching rules, and Metro moves
// anything that sits in two on-demand chunks onto the boot path. One import
// target is one chunk (the sheet's, which the shell already warms up on idle).
const LazyWorkspaceBrandMenu = React.lazy(async () => {
  const mod = await import("./BrandSwitcherSheet");
  return { default: mod.WorkspaceBrandMenu };
});

type Measurable = {
  measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void;
  focus?: () => void;
} | null;

/** A tight header: a smaller brand mark. */
const COMPACT_MARK_SIZE = 20;

const FALLBACK_ANCHOR: BrandMenuAnchor = { x: 16, y: 16, width: 160, height: 44 };

export const WorkspaceBrandSwitcher: React.FC<WorkspaceBrandSwitcherProps> = ({
  brandId,
  compact = false,
  onOpenSheet,
  brandLoading,
  testID = "workspace-brand-switcher",
}) => {
  const { isWideDesktop } = useResponsiveLayout();
  const workspace = useWorkspaceBrand(brandId);
  const chipRef = useRef<View | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<BrandMenuAnchor | null>(null);
  // The menu stays mounted after its first open, so closing animates and the
  // chunk is not re-requested.
  const [loaded, setLoaded] = useState(false);

  const handlePress = useCallback((): void => {
    // No brand yet: the top bar's sheet is where a first brand is created.
    if (workspace.brand === null && !workspace.pending && onOpenSheet !== undefined) {
      onOpenSheet();
      return;
    }
    if (!isWideDesktop) {
      if (onOpenSheet !== undefined) {
        onOpenSheet();
        return;
      }
      setAnchor(null);
      setLoaded(true);
      setOpen(true);
      return;
    }
    const show = (next: BrandMenuAnchor): void => {
      setAnchor(next);
      setLoaded(true);
      setOpen(true);
    };
    const node = chipRef.current as Measurable;
    if (node?.measureInWindow === undefined) {
      show(FALLBACK_ANCHOR);
      return;
    }
    node.measureInWindow((x, y, width, height) => show({ x, y, width, height }));
  }, [isWideDesktop, onOpenSheet, workspace.brand, workspace.pending]);

  const expandedState = useMemo(() => ({ expanded: open }), [open]);

  const focusChip = useCallback((): void => {
    (chipRef.current as Measurable)?.focus?.();
  }, []);
  const handleClose = useCallback((): void => {
    setOpen(false);
    focusChip();
  }, [focusChip]);

  return (
    <>
      <BrandChip
        onPress={handlePress}
        brand={workspace.brand}
        fullNameLabel={compact}
        markSize={compact ? COMPACT_MARK_SIZE : undefined}
        brandLoading={brandLoading === true || workspace.pending}
        accessibilityState={expandedState}
        chipRef={chipRef}
        testID={testID}
      />
      {loaded ? (
        <Suspense fallback={null}>
          <LazyWorkspaceBrandMenu
            visible={open}
            onClose={handleClose}
            activeBrandId={workspace.brand?.id ?? null}
            anchor={isWideDesktop ? anchor : null}
            onManageBrands={isWideDesktop ? onOpenSheet : undefined}
            // The phone sheet's layer holds focus until it has left the page: hand it back then too.
            onClosed={focusChip}
          />
        </Suspense>
      ) : null}
    </>
  );
};

export default WorkspaceBrandSwitcher;
