import React from "react";
import { Image, Text, View } from "react-native";

import { formatTime } from "../../lib/format";

/**
 * A real zerospike lock-screen notification, and the only element of the iOS
 * scene that crosses the composite's cut line: it is the bleed.
 *
 * Everything it prints is the app's own:
 *   title  i18n `notifications.basalTitle`
 *   body   i18n `notifications.basalBody`
 * which is verbatim what scheduleBasalReminder and reminderContent send
 * (lib/services/notifications.ts:444 and :669). Nothing here is store copy
 * written for a screenshot - a panel that invented a notification body would
 * be advertising a message the app never sends.
 *
 * The stamp is the app's own default basal reminder time, 22:00
 * (DEFAULT_PREFS in lib/services/notificationPrefs.ts), run through the app's
 * own locale formatter, so it reads 22:00 in tr/de and 10:00 PM in en.
 *
 * The fill is deliberately LIGHT (white 0.14 over the wash). selftest-v2's
 * check 6c samples the canvas centre two rows above the bottom scrim and fails
 * anything less than 20 luminance over the page margin - the check the dark
 * #080e14 android-phone bleed failed last round. This card is what carries
 * that row on both iOS profiles.
 *
 * Plain "row": RN's own forceRTL mirrors the header under Arabic.
 */
export function NotificationCard({
  title,
  body,
  now,
  height,
  pad,
  icon,
  titleSize,
  bodySize,
  metaSize,
}: {
  title: string;
  body: string;
  now: number;
  height: number;
  pad: number;
  icon: number;
  titleSize: number;
  bodySize: number;
  metaSize: number;
}) {
  const stamp = new Date(now);
  stamp.setHours(22, 0, 0, 0);

  return (
    <View
      style={{
        height,
        borderRadius: Math.round(height * 0.18),
        padding: pad,
        overflow: "hidden",
        backgroundColor: "rgba(255,255,255,0.14)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.14)",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: Math.round(icon * 0.34) }}>
        <Image
          source={require("../../assets/brand/icon-1024.png")}
          style={{ width: icon, height: icon, borderRadius: Math.round(icon * 0.24) }}
        />
        <Text
          style={{ fontSize: metaSize, fontWeight: "600", color: "rgba(255,255,255,0.78)" }}
          numberOfLines={1}
        >
          zerospike
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: metaSize, color: "rgba(255,255,255,0.52)" }} numberOfLines={1}>
          {formatTime(stamp.toISOString())}
        </Text>
      </View>

      <Text
        style={{
          marginTop: Math.round(pad * 0.7),
          fontSize: titleSize,
          lineHeight: Math.round(titleSize * 1.3),
          fontWeight: "700",
          color: "#ffffff",
        }}
        numberOfLines={1}
      >
        {title}
      </Text>
      <Text
        style={{
          marginTop: 8,
          fontSize: bodySize,
          lineHeight: Math.round(bodySize * 1.32),
          color: "rgba(255,255,255,0.80)",
        }}
        numberOfLines={2}
      >
        {body}
      </Text>
    </View>
  );
}
