import { injectionDoseOk } from "../lib/injectionDose";
import React, { useEffect, useRef, useState } from "react";
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
import Animated from "react-native-reanimated";

import type { BolusKind, InjectionSite, InsulinType, SitePoint } from "../lib/db/types";
import { BOLUS_KINDS, SELECTABLE_SITES } from "../lib/db/types";
import {
  findRecentCalculatorBolus,
  getSiteUsageHistory,
  updateInjection,
  type InjectionUpdate,
  type SiteUsage,
} from "../lib/db/injections";
import { OTHER_PRODUCT_ID } from "../lib/insulinCatalog";
import { getRotationCycleStart } from "../lib/rotationCycle";
import { InjectionBodyMap } from "./InjectionBodyMap";
import { Skeleton } from "./Skeleton";
import { DirIcon } from "./DirIcon";
import { checkDose } from "../lib/insulin";
import { logCrash, logEvent } from "../lib/analytics";
import { hapticSuccess, hapticSelect } from "../lib/haptics";
import { useApp } from "../lib/store/AppContext";
import { FeedbackHost, useFeedback } from "./Feedback";
import { Stepper, useStepperValidity } from "./Stepper";
import { InlineDateTimePicker } from "./InlineDateTimePicker";
import { formatTime, num, relativeDay } from "../lib/format";
import { GLUCOSE_RICH, RADIUS, THEME, glow } from "../lib/theme/tokens";
import { useLayout } from "../lib/useLayout";
import { listEntering, listExiting, listLayout } from "../lib/theme/motion";
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
  bolus_kind: BolusKind | null;
  logged_at: string;
  /** Which product this row actually used (schema v22, see
   *  ../lib/insulinCatalog). save() keeps this as-is UNLESS the sheet's own
   *  insulin-type toggle is switched away from this row's original type -
   *  then it is re-derived from the active profile's product for the NEW
   *  type instead, so a basal product can never end up sitting on a row
   *  that now reads as bolus (or vice versa). */
  insulin_product_id: string | null;
  insulin_product_other: string | null;
}

// Same heat window as the injection tab's map surface.
const USAGE_WINDOW_DAYS = 30;

/** Widest the sheet gets on a tablet before it stops stretching and centres
 *  (same cap as components/GlucoseInputSheet.tsx's SHEET_MAX_WIDTH). */
const SHEET_MAX_WIDTH = 600;

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
  onDelete,
}: {
  visible: boolean;
  injection: InjectionEditTarget | null;
  onClose: () => void;
  onSaved: () => void;
  /** Destructive "Delete" action (2.3.1 P4): confirms first, then fires this so
   *  the caller can run the same undo-toast delete every other surface uses.
   *  Left undefined, no delete button is drawn - same "prop absent, feature
   *  absent" rule the row's own swipe delete follows. */
  onDelete?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { activeProfile, isProUser } = useApp();
  const { confirm } = useFeedback();
  const { height: winH } = useWindowDimensions();
  const { isWide } = useLayout();
  // Fixed, not just a cap: the sheet swaps its body between the form and the
  // site-picking step (see `step` below) without ever resizing the frame
  // around it, so a step change can never jump the sheet's height.
  const sheetHeight = Math.round(winH * 0.86);
  // Dose in units (0 = no dose). Stepper-driven, keyboard-editable.
  const [dose, setDose] = useState(0);
  const [insulinType, setInsulinType] = useState<InsulinType>("bolus");
  const [bolusKind, setBolusKind] = useState<BolusKind | null>(null);
  const [site, setSite] = useState<InjectionSite>("abdomen_left");
  const [point, setPoint] = useState<SitePoint | null>(null);
  // Whether the working state currently HAS a site (site+point pair), as
  // opposed to merely displaying a placeholder region for the picker to open
  // on. True from an existing record, from a fresh pick on the body map,
  // false again if the user clears it. save() writes null for both columns
  // exactly when this is false, so a row logged with no region only gains one
  // if the user actually chose it, and a chosen region can be removed again.
  const [hasSite, setHasSite] = useState(false);
  const [loggedAt, setLoggedAt] = useState<Date>(new Date());
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const stepperFields = useStepperValidity();
  // Which body the sheet shows: the form, or the site-picking silhouette
  // (entered from the compact site row, returns to the form on a pick).
  const [step, setStep] = useState<"form" | "site">("form");
  // undefined = not fetched yet for this sheet-open. Loaded lazily the first
  // time the site step is actually entered, not on every sheet open (see
  // ensureUsageLoaded).
  const [usage, setUsage] = useState<SiteUsage[] | undefined>(undefined);
  const [noSiteCount, setNoSiteCount] = useState(0);
  const usageRequestedRef = useRef(false);

  useEffect(() => {
    if (visible && injection) {
      setDose(injection.dose_units ?? 0);
      setInsulinType(injection.insulin_type ?? "bolus");
      setBolusKind(injection.bolus_kind);
      // A row logged without a region (a calculator bolus) opens on the first
      // selectable region so the user CAN fill one in; it only becomes part of
      // the record if they pick one (see hasSite).
      setSite(injection.site ?? SELECTABLE_SITES[0]);
      setHasSite(injection.site != null);
      setPoint(injection.site_point);
      setLoggedAt(new Date(injection.logged_at));
      setTimePickerOpen(false);
      setStep("form");
      setUsage(undefined);
      setNoSiteCount(0);
      usageRequestedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, injection?.id]);

  /** Site-usage history for the silhouette step, fetched once per sheet-open
   *  the first time it is actually entered - most edits never touch the site,
   *  so the main open/save flow never pays for this query. On failure the
   *  step still has to open with a pickable (if colourless) silhouette rather
   *  than staying stuck loading, so this falls back to an empty usage list. */
  async function ensureUsageLoaded() {
    if (usageRequestedRef.current || !activeProfile) return;
    usageRequestedRef.current = true;
    try {
      const cycle = await getRotationCycleStart(activeProfile.id);
      const u = await getSiteUsageHistory(activeProfile.id, USAGE_WINDOW_DAYS, cycle);
      setUsage(u.sites);
      setNoSiteCount(u.noSiteCount);
    } catch (err) {
      logCrash(err, { screen: "injectionEditSheet", step: "siteUsage" });
      setUsage([]);
    }
  }

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
    if (!injection || saving || !stepperFields.allValid || !injectionDoseOk(dose, injection?.dose_units ?? null)) return;
    const hasDose = dose > 0;
    if (insulinType === "bolus" && hasDose && !(await confirmDoubleBolus())) return;
    if (hasDose && !(await confirmDose(dose))) return;

    setSaving(true);
    try {
      // Product picking moved to settings/profile.tsx (2.4): this sheet no
      // longer offers a picker. The row keeps whatever product it already
      // had UNLESS the type toggle above was switched to the other type
      // this session - a basal product carried over onto a row now typed
      // "bolus" (or vice versa) would be a straight mismatch, so that case
      // re-derives from the active profile's product for the NEW type
      // instead, the same source a fresh entry of that type would use.
      const typeChanged = insulinType !== (injection.insulin_type ?? "bolus");
      const productId = typeChanged
        ? ((insulinType === "basal"
            ? activeProfile?.basal_insulin_id
            : activeProfile?.bolus_insulin_id) ?? null)
        : injection.insulin_product_id;
      const productOther = typeChanged
        ? (productId === OTHER_PRODUCT_ID
            ? ((insulinType === "basal"
                ? activeProfile?.basal_insulin_other
                : activeProfile?.bolus_insulin_other) ?? null)
            : null)
        : injection.insulin_product_other;
      const patch: InjectionUpdate = {
        dose_units: hasDose ? dose : null,
        insulin_type: insulinType,
        bolus_kind: insulinType === "bolus" ? bolusKind : null,
        insulin_product_id: productId,
        insulin_product_other: productOther,
        site: hasSite ? site : null,
        site_point: hasSite ? point : null,
        logged_at: loggedAt.toISOString(),
      };
      await updateInjection(injection.id, patch);
      logEvent("log_edited");
      hapticSuccess();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  /** Same confirm dialog as the row's own swipe delete (useJournalRows.tsx's
   *  confirmAndDelete) and MedEditSheet's: a plain factual question, destructive
   *  styling, no second line here - an injection never has an Apple Health
   *  mirror to warn about. */
  async function handleDelete() {
    if (!injection || !onDelete) return;
    const ok = await confirm({
      message: t("journal.deleteEntry"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
      icon: "trash-outline",
    });
    if (!ok) return;
    onDelete();
  }

  // Neutral vs. real: the row only names an actual region once one is on the
  // working state (hasSite) - an existing record shows it right away, a
  // cleared one falls back to the neutral prompt, same as the create form.
  const siteSummaryLabel = hasSite
    ? point != null
      ? t("injection.siteWithPoint", { site: t(`injectionSite.${site}`), n: point })
      : t(`injectionSite.${site}`)
    : t("injection.chooseSitePoint");
  // Reserves exactly the space InjectionBodyMap's own minHeight will occupy,
  // so the skeleton -> real map swap never resizes the step.
  const mapMinHeight = Math.round(winH * 0.5);

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
                // Fixed (not a cap): the body swaps between the form and the
                // site step below without the frame around it ever resizing.
                // 86% keeps the same "under 100%" margin the sheet always had,
                // so the dim overlay stays visible above it even with the
                // keyboard open.
                height: sheetHeight,
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
              isWide ? { width: "100%", maxWidth: SHEET_MAX_WIDTH, alignSelf: "center" } : undefined,
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center mb-1.5">
              <View style={{ width: 38, height: 4, borderRadius: 9, backgroundColor: THEME.border }} />
            </View>
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center flex-1" style={{ gap: 6 }}>
                {step === "site" ? (
                  <Pressable
                    onPress={() => setStep("form")}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.back")}
                    style={{ marginLeft: -4 }}
                    className="p-1"
                  >
                    <DirIcon name="chevron-back" size={22} color={THEME.muted} />
                  </Pressable>
                ) : null}
                <Text
                  numberOfLines={1}
                  style={{ color: THEME.ink, fontSize: 17, fontWeight: "800", flexShrink: 1 }}
                >
                  {step === "site" ? t("injection.selectSite") : t("calculator.editTitle")}
                </Text>
              </View>
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

            {step === "site" ? (
              <ScrollView
                style={{ flex: 1 }}
                bounces={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 24 }}
              >
                {usage === undefined ? (
                  <Skeleton width="100%" height={mapMinHeight} radius={20} />
                ) : (
                  <InjectionBodyMap
                    usage={usage}
                    noSiteCount={noSiteCount}
                    selected={hasSite && point != null ? { site, point } : null}
                    onSelect={(selection) => {
                      setSite(selection.site);
                      setPoint(selection.point);
                      setHasSite(true);
                      setStep("form");
                    }}
                    windowDays={USAGE_WINDOW_DAYS}
                    // Rotation suggestion is a Pro feature; a non-Pro user picks
                    // a region freely but never sees the hint ring here either.
                    showRotationHint={isProUser}
                  />
                )}
              </ScrollView>
            ) : (
              <ScrollView
                style={{ flex: 1 }}
                bounces={false}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 32 }}
              >
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

                <FieldLabel>{t("injection.dose")}</FieldLabel>
                <Stepper
                  value={dose}
                  onChange={setDose}
                  onValidityChange={stepperFields.reporter("dose")}
                  step={0.5}
                  longStep={1}
                  min={0}
                  max={150}
                  decimals={1}
                  suffix={t("common.units")}
                  accessibilityLabel={t("injection.dose")}
                  style={{ marginBottom: injectionDoseOk(dose, injection?.dose_units ?? null) ? 16 : 6 }}
                />
                {injectionDoseOk(dose, injection?.dose_units ?? null) ? null : (
                  <Text style={{ color: THEME.muted, fontSize: 12, marginBottom: 12 }}>
                    {t("basalConfirm.doseRequired")}
                  </Text>
                )}

                {/* Reflows smoothly when the bolus-label row appears/disappears,
                    same motion language as the create form (WP3). */}
                <Animated.View layout={listLayout}>
                  {insulinType === "bolus" ? (
                    <Animated.View
                      entering={listEntering}
                      exiting={listExiting}
                      style={{ marginBottom: 16 }}
                    >
                      <FieldLabel>{t("injection.bolusKindLabel")}</FieldLabel>
                      <View className="flex-row" style={{ gap: 8 }}>
                        {BOLUS_KINDS.map((kind) => (
                          <Chip
                            key={kind}
                            label={
                              kind === "meal"
                                ? t("injection.bolusKindMeal")
                                : t("injection.bolusKindCorrection")
                            }
                            on={bolusKind === kind}
                            onPress={() => {
                              hapticSelect();
                              setBolusKind((prev) => (prev === kind ? null : kind));
                            }}
                            style={{ flex: 1 }}
                          />
                        ))}
                      </View>
                    </Animated.View>
                  ) : null}

                  <FieldLabel>{t("injection.selectSite")}</FieldLabel>
                  <View className="flex-row items-center mb-4" style={{ gap: 8 }}>
                    <Pressable
                      onPress={() => {
                        hapticSelect();
                        setStep("site");
                        void ensureUsageLoaded();
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: hasSite }}
                      accessibilityLabel={siteSummaryLabel}
                      className="flex-row items-center flex-1"
                      style={[inputStyle, { minHeight: 44 }]}
                    >
                      <Ionicons
                        name="location-outline"
                        size={16}
                        color={hasSite ? THEME.accent : THEME.muted}
                      />
                      <Text
                        numberOfLines={1}
                        style={{
                          color: hasSite ? THEME.ink : THEME.muted,
                          marginLeft: 8,
                          fontSize: 13,
                          flex: 1,
                        }}
                      >
                        {siteSummaryLabel}
                      </Text>
                      <DirIcon name="chevron-forward-outline" size={16} color={THEME.muted} />
                    </Pressable>
                    {hasSite ? (
                      <Pressable
                        onPress={() => {
                          hapticSelect();
                          setHasSite(false);
                          setSite(SELECTABLE_SITES[0]);
                          setPoint(null);
                        }}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={t("common.delete")}
                        style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
                      >
                        <Ionicons name="close-circle-outline" size={18} color={THEME.muted} />
                      </Pressable>
                    ) : null}
                  </View>

                  <GradientCTA label={t("common.save")} disabled={saving || !stepperFields.allValid || !injectionDoseOk(dose, injection?.dose_units ?? null)} onPress={save} />

                  {onDelete ? (
                    <Pressable
                      onPress={handleDelete}
                      accessibilityRole="button"
                      accessibilityLabel={t("common.delete")}
                      hitSlop={8}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 44,
                        marginTop: 14,
                      }}
                    >
                      <Ionicons name="trash-outline" size={16} color={GLUCOSE_RICH.low} />
                      <Text
                        style={{
                          color: GLUCOSE_RICH.low,
                          fontSize: 13,
                          fontWeight: "700",
                          marginLeft: 6,
                        }}
                      >
                        {t("common.delete")}
                      </Text>
                    </Pressable>
                  ) : null}
                </Animated.View>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      {/* This sheet is an RN <Modal>, i.e. its own view controller. The
          FeedbackHost a SCREEN renders lives in the screen's controller, which
          is UNDERNEATH this one - so a confirm() raised from here used to be
          painted behind the sheet: invisible, untappable, and the promise it
          returns never settled, which left the action that awaited it hanging.
          Hosts are a stack and only the topmost one paints (lib/feedback.ts
          activeHostId), so mounting one here while the sheet is open puts the
          dialog in the right controller and hands it back to the screen on
          close. Guarded on `visible` so a closed sheet never takes the stack. */}
      {visible ? <FeedbackHost /> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}
