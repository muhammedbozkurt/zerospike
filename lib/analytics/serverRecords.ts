import { runDeleteFlow, type DeleteResult } from "./deleteDevice";
import { resetFirebaseAnalyticsData } from "./firebaseSink";
import { clearAnalyticsQueue, pauseAnalyticsSending } from "./supabaseSink";
import { postDeleteDevice } from "./transport";

/**
 * Settings > Data > Privacy > "Delete my server records": pauses the uploads and
 * empties the on-device outbox, asks the `delete-device` function to delete
 * everything it holds under this installation ID and RevenueCat app user id, and
 * after a success empties the outbox again and has Firebase forget its app
 * instance (the order is pinned in ./deleteDevice). The journal on the device is
 * not touched, and the analytics switch keeps whatever the user set.
 */
export function deleteMyServerRecords(): Promise<DeleteResult> {
  return runDeleteFlow({
    pauseSending: pauseAnalyticsSending,
    clearQueue: clearAnalyticsQueue,
    post: () => postDeleteDevice(),
    afterDeleted: resetFirebaseAnalyticsData,
  });
}
