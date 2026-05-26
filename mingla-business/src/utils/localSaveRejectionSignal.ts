import type { UpdateLiveEventResult } from "../store/liveEventStore";

export const LOCAL_SAVE_REJECTED_TOAST =
  "Couldn't finish the local save. Review the details shown here.";

export const surfaceLocalSaveRejection = <DialogContent,>(
  result: Extract<UpdateLiveEventResult, { ok: false }>,
  showToast: (message: string) => void,
  buildDialog: (
    result: Extract<UpdateLiveEventResult, { ok: false }>,
  ) => DialogContent,
  setDialog: (dialog: DialogContent) => void,
): void => {
  showToast(LOCAL_SAVE_REJECTED_TOAST);
  setDialog(buildDialog(result));
};
