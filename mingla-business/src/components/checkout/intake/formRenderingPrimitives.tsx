/**
 * #4514 C11 — the business app's own visual primitives, injected into
 * `@mingla/form-rendering`. Nothing is copied into the package: the renderers
 * draw with these exact components and tokens, so any change to them (theme,
 * context-driven colours) reaches every question.
 */

import { color, radius, space, type } from "../../../constants/designSystem";
import { Icon } from "../../ui/Icon";
import { WebDateTimeInput } from "../../ui/WebDateTimeInput";
import type { FormRenderingPrimitives } from "@mingla/form-rendering";

export const businessFormPrimitives: FormRenderingPrimitives = {
  tokens: { color, radius, space, type },
  Icon,
  WebDateTimeInput,
};
