import { useEffect } from "react";

import { registerOverlay } from "./feedbackSurvey";

/**
 * Call with a Modal's visibility. While true the overlay counts as open, so the
 * one-time cancellation survey (components/feedback/CancelSurveyHost) does not
 * try to present a second Modal on top of it.
 */
export function useOverlayPresence(visible: boolean): void {
  useEffect(() => {
    if (!visible) return;
    return registerOverlay();
  }, [visible]);
}
