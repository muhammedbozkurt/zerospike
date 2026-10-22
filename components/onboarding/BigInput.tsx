import { TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { INPUT_TEXT, RADIUS, THEME } from "../../lib/theme/tokens";
import { withAlpha } from "../rich/GlassCard";

/**
 * Onboarding-only text input, drawn as an ANSWER CARD rather than a form field:
 * an icon plate, the editable value, and the same filled check disc a selected
 * OptionCard carries. The profile-name step is the first question in the quiz,
 * so it has to look like the option cards that follow it, not like a settings
 * row - and its value is always filled (a default name is prefilled), which is
 * exactly what the check states.
 *
 * Purely presentational; the caller owns the value.
 */
export function BigInput({
  value,
  onChangeText,
  placeholder,
  icon = "person-outline",
  keyboardType = "default",
  autoFocus = false,
  maxLength,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  keyboardType?: "default" | "numeric";
  autoFocus?: boolean;
  maxLength?: number;
  accessibilityLabel?: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        minHeight: 76,
        paddingHorizontal: 20,
        paddingVertical: 18,
        borderRadius: RADIUS.xl,
        borderWidth: 1.5,
        borderColor: THEME.accent,
        backgroundColor: withAlpha(THEME.accent, 0.1),
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: RADIUS.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: withAlpha(THEME.accent, 0.14),
        }}
      >
        <Ionicons name={icon} size={22} color={THEME.accent} />
      </View>

      {/* fontSize only, never a lineHeight: iOS draws a TextInput's glyphs
          inside a fixed line box and clips anything taller (see INPUT_TEXT). */}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={THEME.placeholder}
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        maxLength={maxLength}
        returnKeyType="done"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        style={{
          ...INPUT_TEXT,
          flex: 1,
          color: THEME.text,
          fontSize: 18,
          fontWeight: "600",
          paddingVertical: 0,
        }}
      />

      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: RADIUS.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: THEME.accentFill,
        }}
      >
        <Ionicons name="checkmark" size={15} color={THEME.accentOnFill} />
      </View>
    </View>
  );
}
