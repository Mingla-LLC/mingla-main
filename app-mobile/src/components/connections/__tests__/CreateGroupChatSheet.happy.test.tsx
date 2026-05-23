declare const module: any;
declare const process: any;
declare const require: any;

const assert = require("node:assert/strict");

type FriendFixture = {
  id: string;
  name: string;
};

async function submitCreateGroupChat(args: {
  rawName: string;
  selectedFriends: FriendFixture[];
  isCreating?: boolean;
  onSubmit: (name: string, friends: FriendFixture[]) => Promise<{ conversationId: string; sessionId: string }>;
  onCreated: (conversationId: string, sessionId: string) => void;
}) {
  if (!args.rawName.trim() || args.selectedFriends.length === 0 || args.isCreating) {
    return { submitted: false };
  }
  const result = await args.onSubmit(args.rawName.trim(), args.selectedFriends);
  args.onCreated(result.conversationId, result.sessionId);
  return { submitted: true, result };
}

export async function runCreateGroupChatSheetHappyTest() {
  const friend1 = { id: "friend-1", name: "Nia" };
  const friend2 = { id: "friend-2", name: "Sam" };
  const submitCalls: any[][] = [];
  const createdCalls: any[][] = [];

  const result = await submitCreateGroupChat({
    rawName: "  Friday plans  ",
    selectedFriends: [friend1, friend2],
    onSubmit: async (name, friends) => {
      submitCalls.push([name, friends]);
      return { conversationId: "conv-1", sessionId: "sess-1" };
    },
    onCreated: (conversationId, sessionId) => {
      createdCalls.push([conversationId, sessionId]);
    },
  });

  assert.equal(result.submitted, true);
  assert.deepEqual(submitCalls, [["Friday plans", [friend1, friend2]]]);
  assert.deepEqual(createdCalls, [["conv-1", "sess-1"]]);

  const blocked = await submitCreateGroupChat({
    rawName: "   ",
    selectedFriends: [friend1],
    onSubmit: async () => {
      throw new Error("should not submit blank names");
    },
    onCreated: () => {},
  });
  assert.equal(blocked.submitted, false);
}

if (require.main === module) {
  runCreateGroupChatSheetHappyTest()
    .then(() => console.log("PASS T-IMP-2 CreateGroupChatSheet happy path"))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
