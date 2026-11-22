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
  fetchBrandFormCounts,
  fetchDoorReads,
  fetchGuestAnswers,
  fetchBrandFormResponses,
  fetchBrandForms,
  fetchEventAttachment,
  fetchGuestQuestionsTile,
  publishBrandForm,
  reopenBrandForm,
  saveBrandFormDraft,
  setBrandFormDoorFullAnswers,
  setBrandFormDoorInvited,
  setBrandFormResponseHidden,
  type AttachInput,
  type DoorReadRow,
  type GuestAnswersCardData,
  type GuestAnswersSubjectKind,
  type AttachResult,
  type BrandFormAttachment,
  type BrandFormCounts,
  type BrandFormDetail,
  type BrandFormListItem,
  type BrandFormOwnerFilter,
  type BrandFormResponsesFilter,
  type BrandFormResponsesPage,
  type BrandFormRow,
  type GuestQuestionsTileData,
  type BrandFormStatus,
  type PublishResult,
  type SaveDraftInput,
} from "../services/brandFormsService";
import type { BrandFormDefinition } from "../utils/brandFormDefinition";
import { brandFormKeys } from "./brandFormKeys";
import { loadRosterAnswers, type RosterAnswerIndex } from "../utils/guestRosterAnswers";
import {
  fetchFormRequestLog,
  previewFormRequest,
  sendFormRequest,
  setFormAutoRemind,
  type FormRequestChannel,
  type FormRequestInput,
  type FormRequestLog,
  type FormRequestPreview,
  type FormRequestResult,
  type FormRequestSendInput,
  type FormRequestSubject,
} from "../services/brandFormRequestService";

export { brandFormKeys } from "./brandFormKeys";

const useReady = (): boolean => {
  const { isAuthReady, user } = useAuth();
  const enabledAuth = isAuthReady && user !== null;
  return enabledAuth;
};

export function useBrandFormsList(brandId: string | null): UseQueryResult<BrandFormListItem[]> {
  const ready = useReady();
  return useQuery<BrandFormListItem[]>({
    queryKey: brandId === null ? brandFormKeys.idle("list") : brandFormKeys.list(brandId),
    enabled: ready && brandId !== null,
    staleTime: 15_000,
    queryFn: () => {
      if (brandId === null) throw new Error("brand_required");
      return fetchBrandForms(brandId);
    },
  });
}

/**
 * #4541 R4.2: the forms the Blast composer's "+ Form" picker lists (this
 * brand's, archived left out; the picker says why a draft or closed form
 * cannot be sent).
 */
export function useBlastFormPicker(brandId: string | null): UseQueryResult<BrandFormListItem[]> {
  const ready = useReady();
  return useQuery<BrandFormListItem[]>({
    queryKey: brandId === null ? brandFormKeys.idle("blast-picker") : brandFormKeys.blastPicker(brandId),
    enabled: ready && brandId !== null,
    staleTime: 15_000,
    queryFn: () => {
      if (brandId === null) throw new Error("brand_required");
      return fetchBrandForms(brandId);
    },
  });
}

/** Wave 3: answered and to-answer per form (list cards) and per page (tiles), one read. */
export function useBrandFormCounts(brandId: string | null): UseQueryResult<BrandFormCounts> {
  const ready = useReady();
  return useQuery<BrandFormCounts>({
    queryKey: brandId === null ? brandFormKeys.idle("counts") : brandFormKeys.counts(brandId),
    enabled: ready && brandId !== null,
    staleTime: 15_000,
    queryFn: () => {
      if (brandId === null) throw new Error("brand_required");
      return fetchBrandFormCounts(brandId);
    },
  });
}

export function useBrandFormDetail(formId: string | null): UseQueryResult<BrandFormDetail> {
  const ready = useReady();
  return useQuery<BrandFormDetail>({
    queryKey: formId === null ? brandFormKeys.idle("detail") : brandFormKeys.detail(formId),
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
  /** #4541 R4.7: All, Known or Unknown (default All). */
  owner?: BrandFormOwnerFilter;
  /** #4541 R4.8: include hidden Unknown replies. */
  showHidden?: boolean;
  enabled?: boolean;
}): UseQueryResult<BrandFormResponsesPage> {
  const ready = useReady();
  const { formId, eventId, filter } = input;
  const owner = input.owner ?? "all";
  const showHidden = input.showHidden === true;
  return useQuery<BrandFormResponsesPage>({
    queryKey:
      formId === null
        ? brandFormKeys.idle("responses")
        : brandFormKeys.responses(formId, eventId, responsesFilterKey(filter, owner, showHidden)),
    enabled: ready && formId !== null && input.enabled !== false,
    staleTime: 10_000,
    queryFn: () => {
      if (formId === null) throw new Error("form_required");
      return fetchBrandFormResponses({ formId, eventId, filter, owner, showHidden });
    },
  });
}

/** #4541 §6.2: the owner filter and the hidden toggle fold into the responses key's filter string. */
export const responsesFilterKey = (
  filter: BrandFormResponsesFilter,
  owner: BrandFormOwnerFilter,
  showHidden: boolean,
): string => `${filter}:${owner}:${showHidden ? 1 : 0}`;

/** #4541 R4.8: hide an Unknown reply, or undo it. Every forms read refreshes (counts, lists, export). */
export function useHideBrandFormResponse(): UseMutationResult<boolean, Error, { responseId: string; hidden: boolean }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { responseId: string; hidden: boolean }) => setBrandFormResponseHidden(v.responseId, v.hidden),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: brandFormKeys.all });
    },
  });
}

export function useEventAttachment(
  eventId: string | null,
  enabled = true,
): UseQueryResult<{ attachment: BrandFormAttachment; form: BrandFormRow } | null> {
  const ready = useReady();
  return useQuery<{ attachment: BrandFormAttachment; form: BrandFormRow } | null>({
    queryKey: eventId === null ? brandFormKeys.idle("event-attachment") : brandFormKeys.eventAttachment(eventId),
    enabled: ready && eventId !== null && enabled,
    staleTime: 15_000,
    queryFn: () => {
      if (eventId === null) throw new Error("event_required");
      return fetchEventAttachment(eventId);
    },
  });
}

/** The "Guest questions" manage-page tile: the page's form and its counts. */
export function useGuestQuestionsTileData(
  eventId: string | null,
  enabled = true,
): UseQueryResult<GuestQuestionsTileData | null> {
  const ready = useReady();
  return useQuery<GuestQuestionsTileData | null>({
    queryKey: eventId === null ? brandFormKeys.idle("tile") : brandFormKeys.tile(eventId),
    enabled: ready && eventId !== null && enabled,
    staleTime: 15_000,
    queryFn: () => {
      if (eventId === null) throw new Error("event_required");
      return fetchGuestQuestionsTile(eventId);
    },
  });
}

/** #4541 R1.9: one guest's answers for the page's active form (marketing manager and up). */
export function useGuestAnswers(
  eventId: string | null,
  subject: { kind: GuestAnswersSubjectKind; id: string } | null,
  enabled = true,
): UseQueryResult<GuestAnswersCardData> {
  const ready = useReady();
  return useQuery<GuestAnswersCardData>({
    queryKey:
      eventId === null || subject === null
        ? brandFormKeys.idle("guest-answers")
        : brandFormKeys.guestAnswers(eventId, subject.kind, subject.id),
    enabled: ready && eventId !== null && subject !== null && enabled,
    staleTime: 15_000,
    queryFn: () => {
      if (eventId === null || subject === null) throw new Error("subject_required");
      return fetchGuestAnswers(eventId, subject);
    },
  });
}

/** #4541 R8.3: the latest door reads of full answers on one page (event manager and up). */
export function useDoorReads(eventId: string | null, enabled = true): UseQueryResult<DoorReadRow[]> {
  const ready = useReady();
  return useQuery<DoorReadRow[]>({
    queryKey: eventId === null ? brandFormKeys.idle("door-reads") : brandFormKeys.doorReads(eventId),
    enabled: ready && eventId !== null && enabled,
    staleTime: 15_000,
    queryFn: () => {
      if (eventId === null) throw new Error("event_required");
      return fetchDoorReads(eventId);
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

/** #4541 R8.3: "Invited door staff can too". */
export function useSetDoorInvited(): UseMutationResult<boolean, Error, { formId: string; on: boolean }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { formId: string; on: boolean }) => setBrandFormDoorInvited(v.formId, v.on),
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

/**
 * Wave 3: one page's answers for the guest list (the chip and the drawer): the
 * page's active form, then every page of its answers (200 a read) and the
 * not-answered list. A list longer than the read cap is marked `truncated`, and
 * guests past it show "Answer not loaded" instead of nothing. Null when the page
 * has no published form.
 */
export function useRosterAnswers(eventId: string | null): UseQueryResult<RosterAnswerIndex | null> {
  const ready = useReady();
  return useQuery<RosterAnswerIndex | null>({
    queryKey: eventId === null ? brandFormKeys.idle("roster-answers") : brandFormKeys.rosterAnswers(eventId),
    enabled: ready && eventId !== null,
    staleTime: 15_000,
    queryFn: async () => {
      if (eventId === null) throw new Error("event_required");
      const found = await fetchEventAttachment(eventId);
      if (found === null || found.form.liveVersionId === null || found.form.status === "draft") return null;
      const formId = found.form.id;
      return loadRosterAnswers(found.form.name, (offset, limit) =>
        fetchBrandFormResponses({ formId, eventId, filter: "all", limit, offset }),
      );
    },
  });
}

/**
 * Wave 4: reach and cost before "Ask guests to answer" or "Remind" sends
 * (event manager and up; the edge checks again). Refreshed when the audience or
 * channels change; never cached long, since answers and throttles move.
 */
export function useFormRequestPreview(input: FormRequestInput | null): UseQueryResult<FormRequestPreview> {
  const ready = useReady();
  return useQuery<FormRequestPreview>({
    queryKey:
      input === null
        ? brandFormKeys.idle("request-preview")
        : brandFormKeys.requestPreview(
            input.formId,
            input.eventId,
            input.kind,
            input.kind === "remind" ? "unanswered" : input.audience,
            [...input.channels].sort().join(","),
            (input.subjects ?? []).map((s) => `${s.kind}:${s.id}`).sort().join(","),
          ),
    enabled: ready && input !== null && input.channels.length > 0,
    staleTime: 0,
    queryFn: () => {
      if (input === null) throw new Error("request_required");
      return previewFormRequest(input);
    },
  });
}

export function useSendFormRequest(): UseMutationResult<FormRequestResult, Error, FormRequestSendInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: FormRequestSendInput) => sendFormRequest(v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: brandFormKeys.all });
    },
  });
}

export function useSetFormAutoRemind(): UseMutationResult<
  { autoRemind: boolean; remindAt: string | null; channels: FormRequestChannel[] },
  Error,
  { attachmentId: string; on: boolean; channels: FormRequestChannel[] }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { attachmentId: string; on: boolean; channels: FormRequestChannel[] }) => setFormAutoRemind(v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: brandFormKeys.all });
    },
  });
}

/**
 * Wave 4 review: the host's delivery log (sends and failures per guest, the
 * automatic reminder runs) for one form on one page, or one guest. Loaded only
 * when the host opens it.
 */
export function useFormRequestLog(
  input: { formId: string; eventId: string; subject?: FormRequestSubject } | null,
): UseQueryResult<FormRequestLog> {
  const ready = useReady();
  return useQuery<FormRequestLog>({
    queryKey:
      input === null
        ? brandFormKeys.idle("request-log")
        : brandFormKeys.requestLog(
            input.formId,
            input.eventId,
            input.subject === undefined ? "all" : `${input.subject.kind}:${input.subject.id}`,
          ),
    enabled: ready && input !== null,
    staleTime: 15_000,
    queryFn: () => {
      if (input === null) throw new Error("request_required");
      return fetchFormRequestLog(input);
    },
  });
}
