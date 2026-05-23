/* eslint-disable import/first */
declare const module: any;
declare const require: any;

import {
  buildPendingCollabPhoneE164,
  canRevokePendingCollabInvite,
  isPendingCollabReadyChange,
  isPendingCollabPhoneValid,
} from "../pendingCollabChatUtils";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function runPendingCollabChatSheetHappyTest() {
  assert(!isPendingCollabPhoneValid("555"), "short phone input is invalid");
  assert(isPendingCollabPhoneValid("(415) 555-0198"), "seven-plus digit phone input is valid");
  assert(
    buildPendingCollabPhoneE164("(415) 555-0198", "+1") === "+14155550198",
    "US phone input normalizes to E.164",
  );
  assert(
    buildPendingCollabPhoneE164("", "+1") === "",
    "empty phone input does not build an invite target",
  );

  const pendingSessionIds = new Set(["session-pending"]);
  assert(
    isPendingCollabReadyChange(
      { session_id: "session-pending", user_id: "invitee-1", has_accepted: true },
      pendingSessionIds,
      "creator-1",
    ),
    "accepted participant update refreshes host pending chat",
  );
  assert(
    isPendingCollabReadyChange(
      { session_id: "session-pending", invited_user_id: "invitee-1", status: "accepted" },
      pendingSessionIds,
      "creator-1",
    ),
    "accepted invite update refreshes host pending chat",
  );
  assert(
    !isPendingCollabReadyChange(
      { session_id: "session-pending", user_id: "creator-1", has_accepted: true },
      pendingSessionIds,
      "creator-1",
    ),
    "creator's own accepted row does not trigger pending-chat ready state",
  );
  assert(
    canRevokePendingCollabInvite({ status: "pending", inviteKind: "warm" }),
    "warm pending invite can be revoked individually",
  );
  assert(
    canRevokePendingCollabInvite({ status: "pending", inviteKind: "cold" }),
    "cold phone pending invite can be revoked individually",
  );
  assert(
    !canRevokePendingCollabInvite({ status: "accepted", inviteKind: "warm" }),
    "accepted members cannot be revoked through pending invite action",
  );
}

if (require.main === module) {
  runPendingCollabChatSheetHappyTest();
  console.log("PASS T-FLY-1 PendingCollabChatSheet happy path");
}
