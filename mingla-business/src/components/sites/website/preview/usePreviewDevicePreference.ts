import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { brandSiteKeys } from "../../../../sites/brandSiteKeys";
import {
  fetchPreviewPreference,
  readCachedPreviewPreference,
  savePreviewPreference,
} from "../../../../sites/contentApi";
import {
  defaultPreviewPreference,
  type PreviewDevicePreference,
} from "../../../../sites/previewDevice";

/**
 * #2829 W9r (DESIGN_SPEC §1.7) — the preview size this member last chose,
 * across brands, sessions and devices: the server row (website.previewDevice)
 * is the truth; the per-user local cache paints the first frame. Default:
 * Desktop on desktop web, Phone on phones and tablets. A failed save is said
 * out loud (the choice still applies on this device).
 */
export function usePreviewDevicePreference(
  userId: string | null,
  isWideDesktop: boolean,
  onSaveError?: (message: string) => void,
): { preference: PreviewDevicePreference; setPreference: (next: PreviewDevicePreference) => void } {
  const client = useQueryClient();
  const [preference, setLocal] = useState<PreviewDevicePreference>(() => defaultPreviewPreference(isWideDesktop));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void readCachedPreviewPreference(userId).then((cached) => {
      if (active && cached && !touched) setLocal(cached);
    });
    return () => {
      active = false;
    };
    // The cache only seeds the first paint; later choices win.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const server = useQuery({
    queryKey: brandSiteKeys.previewDevice(userId),
    queryFn: () => fetchPreviewPreference(userId!),
    enabled: userId !== null,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (server.data && !touched) setLocal(server.data);
  }, [server.data, touched]);

  const save = useMutation({
    mutationFn: (next: PreviewDevicePreference) => savePreviewPreference(userId!, next),
    onSuccess: (saved) => client.setQueryData(brandSiteKeys.previewDevice(userId), saved),
    onError: (error) => onSaveError?.(error instanceof Error ? error.message : "Your preview size couldn’t be saved."),
  });

  const setPreference = useCallback((next: PreviewDevicePreference) => {
    setTouched(true);
    setLocal(next);
    if (userId) save.mutate(next);
  }, [save, userId]);

  return { preference, setPreference };
}
