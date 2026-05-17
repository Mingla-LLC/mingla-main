/**
 * useTemplateMutations — React Query mutations for create / update /
 * duplicate / delete (ORCH-0863).
 *
 * Each mutation's onSuccess invalidates the relevant `marketingKeys.templates.*`
 * factory entries so the Templates tab + Template detail screen pick up
 * fresh state without manual refetch.
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import {
  createUserTemplate,
  deleteUserTemplate,
  duplicateTemplate,
  updateUserTemplate,
  type CreateUserTemplateInput,
  type DeleteUserTemplateInput,
  type DuplicateTemplateInput,
  type UpdateUserTemplateInput,
} from "../../services/marketing/marketingTemplateService";
import type { MarketingTemplateRow } from "../../types/marketing";
import { marketingKeys } from "./marketingKeys";

export function useCreateUserTemplate(
  accountId: string | null | undefined,
): UseMutationResult<MarketingTemplateRow, Error, CreateUserTemplateInput> {
  const qc = useQueryClient();
  return useMutation<MarketingTemplateRow, Error, CreateUserTemplateInput>({
    mutationFn: async (input) => createUserTemplate(input),
    onSuccess: (row) => {
      if (typeof accountId === "string" && accountId.length > 0) {
        qc.invalidateQueries({ queryKey: marketingKeys.templates.user(accountId) });
      }
      qc.invalidateQueries({ queryKey: marketingKeys.templates.byId(row.id) });
    },
  });
}

export function useUpdateUserTemplate(
  accountId: string | null | undefined,
): UseMutationResult<MarketingTemplateRow, Error, UpdateUserTemplateInput> {
  const qc = useQueryClient();
  return useMutation<MarketingTemplateRow, Error, UpdateUserTemplateInput>({
    mutationFn: async (input) => updateUserTemplate(input),
    onSuccess: (row) => {
      if (typeof accountId === "string" && accountId.length > 0) {
        qc.invalidateQueries({ queryKey: marketingKeys.templates.user(accountId) });
      }
      qc.invalidateQueries({ queryKey: marketingKeys.templates.byId(row.id) });
    },
  });
}

export function useDuplicateTemplate(
  accountId: string | null | undefined,
): UseMutationResult<MarketingTemplateRow, Error, DuplicateTemplateInput> {
  const qc = useQueryClient();
  return useMutation<MarketingTemplateRow, Error, DuplicateTemplateInput>({
    mutationFn: async (input) => duplicateTemplate(input),
    onSuccess: (row) => {
      if (typeof accountId === "string" && accountId.length > 0) {
        qc.invalidateQueries({ queryKey: marketingKeys.templates.user(accountId) });
      }
      qc.invalidateQueries({ queryKey: marketingKeys.templates.byId(row.id) });
    },
  });
}

export function useDeleteUserTemplate(
  accountId: string | null | undefined,
): UseMutationResult<void, Error, DeleteUserTemplateInput> {
  const qc = useQueryClient();
  return useMutation<void, Error, DeleteUserTemplateInput>({
    mutationFn: async (input) => deleteUserTemplate(input),
    onSuccess: (_void, input) => {
      if (typeof accountId === "string" && accountId.length > 0) {
        qc.invalidateQueries({ queryKey: marketingKeys.templates.user(accountId) });
      }
      qc.invalidateQueries({ queryKey: marketingKeys.templates.byId(input.template_id) });
    },
  });
}
