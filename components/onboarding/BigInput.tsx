import { TextInput, View } from "react-native";

import { THEME, RADIUS } from "../../lib/theme/tokens";

/**
 * Onboarding-only text input: big, centred, airy — matches the QuizStep visual
 * language instead of reusing the compact settings InputRow (which reads too small
 * on a full onboarding page). Purely presentational; the caller owns the value.
 */
export function BigInput({
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
  autoFocus = false,
  maxLength,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric";
  autoFocus?: boolean;
  maxLength?: number;
  accessibilityLabel?: string;
}) {
  return (
    <View
      style={{
        borderRadius: RADIUS["2xl"],
        backgroundColor: THEME.glass,
        borderWidth: 1,
        borderColor: THEME.border,
        paddingHorizontal: 20,
        paddingVertical: 24,
      }}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={THEME.muted}
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        maxLength={maxLength}
        returnKeyType="done"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        style={{
          color: THEME.ink,
          fontSize: 26,
          fontWeight: "700",
          textAlign: "center",
          paddingVertical: 4,
        }}
      />
    </View>
  );
}
