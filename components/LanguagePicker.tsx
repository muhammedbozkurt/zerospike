import React, { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { Lang } from "../lib/db/types";
import { LANG_LABELS, SUPPORTED_LANGS } from "../lib/i18n";
import { THEME } from "../lib/theme/tokens";

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
  const [open, setOpen] = useState(false);

  function select(lang: Lang) {
    onChange(lang);
    setOpen(false);
  }

  return (
    <View className="mb-4">
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center bg-glass border border-hair rounded-2xl px-4 py-3"
      >
        <Ionicons name="language-outline" size={19} color={THEME.muted} />
        <Text className="flex-1 ml-3 font-medium text-ink">
          {t("settings.language")}
        </Text>
        <Text className="text-mut mr-2">{LANG_LABELS[value]}</Text>
        <Ionicons name="chevron-down" size={16} color={THEME.muted} />
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
        >
          <Pressable
            className="rounded-3xl bg-glass border border-hair p-4"
            onPress={(e) => e.stopPropagation()}
          >
            <Text className="text-ink text-lg font-bold mb-3 px-1">
              {t("settings.language")}
            </Text>
            {SUPPORTED_LANGS.map((l) => {
              const active = l === value;
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
    </View>
  );
}
