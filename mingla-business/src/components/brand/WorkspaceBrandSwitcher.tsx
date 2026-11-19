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
 * The chip (mark, name, chevron) is on the boot path; the menu loads the
 * first time it opens. Web >= 1024 gets a popover under the chip; phones and
 * native get a sheet. A top bar that owns a full switcher sheet (create,
 * continue setup, delete) passes it as `onOpenSheet`: phones open that sheet,
 * and the desktop popover offers it as "Manage brands".
 */
import React, { Suspense, useCallback, useRef, useState } from "react";
import type { View } from "react-native";

import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useWorkspaceBrand } from "../../hooks/useWorkspaceBrand";
import { BrandChip } from "../ui/BrandChip";
import type { BrandMenuAnchor } from "./WorkspaceBrandMenu";

export interface WorkspaceBrandSwitcherProps {
  /** The brand this screen edits. Omit on screens that follow the route or the current brand. */
  brandId?: string;
  /** A tight header: smaller mark, and the name shortens to the space it has. */
  compact?: boolean;
  /** The app top bar's own full switcher sheet. */
  onOpenSheet?: () => void;
  /** The host knows the current brand is still being resolved (issue #3345). */
  brandLoading?: boolean;
  testID?: string;
}

const LazyWorkspaceBrandMenu = React.lazy(async () => {
  const mod = await import("./WorkspaceBrandMenu");
  return { default: mod.WorkspaceBrandMenu };
});

type Measurable = {
  measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void;
  focus?: () => void;
} | null;

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

  const handleClose = useCallback((): void => {
    setOpen(false);
    (chipRef.current as Measurable)?.focus?.();
  }, []);

  return (
    <>
      <BrandChip
        onPress={handlePress}
        brandId={brandId}
        compact={compact}
        brandLoading={brandLoading}
        expanded={open}
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
          />
        </Suspense>
      ) : null}
    </>
  );
};

export default WorkspaceBrandSwitcher;
