/**
 * #4541 R2.4 — React Query hooks for the Explorer's brand form reads and the
 * answer submit. Keys come only from `brandFormKeys` (Constitution rule 4);
 * server state stays in the query cache (rule 5). Every successful submit
 * invalidates `brandFormKeys.all`, so cards, the "Still to answer" row and the
 * screen re-read together.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { RsvpBrandFormRead } from "@mingla/offering-rendering/rsvpBrandForm";

import { brandFormKeys } from "./queryKeys";
import {
  BrandFormError,
  fetchBlastForm,
  fetchCheckoutForm,
  fetchLinkForm,
  fetchMyForm,
  fetchMyPendingBrandForms,
  fetchPageForm,
  submitBrandForm,
  type CheckoutBrandForm,
  type FormScreenRead,
  type PendingBrandForm,
  type SubmitBrandFormBody,
  type SubmitBrandFormResult,
} from "../services/brandFormService";
import {
  formIdentityPath,
  formScreenScope,
  type FormRouteParams,
} from "../components/forms/formRoute";
import { useAppStore } from "../store/appStore";

const noRetryOnRefusal = (failureCount: number, error: unknown): boolean =>
  error instanceof BrandFormError &&
  (error.code === "network" || error.code === "server_error") &&
  failureCount < 1;

/** The signed-in guest's forms ("to answer" cards, "Still to answer"). */
export function useMyPendingForms(): UseQueryResult<PendingBrandForm[]> {
  const userId = useAppStore((s) => s.user?.id ?? null);
  return useQuery<PendingBrandForm[]>({
    queryKey: brandFormKeys.myPending(userId),
    enabled: userId !== null,
    staleTime: 30_000,
    queryFn: fetchMyPendingBrandForms,
  });
}

/** The pending row for one held order, RSVP or plus-one, from the list above. */
export function pendingFormFor(
  rows: readonly PendingBrandForm[] | undefined,
  kind: string | null,
  id: string | null,
  eventId?: string | null,
): PendingBrandForm | null {
  if (rows === undefined || kind === null || id === null) return null;
  return rows.find((row) =>
    row.subject.kind === kind && row.subject.id === id &&
    (eventId === undefined || eventId === null || row.eventId === eventId)
  ) ?? null;
}

/** The form screen's read, by the way it was opened (R2.2). */
export function useFormScreenRead(
  params: FormRouteParams | null,
  signedIn: boolean,
): UseQueryResult<FormScreenRead> {
  const path = params === null ? null : formIdentityPath(params, signedIn);
  return useQuery<FormScreenRead>({
    queryKey: brandFormKeys.screen(params?.formId ?? "none", params === null ? "none" : formScreenScope(params)),
    enabled: params !== null && path !== "sign_in",
    staleTime: 15_000,
    retry: noRetryOnRefusal,
    queryFn: () => {
      const p = params as FormRouteParams;
      switch (path) {
        case "link":
          return fetchLinkForm(p.formId, p.token as string);
        case "blast_user":
        case "blast_unknown":
          return fetchBlastForm(p.formId, p.campaignId as string);
        case "held":
        case "event":
          return fetchMyForm(p.formId, p.eventId);
        default:
          throw new BrandFormError("sign_in_required", 401);
      }
    },
  });
}

/** R2.10 — the cart's questions read (events and experiences). */
export function useCheckoutForm(
  eventId: string,
  enabled: boolean,
): UseQueryResult<CheckoutBrandForm | null> {
  return useQuery<CheckoutBrandForm | null>({
    queryKey: brandFormKeys.checkout(eventId),
    enabled,
    staleTime: 30_000,
    retry: noRetryOnRefusal,
    queryFn: () => fetchCheckoutForm(eventId),
  });
}

/** R1.14 — the RSVP page's form, through the edge. */
export function usePageForm(
  eventId: string | null,
  enabled: boolean,
): UseQueryResult<RsvpBrandFormRead | null> {
  return useQuery({
    queryKey: brandFormKeys.rsvpForm(eventId),
    enabled: enabled && eventId !== null,
    staleTime: 30_000,
    queryFn: () => fetchPageForm(eventId as string),
  });
}

/** The answer submit; `onError` is the screen's (it owns the copy). */
export function useSubmitBrandForm(
  onError: (error: BrandFormError) => void,
): UseMutationResult<SubmitBrandFormResult, BrandFormError, SubmitBrandFormBody> {
  const queryClient = useQueryClient();
  return useMutation<SubmitBrandFormResult, BrandFormError, SubmitBrandFormBody>({
    mutationFn: async (body) => {
      try {
        return await submitBrandForm(body);
      } catch (error) {
        throw error instanceof BrandFormError ? error : new BrandFormError("network", null);
      }
    },
    onError,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: brandFormKeys.all });
    },
  });
}
