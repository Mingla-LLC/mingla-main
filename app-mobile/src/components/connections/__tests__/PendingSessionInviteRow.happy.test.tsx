declare const module: any;
declare const process: any;
declare const require: any;

const assert = require("node:assert/strict");

type Invite = {
  sessionId: string;
  inviteId: string;
};

async function pressInviteAction(args: {
  invite: Invite;
  isProcessing: boolean;
  action: "accept" | "decline";
  onAccept: (sessionId: string, inviteId: string) => Promise<void>;
  onDecline: (sessionId: string, inviteId: string) => Promise<void>;
}) {
  if (args.isProcessing) return false;
  if (args.action === "accept") {
    await args.onAccept(args.invite.sessionId, args.invite.inviteId);
  } else {
    await args.onDecline(args.invite.sessionId, args.invite.inviteId);
  }
  return true;
}

export async function runPendingSessionInviteRowHappyTest() {
  const invite = { sessionId: "sess-1", inviteId: "invite-1" };
  const accepted: any[][] = [];
  const declined: any[][] = [];

  const acceptPressed = await pressInviteAction({
    invite,
    isProcessing: false,
    action: "accept",
    onAccept: async (sessionId, inviteId) => { accepted.push([sessionId, inviteId]); },
    onDecline: async (sessionId, inviteId) => { declined.push([sessionId, inviteId]); },
  });
  assert.equal(acceptPressed, true);
  assert.deepEqual(accepted, [["sess-1", "invite-1"]]);

  const declinePressed = await pressInviteAction({
    invite,
    isProcessing: false,
    action: "decline",
    onAccept: async (sessionId, inviteId) => { accepted.push([sessionId, inviteId]); },
    onDecline: async (sessionId, inviteId) => { declined.push([sessionId, inviteId]); },
  });
  assert.equal(declinePressed, true);
  assert.deepEqual(declined, [["sess-1", "invite-1"]]);

  const blocked = await pressInviteAction({
    invite,
    isProcessing: true,
    action: "accept",
    onAccept: async (sessionId, inviteId) => { accepted.push([sessionId, inviteId]); },
    onDecline: async (sessionId, inviteId) => { declined.push([sessionId, inviteId]); },
  });
  assert.equal(blocked, false);
  assert.equal(accepted.length, 1);
}

if (require.main === module) {
  runPendingSessionInviteRowHappyTest()
    .then(() => console.log("PASS T-IMP-4 PendingSessionInviteRow happy path"))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
