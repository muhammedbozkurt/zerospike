import React, { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { Lang } from "../../lib/db/types";
import { LANG_LABELS, SUPPORTED_LANGS } from "../../lib/i18n";
import { useApp } from "../../lib/store/AppContext";
import { hapticSelect } from "../../lib/haptics";
import { THEME } from "../../lib/theme/tokens";

/** Uppercase language-code badge (flag emojis render as "?" on some devices). */
function CodeBadge({ code, active }: { code: Lang; active?: boolean }) {
  return (
    <View
      className={`w-9 h-7 rounded-md items-center justify-center ${
        active ? "bg-brand/20" : "bg-glass"
      }`}
    >
      <Text
        className={`text-[11px] font-bold ${active ? "text-brand" : "text-mut"}`}
      >
        {code.toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * Compact language chip for the onboarding header (top-right). Tapping opens a
 * bottom-sheet list; picking a language changes it live through the shared
 * zerospike.lang infrastructure, so every screen re-renders instantly.
 */
export function LanguageChip() {
  const { t } = useTranslation();
  const { lang, setLanguage } = useApp();
  const [open, setOpen] = useState(false);

  async function select(next: Lang) {
    hapticSelect();
    setOpen(false);
    if (next !== lang) await setLanguage(next);
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("settings.language")}
        className="flex-row items-center rounded-full border border-hair bg-glass pl-2.5 pr-2 py-1.5"
      >
        <Ionicons name="language-outline" size={15} color={THEME.muted} />
        <Text className="text-ink text-xs font-semibold ml-1.5">
          {lang.toUpperCase()}
        </Text>
        <Ionicons name="chevron-down" size={13} color={THEME.muted} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/70 justify-end"
          onPress={() => setOpen(false)}
        >
          <Pressable
            className="rounded-t-3xl border-t border-hair p-4 pb-8"
            style={{
              backgroundColor: THEME.sheet,
              shadowColor: "#000",
              shadowOpacity: 0.5,
              shadowRadius: 28,
              shadowOffset: { width: 0, height: -8 },
              elevation: 16,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text className="text-ink text-lg font-bold mb-3 px-1">
              {t("settings.language")}
            </Text>
            {SUPPORTED_LANGS.map((l) => {
              const active = l === lang;
              return (
                <Pressable
                  key={l}
                  onPress={() => select(l)}
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
                    <Ionicons name="checkmark-circle" size={20} color="#2ee6ff" />
                  ) : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
