import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { OverlayModal as Modal } from "./OverlayModal";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { Lang } from "../lib/db/types";
import { LANG_LABELS, SUPPORTED_LANGS } from "../lib/i18n";
import { ELEVATION, HIT_TARGET, THEME } from "../lib/theme/tokens";
import { RIPPLE_ALPHA, ROW_MIN_HEIGHT } from "../lib/theme/uiPrimitives";
import { withAlpha } from "./rich/GlassCard";
import { useLayout } from "../lib/useLayout";

/** Cap for a centered, content-sized dialog card on a tablet (does not
 *  stretch edge to edge like a bottom sheet). */
const DIALOG_MAX_WIDTH = 520;

/** Small uppercase language-code badge (no flag emojis - those render as "?"
 *  on devices without regional-indicator glyph support). */
function CodeBadge({ code, active }: { code: Lang; active?: boolean }) {
  return (
    <View
      className={`w-9 h-7 rounded-md items-center justify-center ${
        active ? "bg-brand/20" : "bg-glass"
      }`}
    >
      <Text
        className={`text-[11px] font-bold ${
          active ? "text-brand" : "text-mut"
        }`}
      >
        {code.toUpperCase()}
      </Text>
    </View>
  );
}

/** Single-row language selector that opens a modal list (not 5 chips at once). */
export function LanguagePicker({
  value,
  onChange,
}: {
  value: Lang;
  onChange: (lang: Lang) => void;
}) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const { isWide } = useLayout();
  const [open, setOpen] = useState(false);

  function select(lang: Lang) {
    onChange(lang);
    setOpen(false);
  }

  return (
    <View className="mb-4">
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${t("settings.language")}: ${LANG_LABELS[value]}`}
        android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
        className="flex-row items-center bg-glass border border-hair rounded-2xl px-4 py-3 active:opacity-80"
        style={{ minHeight: ROW_MIN_HEIGHT }}
      >
        <Ionicons name="language-outline" size={19} color={THEME.textMuted} />
        <Text className="flex-1 ml-3 font-medium text-ink">
          {t("settings.language")}
        </Text>
        <Text className="text-mut mr-2">{LANG_LABELS[value]}</Text>
        <Ionicons name="chevron-down" size={16} color={THEME.textMuted} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/70 justify-center px-6"
          onPress={() => setOpen(false)}
          onAccessibilityEscape={() => setOpen(false)}
          accessible={false}
          focusable={false}
        >
          <Pressable
            className="rounded-3xl border border-hair p-4"
            style={[
              {
                backgroundColor: THEME.surfaceRaised,
                ...ELEVATION.sheet,
              },
              isWide ? { maxWidth: DIALOG_MAX_WIDTH, alignSelf: "center" } : undefined,
            ]}
            onPress={(e) => e.stopPropagation()}
            accessible={false}
            focusable={false}
            importantForAccessibility="auto"
          >
            <Text className="text-ink text-lg font-bold mb-3 px-1">
              {t("settings.language")}
            </Text>
            <ScrollView
              style={{ maxHeight: height * 0.5 }}
              showsVerticalScrollIndicator={false}
            >
              {SUPPORTED_LANGS.map((l) => {
                const active = l === value;
                return (
                  <Pressable
                    key={l}
                    onPress={() => select(l)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
                    style={{ minHeight: HIT_TARGET }}
                    className={`flex-row items-center rounded-2xl px-3 py-2.5 mb-1.5 border ${
                      active
                        ? "bg-brand/10 border-brand/40"
                        : "bg-glass border-transparent"
                    }`}
                  >
                    <CodeBadge code={l} active={active} />
                    <Text
                      className={`flex-1 ml-3 font-medium ${
                        active ? "text-brand" : "text-ink"
                      }`}
                    >
                      {LANG_LABELS[l]}
                    </Text>
                    {active ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={THEME.accent}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
