import { Platform } from "react-native";
import { useTranslation } from "react-i18next";

import { healthStoreLabelKey } from "./cgm/sourceLabel";

/** The health store's name in the app's language (Apple's own localized app
 *  name on iOS), for the {{health}} placeholder. */
export function useHealthName(): string {
  const { t } = useTranslation();
  return t(healthStoreLabelKey(Platform.OS));
}
