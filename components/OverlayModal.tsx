import React from "react";
import { Modal, type ModalProps } from "react-native";

import { useOverlayPresence } from "../lib/useOverlayPresence";

/**
 * A drop-in for react-native's Modal that tells the cancellation survey a
 * Modal is on screen while it is visible (lib/feedbackSurvey registerOverlay),
 * so the survey never tries to open a second Modal over it.
 */
export function OverlayModal(props: ModalProps) {
  useOverlayPresence(props.visible ?? true);
  return <Modal {...props} />;
}
