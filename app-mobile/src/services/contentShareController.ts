import type { ShareEntityKind } from '@mingla/sharing';
import type { ContentShareIdentity, ShareMessageContext } from './contentShareAdapter';

export type OpenContentShareInput = {
  kind: ShareEntityKind;
  identity: ContentShareIdentity;
  messageContext?: ShareMessageContext;
};

let handler: ((input: OpenContentShareInput) => void) | null = null;

export function registerContentShareHandler(next: ((input: OpenContentShareInput) => void) | null): void {
  handler = next;
}

export function openUnifiedContentShare(input: OpenContentShareInput): void {
  if (!handler) throw new Error('unified_share_provider_unavailable');
  handler(input);
}
