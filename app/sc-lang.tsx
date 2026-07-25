import { useEffect } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { isScreenshotMode } from "../lib/screenshotMode";
import { SUPPORTED_LANGS } from "../lib/i18n";
import { useApp } from "../lib/store/AppContext";
import type { Lang } from "../lib/db/types";

/**
 * Store-screenshot ONLY (I7): a route that sets the in-app language from a ROUTE
 * param (?lang=xx) and then returns to the tabs. On Android a warm deep-link does
 * NOT deliver GLOBAL query params (so the root ?scLang handler never fires), but a
 * ROUTE param on the navigated screen IS delivered - so the capture pipeline
 * navigates here to persist the language, then cold-relaunches to re-seed in it.
 * Double-locked: in a normal build isScreenshotMode() is false, so this just
 * redirects to the tabs and changes nothing.
 */
export default function ScLang() {
  const { lang } = useLocalSearchParams<{ lang?: string }>();
  const { setLanguage } = useApp();
  const router = useRouter();
  useEffect(() => {
    void (async () => {
      if (
        isScreenshotMode() &&
        lang &&
        (SUPPORTED_LANGS as string[]).includes(lang)
      ) {
        await setLanguage(lang as Lang);
      }
      router.replace("/(tabs)");
    })();
  }, [lang, setLanguage, router]);
  return <View style={{ flex: 1, backgroundColor: "#04161d" }} />;
}
