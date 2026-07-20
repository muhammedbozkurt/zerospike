import React from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AppBackground,
  ConicAvatar,
  GlassCard,
  GlucoseChip,
  GlucoseRing,
  GradientAreaChart,
  GradientCTA,
  IconTile,
  NeonProgressBar,
  TIRDonut,
  tirSegments,
} from "../components/rich";
import { StatCard } from "../components/StatCard";
import { GLUCOSE_RICH, THEME } from "../lib/theme/tokens";

/**
 * PHASE 1 EVIDENCE / dev-only design gallery. Not linked from any UI - reachable
 * only by deep link (zerospike://design-gallery) to screenshot the Midnight
 * Monitor signature components on-device. Scaffolding: superseded once the
 * components are wired into real screens in later phases. Sample numbers only.
 */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: THEME.muted, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: "800", marginBottom: 8, marginTop: 18 }}>
      {children}
    </Text>
  );
}

export default function DesignGallery() {
  return (
    <AppBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: THEME.ink, fontSize: 22, fontWeight: "800" }}>Midnight Monitor</Text>
            <ConicAvatar label="MB" size={32} />
          </View>
          <Text style={{ color: THEME.muted, fontSize: 12, marginTop: 2 }}>Phase 1 - signature components</Text>

          <Label>Glucose ring - hero gauge</Label>
          <GlassCard glow style={{ alignItems: "center", paddingVertical: 16 }}>
            <GlucoseRing value={118} caption="mg/dL - 20dk" color={GLUCOSE_RICH.target} size={150} />
          </GlassCard>

          <Label>Glucose chips - one language</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <GlucoseChip value="64" label="Low" status="low" />
            <GlucoseChip value="118" label="In range" status="normal" />
            <GlucoseChip value="168" label="High" status="elevated" />
            <GlucoseChip value="255" label="Very high" status="high" />
          </View>

          <Label>Time in range donut</Label>
          <GlassCard glow style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <TIRDonut segments={tirSegments({ low: 10, target: 78, high: 11, veryHigh: 1 })} centerValue="78" centerSuffix="%" size={96} />
            <View style={{ gap: 6 }}>
              {[
                ["Low", GLUCOSE_RICH.low, "10%"],
                ["In range", GLUCOSE_RICH.target, "78%"],
                ["High", GLUCOSE_RICH.high, "11%"],
                ["Very high", GLUCOSE_RICH.veryHigh, "1%"],
              ].map(([name, color, pct]) => (
                <View key={name} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                  <Text style={{ color: THEME.ink, fontSize: 12, fontWeight: "700", width: 70 }}>{name}</Text>
                  <Text style={{ color: THEME.muted, fontSize: 12 }}>{pct}</Text>
                </View>
              ))}
            </View>
          </GlassCard>

          <Label>Gradient area chart (with target band)</Label>
          <GlassCard>
            <GradientAreaChart
              data={[120, 98, 145, 132, 160, 118, 126, 150, 110, 128, 138, 122]}
              targetBand={{ min: 70, max: 180 }}
              width={300}
              height={80}
            />
          </GlassCard>

          <Label>Neon progress - 142 / 180 g carbs</Label>
          <GlassCard>
            <NeonProgressBar value={142} max={180} height={10} />
          </GlassCard>

          <Label>Icon tiles - vector plates</Label>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <IconTile icon="egg" size={40} radius={12} hero />
            <IconTile icon="nutrition" size={40} radius={12} hero />
            <IconTile icon="medical" size={40} radius={12} />
            <IconTile icon="notifications" size={40} radius={12} />
            <IconTile icon="settings-sharp" size={40} radius={12} />
          </View>

          <Label>Stat cards - glass + glow</Label>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <StatCard glass glow label="Average" value={132} style={{ flex: 1 }} />
            <StatCard glass glow={GLUCOSE_RICH.target} label="HbA1c*" display="6.2" accent={GLUCOSE_RICH.target} style={{ flex: 1 }} />
          </View>

          <Label>Call to action</Label>
          <View style={{ gap: 8 }}>
            <GradientCTA label="Add a record" onPress={() => {}} />
            <GradientCTA label="Not now" variant="sub" onPress={() => {}} />
            <GradientCTA label="Call emergency" danger onPress={() => {}} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}
