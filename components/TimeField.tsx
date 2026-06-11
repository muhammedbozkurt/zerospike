import React, { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

interface Props {
  label?: string;
  value: string; // 'HH:MM'
  onChange: (value: string) => void;
}

function two(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toDate(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 22, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

export function TimeField({ label, value, onChange }: Props) {
  const [show, setShow] = useState(false);

  function handleChange(_e: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setShow(false);
    if (date) onChange(`${two(date.getHours())}:${two(date.getMinutes())}`);
  }

  return (
    <View className="mb-3">
      {label ? (
        <Text className="text-sm font-medium text-zinc-300 mb-1.5">{label}</Text>
      ) : null}
      <Pressable
        onPress={() => setShow((s) => !s)}
        className="flex-row items-center justify-between rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3"
      >
        <Text className="text-base text-zinc-50">{value}</Text>
        <Ionicons name="time-outline" size={18} color="#a1a1aa" />
      </Pressable>
      {show ? (
        <DateTimePicker
          value={toDate(value)}
          mode="time"
          is24Hour
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleChange}
          themeVariant="dark"
        />
      ) : null}
    </View>
  );
}
