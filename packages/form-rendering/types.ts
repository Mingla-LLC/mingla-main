/**
 * #4514 — the one question model's types for @mingla/form-rendering.
 *
 * The question shape is the trip intake shape (ORCH-0880), which brand forms
 * extend in later waves. Every visual primitive is injected by the host app
 * (C11): its design tokens, its Icon and its date input. File upload is
 * rendered by the host app through `renderFileUpload`.
 */

import type { ComponentType, ReactNode } from "react";

export type FormQuestionType =
  | "short_text"
  | "long_text"
  | "single_choice"
  | "multi_choice"
  | "date"
  | "number"
  | "file_upload";

export interface FormQuestion {
  /** UUID, unique within the form. */
  id: string;
  type: FormQuestionType;
  /** 1-200 chars. */
  label: string;
  required: boolean;
  /** Display order, unique within the form. */
  position: number;
  helper?: string;
  placeholder?: string;
  /** single_choice / multi_choice: 2-10 options. */
  options?: string[];
  /** file_upload: max files per question, 1-5; default 1. */
  max_files?: number;
  allow_images?: boolean;
  allow_pdfs?: boolean;
  allow_docs?: boolean;
  /** number: optional limits. */
  min?: number;
  max?: number;
  integer_only?: boolean;
}

export interface FormFileAnswer {
  claim_id?: string;
  mime_type: string;
  size_bytes: number;
  expires_at?: string;
  path?: string;
  filename?: string;
}

export type FormAnswerValue = string | string[] | FormFileAnswer[] | null;

export interface FormSchema {
  questions: FormQuestion[];
}

/** The icons this package draws. The host's Icon must accept these names. */
export type FormIconName = "bell" | "check" | "calendar" | "eye";

export interface FormIconProps {
  name: FormIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/**
 * The host's date input, drawn on every platform: the host app's Mingla
 * calendar field (#4523). It commits `YYYY-MM-DD` (or "" when cleared). The
 * name predates #4523, when this was the web-only browser date box.
 */
export interface FormWebDateInputProps {
  type: "date";
  value: string;
  onChangeValue: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  hasError?: boolean;
  testID?: string;
  /** #4523: the form's tokens, so a host can draw its calendar in the form's palette. */
  tokens?: FormRenderingTokens;
}

export interface FormTextStyle {
  fontSize?: number;
  lineHeight?: number;
}

/** The subset of the host's design tokens the renderers read. */
export interface FormRenderingTokens {
  color: {
    danger: string;
    warning: string;
    accent: string;
    accentLine: string;
    line: string;
    text1: string;
    text2: string;
    text3: string;
    text4: string;
    textStrong: string;
    fill: { inset: string };
    /**
     * #4541 R2.7: the required asterisk's colour. Absent: `accent` (Host and
     * buyer web). The Explorer app passes white. "(optional)" still marks the
     * other questions, so colour never carries the meaning alone.
     */
    requiredMark?: string;
  };
  radius: { sm: number; md: number };
  space: { 1: number; 2: number; 4: number; 6: number };
  type: { body: FormTextStyle; caption: FormTextStyle; small: FormTextStyle };
}

/** The host's cover drawing for the brand header (image, or its gradient fallback). */
export interface FormBrandCoverProps {
  uri: string | null;
  hue: number;
  accent: string | null;
  height: number;
}

/**
 * #4541 R2.12: every guest-facing word this package draws. The English
 * defaults (`DEFAULT_FORM_RENDERING_COPY`) are today's strings, so Host web
 * and buyer web pass nothing. The Explorer app passes its `forms` namespace
 * `t()` values. Placeholder functions receive already-formatted values.
 */
export interface FormRenderingCopy {
  /** The door line under a door question's label (drawn with the eye mark). */
  shownToDoorStaff: string;
  /** The line at the top when door staff can open full answers. */
  answersSeenLine: string;
  /** Beside the label of a question that is not required. */
  optional: string;
  /** A question saved with no label. */
  untitledQuestion: string;
  /** The form's "continue" gate while a required question is unanswered. */
  requiredToContinue: string;
  /** Per-question refusal rows (the server's `form_answers_invalid` codes). */
  fieldErrors: { required: string; type: string; option: string; too_long: string };
  /** Text question placeholder when the host set none. */
  textPlaceholder: string;
  /** Number question placeholder when the host set none. */
  numberPlaceholder: string;
  numberMin: (min: string) => string;
  numberMax: (max: string) => string;
  /** Date question, before a date is picked (iOS and Android). */
  datePlaceholder: string;
  dateCancel: string;
  dateSet: string;
  /** Brand header fallbacks. */
  brandFallbackName: string;
  fromBrand: (brand: string) => string;
  fromHost: string;
}

/** Everything visual the host app injects (C11). */
export interface FormRenderingPrimitives {
  tokens: FormRenderingTokens;
  Icon: ComponentType<FormIconProps>;
  WebDateTimeInput: ComponentType<FormWebDateInputProps>;
  /** Optional: the brand header's cover (absent: the image or a flat accent fill). */
  BrandCover?: ComponentType<FormBrandCoverProps>;
  /**
   * #4541 R2.12: the words, injected like the tokens. Absent or partial: the
   * English defaults fill the gaps (`resolveFormCopy`).
   */
  copy?: Partial<FormRenderingCopy>;
}

/** The props a host's file upload renderer receives. */
export interface FormFileUploadRenderProps {
  question: FormQuestion;
  value: FormFileAnswer[];
  onChange: (next: FormFileAnswer[]) => void;
  error?: string;
  disabled: boolean;
}

export type RenderFormFileUpload = (props: FormFileUploadRenderProps) => ReactNode;
