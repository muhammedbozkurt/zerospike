import React from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { HIT_TARGET, RADIUS, SPACE, THEME } from "../lib/theme/tokens";
import { hapticSelect } from "../lib/haptics";
import { confirmCardEmphasized, showUntilConfirmNote } from "../lib/ratioConfirmCard";
import { Txt } from "./ui";

/**
 * The one confirmation card for "I set these ratios with my diabetes team", used
 * by the ratios sheet, Profile and Targets and the profile editor. The whole card
 * is the touch target. It never starts ticked on its own: `checked` comes from
 * the caller and only a stored confirmation sets it.
 *
 * While the ratios are complete and the card is still unticked it takes the
 * accent border and says, under the label, that the calculation stays hidden
 * until the confirmation is given.
 */
export function RatioConfirmCard({
  checked,
  onToggle,
  complete,
  disabled,
  emphasized = false,
}: {
  checked: boolean;
  onToggle: (next: boolean) => void;
  /** All four values are filled in (the box can be ticked). */
  complete: boolean;
  disabled?: boolean;
  /** Opened on purpose from the calculator's "Confirm ratios" button. */
  emphasized?: boolean;
}) {
  const { t } = useTranslation();
  const accent = confirmCardEmphasized({ complete, checked, emphasized });
  const label = t("calculator.setup.confirm");
  return (
    <View
      style={{
        borderWidth: accent ? 2 : 1,
        borderColor: accent ? THEME.accent : THEME.border,
        borderRadius: RADIUS.lg,
        backgroundColor: THEME.surface,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Pressable
        onPress={() => {
          if (disabled) return;
          hapticSelect();
          onToggle(!checked);
        }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: !!disabled }}
        accessibilityLabel={label}
        accessibilityHint={t("calculator.setup.teamNote")}
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: SPACE.md,
          padding: SPACE.lg,
          minHeight: HIT_TARGET,
        }}
      >
        <Ionicons
          name={checked ? "checkbox" : "square-outline"}
          size={28}
          color={checked || accent ? THEME.accent : THEME.textMuted}
        />
        <View style={{ flex: 1 }}>
          <Txt style={{ fontWeight: "600" }}>{label}</Txt>
          <Txt kind="caption" tone="muted" style={{ marginTop: 4 }}>
            {t("calculator.setup.teamNote")}
          </Txt>
        </View>
      </Pressable>
      {showUntilConfirmNote({ complete, checked }) ? (
        <View
          style={{
            flexDirection: "row",
            gap: SPACE.sm,
            paddingHorizontal: SPACE.lg,
            paddingBottom: SPACE.md,
          }}
        >
          <Ionicons name="information-circle-outline" size={16} color={THEME.accent} />
          <Txt kind="caption" tone="muted" style={{ flex: 1 }}>
            {t("ratioConfirm.until")}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}
