export const readAsStringBase64Async = async (_uri: string): Promise<string> => {
  throw new Error("Native file reads are unavailable on web.");
};

export const getFileInfoAsync = async (
  _uri: string,
): Promise<{ exists?: boolean; size?: unknown }> => ({ exists: false });

export const createMultipartUploadTask = async (): Promise<{
  uploadAsync: () => Promise<unknown>;
  cancelAsync?: () => Promise<void>;
}> => ({
  uploadAsync: async () => {
    throw new Error("Native multipart upload tasks are unavailable on web.");
  },
});

// META-ORCH-1270 — web never uses the native binary task; the Bunny TUS PATCH
// on web is driven by XHR in the processing service. This stub keeps the module
// shape symmetric so imports resolve on web.
export const createBinaryUploadTask = async (): Promise<{
  uploadAsync: () => Promise<unknown>;
  cancelAsync?: () => Promise<void>;
}> => ({
  uploadAsync: async () => {
    throw new Error("Native binary upload tasks are unavailable on web.");
  },
});
