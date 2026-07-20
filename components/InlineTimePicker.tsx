import React from "react";
import { Platform, Pressable, Text, View } from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useTranslation } from "react-i18next";

function two(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function toDate(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 22, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

/**
 * Cross-platform time picker that actually closes.
 * - Android: native dialog that dismisses itself on selection.
 * - iOS: an inline spinner with an explicit "Done" button (the iOS spinner has
 *   no built-in dismiss, which is why it appeared "stuck").
 */
export function InlineTimePicker({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: string; // 'HH:MM'
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!visible) return null;

  function handle(_e: DateTimePickerEvent, date?: Date) {
    if (date) onChange(`${two(date.getHours())}:${two(date.getMinutes())}`);
    if (Platform.OS !== "ios") onClose(); // Android dialog closes itself
  }

  if (Platform.OS === "android") {
    return (
      <DateTimePicker
        value={toDate(value)}
        mode="time"
        is24Hour
        display="default"
        onChange={handle}
      />
    );
  }

  return (
    <View className="rounded-2xl bg-glass border border-hair mb-4 overflow-hidden">
      <View className="flex-row items-center justify-end px-3 py-2 border-b border-zinc-800">
        <Pressable
          onPress={onClose}
          hitSlop={8}
          className="px-4 py-1.5 rounded-lg bg-brand"
        >
          <Text className="text-black font-semibold text-sm">
            {t("common.done")}
          </Text>
        </Pressable>
      </View>
      <DateTimePicker
        value={toDate(value)}
        mode="time"
        is24Hour
        display="spinner"
        onChange={handle}
        themeVariant="dark"
      />
    </View>
  );
}
