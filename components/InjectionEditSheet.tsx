import React, { useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import type { InjectionSite, InsulinType, SitePoint } from "../lib/db/types";
import { SELECTABLE_SITES } from "../lib/db/types";
import {
  findRecentCalculatorBolus,
  getSiteUsageHistory,
  updateInjection,
  type InjectionUpdate,
  type SiteUsage,
} from "../lib/db/injections";
import { getRotationCycleStart } from "../lib/rotationCycle";
import { SitePointSelector } from "./InjectionSiteBoard";
import { checkDose } from "../lib/insulin";
import { logEvent } from "../lib/analytics";
import { hapticSuccess, hapticSelect } from "../lib/haptics";
import { useApp } from "../lib/store/AppContext";
import { useFeedback } from "./Feedback";
import { Stepper } from "./Stepper";
import { InlineDateTimePicker } from "./InlineDateTimePicker";
import { formatTime, num, relativeDay } from "../lib/format";
import { RADIUS, THEME, glow } from "../lib/theme/tokens";
import { GradientCTA } from "./rich/GradientCTA";
import { withAlpha } from "./rich/GlassCard";

/** The stored injection being corrected (structurally matches Injection). */
export interface InjectionEditTarget {
  id: string;
  /** Null for a row logged without a region (schema v11). */
  site: InjectionSite | null;
  site_point: SitePoint | null;
  dose_units: number | null;
  insulin_type: InsulinType | null;
  logged_at: string;
}

// Same heat window as the injection tab's map surface.
const USAGE_WINDOW_DAYS = 30;

const inputStyle = {
  borderRadius: RADIUS.md,
  borderWidth: 1,
  borderColor: THEME.border,
  backgroundColor: THEME.glass,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: THEME.ink,
} as const;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: THEME.muted, fontSize: 12, fontWeight: "700", marginBottom: 6 }}>
      {children}
    </Text>
  );
}

/** A selectable pill in the Midnight Monitor language. */
function Chip({
  label,
  on,
  onPress,
  style,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  style?: object;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[
        {
          borderRadius: RADIUS.md,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: on ? THEME.accent : THEME.border,
          backgroundColor: on ? withAlpha(THEME.accent, 0.14) : THEME.glass,
        },
        on ? glow(THEME.accent, 12, 0.35) : undefined,
        style,
      ]}
    >
      <Text
        style={{
          color: on ? THEME.accent : THEME.muted,
          fontSize: 12,
          fontWeight: on ? "800" : "600",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Bottom sheet for correcting an injection: dose, insulin type, region, rotation
 * point and time. The calculator writes a bolus row automatically, so this is
 * where that row gets its real site and point - which is exactly why the site
 * and point are editable here rather than fixed at creation.
 *
 * Rendered from tab screens (injection tab, dashboard journal), which are not
 * modal routes, so a plain RN Modal is fine here (gotcha 22 applies to the
 * calculator/add-food/scan modal screens only).
 */
export function InjectionEditSheet({
  visible,
  injection,
  onClose,
  onSaved,
}: {
  visible: boolean;
  injection: InjectionEditTarget | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { activeProfile } = useApp();
  const { confirm } = useFeedback();
  const { height: winH } = useWindowDimensions();
  // Dose in units (0 = no dose). Stepper-driven, keyboard-editable.
  const [dose, setDose] = useState(0);
  const [insulinType, setInsulinType] = useState<InsulinType>("bolus");
  const [site, setSite] = useState<InjectionSite>("abdomen_left");
  const [point, setPoint] = useState<SitePoint | null>(null);
  // Whether the user actually touched the region selector while this row was
  // open. A row logged WITHOUT a region has to open on some region for the
  // selector to render, and saving must not turn that placeholder into a record
  // the user never made.
  const [siteTouched, setSiteTouched] = useState(false);
  const [loggedAt, setLoggedAt] = useState<Date>(new Date());
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState<SiteUsage[] | undefined>(undefined);

  // Heat data for the selector dots, from the profile's cycle stamp on.
  useEffect(() => {
    if (!visible || !activeProfile) return;
    let alive = true;
    (async () => {
      const cycle = await getRotationCycleStart(activeProfile.id);
      const u = await getSiteUsageHistory(activeProfile.id, USAGE_WINDOW_DAYS, cycle);
      if (alive) setUsage(u.sites);
    })();
    return () => {
      alive = false;
    };
  }, [visible, activeProfile]);

  useEffect(() => {
    if (visible && injection) {
      setDose(injection.dose_units ?? 0);
      setInsulinType(injection.insulin_type ?? "bolus");
      // A row logged without a region (a calculator bolus) opens on the first
      // selectable region so the user CAN fill one in; it only becomes part of the
      // record if they pick one (see siteTouched).
      setSite(injection.site ?? SELECTABLE_SITES[0]);
      setSiteTouched(false);
      setPoint(injection.site_point);
      setLoggedAt(new Date(injection.logged_at));
      setTimePickerOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, injection?.id]);

  /** Same plausibility gate as the create form: confirm, never refuse. */
  async function confirmDose(units: number): Promise<boolean> {
    const check = checkDose(units);
    if (check === "ok") return true;
    const first = await confirm({
      title: t("injection.doseCheckTitle", { n: num(units) }),
      message: t("injection.doseCheckBody"),
      confirmLabel: t("injection.doseCheckConfirm"),
      icon: "help-circle-outline",
    });
    if (!first) return false;
    if (check === "high") return true;
    return confirm({
      title: t("injection.doseCheckTitle", { n: num(units) }),
      message: t("injection.doseImplausibleBody"),
      confirmLabel: t("injection.doseCheckConfirm"),
      icon: "help-circle-outline",
    });
  }

  /** Same gentle double-bolus nudge as the injection tab's own form (R10 1.4),
   *  runs before the dose-threshold checks. Excludes the row being edited so a
   *  calculator-written bolus never flags against its own value. */
  async function confirmDoubleBolus(): Promise<boolean> {
    if (!activeProfile || !injection) return true;
    const existing = await findRecentCalculatorBolus(activeProfile.id, loggedAt, injection.id);
    if (!existing) return true;
    return confirm({
      title: t("injection.doubleBolusTitle", {
        n: num(existing.dose_units ?? 0),
        time: formatTime(existing.logged_at),
      }),
      message: t("injection.doubleBolusBody"),
      confirmLabel: t("injection.doubleBolusConfirm"),
      icon: "help-circle-outline",
    });
  }

  async function save() {
    if (!injection || saving) return;
    const hasDose = dose > 0;
    if (insulinType === "bolus" && hasDose && !(await confirmDoubleBolus())) return;
    if (hasDose && !(await confirmDose(dose))) return;

    setSaving(true);
    try {
      // An entry that had no region keeps having none unless the user chose one
      // here: correcting a dose must not quietly file it under a body region.
      const keepsNoSite = injection.site == null && !siteTouched;
      const patch: InjectionUpdate = {
        dose_units: hasDose ? dose : null,
        insulin_type: insulinType,
        site: keepsNoSite ? null : site,
        site_point: keepsNoSite ? null : point,
        logged_at: loggedAt.toISOString(),
      };
      await updateInjection(injection.id, patch);
      logEvent("log_edited", { kind: "insulin" });
      hapticSuccess();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <Pressable
          style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.72)" }}
          onPress={onClose}
        >
          <Pressable
            style={[
              {
                // Bounded like the other bottom sheets (see InjectionSiteBoard's
                // region modal): "100%" let the sheet cover the whole screen with
                // no dim overlay showing above it once the keyboard was open.
                maxHeight: Math.round(winH * 0.86),
                borderTopLeftRadius: 26,
                borderTopRightRadius: 26,
                borderTopWidth: 1,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.bg.g1,
                paddingHorizontal: 18,
                paddingTop: 8,
              },
              glow(THEME.accent, 30, 0.3),
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center mb-1.5">
              <View style={{ width: 38, height: 4, borderRadius: 9, backgroundColor: THEME.border }} />
            </View>
            <View className="flex-row items-center justify-between mb-4">
              <Text style={{ color: THEME.ink, fontSize: 17, fontWeight: "800" }}>
                {t("calculator.editTitle")}
              </Text>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
                className="p-1"
              >
                <Ionicons name="close" size={22} color={THEME.muted} />
              </Pressable>
            </View>

            <ScrollView
              style={{ flexShrink: 1 }}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 32 }}
            >
              <FieldLabel>{t("injection.dose")}</FieldLabel>
              <Stepper
                value={dose}
                onChange={setDose}
                step={0.5}
                longStep={1}
                min={0}
                max={150}
                decimals={1}
                suffix={t("common.units")}
                accessibilityLabel={t("injection.dose")}
                style={{ marginBottom: 16 }}
              />

              <FieldLabel>{t("injection.insulinType")}</FieldLabel>
              <View className="flex-row mb-4" style={{ gap: 8 }}>
                {(["basal", "bolus"] as const).map((type) => (
                  <Chip
                    key={type}
                    label={type === "basal" ? t("injection.typeBasal") : t("injection.typeBolus")}
                    on={insulinType === type}
                    onPress={() => {
                      hapticSelect();
                      setInsulinType(type);
                    }}
                    style={{ flex: 1 }}
                  />
                ))}
              </View>

              <FieldLabel>{t("injection.selectSite")}</FieldLabel>
              <SitePointSelector
                usage={usage}
                site={site}
                point={point}
                onChange={(s, p) => {
                  setSite(s);
                  setPoint(p);
                  setSiteTouched(true);
                }}
                allowClearPoint
                style={{ marginBottom: 16 }}
              />

              <FieldLabel>{t("calculator.loggedTime")}</FieldLabel>
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  setTimePickerOpen((v) => !v);
                }}
                className="flex-row items-center mb-5"
                style={inputStyle}
              >
                <Ionicons name="time-outline" size={16} color={THEME.muted} />
                <Text style={{ color: THEME.ink, marginLeft: 8, fontSize: 13 }}>
                  {relativeDay(loggedAt.toISOString(), {
                    today: t("common.today"),
                    yesterday: t("common.yesterday"),
                  })}
                  {" · "}
                  {formatTime(loggedAt.toISOString())}
                </Text>
              </Pressable>
              <InlineDateTimePicker
                visible={timePickerOpen}
                value={loggedAt}
                max={new Date()}
                locale={i18n.language}
                onChange={setLoggedAt}
                onClose={() => setTimePickerOpen(false)}
              />

              <GradientCTA label={t("common.save")} disabled={saving} onPress={save} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
