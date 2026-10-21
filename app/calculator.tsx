import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  I18nManager,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View, Platform, useWindowDimensions } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import Slider from "@react-native-community/slider";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import {
  RATIOS_CONFIRM_PROMPTED_KEY,
  calcFiguresAllowed,
  calcSetupNeeded,
  calcSetupPrefilled,
  ratioFieldsComplete,
  ratioFieldsInitial,
  shouldAutoOpenCalcSetup,
  type RatioFields,
} from "../lib/calcSetup";
import { useRatioWriter } from "../lib/useRatioWriter";
import type { RatioWriter } from "../lib/ratioWriter";
import { DOSE_BOUNDS, glucoseEntryBounds } from "../lib/numericField";
import { recentGlucoseSuggestion } from "../lib/glucoseSuggestion";
import { getFood } from "../lib/db/foods";
import {
  addMealLog,
  addSugarLog,
  deleteMealLog,
  deleteMealRecord,
  findMatchingSugarLog,
  getLatestSugarLog,
  getMealLog,
  getSugarLog,
  updateMealLog,
  updateSugarLog,
} from "../lib/db/logs";
import { captureDeletion, restoreDeletion } from "../lib/db/undo";
import {
  applyAfterDelete,
  applyAfterDeleteFromSnapshot,
  undoAfterDelete,
} from "../lib/afterDelete";
import {
  deleteInjection,
  getCalculatorInjectionForMeal,
  getSiteUsageHistory,
  leastRecentlyUsedPoint,
  logInjection,
  updateInjection,
  type SiteUsage,
} from "../lib/db/injections";
import { getRotationCycleStart } from "../lib/rotationCycle";
import { InjectionBodyMap, type PointSelection } from "../components/InjectionBodyMap";
import { logCrash, logEvent } from "../lib/analytics";
import { noteLog, maybeRequestReview } from "../lib/services/review";
import { noteFirstLog } from "../lib/services/firstLog";
import {
  checkDose,
  carbsForPortion,
  estimateInsulinConfirmed,
  activeMealSlot,
  mealSlotForHour,
  carbRatioForSlot,
  type InsulinWarning,
} from "../lib/insulin";
import { activeInsulinBreakdown } from "../lib/iob";
import { bolusProfileFor, basalProfileFor, insulinProductById } from "../lib/insulinCatalog";
import { getInjections } from "../lib/db/injections";
import {
  classifyGlucose,
  formatGlucose,
  glucoseFromDisplay,
  glucoseToDisplay,
  glucoseUnitLabel,
  targetMidpoint,
  targetRangeFor,
} from "../lib/glucose";
import { insulinModeOf, insulinModeShowsBolus } from "../lib/insulinMode";
import {
  getTemplateWithItems,
  touchTemplate,
  type TemplateWithItems,
} from "../lib/db/mealTemplates";
import { applyItemPortion, parsePortions, resolvedTotals } from "../lib/mealTemplates";
import {
  schedulePostMealReminder,
  noteJournalActivity,
} from "../lib/services/notifications";
import {
  deleteGlucoseRowFromHealth,
  getHealthWriteEnabled,
  updateGlucoseInHealth,
  writeGlucoseToHealthIfEnabled,
  shouldAnnounceHealthWriteFailure,
  HEALTH_NAME,
} from "../lib/services/health";
import { foodSourceLabel } from "../lib/services/openFoodFacts";
import type {
  Food,
  GlucoseUnit,
  InjectionSite,
  LogTag,
  MealSlot,
  SitePoint,
} from "../lib/db/types";
import { foodName, SELECTABLE_SITES } from "../lib/db/types";
import { Segmented } from "../components/ui";
import { SCRIM, SheetShell } from "../components/SheetShell";
import { useStepperValidity } from "../components/Stepper";
import { NumericField } from "../components/NumericField";
import { CarbRatioInput, IsfInput } from "../components/RatioInput";
import { ConfirmCheckbox } from "../components/ConfirmCheckbox";
import { PortionPresetChips } from "../components/PortionPresetChips";
import { EMOJI_RENDERS, FoodIconTile } from "../components/FoodPlate";
import { Tooltip } from "../components/Tooltip";
import { TagPicker } from "../components/TagPicker";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { useEntryGuardConfirm } from "../components/useEntryGuardConfirm";
import { InlineDateTimePicker } from "../components/InlineDateTimePicker";
import { Skeleton } from "../components/Skeleton";
import { DirIcon } from "../components/DirIcon";
import { CarbRatioLine } from "../components/CarbRatioLine";
import { useCarbChoiceText } from "../lib/carbDisplayPref";
import { formatTime, num, relativeDay } from "../lib/format";
import {
  GLUCOSE_INPUT_CEILING,
  glucoseAboveCeiling,
  parseDecimalText,
} from "../lib/numberInput";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { mealEditMode, type MealEditMode } from "../lib/mealRoute";
import { CarbOnlyMealEdit } from "../components/CarbOnlyMealEdit";
import { hapticSuccess, hapticSelect } from "../lib/haptics";
import {
  AppBackground,
  GlassCard,
  GlucoseChip,
  GradientCTA,
  IconTile,
  withAlpha,
} from "../components/rich";
import { GLUCOSE_RICH, INPUT_TEXT, MODAL_TOP_PAD, RADIUS, RICH_BY_STATUS, TABULAR, THEME, glow } from "../lib/theme/tokens";
import { mealPrefill } from "../lib/mealPrefill";
import { useLayout } from "../lib/useLayout";
import { sheetBoxStyle } from "../lib/tabletLayout";
import { upper } from "../lib/upper";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner"];


// Same heat window as the injection tab's map and its edit sheet, so a region's
// colour means the same thing wherever it is picked.
const USAGE_WINDOW_DAYS = 30;

/**
 * The stand-in food row for a meal that has none: a typed-name entry, or one
 * whose catalogue food was deleted afterwards. The screen used to wait forever
 * for a food that would never load and showed only "loading", so the fastest way
 * to log something was also the one entry that could not be corrected.
 *
 * Every figure comes from the meal's own record: carb_100g is back-derived from
 * the carbs and portion that were saved, so the numbers on screen are the user's
 * and a portion change scales them the same way it does for a catalogue food.
 */
function foodFromMeal(log: {
  custom_food_name: string | null;
  portion_g: number;
  calculated_carbs_g: number;
  logged_at: string;
}): Food {
  const name = log.custom_food_name?.trim() || "";
  // NOT rounded: at the stored portion this has to reproduce the stored carbs
  // exactly, or merely opening the entry and saving it again would nudge the
  // user's own figure. The screen rounds it for display (see num()).
  const prefill = mealPrefill(log);
  const per100 = prefill.carb_100g;
  return {
    id: "",
    name_tr: name,
    name_en: name,
    name_de: name,
    name_es: name,
    name_fr: name,
    aliases_json: "[]",
    category: "other",
    barcode: null,
    carb_100g: per100,
    glycemic_index: 0,
    glycemic_load: 0,
    portion_size_g: prefill.portion_g,
    brand_name: null,
    custom_notes: null,
    is_custom: 1,
    source: null,
    emoji: null,
    created_at: log.logged_at,
  };
}

/**
 * A meal template as ONE food for the estimator: carb_100g is the template's total
 * carbohydrate and the portion is pinned to 100, so carb_100g × 100 / 100 gives
 * back exactly that total.
 *
 * This is how several items reach a dose estimate without touching estimateInsulin
 * or anything around it: its signature is Pick<Food,"carb_100g"> and it computes
 * carbs = carb_100g × portion / 100. The whole safety chain on this screen (the IOB
 * re-read, checkDose, both confirmations, the injection row) therefore runs
 * unchanged and unduplicated - a second copy of it for templates is precisely the
 * thing that must not exist.
 */
function foodFromTemplate(loaded: TemplateWithItems): Food {
  const name = loaded.template.name;
  return {
    id: "",
    name_tr: name,
    name_en: name,
    name_de: name,
    name_es: name,
    name_fr: name,
    aliases_json: "[]",
    category: "other",
    barcode: null,
    carb_100g: loaded.carbs_g,
    glycemic_index: 0,
    glycemic_load: 0,
    portion_size_g: 100,
    brand_name: null,
    custom_notes: null,
    is_custom: 1,
    source: null,
    emoji: null,
    created_at: loaded.template.created_at,
  };
}

/** Maps an estimate warning to its calculator i18n key. */
const WARN_KEY: Record<InsulinWarning, string> = {
  high_dose: "warnHighDose",
  carb_ratio_out_of_range: "warnRatio",
  isf_out_of_range: "warnIsf",
};

/** The mockup's B04 read-out card: a small caps label with a big figure beside it. */
function ReadoutCard({
  label,
  value,
  suffix,
  color,
  accessory,
  note,
  children,
}: {
  label: string;
  value: string;
  suffix?: string;
  color?: string;
  accessory?: React.ReactNode;
  /** Display-only secondary line under the figure (carb choices). */
  note?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <GlassCard style={{ marginBottom: 10 }}>
      <View className="flex-row items-center justify-between">
        <Text
          style={{
            color: THEME.textMuted,
            fontSize: 11,
            letterSpacing: 1.3,
            fontWeight: "800",
            flex: 1,
          }}
        >
          {upper(label)}
        </Text>
        <View className="flex-row items-baseline" style={{ gap: 4 }}>
          <Text
            style={[
              TABULAR,
              { color: color ?? THEME.text, fontSize: 26, fontWeight: "800" },
            ]}
          >
            {value}
          </Text>
          {suffix ? (
            <Text style={{ color: THEME.textMuted, fontSize: 12 }}>{suffix}</Text>
          ) : null}
          {accessory}
        </View>
      </View>
      {note ? (
        <Text style={[TABULAR, { color: THEME.textMuted, fontSize: 12, textAlign: "right", marginTop: 2 }]}>
          {note}
        </Text>
      ) : null}
      {children}
    </GlassCard>
  );
}

/** A neutral, non-blocking notice card (info tone, never an alarm). Optionally
 *  tappable (e.g. "ratio not set, tap to set it") - onPress swaps the plain
 *  View for a Pressable with a trailing chevron, everything else unchanged. */
function NoticeCard({
  icon,
  tint,
  title,
  body,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title?: string;
  body: string;
  onPress?: () => void;
}) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      className="flex-row items-start rounded-2xl px-3.5 py-3 mb-3"
      style={{ borderWidth: 1, borderColor: withAlpha(tint, 0.3), backgroundColor: withAlpha(tint, 0.1) }}
      {...(onPress ? { onPress, accessibilityRole: "button" as const } : {})}
    >
      <Ionicons name={icon} size={15} color={tint} style={{ marginTop: 1 }} />
      <View className="flex-1 ml-2.5">
        {title ? (
          <Text style={{ color: tint, fontSize: 12, fontWeight: "800", marginBottom: 2 }}>
            {title}
          </Text>
        ) : null}
        <Text style={{ color: THEME.text, fontSize: 12, lineHeight: 17, opacity: 0.85 }}>
          {body}
        </Text>
      </View>
      {onPress ? <DirIcon name="chevron-forward-outline" size={14} color={tint} /> : null}
    </Wrapper>
  );
}

/** Secondary, non-regulation notices (default ratios, ISF off) stacked as
 *  separate cards each carry their own border/background and pile up
 *  vertically; grouped under one card they read as one dismissable block
 *  instead of a wall of boxes. The regulation notice (calcNotAdvice) and the
 *  plausibility warnings stay outside this group, on their own. */
function NoticeGroup({
  items,
}: {
  items: {
    icon: keyof typeof Ionicons.glyphMap;
    tint: string;
    title?: string;
    body: string;
    /** Makes the row tappable, with the same trailing chevron NoticeCard draws. */
    onPress?: () => void;
  }[];
}) {
  if (items.length === 0) return null;
  return (
    <View
      className="rounded-2xl px-3.5 py-3 mb-3"
      style={{
        borderWidth: 1,
        borderColor: withAlpha(THEME.accent, 0.3),
        backgroundColor: withAlpha(THEME.accent, 0.1),
      }}
    >
      {items.map((item, i) => {
        const Row = item.onPress ? Pressable : View;
        return (
          <Row
            key={i}
            className="flex-row items-start"
            style={{ marginTop: i === 0 ? 0 : 10 }}
            {...(item.onPress
              ? { onPress: item.onPress, accessibilityRole: "button" as const }
              : {})}
          >
            <Ionicons name={item.icon} size={15} color={item.tint} style={{ marginTop: 1 }} />
            <View className="flex-1 ml-2.5">
              {item.title ? (
                <Text style={{ color: item.tint, fontSize: 12, fontWeight: "800", marginBottom: 2 }}>
                  {item.title}
                </Text>
              ) : null}
              <Text style={{ color: THEME.text, fontSize: 12, lineHeight: 17, opacity: 0.85 }}>
                {item.body}
              </Text>
            </View>
            {item.onPress ? (
              <DirIcon name="chevron-forward-outline" size={14} color={item.tint} />
            ) : null}
          </Row>
        );
      })}
    </View>
  );
}

/**
 * The calculator's numbers, asked in one sheet: a carb ratio for each meal and
 * the correction factor, as four separate fields. It opens by itself once (see
 * lib/calcSetup.ts); afterwards the "Enter your ratios" / "Confirm your ratios"
 * line leads to Profile and Targets.
 *
 * The fields open with the user's own stored values or EMPTY; nothing is
 * suggested. Whatever is typed is written to the profile as it is typed, through
 * the same writer Profile and Targets uses, so the two are one record: leaving
 * the sheet half-filled, or going to Profile, loses nothing. Ticking the box
 * confirms the numbers on screen; only then does the calculator show a figure,
 * and the sheet closes so it is right there. Changing any value un-ticks the box.
 *
 * ISF is held in mg/dL and edited in the profile's display unit.
 */
function CalcSetupSheet({
  visible,
  onClose,
  onFinish,
  onConfirmed,
  getWriter,
  saveError,
  unit,
  initial,
  prefilled,
}: {
  visible: boolean;
  /** Put the sheet away; whatever was typed is kept. */
  onClose: () => void;
  /** Save: writes what is pending and closes unless the write failed. */
  onFinish: () => Promise<void>;
  /** The box was ticked and the confirmation reached the profile. */
  onConfirmed: () => void;
  getWriter: (opts?: { renew?: boolean }) => RatioWriter | null;
  saveError: boolean;
  unit: GlucoseUnit;
  initial: RatioFields;
  /** All four values are the user's own and already filled in. */
  prefilled: boolean;
}) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<RatioFields>(initial);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Every open starts from what the profile holds now, with a writer that
  // starts from it too. The box always starts unticked.
  useEffect(() => {
    if (!visible) return;
    setFields(initial);
    setConfirmed(false);
    getWriter({ renew: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function change(patch: Partial<RatioFields>) {
    const next = { ...fields, ...patch };
    setFields(next);
    setConfirmed(false);
    getWriter()?.update(next);
  }

  async function toggle(next: boolean) {
    if (!ratioFieldsComplete(fields)) return;
    setConfirmed(next);
    const ok = await getWriter()?.confirm(next);
    if (next && ok) {
      hapticSuccess();
      onConfirmed();
    } else if (next) {
      setConfirmed(false);
    }
  }

  const complete = ratioFieldsComplete(fields);

  return (
    <SheetShell
      visible={visible}
      onClose={onClose}
      title={t("calculator.setup.title")}
      closeLabel={t("common.close")}
      footer={
        <View>
          {saveError ? (
            <Text style={{ color: THEME.warning, fontSize: 12, marginBottom: 8 }}>
              {t("common.saveFailed")}
            </Text>
          ) : null}
          <GradientCTA
            label={t("common.save")}
            loading={busy}
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await onFinish();
              } finally {
                setBusy(false);
              }
            }}
          />
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("calculator.setup.later")}
            style={{ minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 4 }}
          >
            <Text style={{ color: THEME.textMuted, fontSize: 15, fontWeight: "500" }}>
              {t("calculator.setup.later")}
            </Text>
          </Pressable>
        </View>
      }
    >
      <Text style={{ color: THEME.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 16 }}>
        {prefilled ? t("calculator.setup.bodyFilled") : t("calculator.setup.body")}
      </Text>

      <DetailLabel>{t("calculator.setup.carbLabel")}</DetailLabel>
      {(["breakfast", "lunch", "dinner"] as const).map((slot) => (
        <View key={slot} style={{ marginBottom: 10, maxWidth: 360 }}>
          <Text style={{ color: THEME.textMuted, fontSize: 12, marginBottom: 4 }}>
            {t(`slot.${slot}`)}
          </Text>
          <CarbRatioInput
            value={fields[slot]}
            onChange={(v) => change({ [slot]: v })}
            accessibilityLabel={`${t("calculator.setup.carbLabel")}, ${t(`slot.${slot}`)}`}
          />
        </View>
      ))}
      <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 }}>
        {t("calculator.setup.carbHint")}
      </Text>

      <View style={{ marginTop: 18 }}>
        <DetailLabel>{t("calculator.setup.isfLabel")}</DetailLabel>
        <IsfInput
          valueMgdl={fields.isfMgdl}
          onChangeMgdl={(v) => change({ isfMgdl: v })}
          unit={unit}
          accessibilityLabel={t("calculator.setup.isfLabel")}
        />
        <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 }}>
          {t("calculator.setup.isfHint")}
        </Text>
      </View>

      <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17, marginTop: 18 }}>
        {t("calculator.setup.teamNote")}
      </Text>
      <View style={{ marginTop: 6 }}>
        <ConfirmCheckbox
          checked={confirmed}
          onToggle={(next) => void toggle(next)}
          label={t("calculator.setup.confirm")}
          hint={t("calculator.setup.hint")}
          disabled={!complete}
        />
      </View>
    </SheetShell>
  );
}

/**
 * The calculated total's place while the ratios are not confirmed: a status
 * line and no number. The figure takes this spot the moment the box is ticked.
 */
function PendingDoseCard() {
  const { t } = useTranslation();
  return (
    <GlassCard style={{ marginBottom: 12 }}>
      <Text
        style={{ color: THEME.textMuted, fontSize: 11, letterSpacing: 1.3, fontWeight: "800" }}
      >
        {upper(t("calculator.estimatedDose"))}
      </Text>
      <Text style={{ color: THEME.textMuted, fontSize: 16, fontWeight: "700", marginTop: 6 }}>
        {t("calculator.pending")}
      </Text>
    </GlassCard>
  );
}

/** A labelled detail row wrapper for the section below the hero. */
function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: THEME.textMuted,
        fontSize: 12,
        fontWeight: "700",
        marginBottom: 6,
      }}
    >
      {children}
    </Text>
  );
}

const inputStyle = () =>
  ({
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: THEME.text,
  }) as const;

/**
 * Region picker, as a modal over the silhouette (InjectionBodyMap) instead of
 * the card-grid SitePointSelector - the same picking language as the
 * Injection tab's own map, so the app has one way to choose a site, not two.
 * Chrome follows InjectionEditSheet's bottom sheet (same overlay/close/height
 * pattern); no cycleStart/onStartNewCycle here, on purpose - this is a record
 * screen, not where a rotation cycle gets managed.
 */
function SitePickerModal({
  visible,
  onClose,
  usage,
  noSiteCount,
  selected,
  onSelect,
  showRotationHint,
}: {
  visible: boolean;
  onClose: () => void;
  /** undefined while the lazy fetch (ensureSiteUsageLoaded) hasn't resolved yet
   *  for this screen visit - renders a skeleton in its place until it does. */
  usage: SiteUsage[] | undefined;
  noSiteCount: number;
  selected: PointSelection | null;
  onSelect: (selection: PointSelection) => void;
  /** Pro gate for the rotation-suggestion ring on the silhouette - passed
   *  through as isProUser from the caller (see InjectionBodyMap). */
  showRotationHint: boolean;
}) {
  const { t } = useTranslation();
  const { height: winH } = useWindowDimensions();
  const { isWide, width: layoutWidth } = useLayout();
  // Matches InjectionBodyMap's own minHeight floor, so the skeleton reserves
  // exactly the space the real silhouette will occupy - no jump once it loads.
  const mapMinHeight = Math.round(winH * 0.5);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: SCRIM }}
        onPress={onClose}
        accessible={false}
        focusable={false}
      >
        <Pressable
          style={[
            {
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
            sheetBoxStyle(layoutWidth, isWide),
          ]}
          onPress={(e) => e.stopPropagation()}
          accessible={false}
          focusable={false}
          importantForAccessibility="auto"
        >
          <View className="items-center mb-1.5">
            <View style={{ width: 38, height: 4, borderRadius: 9, backgroundColor: THEME.border }} />
          </View>
          <View className="flex-row items-center justify-between mb-3">
            <Text style={{ color: THEME.text, fontSize: 17, fontWeight: "800" }}>
              {t("injection.selectSite")}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              className="p-1"
            >
              <Ionicons name="close" size={22} color={THEME.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flexShrink: 1 }}
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
                selected={selected}
                onSelect={onSelect}
                windowDays={USAGE_WINDOW_DAYS}
                showRotationHint={showRotationHint}
              />
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CalculatorScreen() {
  const { t } = useTranslation();
  const choiceText = useCarbChoiceText();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    foodId,
    portion: portionParam,
    mealLogId,
    templateId,
    portions,
  } = useLocalSearchParams<{
    foodId?: string;
    portion?: string;
    mealLogId?: string;
    templateId?: string;
    portions?: string;
  }>();
  const { activeProfile, lang, bumpData, dataVersion, isProUser } = useApp();
  const { actionSheet, confirm, toast } = useFeedback();
  const guardEntry = useEntryGuardConfirm();

  const [food, setFood] = useState<Food | null>(null);
  // Set only on the template route: what the synthetic food above stands for, and
  // what the saved row is then named, portioned and attributed to.
  const [templateCtx, setTemplateCtx] = useState<TemplateWithItems | null>(null);
  const [portion, setPortion] = useState(100);
  const [slot, setSlot] = useState<MealSlot>(activeMealSlot());
  // True only once the user has picked a slot pill themselves - gates the
  // loggedAt-driven auto-suggest below so it never overrides a deliberate
  // choice (edit mode is prefilled straight from the record and never runs
  // that effect at all, see isEdit guard).
  const [slotTouched, setSlotTouched] = useState(false);
  const [glucose, setGlucose] = useState("");
  // A new record starts with this BLANK - never pre-filled from the estimate -
  // so the stored dose is always something the user actually typed. Edit mode
  // is the one exception: the prefill effect below loads it from the record.
  const [doseText, setDoseText] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [tags, setTags] = useState<LogTag[]>([]);
  const [iob, setIob] = useState(0);
  // Long-acting (basal) insulin still active, kept apart from `iob` (bolus
  // only, see lib/iob.ts) and shown as its own line in the IOB tooltip.
  const [basalIob, setBasalIob] = useState(0);
  const [saving, setSaving] = useState(false);
  const stepperFields = useStepperValidity();
  // Flips true only on a direct user edit (photo, note, tags, typed dose) -
  // never on the edit-mode prefill - so the close button only warns about
  // input the user themselves just made, not the record it loaded.
  const [dirty, setDirty] = useState(false);
  // null keeps the "log it as of now" default; a Date is an explicit user pick.
  const [loggedAt, setLoggedAt] = useState<Date | null>(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  // The reading an already-saved meal is attached to, so an edit updates that
  // row instead of silently leaving a stale value behind it.
  const [linkedSugarLogId, setLinkedSugarLogId] = useState<string | null>(null);
  // Edit mode: the meal's logged_at exactly as prefilled, so save can tell a
  // real user edit of the time apart from the picker simply holding what it
  // was loaded with. Only the linked reading's own logged_at needs this - it
  // can legitimately differ from the meal's, and must not be dragged along
  // just because the meal itself got saved.
  const prefillLoggedAtRef = useRef<Date | null>(null);

  // Optional region for the bolus row this screen writes (see renderDetails'
  // site picker below). `site`/`point` are only meaningful once `siteTouched`
  // is true - they default to the first selectable region purely so the picker
  // has something to display when it is opened, exactly the "opens on a
  // placeholder region, only becomes real once picked" pattern InjectionEditSheet
  // already uses for the same reason. Left blank by default, always: earlier
  // builds auto-stamped this injection to a fixed 'abdomen_left', which polluted
  // rotation-heat data with entries the user never actually placed.
  const [site, setSite] = useState<InjectionSite>(SELECTABLE_SITES[0]);
  const [point, setPoint] = useState<SitePoint | null>(null);
  const [siteTouched, setSiteTouched] = useState(false);
  const [siteModalOpen, setSiteModalOpen] = useState(false);
  // undefined = not fetched yet (modal never opened this session). The silhouette
  // in the modal reads this directly, so a fresh open shows its own skeleton
  // until it resolves - see ensureSiteUsageLoaded.
  const [siteUsage, setSiteUsage] = useState<SiteUsage[] | undefined>(undefined);
  const [siteNoSiteCount, setSiteNoSiteCount] = useState(0);
  // Guards the lazy fetch below to run at most once per screen visit, whichever
  // modal open triggers it first.
  const siteUsageRequestedRef = useRef(false);
  // Least-recently-used point, shown as a factual hint only - never pre-applied.
  // Edit mode only: false until the prefill effect below has finished every
  // await. Gates the save button (see the effect's finally for why).
  const [editPrefillDone, setEditPrefillDone] = useState(false);
  const [siteSuggestion, setSiteSuggestion] = useState<{
    site: InjectionSite;
    point: SitePoint;
  } | null>(null);

  const isEdit = typeof mealLogId === "string" && mealLogId.length > 0;

  // A user who told us they take no mealtime insulin gets a carb-only screen:
  // no dose estimate, no dose field, no injection written. Everything else on
  // this screen (portion, carbs, photo, note, tags) is unchanged.
  const insulinMode = insulinModeOf(activeProfile);
  const showsDose = insulinModeShowsBolus(insulinMode);

  // The ratios sheet (lib/calcSetup.ts). It opens by itself ONCE on a new
  // record while the profile has no confirmed ratios of its own; after that the
  // "Enter your ratios" line (CarbRatioLine) leads to Profile and Targets.
  const setupNeeded = calcSetupNeeded(activeProfile);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupSaveError, setSetupSaveError] = useState(false);
  const setupErrorRef = useRef(false);
  // The sheet and Profile and Targets write the four numbers through the same
  // writer, so what is typed in one is the record the other reads.
  const ratioWriters = useRatioWriter(() => {
    setupErrorRef.current = true;
    setSetupSaveError(true);
  });
  const setupPromptedKey = activeProfile ? `${RATIOS_CONFIRM_PROMPTED_KEY}.${activeProfile.id}` : null;

  // Marked the moment the sheet is shown, not when it is put away: a force-quit
  // with the sheet open still counts as offered, so it never comes back by itself.
  useEffect(() => {
    if (!setupPromptedKey || !setupNeeded || isEdit) return;
    let alive = true;
    (async () => {
      let prompted = false;
      try {
        prompted = (await AsyncStorage.getItem(setupPromptedKey)) != null;
      } catch {
        // an unreadable flag means "ask", which is the safe direction
      }
      if (alive && shouldAutoOpenCalcSetup({ needed: true, isEdit, prompted })) {
        setSetupOpen(true);
        AsyncStorage.setItem(setupPromptedKey, "1").catch(() => {
          // best-effort: worst case the sheet is offered once more next time
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [setupPromptedKey, setupNeeded, isEdit]);

  // Putting the sheet away keeps whatever was typed: the pending value is
  // written on the way out.
  function closeSetup() {
    void ratioWriters.get()?.flush();
    setSetupOpen(false);
    setSetupSaveError(false);
  }

  async function finishSetup() {
    setupErrorRef.current = false;
    await ratioWriters.get()?.flush();
    if (setupErrorRef.current) return;
    setSetupOpen(false);
    setSetupSaveError(false);
    hapticSuccess();
  }

  useEffect(() => {
    (async () => {
      if (!foodId) return;
      const f = await getFood(foodId);
      if (f) {
        setFood(f);
        // Prefill the portion from a one-tap "recent meal" re-log, else default.
        const p = Number(portionParam);
        setPortion(Number.isFinite(p) && p > 0 ? p : f.portion_size_g || 100);
      }
    })();
  }, [foodId, portionParam]);

  // Template mode: load the recipe, fold it into one synthetic food and pin the
  // portion to 100. `portions` (a csv on the link) carries ONE day's portions
  // without touching the stored template; it is all-or-nothing, so a stale link
  // falls back to the template as it stands rather than dosing on a partial read.
  useEffect(() => {
    (async () => {
      if (!templateId) return;
      const loaded = await getTemplateWithItems(templateId, lang);
      if (!loaded) return;
      const carried = parsePortions(portions, loaded.items.length);
      const items = carried
        ? loaded.items.map((item, i) => applyItemPortion(item, carried[i]))
        : loaded.items;
      const totals = resolvedTotals(items);
      const ctx: TemplateWithItems = {
        template: loaded.template,
        items,
        carbs_g: totals.carbs_g,
        portion_g: totals.portion_g,
      };
      setTemplateCtx(ctx);
      setFood(foodFromTemplate(ctx));
      setPortion(100);
    })();
  }, [templateId, portions, lang]);

  // Edit mode: prefill every field from the stored log, including the dose
  // exactly as it was recorded - a new record's blank-start default (above)
  // never applies here.
  useEffect(() => {
    (async () => {
      if (!isEdit || !mealLogId) {
        setEditPrefillDone(true);
        return;
      }
      try {
      const log = await getMealLog(mealLogId);
      if (!log) return;
      const catalogueFood = log.food_id ? await getFood(log.food_id) : null;
      // No catalogue row (typed name, or the food was deleted since): stand one in
      // from the meal's own values instead of leaving the screen loading forever.
      setFood(catalogueFood ?? foodFromMeal(log));
      setPortion(catalogueFood ? log.portion_g : mealPrefill(log).portion_g);
      setDoseText(num(log.insulin_dose_units));
      setNote(log.personal_note ?? "");
      setPhoto(log.photo_uri_local);
      setTags(log.tags);
      setLoggedAt(new Date(log.logged_at));
      prefillLoggedAtRef.current = new Date(log.logged_at);
      // The record's own hour, not "now": activeMealSlot() at mount would show
      // whatever slot happens to be active while editing, not the one this
      // meal was actually logged under.
      setSlot(mealSlotForHour(new Date(log.logged_at).getHours()));
      setLinkedSugarLogId(log.sugar_log_id);
      // Prefill the region from whatever this meal's bolus row actually holds -
      // possibly set later from the Injection tab, and never to be overwritten by
      // a picker that opens on a placeholder. No injection row (dose was 0 when
      // first saved) or no region on it both mean "nothing to prefill".
      const existingInjection = await getCalculatorInjectionForMeal(mealLogId);
      if (existingInjection?.site) {
        setSite(existingInjection.site);
        setPoint(existingInjection.site_point);
        setSiteTouched(true);
      } else {
        setSite(SELECTABLE_SITES[0]);
        setPoint(null);
        setSiteTouched(false);
      }
      if (log.sugar_log_id) {
        const reading = await getSugarLog(log.sugar_log_id);
        if (reading) {
          setGlucose(
            num(
              glucoseToDisplay(
                reading.glucose_level_mgdl,
                activeProfile?.glucose_unit ?? "mgdl"
              )
            )
          );
        }
      }
      } finally {
        // The region prefill is the LAST await here, but setFood() above already
        // cleared the loading skeleton. Saving inside that window wrote a null
        // region over one the user had assigned on the Injection tab, so the CTA
        // stays disabled until every field has actually landed.
        setEditPrefillDone(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, mealLogId]);

  // New record only: once the user moves the logged-time picker off "now",
  // the slot follows the picked hour - a 23:00 entry defaults to dinner
  // instead of staying on whatever slot happened to be active when the
  // screen opened. Never runs once the user has picked a slot pill
  // themselves (slotTouched), and never in edit mode, which prefills the
  // slot from the record's own hour above and must not have it overridden
  // by a later logged-time correction.
  useEffect(() => {
    if (isEdit || slotTouched || !loggedAt) return;
    setSlot(mealSlotForHour(loggedAt.getHours()));
  }, [loggedAt, isEdit, slotTouched]);

  // Active insulin (IOB) from recent bolus doses, used to trim the correction
  // so a fresh dose doesn't stack on top of insulin that is still working.
  useEffect(() => {
    void readFreshIob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile, dataVersion]);

  // The least-recently-used hint next to the site row below. Purely descriptive
  // of the user's own history, same as the injection tab's own rotation card -
  // never applied on its own (see renderDetails). This is cheap (one grouped
  // query) and the hint has to be visible without ever opening the modal, so it
  // loads eagerly; the heavier per-site usage history stays lazy (see
  // ensureSiteUsageLoaded) since the calculator's main flow never needs it.
  // Rotation is a Pro feature (same gate as the injection tab's rotation card),
  // so a non-Pro profile never even issues this query - the Injection tab hides
  // the identical suggestion behind a paywall card, and firing it here would
  // quietly hand the same information to a free user through a screen that has
  // no Pro gate of its own.
  useEffect(() => {
    if (!activeProfile || !isProUser) return;
    let alive = true;
    (async () => {
      const cycle = await getRotationCycleStart(activeProfile.id);
      const suggestion = await leastRecentlyUsedPoint(activeProfile.id, cycle);
      if (!alive) return;
      setSiteSuggestion(suggestion);
    })();
    return () => {
      alive = false;
    };
  }, [activeProfile, isProUser]);

  /** Site-usage history for the silhouette modal, fetched once per screen visit
   *  the first time the modal opens rather than whenever the calculator does -
   *  this screen's main flow (logging a meal) never touches it. On failure the
   *  modal still has to open with a pickable (if colourless) silhouette rather
   *  than staying stuck loading, so this falls back to an empty usage list. */
  async function ensureSiteUsageLoaded() {
    if (siteUsageRequestedRef.current || !activeProfile) return;
    siteUsageRequestedRef.current = true;
    try {
      const cycle = await getRotationCycleStart(activeProfile.id);
      const usage = await getSiteUsageHistory(activeProfile.id, USAGE_WINDOW_DAYS, cycle);
      setSiteUsage(usage.sites);
      setSiteNoSiteCount(usage.noSiteCount);
    } catch (err) {
      logCrash(err, { screen: "calculator", step: "siteUsage" });
      setSiteUsage([]);
    }
  }

  /** Re-reads active insulin from the log. IOB decays while this screen sits
   *  open, so the value the save uses is taken at save time, not at mount. */
  async function readFreshIob(): Promise<number> {
    if (!activeProfile) return 0;
    const injections = await getInjections(activeProfile.id, 100);
    const breakdown = activeInsulinBreakdown(injections, {
      bolusProfile: bolusProfileFor(activeProfile.bolus_insulin_id),
      basalProfile: basalProfileFor(activeProfile.basal_insulin_id),
    });
    setIob(breakdown.bolus);
    setBasalIob(breakdown.basal);
    return breakdown.bolus;
  }

  const unit = activeProfile?.glucose_unit ?? "mgdl";

  /** Shared by both glucose fields below (loading skeleton and loaded view -
   *  same `glucose` state, so one handler keeps them from drifting). The field
   *  hands over a number inside 20-600 mg/dL (1.1-33.3 mmol/L) or null, so an
   *  out-of-range entry is never stored; only a REAL change marks the record
   *  dirty. */
  function onGlucoseChange(v: number | null) {
    const next = v == null ? "" : String(v);
    if (next !== glucose) setDirty(true);
    setGlucose(next);
  }

  /** The manual dose: a number from 0 to 100 or null (empty). It never fills
   *  itself; the stored value is what the user typed or stepped to. */
  function onDoseChange(v: number | null) {
    setDirty(true);
    setDoseText(v == null ? "" : String(v));
  }

  // The newest reading, fetched once for a new record. It is only OFFERED under
  // the glucose field (recentGlucoseSuggestion: 15 minutes at most); the field
  // stays empty and the calculation ignores it until the user taps it.
  const [latestReading, setLatestReading] = useState<{
    glucose_level_mgdl: number;
    logged_at: string;
  } | null>(null);
  useEffect(() => {
    if (isEdit || !activeProfile) return;
    let alive = true;
    getLatestSugarLog(activeProfile.id)
      .then((l) => {
        if (alive) setLatestReading(l);
      })
      .catch(() => {
        // no offer is the safe direction
      });
    return () => {
      alive = false;
    };
  }, [activeProfile?.id, isEdit]);

  // ONE numeric normalizer for the whole app (lib/numberInput): a comma is a
  // decimal separator, not a digit to be dropped - "5,5" must stay 5.5 mmol/L
  // and never become 55.
  const glucoseTyped = useMemo(() => parseDecimalText(glucose), [glucose]);

  const glucoseMgdl = useMemo(() => {
    return glucoseTyped != null && glucoseTyped > 0
      ? glucoseFromDisplay(glucoseTyped, unit)
      : null;
  }, [glucoseTyped, unit]);

  // Descriptive only: a reading past what a consumer meter reports is still
  // accepted and stored, it just gets said out loud.
  const glucoseAboveMeterRange = glucoseAboveCeiling(glucoseTyped, unit);

  // What the manual dose field reads right now. null = EMPTY, which is not the
  // same as 0: 0 is the user stating they injected nothing.
  const typedDose = useMemo(() => parseDecimalText(doseText), [doseText]);

  const glucoseStatus =
    glucoseMgdl != null && activeProfile
      ? classifyGlucose(glucoseMgdl, "pre_meal", activeProfile)
      : null;

  const glucoseBounds = glucoseEntryBounds(unit);
  const glucoseOffer =
    !isEdit && glucose === "" ? recentGlucoseSuggestion(latestReading ? [latestReading] : null, new Date()) : null;

  function useOfferedGlucose() {
    const offer = recentGlucoseSuggestion(latestReading ? [latestReading] : null, new Date());
    if (!offer) return;
    hapticSelect();
    setDirty(true);
    setGlucose(String(glucoseToDisplay(offer.mgdl, unit)));
  }

  /** The glucose card, identical on the loading and loaded screens. */
  function glucoseCard() {
    return (
      <GlassCard style={{ marginBottom: 10 }}>
        <View className="flex-row items-center justify-between" style={{ marginBottom: 8, gap: 8 }}>
          <Text
            style={{ color: THEME.textMuted, fontSize: 11, letterSpacing: 1.3, fontWeight: "800", flex: 1 }}
          >
            {upper(t("calculator.currentGlucose"))}
          </Text>
          {glucoseStatus ? (
            <GlucoseChip
              status={glucoseStatus}
              dot={false}
              label={
                glucoseStatus === "normal"
                  ? t("insights.inRange")
                  : glucoseStatus === "low"
                    ? t("insights.low")
                    : glucoseStatus === "veryHigh"
                      ? t("insights.veryHigh")
                      : t("insights.high")
              }
            />
          ) : null}
        </View>
        <NumericField
          value={glucoseTyped}
          onChange={onGlucoseChange}
          onValidityChange={stepperFields.reporter("glucose")}
          decimals={glucoseBounds.decimals}
          min={glucoseBounds.min}
          max={glucoseBounds.max}
          maxLength={unit === "mmol" ? 4 : 3}
          placeholder={t(unit === "mmol" ? "numeric.glucoseExampleMmol" : "numeric.glucoseExampleMgdl")}
          suffix={glucoseUnitLabel(unit)}
          accessibilityLabel={t("calculator.currentGlucose")}
          valueColor={glucoseStatus ? RICH_BY_STATUS[glucoseStatus] : undefined}
        />
        {glucoseOffer ? (
          <Pressable
            onPress={useOfferedGlucose}
            accessibilityRole="button"
            accessibilityLabel={t("calculator.glucoseOffer", {
              value: formatGlucose(glucoseOffer.mgdl, unit),
              unit: glucoseUnitLabel(unit),
            })}
            hitSlop={6}
            style={{ minHeight: 36, justifyContent: "center", marginTop: 4 }}
          >
            <Text style={{ color: THEME.accent, fontSize: 13, fontWeight: "600" }}>
              {t("calculator.glucoseOffer", {
                value: formatGlucose(glucoseOffer.mgdl, unit),
                unit: glucoseUnitLabel(unit),
              })}
            </Text>
          </Pressable>
        ) : null}
      </GlassCard>
    );
  }

  /** The dose field: 0-100 units in steps of 0.5, empty until the user fills it. */
  function doseField(marginBottom: number) {
    return (
      <NumericField
        value={typedDose}
        onChange={onDoseChange}
        onValidityChange={stepperFields.reporter("dose")}
        decimals={DOSE_BOUNDS.decimals}
        min={DOSE_BOUNDS.min}
        max={DOSE_BOUNDS.max}
        step={DOSE_BOUNDS.step}
        longStep={1}
        suffix={t("common.units")}
        accessibilityLabel={t("calculator.manualDose")}
        style={{ marginBottom }}
      />
    );
  }

  // The correction aims at the MIDDLE of the post-meal range, and the screen
  // says so in words right under the number.
  const correctionTarget = activeProfile
    ? targetMidpoint(targetRangeFor("post_meal_2h", activeProfile))
    : null;

  // "What is this based on?" explanation for the active-insulin figure below:
  // names the selected bolus product and its typical duration, or says a
  // generic profile is in use, plus any still-active basal. Shared copy with
  // the dashboard's own IOB tooltip (iob.* keys).
  const iobTooltipText = useMemo(() => {
    const bolusProduct = insulinProductById(activeProfile?.bolus_insulin_id);
    const parts = [
      t("iob.basisText"),
      bolusProduct
        ? t("iob.productText", {
            product: bolusProduct.label,
            hours: num(bolusProduct.durationHours),
          })
        : t("iob.genericText"),
    ];
    if (basalIob > 0) parts.push(t("iob.basalActive", { value: num(basalIob) }));
    parts.push(t("iob.personalNote"));
    return parts.join("\n\n");
  }, [activeProfile?.bolus_insulin_id, basalIob, t]);

  // Carbs need no ratio. The unit estimate exists only behind the confirmation
  // gate (lib/calcSetup.ts calcFiguresAllowed): null means no figure is computed.
  const carbsG = food ? carbsForPortion(food, portion) : null;
  const estimate = useMemo(() => {
    if (!food || !activeProfile) return null;
    return estimateInsulinConfirmed(food, portion, activeProfile, {
      slot,
      currentGlucose: glucoseMgdl,
      currentIOB: iob,
    });
  }, [food, activeProfile, portion, slot, glucoseMgdl, iob]);

  // The RAW stored ratio (not estimateInsulin's own 0.1 floor - that floor
  // only guards its division and is never a real setting): a missing/zero
  // ratio makes the meal-dose arithmetic meaningless, so the hero and its
  // breakdown are replaced below rather than showing a number built on it.
  const rawCarbRatio = activeProfile ? carbRatioForSlot(activeProfile, slot) : null;
  const carbRatioValid =
    calcFiguresAllowed(activeProfile) &&
    estimate != null &&
    rawCarbRatio != null &&
    Number.isFinite(rawCarbRatio) &&
    rawCarbRatio > 0;

  async function pickPhoto(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.5 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.5 });

    if (result.canceled || !result.assets?.[0]) return;
    const src = result.assets[0].uri;
    setDirty(true);
    // Copy into the app sandbox for fully-offline persistence.
    try {
      const dest = `${FileSystem.documentDirectory}meal_${Date.now()}.jpg`;
      await FileSystem.copyAsync({ from: src, to: dest });
      setPhoto(dest);
    } catch {
      setPhoto(src);
    }
  }

  function choosePhoto() {
    actionSheet({
      title: t("calculator.addPhoto"),
      actions: [
        {
          label: t("calculator.takePhoto"),
          icon: "camera-outline",
          onPress: () => pickPhoto(true),
        },
        {
          label: t("calculator.choosePhoto"),
          icon: "images-outline",
          onPress: () => pickPhoto(false),
        },
      ],
    });
  }

  /**
   * router.back() is a no-op when this modal is the only route on the stack
   * (scan reaches it via replace(), so a scan that was itself the entry point
   * leaves nothing to pop). That stranded the user in a modal that had already
   * saved and then refused to close. The food tab is the fallback: it closes
   * the modal and lands where the new entry is visible.
   */
  function dismiss() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/food");
  }

  /** The header close button: a photo, note, tag or typed dose the user just
   *  added has nowhere else to live if this screen closes without saving, so
   *  leaving un-warned would silently drop it. Nothing to lose (dirty still
   *  false) closes at once, same as before. */
  async function handleClose() {
    if (dirty) {
      const proceed = await confirm({
        title: t("calculator.discardTitle"),
        message: t("calculator.discardBody"),
        confirmLabel: t("calculator.discardConfirm"),
        destructive: true,
        icon: "close-circle-outline",
      });
      if (!proceed) return;
    }
    dismiss();
  }

  /**
   * The same two-stage plausibility gate the Injection tab uses. It runs BEFORE
   * anything is written, because this screen creates a real injection row: a
   * dose that would need confirming when typed by hand must need confirming
   * here too. Declining cancels the whole record, not just the injection.
   */
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

  async function logMeal() {
    if (!food || !activeProfile || saving || !stepperFields.allValid) return;

    // Locked before the confirmation dialog, not after it: the CTA is disabled
    // while `saving`, and a second tap during the dialog would otherwise start a
    // parallel save.
    setSaving(true);
    try {
      // Active insulin decays by the minute, so the figure the save is built on
      // is re-read here rather than trusted from whenever the screen opened.
      const freshIob = await readFreshIob();
      const est = estimateInsulinConfirmed(food, portion, activeProfile, {
        slot,
        currentGlucose: glucoseMgdl,
        currentIOB: freshIob,
      });
      const mealCarbs = carbsForPortion(food, portion);

      // The typed dose is the record of what the user actually injected, so it is
      // never overwritten by the estimate: a typed 0 means "no insulin" and is
      // stored as 0. Falling back to the estimated total on a falsy parse turned
      // that declaration into a phantom bolus and left active-insulin tracking
      // wrong for hours. An EMPTY field is not a value at all, so the save says
      // what it is about to store before it writes anything.
      let dose: number;
      if (!showsDose) {
        dose = 0;
      } else if (typedDose == null) {
        // Without a usable ratio est.totalDose is built on the defensive 0.1
        // floor (lib/insulin.ts), not a real setting - the dialog drops the
        // number rather than cite it.
        const proceed = await confirm({
          title: t("calculator.emptyDoseTitle"),
          message: carbRatioValid && est
            ? t("calculator.emptyDoseBody", { n: num(est.totalDose) })
            : t("calculator.doseZeroNote"),
          confirmLabel: t("calculator.emptyDoseConfirm"),
          icon: "help-circle-outline",
        });
        if (!proceed) return;
        dose = 0;
      } else {
        dose = typedDose;
      }
      // Gate first: nothing at all is written until an unusual dose is confirmed.
      if (dose > 0 && !(await confirmDose(dose))) return;

      const loggedIso = loggedAt ? loggedAt.toISOString() : undefined;
      const at = loggedAt ?? new Date();

      // The region for the bolus row below, if the user picked one (see
      // renderDetails' site picker). Untouched stays null, same as a dose of 0
      // writes no row at all - a place the user never actually chose must never
      // land in a health record as if it had been.
      const chosenSite = siteTouched ? site : null;
      const chosenPoint = siteTouched ? point : null;

      // The bolus row this meal already owns, read once up front so both the
      // guard below and the update branch further down share it - editing a
      // meal never has two separate reads of the same row racing each other.
      const existingInjectionForEdit =
        isEdit && mealLogId ? await getCalculatorInjectionForMeal(mealLogId) : null;

      // Duplicate-entry check (lib/entryGuard.ts), before anything is written.
      // Meal and bolus are each their own entry kind, so this is two sequential
      // confirms at most - the second only runs once the first is accepted -
      // never a stacked pair for the same save. A catalogue food's own id is
      // the comparison key; a typed name or a template has no id (foodFromMeal
      // / foodFromTemplate both leave it ""), so its own name stands in,
      // normalized the same way listRecentMealLogs compares it. In EDIT mode
      // each guard call excludes ITS OWN record only - the meal call excludes
      // the meal row, the bolus call excludes the linked injection row - so
      // correcting one type never gets flagged as a duplicate of itself, and
      // never on the other type's behalf either.
      const foodKeyForGuard = food.id || foodName(food, lang).trim().toLowerCase();
      if (
        !(await guardEntry({
          entryKind: "meal",
          entryAtIso: loggedIso,
          foodKey: foodKeyForGuard,
          foodName: foodName(food, lang),
          excludeId: isEdit && mealLogId ? mealLogId : null,
        }))
      ) {
        return;
      }
      if (
        dose > 0 &&
        !(await guardEntry({
          entryKind: "injection",
          insulinType: "bolus",
          entryAtIso: loggedIso,
          excludeId: existingInjectionForEdit?.id ?? null,
        }))
      ) {
        return;
      }

      if (isEdit && mealLogId) {
        // Correcting an existing record: no post-meal reminder and no review
        // nudge, but every row this meal owns has to move with it. Leaving the
        // linked bolus at its old value would keep active insulin wrong for
        // hours, which is exactly the coupling the auto-write exists to fix.
        await updateMealLog(mealLogId, {
          portion_g: portion,
          calculated_carbs_g: mealCarbs,
          insulin_dose_units: dose,
          photo_uri_local: photo,
          personal_note: note.trim() || null,
          tags,
          ...(loggedAt ? { logged_at: loggedAt.toISOString() } : {}),
        });

        const existingInjection = existingInjectionForEdit;
        if (dose > 0) {
          if (existingInjection) {
            await updateInjection(existingInjection.id, {
              dose_units: dose,
              insulin_type: "bolus",
              site: chosenSite,
              site_point: chosenPoint,
              tags,
              ...(loggedAt ? { logged_at: loggedAt.toISOString() } : {}),
            });
          } else {
            await logInjection({
              profile_id: activeProfile.id,
              site: chosenSite,
              site_point: chosenPoint,
              dose_units: dose,
              insulin_type: "bolus",
              meal_log_id: mealLogId,
              source: "calculator",
              tags,
              logged_at: loggedIso,
            });
          }
        } else if (existingInjection) {
          // The dose was cleared, so the injection it stood for is gone too.
          await deleteInjection(existingInjection.id);
        }

        // A corrected glucose value belongs on the reading this meal is already
        // attached to, not on a second row. Clearing the field leaves the
        // reading alone: a measurement is not deleted because a field went blank.
        //
        // logged_at is included only when the user actually moved the time
        // picker off what it was prefilled with. The reading's own logged_at
        // can legitimately differ from the meal's (it may have been taken a
        // few minutes apart), and every save - even one that only touched the
        // dose or a tag - passed through here with the untouched prefill value
        // and overwrote it to match the meal every time.
        const loggedAtChanged =
          loggedAt != null &&
          prefillLoggedAtRef.current != null &&
          loggedAt.getTime() !== prefillLoggedAtRef.current.getTime();
        if (linkedSugarLogId && glucoseMgdl != null) {
          await updateSugarLog(linkedSugarLogId, {
            glucose_level_mgdl: glucoseMgdl,
            ...(loggedAtChanged ? { logged_at: loggedIso } : {}),
          });
          // A previously mirrored reading must not keep its stale value in
          // Apple Health after a correction here.
          void (async () => {
            try {
              // With the mirror off the old sample and its link stay as they are.
              const row = await getSugarLog(linkedSugarLogId);
              if (!row) return;
              if (!(await getHealthWriteEnabled(row.profile_id))) return;
              // Not gated on row.healthkit_uuid: the reading's first write can
              // still be in flight. updateGlucoseInHealth decides inside the
              // row lock, writes the stored values and links the result itself.
              const res = await updateGlucoseInHealth(
                linkedSugarLogId,
                row.healthkit_uuid ?? null,
                // X7: the row's OWN owner, not the active profile.
                row.profile_id
              );
              if (res.failed && shouldAnnounceHealthWriteFailure()) {
                toast(t("dashboard.healthWriteFailed", { health: HEALTH_NAME }), "info");
              }
            } catch {
              // the local edit must never fail because the mirror did
            }
          })();
        } else if (!linkedSugarLogId && glucoseMgdl != null) {
          // R10 1.3: the meal had no reading attached, but one was typed while
          // editing it, and it was silently discarded before. Same dedup as a fresh
          // save (reuse a measurement logged minutes ago instead of doubling it),
          // then link the result so it stops disappearing on save.
          const existingReading = await findMatchingSugarLog(
            activeProfile.id,
            glucoseMgdl,
            at
          );
          let newSugarLogId: string;
          if (existingReading) {
            newSugarLogId = existingReading.id;
          } else {
            const sugar = await addSugarLog({
              profile_id: activeProfile.id,
              glucose_level_mgdl: glucoseMgdl,
              period_tag: "pre_meal",
              tags,
              logged_at: loggedIso,
            });
            void writeGlucoseToHealthIfEnabled(sugar).then((ok) => {
              if (!ok && shouldAnnounceHealthWriteFailure()) {
                toast(t("dashboard.healthWriteFailed", { health: HEALTH_NAME }), "info");
              }
            });
            newSugarLogId = sugar.id;
          }
          await updateMealLog(mealLogId, { sugar_log_id: newSugarLogId });
        }

        logEvent("log_edited", { kind: "meal" });
        hapticSuccess();
        bumpData();
        dismiss();
        return;
      }

      // The glucose typed here is a real reading the user took. Before v8 it was
      // used for the correction and then discarded (meal_logs.sugar_log_id was
      // always null), so it never appeared in the journal, the averages or the
      // export. Persist it and link it to the meal.
      //
      // But only if it is genuinely new: a user who logged this reading on the
      // dashboard a minute ago and then typed the same number here would
      // otherwise get two identical rows, double-counted in every average and in
      // the doctor's export. Same value within a few minutes = same measurement.
      let sugarLogId: string | null = null;
      let createdSugarLogId: string | null = null;
      if (glucoseMgdl != null) {
        const existingReading = await findMatchingSugarLog(
          activeProfile.id,
          glucoseMgdl,
          at
        );
        if (existingReading) {
          sugarLogId = existingReading.id;
        } else {
          const sugar = await addSugarLog({
            profile_id: activeProfile.id,
            glucose_level_mgdl: glucoseMgdl,
            period_tag: "pre_meal",
            tags,
            logged_at: loggedIso,
          });
          // Opt-in Apple Health mirror (H1); no-op unless the user enabled it.
          // A genuine failure gets one immediate toast, capped per session by
          // shouldAnnounceHealthWriteFailure (the same signal the dashboard's
          // own manual-sync toast and the foreground/sync retry both key off).
          void writeGlucoseToHealthIfEnabled(sugar).then((ok) => {
            if (!ok && shouldAnnounceHealthWriteFailure()) {
              toast(t("dashboard.healthWriteFailed", { health: HEALTH_NAME }), "info");
            }
          });
          sugarLogId = sugar.id;
          createdSugarLogId = sugar.id;
        }
      }

      // A template saves as ONE row named after the recipe, carrying its summed
      // portion and the id it came from. The synthetic food has no catalogue row
      // behind it, so food_id stays null and the name is stored on the meal.
      const meal = await addMealLog({
        profile_id: activeProfile.id,
        food_id: templateCtx ? null : food.id,
        custom_food_name: templateCtx ? templateCtx.template.name : null,
        portion_g: templateCtx ? templateCtx.portion_g : portion,
        calculated_carbs_g: mealCarbs,
        insulin_dose_units: dose,
        sugar_log_id: sugarLogId,
        photo_uri_local: photo,
        personal_note: note.trim() || null,
        tags,
        logged_at: loggedIso,
        meal_template_id: templateCtx ? templateCtx.template.id : null,
      });
      // From here on the meal row EXISTS. Everything below is a side effect, and
      // none of it may keep the screen open: an exception between the write and
      // dismiss() left the user staring at a modal that had already saved and
      // would not close, with no way to tell it had worked.
      try {
        if (templateCtx)
          await touchTemplate(templateCtx.template.id, meal.logged_at);
      } catch (err) {
        logCrash(err, { screen: "calculator", step: "touchTemplate" });
      }
      logEvent("log_added", { kind: "meal" });
      void noteFirstLog("meal");

      // SAFETY: the dose has to land in injection_logs, not only on the meal row.
      // IOB is computed from bolus injections, so a dose recorded on the meal
      // alone left active insulin reading 0 for anyone logging through this
      // screen - which is the main flow - and silently disabled the entire
      // anti-stacking protection. The row is marked source='calculator' so the
      // injection tab can show it as already logged rather than inviting a
      // duplicate, and it stays fully editable there.
      let wroteInjection = false;
      if (showsDose && dose > 0) {
        try {
          await logInjection({
            profile_id: activeProfile.id,
            site: chosenSite,
            site_point: chosenPoint,
            dose_units: dose,
            insulin_type: "bolus",
            meal_log_id: meal.id,
            source: "calculator",
            tags,
            logged_at: loggedIso,
          });
          wroteInjection = true;
        } catch (err) {
          // The dose still lives on the meal row, so nothing the user typed is
          // lost. wroteInjection stays false, which downgrades the toast to the
          // plain "entry saved" wording instead of claiming a bolus row exists.
          logCrash(err, { screen: "calculator", step: "logInjection" });
        }
      }

      // The reading and the dose this save wrote are entries of their own kind
      // too, though log_added stays one event per save.
      if (createdSugarLogId) void noteFirstLog("glucose");
      if (wroteInjection) void noteFirstLog("injection");

      void noteLog();
      void noteJournalActivity();
      hapticSuccess();
      // Logging a meal asks the post-meal service to schedule the 2-hour glucose
      // check; schedulePostMealReminder (lib/services/notifications.ts) makes the
      // actual call, in one place for every meal-logging path: a running timer is
      // left untouched, and an idle one only arms for a record close to now - a
      // backdated entry (writing up last night's dinner) does not start a
      // countdown relative to right now for a meal that already happened.
      // Best effort on purpose: scheduleNotificationAsync throws on a device
      // that refuses the schedule, and an unavailable REMINDER must never cost
      // the user a saved MEAL or trap them in this modal.
      try {
        await schedulePostMealReminder(loggedAt);
      } catch (err) {
        logCrash(err, { screen: "calculator", step: "postMealReminder" });
      }
      bumpData();

      // ONE undo for the whole record. Undoing "the injection" while the meal
      // and its dose stayed behind left the user with a half-reverted entry they
      // had no way to finish reverting; this takes back exactly what the save
      // created. A reading that already existed is never touched, because the
      // save did not create it.
      const mealId = meal.id;
      const mealProfileId = meal.profile_id;
      const mealTemplateId = meal.meal_template_id;
      const mealLoggedAtMs = new Date(meal.logged_at).getTime();
      const createdReading = createdSugarLogId;
      // A region was picked or not - the toast says which, since "edit it on the
      // Injection tab" reads as a correction prompt when there is nothing wrong,
      // and silence about a missing region reads as if one was recorded.
      const message = wroteInjection
        ? chosenSite
          ? t("calculator.autoInjection")
          : t("calculator.autoInjectionNoSite")
        : createdReading
          ? t("calculator.autoGlucose")
          : t("calculator.savedRecord");
      toast(message, "success", {
        label: t("common.undo"),
        onPress: () => {
          void (async () => {
            // Undo also revokes the Apple Health mirror of the reading this save
            // created (best-effort): the local row is gone, so leaving the sample
            // in Health would strand a reading the user just took back.
            const mirrored = await deleteMealRecord(mealId, createdReading);
            if (createdReading) void deleteGlucoseRowFromHealth(createdReading, mirrored);
            // The save a moment ago is what armed the post-meal countdown
            // (schedulePostMealReminder above), so taking the record back has
            // to take that countdown back too - otherwise the dashboard counts
            // down to a check on a meal the user just undid. Same shared
            // cleanup as every other delete path (lib/afterDelete.ts); no undo
            // is offered on an undo, so its report is not kept.
            await applyAfterDelete([
              {
                id: mealId,
                profileId: mealProfileId,
                loggedAtMs: mealLoggedAtMs,
                templateId: mealTemplateId,
              },
            ]);
            bumpData();
            toast(t("calculator.undone"), "info");
          })();
        },
      });
      dismiss();
      if (glucoseStatus !== "low") void maybeRequestReview("log_saved");
    } catch (err) {
      // Only reachable while the record is still unwritten, so staying on the
      // screen is right - but it used to stay in silence, with the button simply
      // doing nothing and no way to tell whether anything had been saved.
      logCrash(err, { screen: "calculator", step: "save" });
      toast(t("calculator.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Destructive delete of an already-saved meal, edit mode only. Same confirm
   * copy and undo toast as the glucose/injection/med edit sheets
   * (journal.deleteEntry, common.delete/cancel, trash-outline, destructive).
   *
   * captureDeletion("meal", ...) + deleteMealLog, NOT deleteMealRecord: that
   * helper is undo's own "revert the record THIS save just created" step and
   * would also remove a glucose reading the user had logged before this meal
   * ever existed. deleteMealLog only removes the meal and the calculator
   * bolus it owns, and the snapshot restores both on undo.
   */
  async function deleteMeal() {
    if (!isEdit || !mealLogId || saving) return;
    const ok = await confirm({
      message: t("journal.deleteEntry"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
      icon: "trash-outline",
    });
    if (!ok) return;

    setSaving(true);
    try {
      const snapshot = await captureDeletion("meal", mealLogId);
      await deleteMealLog(mealLogId);
      // The SAME post-delete cleanup the journal rows run (lib/afterDelete.ts):
      // a countdown this meal armed must not outlive it here either, and the
      // undo below puts both the rows and that countdown back.
      const aftermath = await applyAfterDeleteFromSnapshot(snapshot);
      bumpData();
      toast(t("journal.deleted"), "success", {
        label: t("common.undo"),
        onPress: () => {
          void (async () => {
            await restoreDeletion(snapshot);
            await undoAfterDelete(aftermath);
            bumpData();
            toast(t("calculator.undone"), "info");
          })();
        },
      });
      dismiss();
    } catch (err) {
      logCrash(err, { screen: "calculator", step: "delete" });
      toast(t("calculator.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  }

  /** The lower "Details" block: slot, logged time, photo, note, tags and the
   *  disclaimer. None of it reads `food`/`estimate` - it is the SAME state
   *  the loaded screen below reads - so the loading skeleton calls this exact
   *  function too: nothing here ever moves when the food card above it swaps
   *  from a skeleton to real content. */
  function renderDetails() {
    // Meaningful only once a dose will actually be written (showsDose && dose >
    // 0): with no dose, this screen writes no injection row at all, so a region
    // for one would describe a record that does not exist. The ROW itself still
    // renders whenever showsDose does, just inert - `dose` flips through
    // empty/0/positive on every keystroke while the user types it, and hiding
    // the whole block on that same flicker is exactly the layout jump the rest
    // of this form avoids. Disabled here, not unmounted.
    const doseActive = typedDose != null && typedDose > 0;
    const siteSummaryLabel = siteTouched
      ? point != null
        ? t("injection.siteWithPoint", { site: t(`injectionSite.${site}`), n: point })
        : t(`injectionSite.${site}`)
      : t("injection.chooseSitePoint");
    // Only a fully touched region+point counts as "selected" for the modal's
    // silhouette; a legacy row with a site but no point (see
    // getCalculatorInjectionForMeal's prefill) has nothing to highlight there.
    const siteModalSelection: PointSelection | null =
      siteTouched && point != null ? { site, point } : null;

    return (
      <>
        <DetailLabel>{t("calculator.activeSlot")}</DetailLabel>
        <Segmented
          options={SLOTS.map((s) => ({ value: s, label: t(`slot.${s}`) }))}
          value={slot}
          onChange={(v) => {
            setSlot(v);
            setSlotTouched(true);
          }}
          className="mb-4"
        />

        <DetailLabel>{t("calculator.loggedTime")}</DetailLabel>
        <Pressable
          onPress={() => setTimePickerOpen((v) => !v)}
          className="flex-row items-center mb-4"
          style={inputStyle()}
        >
          <Ionicons name="time-outline" size={16} color={THEME.textMuted} />
          <Text style={{ color: THEME.text, marginLeft: 8, fontSize: 13 }}>
            {relativeDay((loggedAt ?? new Date()).toISOString(), {
              today: t("common.today"),
              yesterday: t("common.yesterday"),
            })}
            {" · "}
            {formatTime((loggedAt ?? new Date()).toISOString())}
          </Text>
        </Pressable>
        <InlineDateTimePicker
          visible={timePickerOpen}
          value={loggedAt ?? new Date()}
          max={new Date()}
          locale={lang}
          onChange={setLoggedAt}
          onClose={() => setTimePickerOpen(false)}
        />

        {showsDose ? (
          <>
            <DetailLabel>{t("injection.selectSite")}</DetailLabel>
            <View className="flex-row items-center mb-2" style={{ gap: 8 }}>
              <Pressable
                onPress={() => {
                  hapticSelect();
                  setSiteModalOpen(true);
                  void ensureSiteUsageLoaded();
                }}
                disabled={!doseActive}
                accessibilityRole="button"
                accessibilityState={{ selected: siteTouched, disabled: !doseActive }}
                accessibilityLabel={siteSummaryLabel}
                className="flex-row items-center flex-1"
                style={[inputStyle(), { minHeight: 44, opacity: doseActive ? 1 : 0.45 }]}
              >
                <Ionicons
                  name="location-outline"
                  size={16}
                  color={siteTouched ? THEME.accent : THEME.textMuted}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    color: siteTouched ? THEME.text : THEME.textMuted,
                    marginLeft: 8,
                    fontSize: 13,
                    flex: 1,
                  }}
                >
                  {siteSummaryLabel}
                </Text>
                <DirIcon name="chevron-forward-outline" size={16} color={THEME.textMuted} />
              </Pressable>
              {siteTouched ? (
                <Pressable
                  onPress={() => {
                    hapticSelect();
                    setSiteTouched(false);
                    setSite(SELECTABLE_SITES[0]);
                    setPoint(null);
                  }}
                  disabled={!doseActive}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t("common.delete")}
                  style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name="close-circle-outline" size={18} color={THEME.textMuted} />
                </Pressable>
              ) : null}
            </View>

            {/* Rotation hint: a single line, applied with one tap, no modal
                needed. Only shown once a dose is actually active, same gate as
                the row above so it never suggests a site for a record that
                will not be written - and only to Pro (isProUser), since the
                underlying suggestion is a Pro feature on the Injection tab.
                Region/point picking itself (the modal below) stays open to
                everyone; only the "which point to prefer" suggestion is Pro,
                so a non-Pro user gets no paywall card here, just no hint. */}
            {doseActive && isProUser && siteSuggestion ? (
              <Pressable
                onPress={() => {
                  hapticSelect();
                  setSite(siteSuggestion.site);
                  setPoint(siteSuggestion.point);
                  setSiteTouched(true);
                }}
                accessibilityRole="button"
                hitSlop={6}
                className="flex-row items-center mb-4"
              >
                <Ionicons name="sync-outline" size={13} color={THEME.accent} />
                <Text style={{ color: THEME.accent, fontSize: 11, marginLeft: 6, flex: 1 }} numberOfLines={1}>
                  {t("injection.leastUsedPoint")}
                  {" · "}
                  {t("injection.siteWithPoint", {
                    site: t(`injectionSite.${siteSuggestion.site}`),
                    n: siteSuggestion.point,
                  })}
                </Text>
              </Pressable>
            ) : null}

            <SitePickerModal
              visible={siteModalOpen}
              onClose={() => setSiteModalOpen(false)}
              usage={siteUsage}
              noSiteCount={siteNoSiteCount}
              selected={siteModalSelection}
              showRotationHint={isProUser}
              onSelect={(selection) => {
                setSite(selection.site);
                setPoint(selection.point);
                setSiteTouched(true);
                setDirty(true);
                setSiteModalOpen(false);
              }}
            />
          </>
        ) : null}

        {photo ? (
          <View className="mb-4">
            <Image source={{ uri: photo }} className="w-full h-44 rounded-2xl" />
            <Pressable
              onPress={() => {
                setPhoto(null);
                setDirty(true);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t("common.delete")}
              className="absolute top-2 right-2 rounded-full p-1.5"
              style={{ backgroundColor: SCRIM }}
            >
              <Ionicons name="trash-outline" size={16} color={GLUCOSE_RICH.low} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={choosePhoto}
            className="flex-row items-center justify-center rounded-2xl py-4 mb-4"
            style={{ borderWidth: 1, borderStyle: "dashed", borderColor: THEME.border }}
          >
            <Ionicons name="camera-outline" size={18} color={THEME.textMuted} />
            <Text style={{ color: THEME.textMuted, marginLeft: 8 }}>
              {t("calculator.addPhoto")}
            </Text>
          </Pressable>
        )}

        <DetailLabel>{t("calculator.personalNote")}</DetailLabel>
        <TextInput
          value={note}
          onChangeText={(s) => {
            setNote(s);
            setDirty(true);
          }}
          placeholder={t("calculator.notePlaceholder")}
          placeholderTextColor={withAlpha(THEME.textMuted, 0.7)}
          multiline
          style={[inputStyle(), INPUT_TEXT, { marginBottom: 16, minHeight: 72 }]}
          textAlignVertical="top"
        />

        <TagPicker
          value={tags}
          onChange={(v) => {
            setTags(v);
            setDirty(true);
          }}
          className="mb-5"
        />

        <NoticeCard
          icon="medical-outline"
          tint={GLUCOSE_RICH.high}
          body={t("disclaimer.short")}
        />
      </>
    );
  }

  // Mounted on both branches below at the same position (after the host), so
  // React keeps one instance across the skeleton-to-loaded swap instead of
  // dismissing and re-presenting a sheet that is already on screen.
  const setupInitial = ratioFieldsInitial(activeProfile);
  const calcSetupSheet = showsDose ? (
    <CalcSetupSheet
      visible={setupOpen}
      onClose={closeSetup}
      onFinish={finishSetup}
      onConfirmed={() => {
        setSetupOpen(false);
        setSetupSaveError(false);
      }}
      getWriter={ratioWriters.get}
      saveError={setupSaveError}
      unit={unit}
      initial={setupInitial}
      prefilled={calcSetupPrefilled(activeProfile)}
    />
  ) : null;

  if (!food || carbsG == null || !activeProfile) {
    // The host lives on every branch, so anything this screen ever says lands
    // inside its own view controller rather than behind it.
    //
    // Only the food-derived pieces below (identity, the carb read-out, the
    // dose hero) are skeletons. The header title needs only isEdit/showsDose
    // (profile + route params, both already known); the portion and glucose
    // controls and renderDetails() read no food/estimate data at all, so they
    // are the real, interactive controls from the first frame and never
    // resize when the skeleton pieces are replaced by real content.
    return (
      <AppBackground>
        <View className="flex-1" style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
          <View className="flex-row items-center justify-between px-4 py-3">
            <Pressable
              onPress={handleClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
            >
              <IconTile icon="close" size={30} radius={10} tint={THEME.textMuted} />
            </Pressable>
            <Text style={{ color: THEME.text, fontSize: 16, fontWeight: "800" }} numberOfLines={1}>
              {isEdit
                ? t("calculator.editTitle")
                : showsDose
                  ? t("calculator.title")
                  : t("calculator.carbFocusTitle")}
            </Text>
            <View style={{ width: 30 }} />
          </View>

          <ScrollView
            {...keyboardAwareScrollProps}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 28 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Food identity */}
            <View className="flex-row items-center mb-3">
              <IconTile
                emoji={EMOJI_RENDERS ? "🍽️" : undefined}
                icon="restaurant-outline"
                size={34}
                radius={11}
                hero
                style={{ marginRight: 10 }}
              />
              <View className="flex-1">
                <Skeleton width="55%" height={17} />
                <View style={{ marginTop: 6 }}>
                  <Skeleton width="35%" height={11} />
                </View>
              </View>
            </View>

            {/* Read-out 1: carbohydrate, with the (real, interactive) portion
                slider under it - same container as ReadoutCard below. */}
            <GlassCard style={{ marginBottom: 10 }}>
              <View className="flex-row items-center justify-between">
                <Text
                  style={{ color: THEME.textMuted, fontSize: 11, letterSpacing: 1.3, fontWeight: "800", flex: 1 }}
                >
                  {upper(t("calculator.estCarbs"))}
                </Text>
                <View className="flex-row items-baseline" style={{ gap: 4 }}>
                  <Skeleton width={48} height={26} radius={6} />
                  <Text style={{ color: THEME.textMuted, fontSize: 12 }}>{t("common.grams")}</Text>
                </View>
              </View>
              <View className="flex-row items-center justify-between mt-2" style={{ gap: 10 }}>
                <Text style={{ color: THEME.textMuted, fontSize: 11 }}>
                  {t("calculator.portion")}
                </Text>
                <NumericField
                  value={portion}
                  onChange={(v) => {
                    if (v != null) setPortion(v);
                  }}
                  required
                  decimals={0}
                  min={0}
                  max={1500}
                  step={5}
                  longStep={25}
                  suffix={t("common.grams")}
                  accessibilityLabel={t("calculator.portion")}
                  style={{ flex: 1, maxWidth: 240 }}
                />
              </View>
              <Slider
                minimumValue={0}
                maximumValue={500}
                step={5}
                value={Math.min(portion, 500)}
                onValueChange={setPortion}
                minimumTrackTintColor={THEME.accent}
                maximumTrackTintColor={THEME.track}
                thumbTintColor={THEME.accent}
                // RTL: the library fills min->max left-to-right regardless of
                // layout direction unless told otherwise; `inverted` flips the
                // fill/thumb rendering only - value and onValueChange keep the
                // same 0..500 meaning either way.
                inverted={I18nManager.isRTL}
              />
            </GlassCard>

            {glucoseCard()}

            {showsDose ? <CarbRatioLine slot={slot} returnAfterConfirm /> : null}

            {showsDose ? (
              activeProfile?.ratios_confirmed !== 1 ? (
                <PendingDoseCard />
              ) : !calcFiguresAllowed(activeProfile) ? null : (
              <View
                className="rounded-2xl p-4 mb-3"
                style={[
                  {
                    borderWidth: 1,
                    borderColor: withAlpha(THEME.accent, 0.45),
                    backgroundColor: withAlpha(THEME.accent, 0.12),
                  },
                  glow(THEME.accent, 28, 0.45),
                ]}
              >
                <Text
                  style={{ color: THEME.accent, fontSize: 11, letterSpacing: 1.3, fontWeight: "800" }}
                >
                  {upper(t("calculator.estimatedDose"))}
                </Text>

                <View className="items-center mt-1">
                  <Skeleton width={90} height={54} radius={10} />
                  <Text style={{ color: THEME.textMuted, fontSize: 12, marginTop: -2 }}>
                    {t("common.units")}
                  </Text>
                </View>

                <View className="mt-3" style={{ gap: 5 }}>
                  <View className="flex-row justify-between">
                    <Text style={{ color: THEME.textMuted, fontSize: 12 }}>
                      {t("calculator.mealDose")}
                    </Text>
                    <Skeleton width={48} height={14} />
                  </View>
                </View>
              </View>
              )
            ) : (
              <NoticeCard
                icon="information-circle-outline"
                tint={THEME.accent}
                title={t("calculator.carbFocusTitle")}
                body={
                  insulinMode === "basal"
                    ? t("calculator.carbFocusBodyBasal")
                    : t("calculator.carbFocusBody")
                }
              />
            )}

            {showsDose ? (
              <>
                <NoticeCard
                  icon="medical-outline"
                  tint={GLUCOSE_RICH.high}
                  body={t("calculator.calcNotAdvice")}
                />

                <DetailLabel>{t("calculator.manualDose")}</DetailLabel>
                {doseField(typedDose == null || typedDose === 0 ? 10 : 16)}
              </>
            ) : null}

            {renderDetails()}

            <GradientCTA
              label={
                isEdit
                  ? t("calculator.saveChanges")
                  : showsDose
                    ? t("calculator.saveMealAndDose")
                    : t("calculator.logMeal")
              }
              disabled
              onPress={() => {}}
            />
          </ScrollView>
        </View>
        <FeedbackHost />
        {calcSetupSheet}
      </AppBackground>
    );
  }

  // Non-null only behind the confirmation gate and a usable slot ratio.
  const doseEst = carbRatioValid ? estimate : null;
  const heroDose = doseEst
    ? doseEst.totalDose === 0 && (doseEst.mealDose > 0 || doseEst.correctionDose > 0)
      ? "< 0.5"
      : num(doseEst.totalDose)
    : null;

  return (
    <AppBackground>
      <View className="flex-1" style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
        {/* Header (mockup B04: close, centred title, balancing spacer) */}
        <View className="flex-row items-center justify-between px-4 py-3">
          <Pressable
            onPress={handleClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <IconTile icon="close" size={30} radius={10} tint={THEME.textMuted} />
          </Pressable>
          <Text style={{ color: THEME.text, fontSize: 16, fontWeight: "800" }} numberOfLines={1}>
            {isEdit
              ? t("calculator.editTitle")
              : showsDose
                ? t("calculator.title")
                : t("calculator.carbFocusTitle")}
          </Text>
          <View style={{ width: 30 }} />
        </View>

        <ScrollView
          {...keyboardAwareScrollProps}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 28 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Food identity, kept compact so the read-outs stay the hero. Same
              per-dish plate as the catalogue's own browse row (FoodRow) -
              resolveFoodEmoji's food.emoji-over-emojiFor priority - so a food
              does not change appearance between picking it and logging it. */}
          <View className="flex-row items-center mb-3">
            <FoodIconTile food={food} size={34} radius={11} style={{ marginRight: 10 }} />
            <View className="flex-1">
              <Text style={{ color: THEME.text, fontSize: 15, fontWeight: "800" }} numberOfLines={1}>
                {foodName(food, lang)}
              </Text>
              {/* The synthetic template food has no real per-100 g value (it is the
                  total), so printing one here would read as a measured figure. */}
              <Text style={{ color: THEME.textMuted, fontSize: 11 }}>
                {templateCtx ? (
                  t("templates.itemCount", { count: templateCtx.items.length })
                ) : (
                  <>
                    {num(food.carb_100g)} {t("common.grams")}/100g
                    {/* A barcode result carries no glycemic index; showing "GI 0"
                        would read as a measured zero rather than "not stated". */}
                    {food.glycemic_index > 0
                      ? ` · ${t("food.gi")} ${food.glycemic_index} · ${t("food.gl")} ${food.glycemic_load}`
                      : ""}
                  </>
                )}
              </Text>
            </View>
          </View>
          {food.source ? (
            <Text style={{ color: THEME.textMuted, fontSize: 11, marginBottom: 10 }}>
              {t("food.dataSource", { source: foodSourceLabel(food.source) })}
              {" · "}
              {t("food.estimatedValues")}
            </Text>
          ) : null}

          {/* Read-out 1: carbohydrate, with the portion slider under it */}
          <ReadoutCard
            label={t("calculator.estCarbs")}
            value={num(carbsG)}
            suffix={t("common.grams")}
            note={choiceText(carbsG)}
          >
            {/* A template has no single portion to drag: its carbs are the sum of its
                items, and one slider over the lot would silently rescale every one
                of them. The portions are edited where they live instead. */}
            {templateCtx ? (
              <View className="mt-2">
                <Text style={{ color: THEME.textMuted, fontSize: 11, lineHeight: 16 }}>
                  {t("templates.calcFromItems")}
                </Text>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/meal-template",
                      params: { templateId: templateCtx.template.id, mode: "log" },
                    })
                  }
                  hitSlop={8}
                  accessibilityRole="button"
                  className="flex-row items-center mt-2"
                >
                  <Ionicons name="options-outline" size={14} color={THEME.accent} />
                  <Text style={{ color: THEME.accent, fontSize: 12, marginLeft: 5 }}>
                    {t("templates.adjustAndLog")}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View className="flex-row items-center justify-between mt-2" style={{ gap: 10 }}>
                  <Text style={{ color: THEME.textMuted, fontSize: 11 }}>
                    {t("calculator.portion")}
                  </Text>
                  {/* Typeable / steppable so any gram value is reachable (e.g. 237 g,
                      or above the slider's 500 g coarse range up to 1500 g). */}
                  <NumericField
                  value={portion}
                  onChange={(v) => {
                    if (v != null) setPortion(v);
                  }}
                  onValidityChange={stepperFields.reporter("portion")}
                  required
                  decimals={0}
                  min={0}
                  max={1500}
                  step={5}
                  longStep={25}
                  suffix={t("common.grams")}
                  accessibilityLabel={t("calculator.portion")}
                  style={{ flex: 1, maxWidth: 240 }}
                />
                </View>
                {/* No presets for a custom-name entry (foodFromMeal/foodFromTemplate
                    stand in with id ""), so the chips just stay hidden there. */}
                {food.id ? (
                  <PortionPresetChips
                    foodId={food.id}
                    value={portion}
                    onPick={setPortion}
                    autoSelect={!isEdit && !(Number(portionParam) > 0)}
                    style={{ marginTop: 10 }}
                  />
                ) : null}
                {/* The slider stays a 0-500 g coarse control; typing can exceed it, so
                    clamp only its thumb, never the real portion. */}
                <Slider
                  minimumValue={0}
                  maximumValue={500}
                  step={5}
                  value={Math.min(portion, 500)}
                  onValueChange={setPortion}
                  minimumTrackTintColor={THEME.accent}
                  maximumTrackTintColor={THEME.track}
                  thumbTintColor={THEME.accent}
                  // RTL: the library fills min->max left-to-right regardless of
                  // layout direction unless told otherwise; `inverted` flips the
                  // fill/thumb rendering only - value and onValueChange keep the
                  // same 0..500 meaning either way.
                  inverted={I18nManager.isRTL}
                />
              </>
            )}
          </ReadoutCard>

          {glucoseCard()}

          {/* Descriptive notes about the READING itself. Neither is an alarm and
              neither instructs: they state what the number is, alongside the
              calculated estimate below. */}
          {glucoseStatus === "low" ? (
            <NoticeCard
              icon="information-circle-outline"
              tint={GLUCOSE_RICH.low}
              body={t("calculator.lowReadingNote")}
            />
          ) : null}
          {glucoseAboveMeterRange ? (
            <NoticeCard
              icon="information-circle-outline"
              tint={THEME.accent}
              body={t("calculator.glucoseAboveMeterRange", {
                max: num(GLUCOSE_INPUT_CEILING[unit]),
                unit: glucoseUnitLabel(unit),
              })}
            />
          ) : null}

          {showsDose ? (
            <>
              <CarbRatioLine slot={slot} returnAfterConfirm />

              {doseEst ? (
                <>
                  {/* Hero: the calculated number, glowing, with its provenance */}
                  <View
                    className="rounded-2xl p-4 mb-3"
                    style={[
                      {
                        borderWidth: 1,
                        borderColor: withAlpha(THEME.accent, 0.45),
                        backgroundColor: withAlpha(THEME.accent, 0.12),
                      },
                      glow(THEME.accent, 28, 0.45),
                    ]}
                  >
                    <Text
                      style={{
                        color: THEME.accent,
                        fontSize: 11,
                        letterSpacing: 1.3,
                        fontWeight: "800",
                      }}
                    >
                      {upper(t("calculator.estimatedDose"))}
                    </Text>

                    <View className="items-center mt-1">
                      <Text
                        style={[
                          TABULAR,
                          {
                            color: THEME.accent,
                            fontSize: 46,
                            lineHeight: 54,
                            fontWeight: "800",
                            textShadowColor: withAlpha(THEME.accent, 0.6),
                            textShadowRadius: 20,
                          },
                        ]}
                      >
                        {heroDose}
                      </Text>
                      <Text style={{ color: THEME.textMuted, fontSize: 12, marginTop: -2 }}>
                        {t("common.units")}
                      </Text>
                    </View>

                    {/* The arithmetic behind the figure, itemised */}
                    <View className="mt-3" style={{ gap: 5 }}>
                      <Breakdown
                        label={t("calculator.mealDose")}
                        value={`${num(doseEst.mealDose)} ${t("common.units")}`}
                      />
                      {doseEst.correctionDose > 0 ? (
                        <Breakdown
                          label={t("calculator.correctionDose")}
                          value={`${num(doseEst.correctionDose)} ${t("common.units")}`}
                        />
                      ) : null}
                      {iob > 0 ? (
                        <Breakdown
                          label={t("calculator.activeInsulin")}
                          value={`${num(iob)} ${t("common.units")}`}
                          tooltip={iobTooltipText}
                        />
                      ) : null}
                      {doseEst.iobReduction > 0 ? (
                        <Breakdown
                          label={t("calculator.iobReduction")}
                          value={`-${num(doseEst.iobReduction)} ${t("common.units")}`}
                          tint={GLUCOSE_RICH.target}
                        />
                      ) : null}
                    </View>

                    {/* The "adjust it yourself" explanation collapses into a tooltip
                        so the read-out stays uncluttered (regulation note below is
                        always visible). */}
                    <View className="flex-row items-center justify-end" style={{ marginTop: 8, gap: 6 }}>
                      <Text style={{ color: THEME.textMuted, fontSize: 11 }}>
                        {t("common.note")}
                      </Text>
                      <Tooltip
                        text={
                          correctionTarget != null
                            ? `${t("calculator.overrideHint")}\n\n${t("calculator.correctionTargetNote", {
                                value: formatGlucose(correctionTarget, unit),
                                unit: glucoseUnitLabel(unit),
                              })}`
                            : t("calculator.overrideHint")
                        }
                      />
                    </View>
                  </View>
                </>
              ) : null}
              {!doseEst && activeProfile.ratios_confirmed !== 1 ? <PendingDoseCard /> : null}
              {/* Without confirmed ratios there is no figure: the one line above
                  (CarbRatioLine, "Enter your ratios") leads to Profile and
                  Targets, and nothing is computed or shown in its place. */}

              {/* Regulation: a non-advice note accompanies every dose display. */}
              <NoticeCard
                icon="medical-outline"
                tint={GLUCOSE_RICH.high}
                body={t("calculator.calcNotAdvice")}
              />

              {doseEst ? (
                <>
                  {/* Secondary, non-regulation notices (a skipped ISF correction)
                      grouped into one card; a dropped correction is stated, not
                      hidden. */}
                  <NoticeGroup
                    items={[
                      ...(doseEst.correctionSkipped === "isf_invalid"
                        ? [
                            {
                              icon: "information-circle-outline" as const,
                              tint: THEME.accent,
                              body: t("calculator.correctionOffIsf"),
                            },
                          ]
                        : []),
                    ]}
                  />

                  {/* Plausibility warnings: non-blocking; the dose stays editable */}
                  {doseEst.warnings.map((w) => (
                    <NoticeCard
                      key={w}
                      icon="alert-circle-outline"
                      tint={GLUCOSE_RICH.low}
                      body={t(`calculator.${WARN_KEY[w]}`)}
                    />
                  ))}

                  <Pressable
                    onPress={() => router.push("/sources")}
                    hitSlop={8}
                    className="flex-row items-center mb-4"
                  >
                    <Ionicons name="information-circle-outline" size={14} color={THEME.accent} />
                    <Text style={{ color: THEME.accent, fontSize: 12, marginLeft: 5 }}>
                      {t("sources.calcLink")}
                    </Text>
                  </Pressable>
                </>
              ) : null}

              <DetailLabel>{t("calculator.manualDose")}</DetailLabel>
              {doseField(10)}
              {/* What the save will store, spelled out while the field is still
                  in front of the user - an empty field is not a value, and a
                  typed 0 is a real record of "no insulin". Without a usable
                  ratio there is no estimate worth citing, so this falls back to
                  the same plain "0 units, no injection" wording the typed-0
                  branch already uses. */}
              {typedDose == null ? (
                <NoticeCard
                  icon="information-circle-outline"
                  tint={THEME.accent}
                  body={
                    doseEst
                      ? t("calculator.doseEmptyNote", { n: num(doseEst.totalDose) })
                      : t("calculator.doseZeroNote")
                  }
                />
              ) : typedDose === 0 ? (
                <NoticeCard
                  icon="information-circle-outline"
                  tint={THEME.accent}
                  body={t("calculator.doseZeroNote")}
                />
              ) : null}
            </>
          ) : (
            <NoticeCard
              icon="information-circle-outline"
              tint={THEME.accent}
              title={t("calculator.carbFocusTitle")}
              // A basal-only user DOES use insulin, so telling them they said
              // otherwise is simply wrong. Each mode gets its own sentence.
              body={
                insulinMode === "basal"
                  ? t("calculator.carbFocusBodyBasal")
                  : t("calculator.carbFocusBody")
              }
            />
          )}

          {/* ── Details ──────────────────────────────────────────────────── */}
          {renderDetails()}

          <GradientCTA
            label={
              isEdit
                ? t("calculator.saveChanges")
                : showsDose
                  ? t("calculator.saveMealAndDose")
                  : t("calculator.logMeal")
            }
            disabled={saving || (isEdit && !editPrefillDone) || !stepperFields.allValid}
            onPress={logMeal}
          />

          {/* Edit mode only (mealLogId present): a new record has nothing to
              delete yet. Same tone/position as the glucose, med and injection
              edit sheets' own delete row (destructive colour, below the save
              action, not inside it). */}
          {isEdit ? (
            <Pressable
              onPress={deleteMeal}
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
        </ScrollView>
      </View>
      <FeedbackHost />
      {calcSetupSheet}
    </AppBackground>
  );
}

function Breakdown({
  label,
  value,
  tint,
  tooltip,
}: {
  label: string;
  value: string;
  tint?: string;
  /** optional "what is this based on?" explanation, rendered next to the label */
  tooltip?: string;
}) {
  return (
    <View className="flex-row justify-between">
      <View className="flex-row items-center" style={{ flex: 1, paddingRight: 8, gap: 4 }}>
        <Text style={{ color: tint ?? THEME.textMuted, fontSize: 12 }}>{label}</Text>
        {tooltip ? <Tooltip text={tooltip} size={12} tint={tint} /> : null}
      </View>
      <Text style={[TABULAR, { color: tint ?? THEME.text, fontSize: 12, fontWeight: "700" }]}>
        {value}
      </Text>
    </View>
  );
}

export default function CalculatorRoute() {
  const { mealLogId } = useLocalSearchParams<{ mealLogId?: string }>();
  const editing = typeof mealLogId === "string" && mealLogId.length > 0;
  const { t } = useTranslation();
  const router = useRouter();
  const [mode, setMode] = useState<MealEditMode | null>(editing ? null : "calculator");

  useEffect(() => {
    if (!editing || !mealLogId) return;
    setMode(null);
    let alive = true;
    (async () => {
      try {
        const log = await getMealLog(mealLogId);
        if (alive) setMode(log ? mealEditMode(log) : "calculator");
      } catch {
        if (!alive) return;
        Alert.alert(t("common.saveFailed"));
        if (router.canGoBack()) router.back();
        else router.replace("/(tabs)/food");
      }
    })();
    return () => {
      alive = false;
    };
  }, [editing, mealLogId, router, t]);

  return (
    <SafeAreaProvider>
      {mode === null ? (
        <AppBackground>
          <View className="flex-1" />
        </AppBackground>
      ) : mode === "carbOnly" && mealLogId ? (
        <CarbOnlyMealEdit mealLogId={mealLogId} />
      ) : (
        <CalculatorScreen />
      )}
    </SafeAreaProvider>
  );
}
