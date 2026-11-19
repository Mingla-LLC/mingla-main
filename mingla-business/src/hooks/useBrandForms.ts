/**
 * #4514 — React Query hooks over brandFormsService. Keys come only from
 * `brandFormKeys`. Every mutation invalidates `brandFormKeys.all` when it
 * succeeds; errors reach the caller (the screen shows them, never swallowed).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  archiveBrandForm,
  attachBrandForm,
  closeBrandForm,
  createBrandForm,
  detachBrandForm,
  fetchBrandForm,
  fetchBrandFormResponses,
  fetchBrandForms,
  fetchEventAttachment,
  publishBrandForm,
  reopenBrandForm,
  saveBrandFormDraft,
  setBrandFormDoorFullAnswers,
  type AttachInput,
  type AttachResult,
  type BrandFormAttachment,
  type BrandFormDetail,
  type BrandFormListItem,
  type BrandFormResponsesFilter,
  type BrandFormResponsesPage,
  type BrandFormRow,
  type BrandFormStatus,
  type PublishResult,
  type SaveDraftInput,
} from "../services/brandFormsService";
import type { BrandFormDefinition } from "../utils/brandFormDefinition";
import { brandFormKeys } from "./brandFormKeys";

export { brandFormKeys } from "./brandFormKeys";

const useReady = (): boolean => {
  const { isAuthReady, user } = useAuth();
  return isAuthReady && user !== null;
};

export function useBrandFormsList(brandId: string | null): UseQueryResult<BrandFormListItem[]> {
  const ready = useReady();
  return useQuery<BrandFormListItem[]>({
    queryKey: brandId === null ? ["brand-forms", "list", "none"] : brandFormKeys.list(brandId),
    enabled: ready && brandId !== null,
    staleTime: 15_000,
    queryFn: () => {
      if (brandId === null) throw new Error("brand_required");
      return fetchBrandForms(brandId);
    },
  });
}

export function useBrandFormDetail(formId: string | null): UseQueryResult<BrandFormDetail> {
  const ready = useReady();
  return useQuery<BrandFormDetail>({
    queryKey: formId === null ? ["brand-forms", "detail", "none"] : brandFormKeys.detail(formId),
    enabled: ready && formId !== null,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => {
      if (formId === null) throw new Error("form_required");
      return fetchBrandForm(formId);
    },
  });
}

export function useBrandFormResponses(input: {
  formId: string | null;
  eventId: string | null;
  filter: BrandFormResponsesFilter;
  enabled?: boolean;
}): UseQueryResult<BrandFormResponsesPage> {
  const ready = useReady();
  const { formId, eventId, filter } = input;
  return useQuery<BrandFormResponsesPage>({
    queryKey:
      formId === null
        ? ["brand-forms", "responses", "none"]
        : brandFormKeys.responses(formId, eventId, filter),
    enabled: ready && formId !== null && input.enabled !== false,
    staleTime: 10_000,
    queryFn: () => {
      if (formId === null) throw new Error("form_required");
      return fetchBrandFormResponses({ formId, eventId, filter });
    },
  });
}

export function useEventAttachment(
  eventId: string | null,
  enabled = true,
): UseQueryResult<{ attachment: BrandFormAttachment; form: BrandFormRow } | null> {
  const ready = useReady();
  return useQuery<{ attachment: BrandFormAttachment; form: BrandFormRow } | null>({
    queryKey: eventId === null ? ["brand-forms", "event-attachment", "none"] : brandFormKeys.eventAttachment(eventId),
    enabled: ready && eventId !== null && enabled,
    staleTime: 15_000,
    queryFn: () => {
      if (eventId === null) throw new Error("event_required");
      return fetchEventAttachment(eventId);
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateBrandForm(): UseMutationResult<
  { formId: string; draftRev: number },
  Error,
  { brandId: string; name: string; draft?: BrandFormDefinition }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { brandId: string; name: string; draft?: BrandFormDefinition }) =>
      createBrandForm(v.brandId, v.name, v.draft),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: brandFormKeys.all });
    },
  });
}

export function useSaveBrandFormDraft(): UseMutationResult<{ draftRev: number }, Error, SaveDraftInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: SaveDraftInput) => saveBrandFormDraft(v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: brandFormKeys.all });
    },
  });
}

export function usePublishBrandForm(): UseMutationResult<
  PublishResult,
  Error,
  { formId: string; draftRev: number }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { formId: string; draftRev: number }) => publishBrandForm(v.formId, v.draftRev),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: brandFormKeys.all });
    },
  });
}

const useStatusMutation = (
  run: (formId: string) => Promise<BrandFormStatus>,
): UseMutationResult<BrandFormStatus, Error, string> => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formId: string) => run(formId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: brandFormKeys.all });
    },
  });
};

export const useCloseBrandForm = (): UseMutationResult<BrandFormStatus, Error, string> =>
  useStatusMutation(closeBrandForm);
export const useReopenBrandForm = (): UseMutationResult<BrandFormStatus, Error, string> =>
  useStatusMutation(reopenBrandForm);
export const useArchiveBrandForm = (): UseMutationResult<BrandFormStatus, Error, string> =>
  useStatusMutation(archiveBrandForm);

export function useSetDoorFullAnswers(): UseMutationResult<boolean, Error, { formId: string; on: boolean }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { formId: string; on: boolean }) => setBrandFormDoorFullAnswers(v.formId, v.on),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: brandFormKeys.all });
    },
  });
}

export function useAttachBrandForm(): UseMutationResult<AttachResult, Error, AttachInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: AttachInput) => attachBrandForm(v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: brandFormKeys.all });
    },
  });
}

export function useDetachBrandForm(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => detachBrandForm(attachmentId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: brandFormKeys.all });
    },
  });
}
