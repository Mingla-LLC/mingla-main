import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { brandKeys } from "./brandKeys";
import {
  cancelContactImport,
  executeContactImport,
  getContactImportStatus,
  inspectContactImport,
  previewContactImport,
  ContactImportError,
  type ContactImportFile,
} from "../services/contactImportService";
export const contactImportKeys = {
  all: (brandId: string) => ["contact-import", brandId] as const,
  batch: (brandId: string, batchId: string) =>
    [...contactImportKeys.all(brandId), batchId] as const,
};
export function useContactImportStatus(
  brandId: string | null,
  batchId: string | null,
) {
  const { isAuthReady, user } = useAuth();
  return useQuery({
    queryKey: contactImportKeys.batch(brandId ?? "", batchId ?? ""),
    queryFn: () => getContactImportStatus(brandId!, batchId!),
    enabled:
      isAuthReady && user !== null && brandId !== null && batchId !== null,
    staleTime: 0,
    retry: 2,
  });
}
export function useContactImport() {
  const qc = useQueryClient();
  return {
    inspect: useMutation({
      mutationFn: ({
        brandId,
        file,
      }: {
        brandId: string;
        file: ContactImportFile;
      }) => inspectContactImport(brandId, file),
      retry: (n, e) => n < 2 && e instanceof ContactImportError && e.retryable,
    }),
    preview: useMutation({
      mutationFn: previewContactImport,
      retry: (n, e) => n < 2 && e instanceof ContactImportError && e.retryable,
    }),
    execute: useMutation({
      mutationFn: executeContactImport,
      onSuccess: (_, v) => {
        void qc.invalidateQueries({
          queryKey: contactImportKeys.batch(v.brandId, v.preview.batchId),
        });
        void qc.invalidateQueries({ queryKey: brandKeys.detail(v.brandId) });
      },
    }),
    cancel: useMutation({
      mutationFn: ({
        brandId,
        batchId,
      }: {
        brandId: string;
        batchId: string;
      }) => cancelContactImport(brandId, batchId),
    }),
  };
}
