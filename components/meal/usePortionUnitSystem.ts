import { useMemo } from "react";
import { getLocales } from "expo-localization";
import { useTranslation } from "react-i18next";

import { portionUnitSystem, type PortionUnitSystem } from "../../lib/portionUnits";

/**
 * Which portion wording this device gets: the app language decides whether
 * English wording applies at all, the system region (expo-localization) picks
 * US ounces over UK millilitres. A device that cannot report a region reads as
 * the US, the same default the English store listing assumes.
 */
export function usePortionUnitSystem(): PortionUnitSystem {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return useMemo(() => {
    let region: string | null = null;
    try {
      region = getLocales()[0]?.regionCode ?? null;
    } catch {
      // expo-localization not ready: treated as "no region"
    }
    return portionUnitSystem(region, lang);
  }, [lang]);
}
