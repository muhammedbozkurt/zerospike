import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { RADIUS, THEME } from "../lib/theme/tokens";
import { useLayout } from "../lib/useLayout";

/** Cap for a centered, content-sized dialog card on a tablet (does not
 *  stretch edge to edge like a bottom sheet). */
const DIALOG_MAX_WIDTH = 520;

/**
 * A small (i) info control. Tapping opens the explanation in a centered popup.
 * It used to expand a balloon in normal flow, which grew the card and shoved
 * everything below it down the screen, reading as the screen jumping under the
 * user's finger. A popup costs nothing in layout, so the surface behind it
 * never moves.
 *
 * Regulation text is moved here, not deleted - a disclaimer that must be shown
 * stays visible; only the explanatory prose moves behind the control.
 */
export function Tooltip({
  text,
  size = 15,
  tint = THEME.muted,
  style,
}: {
  text: string;
  size?: number;
  tint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const { isWide } = useLayout();
  const [open, setOpen] = useState(false);
  return (
    <View style={style}>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={text}
      >
        <Ionicons name="information-circle-outline" size={size} color={tint} />
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
            className="rounded-3xl border border-hair p-4"
            style={[
              {
                backgroundColor: THEME.sheet,
                shadowColor: "#000",
                shadowOpacity: 0.5,
                shadowRadius: 28,
                shadowOffset: { width: 0, height: 12 },
                elevation: 16,
              },
              isWide ? { maxWidth: DIALOG_MAX_WIDTH, alignSelf: "center" } : undefined,
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <ScrollView
              style={{ maxHeight: 380 }}
              showsVerticalScrollIndicator={false}
            >
              <Text style={{ color: THEME.ink, fontSize: 13, lineHeight: 19 }}>
                {text}
              </Text>
            </ScrollView>
            <Pressable
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              style={{
                marginTop: 14,
                minHeight: 44,
                borderRadius: RADIUS.md,
                borderWidth: 1,
                borderColor: THEME.border,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{ color: THEME.ink, fontSize: 13, fontWeight: "700" }}
              >
                {t("common.close")}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
