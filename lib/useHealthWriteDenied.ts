import { useCallback } from "react";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";

import { useFeedback } from "../components/Feedback";
import { isHealthConnectPermissionBlocked, openHealthSettings } from "./services/health";

/** What to do after a Health write permission request came back denied: a
 *  blocked Health Connect dialog goes straight to Settings, and on iOS (which
 *  never re-shows its dialog) the user is told where to switch it on, with a
 *  button that opens the Health app. Shared by Settings > Data and the
 *  dashboard's one-time question. */
export function useHealthWriteDenied() {
  const { t } = useTranslation();
  const { toast, confirm } = useFeedback();
  const healthName = t(
    Platform.OS === "ios" ? "settings.healthSection" : "settings.healthSectionAndroid"
  );
  return useCallback(async () => {
    if (Platform.OS === "android" && isHealthConnectPermissionBlocked("write")) {
      toast(t("settings.healthPermissionBlocked", { health: healthName }), "info");
      void openHealthSettings();
      return;
    }
    const open = await confirm({
      title: t("settings.healthWriteDenied", { health: healthName }),
      message: t(
        Platform.OS === "ios"
          ? "settings.healthDeniedStepsIos"
          : "settings.healthDeniedStepsAndroid"
      ),
      confirmLabel: t("settings.healthOpenApp", { health: healthName }),
      cancelLabel: t("common.close"),
    });
    if (open) void openHealthSettings();
  }, [t, toast, confirm, healthName]);
}
