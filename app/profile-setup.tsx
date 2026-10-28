import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { isolateLtr } from "../lib/format";
import { deleteProfile, updateProfile } from "../lib/db/profiles";
import { tryWrite } from "../lib/saveGuard";
import { trackSaveFailed } from "../lib/analytics/saveFailed";
import { syncBasalReminderRow } from "../lib/db/reminders";
import { applyNotificationPrefs } from "../lib/services/notifications";
import { setUpReminderPlan } from "../lib/services/reminderPlan";
import { decideDraftDiscard, resolveFallbackProfileId } from "../lib/profileDraft";
import { presetFor } from "../lib/reminderPresets";
import { ReminderPlanPreview, usePresetLabel } from "../components/ReminderPlanPreview";
import { isAlarmKitAvailable } from "../modules/zerospike-alarmkit";
import {
  clampTarget,
  glucoseToDisplay,
  glucoseFromDisplay,
  glucoseUnitLabel,
  TARGET_RANGE_BOUNDS,
} from "../lib/glucose";
import { CARB_TARGET_BOUNDS, clampCarbTarget } from "../lib/insulin";
import { insulinModeShowsBasal, insulinModeShowsBolus } from "../lib/insulinMode";
import { TARGET_DEFAULTS_MGDL, CARB_TARGET_DEFAULTS_G, isNoInsulinDiabetesType } from "../lib/diabetesDefaults";
import type { DiabetesType, GlucoseUnit, InsulinMode } from "../lib/db/types";
import { FormCard, InputRow, ActionRow } from "../components/form";
import { RangeInput } from "../components/RangeInput";
import { CarbRatioInput, IsfInput } from "../components/RatioInput";
import { RatioConfirmCard } from "../components/RatioConfirmCard";
import {
  RATIOS_ENTERED,
  ratioFieldsInitial,
  type RatioFields,
} from "../lib/calcSetup";
import { InlineTimePicker } from "../components/InlineTimePicker";
import { InsulinModeSection } from "../components/InsulinModeSection";
import { Button, Segmented, Txt } from "../components/ui";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { ScreenHeader } from "../components/ScreenHeader";
import { AppBackground, ConicAvatar, GradientCTA } from "../components/rich";
import { MODAL_TOP_PAD, SPACE, THEME } from "../lib/theme/tokens";
import { parseDecimalText } from "../lib/numberInput";
import { upper } from "../lib/upper";
import { displayProfileName } from "../lib/profileName";
import { useLayout } from "../lib/useLayout";

/** Two-letter mark for the conic avatar (mockup 07's profile hero). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return upper(parts[0].slice(0, 2));
  return upper(parts[0][0] + parts[1][0]);
}

/**
 * Configure a (usually freshly-created) profile's personal targets.
 *
 * Rebuilt to the mockup's 07 "Profil / kurulum" composition: an identity hero
 * (conic avatar, name, and a glass chip stating the profile in one line) sits
 * above the form, so a family managing several profiles can always see WHOSE
 * numbers they are editing. Targets are ranges, using the same band control as
 * settings and onboarding.
 */
function ProfileSetupScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { columnPad } = useLayout();
  const { activeProfile, profiles, setActiveProfileId, refreshProfiles, bumpData } =
    useApp();
  const { toast } = useFeedback();
  // Opened straight after "Create" in the profile switcher, which creates the
  // row and switches to it BEFORE this screen opens (the reminders and targets
  // edited here are profile-scoped, so they need the new profile to already be
  // the active one). `previousProfileId` is what to fall back to if the user
  // walks away without saving - see discardDraft below.
  const params = useLocalSearchParams<{
    created?: string;
    previousProfileId?: string;
  }>();
  const isDraft = params.created === "1";
  // WHICH profile this screen is editing, pinned on first render and never
  // re-read from `activeProfile` again. Every write below (targets, the basal
  // row, the measurement layout) passes this id explicitly instead of letting
  // the db layer resolve "the active profile" per call: a switch landing
  // between two awaits - a caregiver on another surface, or this screen's own
  // cancel path - would otherwise write half of one form into somebody else's
  // profile. Adopted late only if the context had not resolved a profile yet
  // on the very first render.
  const editedProfileIdRef = useRef<string | null>(activeProfile?.id ?? null);
  if (editedProfileIdRef.current == null && activeProfile) {
    editedProfileIdRef.current = activeProfile.id;
  }
  // Glucose fields (targets, ISF) are stored in mg/dL but shown/entered in this
  // profile's unit, so a mmol household never sees mg/dL labels or writes mmol
  // numbers into mg/dL columns. Unlike the old read-only const, unit is now
  // asked here too (Wave 2a), so it is state, with changeUnit() re-expressing
  // whatever is already typed instead of silently reinterpreting it.
  const [unit, setUnit] = useState<GlucoseUnit>(activeProfile?.glucose_unit ?? "mgdl");
  const [diabetesType, setDiabetesType] = useState<DiabetesType>(
    activeProfile?.diabetes_type ?? "unknown"
  );
  const [insulinMode, setInsulinMode] = useState<InsulinMode>(
    activeProfile?.insulin_mode ?? "both"
  );
  const [oralMeds, setOralMeds] = useState(activeProfile?.oral_meds_enabled === 1);
  const showsBolus = insulinModeShowsBolus(insulinMode);
  const showsBasal = insulinModeShowsBasal(insulinMode);

  const [name, setName] = useState(
    activeProfile?.name ?? ""
  );
  const [fastingMin, setFastingMin] = useState(
    String(glucoseToDisplay(activeProfile?.target_fasting_min ?? 80, unit))
  );
  const [fastingMax, setFastingMax] = useState(
    String(glucoseToDisplay(activeProfile?.target_fasting_max ?? 100, unit))
  );
  const [postmealMin, setPostmealMin] = useState(
    String(glucoseToDisplay(activeProfile?.target_postmeal_min ?? 80, unit))
  );
  const [postmealMax, setPostmealMax] = useState(
    String(glucoseToDisplay(activeProfile?.target_postmeal_max ?? 140, unit))
  );
  // Ratios / ISF start EMPTY (the user's own numbers or nothing); ISF is kept in
  // mg/dL here and shown in the display unit. They are written only when all
  // four are filled, and counted as confirmed only with the box ticked.
  const [ratios, setRatios] = useState<RatioFields>(() => ratioFieldsInitial(activeProfile));
  const [ratiosTick, setRatiosTick] = useState(activeProfile?.ratios_confirmed === 1);
  const [carbMin, setCarbMin] = useState(
    String(activeProfile?.daily_carb_target_min_g ?? 160)
  );
  const [carbMax, setCarbMax] = useState(
    String(activeProfile?.daily_carb_target_g ?? 200)
  );
  // A prefilled target only becomes the user's own once they actually move the
  // control on its row - same "touched" pattern onboarding uses, so picking a
  // diabetes type never overwrites a value already hand-edited.
  const [targetsTouched, setTargetsTouched] = useState(false);
  const [carbRangeTouched, setCarbRangeTouched] = useState(false);
  const [basalTime, setBasalTime] = useState("22:00");
  // Whether the user actually picked a time, vs. just seeing the "22:00"
  // placeholder - gates whether save() overwrites the device's shared basal
  // reminder time (see save()).
  const [basalTimeTouched, setBasalTimeTouched] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── The ready-made measurement layout (2.3.0's K2-E, shared with onboarding) ─
  //
  // The second profile used to arrive with NOTHING: onboarding offered this
  // layout exactly once, to the first profile, so a family's second profile had
  // no measurement reminders and was never asked for the alarm permission -
  // and the difference was invisible from every screen.
  //
  // The preview and the write are the same code onboarding runs
  // (components/ReminderPlanPreview.tsx, lib/services/reminderPlan.ts),
  // including the once-per-run alarm prompt, so the two surfaces cannot drift.
  // The diabetes type comes from the segment on THIS screen rather than from
  // the stored profile, because the user may be changing it right now.
  const alarmKitAvailable = useMemo(() => isAlarmKitAvailable(), []);
  const presetLabel = usePresetLabel();
  // Only REMOVALS are stored, by TIME, so the layout keeps following the
  // diabetes segment while the user is still making up their mind (the same
  // "derived until touched" shape onboarding uses).
  const [removedPlanTimes, setRemovedPlanTimes] = useState<string[]>([]);
  const [planDecided, setPlanDecided] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const planRows = useMemo(
    () => presetFor(diabetesType).filter((r) => !removedPlanTimes.includes(r.time)),
    [diabetesType, removedPlanTimes]
  );

  // ── Cancelling a brand-new profile ──────────────────────────────────────────
  //
  // The switcher creates the row and makes it active BEFORE pushing this screen
  // (it has to: everything edited here is profile-scoped). Closing without
  // saving therefore used to leave the device sitting on a nameless profile
  // with default targets that the user never agreed to and could not tell apart
  // from a real one. Cancelling a creation now means what it says: the draft row
  // is deleted and the profile that was active before comes back.
  //
  // Unless something WAS configured. Setting up the measurement layout writes
  // real rows for this profile and answers two OS permission dialogs; throwing
  // that away because the targets form was closed afterwards would be the same
  // silent loss in the other direction, so the profile is kept in that case (the
  // targets simply stay at their defaults, exactly as they would after a save
  // that changed nothing).
  //
  // The id captured above is the draft; `previousId` is only a HINT of where
  // to go back to (see resolveFallbackProfileId - that profile can be deleted
  // from elsewhere while this screen is open).
  const previousProfileId =
    typeof params.previousProfileId === "string" ? params.previousProfileId : null;
  const savedRef = useRef(false);
  const planInstalledRef = useRef(false);
  const discardedRef = useRef(false);
  // How many writes are running right now (a save, a plan setup). A dismiss
  // arriving mid-write must not decide anything: deleting the profile out from
  // under an in-flight insert is how rows end up owned by a row that no longer
  // exists. The dismiss is remembered instead and re-asked in the write's
  // `finally`, by which point savedRef / planInstalledRef answer it properly.
  const inFlightRef = useRef(0);
  const pendingDiscardRef = useRef(false);
  const [busy, setBusy] = useState(false);

  // Held in a ref rather than a useCallback so the unmount cleanup below can
  // depend on nothing at all: with `profiles` in its dependency list the
  // cleanup would re-run (and delete the draft) every time the profile list
  // changed while the user was still typing.
  const discardDraftRef = useRef<() => Promise<void>>(async () => {});
  discardDraftRef.current = async () => {
    const draftId = editedProfileIdRef.current;
    if (draftId == null) return;
    const decision = decideDraftDiscard({
      isDraft,
      saved: savedRef.current,
      planInstalled: planInstalledRef.current,
      alreadyDiscarded: discardedRef.current,
      inFlight: inFlightRef.current > 0,
    });
    if (decision === "defer") {
      pendingDiscardRef.current = true;
      return;
    }
    if (decision !== "discard") return;
    discardedRef.current = true;
    try {
      // Switch away FIRST: deleteProfile drops the row, and the notification /
      // widget syncs that a switch kicks off resolve the active profile from
      // storage, so doing it the other way round leaves a window where they
      // resolve a profile that no longer exists.
      const fallbackId = resolveFallbackProfileId(
        previousProfileId,
        profiles,
        draftId
      );
      if (fallbackId) await setActiveProfileId(fallbackId);
      await deleteProfile(draftId);
      await refreshProfiles();
      bumpData();
    } catch {
      // best-effort: at worst the empty profile stays and can be deleted from
      // Settings > Data like any other
    }
  };

  useEffect(() => () => void discardDraftRef.current(), []);

  /** Marks a write as running, and answers a dismiss that arrived during it. */
  async function withWriteInFlight(run: () => Promise<void>) {
    inFlightRef.current++;
    setBusy(true);
    try {
      await run();
    } finally {
      inFlightRef.current--;
      setBusy(inFlightRef.current > 0);
      if (inFlightRef.current === 0 && pendingDiscardRef.current) {
        pendingDiscardRef.current = false;
        await discardDraftRef.current();
      }
    }
  }

  /** The X in the header, and the only path that is not a save. */
  async function closeWithoutSaving() {
    await discardDraftRef.current();
    router.back();
  }

  function n(v: string, fallback: number): number {
    const x = (parseDecimalText(v) ?? NaN);
    return Number.isFinite(x) && x > 0 ? x : fallback;
  }

  // Re-expresses whatever is already typed in the new unit; only the
  // glucose-unit-dependent fields (targets, ISF) need converting, not the
  // carb ratios (g of carb per unit of insulin) or the carb range (grams).
  function changeUnit(next: GlucoseUnit) {
    if (next === unit) return;
    const convert = (text: string, fallbackMgdl: number) =>
      String(
        glucoseToDisplay(
          glucoseFromDisplay(n(text, glucoseToDisplay(fallbackMgdl, unit)), unit),
          next
        )
      );
    setFastingMin(convert(fastingMin, 80));
    setFastingMax(convert(fastingMax, 100));
    setPostmealMin(convert(postmealMin, 80));
    setPostmealMax(convert(postmealMax, 140));
    setUnit(next);
  }

  // Picking a diabetes type seeds the target-range (+ carb-range) defaults,
  // per the Wave 2a matrix, only while the user hasn't hand-edited a value.
  // prediabetes/none also force insulin_mode back to "none", the same way the
  // insulin segment itself works once it re-hides.
  function selectDiabetesType(next: DiabetesType) {
    setDiabetesType(next);
    if (isNoInsulinDiabetesType(next)) setInsulinMode("none");
    if (!targetsTouched) {
      const { fasting, postmeal } = TARGET_DEFAULTS_MGDL[next];
      setFastingMin(String(glucoseToDisplay(fasting.min, unit)));
      setFastingMax(String(glucoseToDisplay(fasting.max, unit)));
      setPostmealMin(String(glucoseToDisplay(postmeal.min, unit)));
      setPostmealMax(String(glucoseToDisplay(postmeal.max, unit)));
    }
    if (!carbRangeTouched) {
      const carb = CARB_TARGET_DEFAULTS_G[next];
      setCarbMin(String(carb.min));
      setCarbMax(String(carb.max));
    }
  }

  function rangeOk(minText: string, maxText: string): boolean {
    const lo = (parseDecimalText(minText) ?? NaN);
    const hi = (parseDecimalText(maxText) ?? NaN);
    return Number.isFinite(lo) && Number.isFinite(hi) && lo < hi;
  }

  /** Both ends inside the accepted band, in the unit being typed. */
  function withinBounds(
    minText: string,
    maxText: string,
    bounds: { min: number; max: number }
  ): boolean {
    const lo = (parseDecimalText(minText) ?? NaN);
    const hi = (parseDecimalText(maxText) ?? NaN);
    return (
      lo >= bounds.min && lo <= bounds.max && hi >= bounds.min && hi <= bounds.max
    );
  }

  const glucoseBounds = {
    min: glucoseToDisplay(TARGET_RANGE_BOUNDS.min, unit),
    max: glucoseToDisplay(TARGET_RANGE_BOUNDS.max, unit),
  };

  const fastingOk =
    rangeOk(fastingMin, fastingMax) &&
    withinBounds(fastingMin, fastingMax, glucoseBounds);
  const postmealOk =
    rangeOk(postmealMin, postmealMax) &&
    withinBounds(postmealMin, postmealMax, glucoseBounds);
  const carbOk =
    rangeOk(carbMin, carbMax) &&
    withinBounds(carbMin, carbMax, CARB_TARGET_BOUNDS);
  const canSave = fastingOk && postmealOk && carbOk;

  /**
   * "Set up this plan": writes the previewed rows to THIS profile and asks for
   * the notification permission, then the alarm one (setUpReminderPlan). "Not
   * now" right below it writes nothing and asks for nothing at all - it only
   * puts the card away.
   *
   * Written straight away rather than on Save, exactly as in onboarding: the
   * two OS dialogs are meaningless before there is a row for them to ring, and
   * a reminder is the one thing on this screen that has to exist before the
   * user can be asked about how it should reach them.
   *
   * A full list and a database failure are told apart on purpose: the first is
   * something the user can fix (delete a reminder), the second is not, and
   * showing "you can add up to 10" for a broken write sent them looking for a
   * limit that was not the problem.
   */
  async function setupPlan() {
    if (savingPlan || planRows.length === 0) return;
    const profileId = editedProfileIdRef.current ?? undefined;
    setSavingPlan(true);
    await withWriteInFlight(async () => {
      try {
        const { outcome, written } = await setUpReminderPlan(
          planRows,
          presetLabel,
          profileId
        );
        let armed = true;
        if (written > 0) {
          planInstalledRef.current = true;
          setPlanDecided(true);
          // Rows exist NOW, so they are armed now rather than at Save: a user
          // who sets up the layout and then leaves without saving still has
          // working reminders. The carve-out in decideDraftDiscard is what
          // keeps that true, and a discard back to another profile re-applies
          // through AppContext's own switch pass.
          armed = await tryWrite(async () => {
            await applyNotificationPrefs();
          });
        }
        if (outcome === "limit") toast(t("reminders.limitReached"), "error");
        else if (outcome === "failed") {
          trackSaveFailed("reminder", "write");
          toast(t("common.saveFailed"), "error");
        } else if (!armed) {
          trackSaveFailed("reminder", "schedule");
          toast(t("reminders.scheduleFailed"), "error");
        } else toast(t("settings.saved"), "success");
      } finally {
        setSavingPlan(false);
      }
    });
  }

  const ratioSetComplete =
    showsBolus &&
    ratios.breakfast != null &&
    ratios.lunch != null &&
    ratios.dinner != null &&
    ratios.isfMgdl != null;

  async function save() {
    const profileId = editedProfileIdRef.current;
    if (profileId == null || !canSave) return;
    setSaving(true);
    await withWriteInFlight(async () => {
      try {
        const written = await tryWrite(() => updateProfile(profileId, {
          name: name.trim(),
          glucose_unit: unit,
          diabetes_type: diabetesType,
          insulin_mode: insulinMode,
          oral_meds_enabled: oralMeds ? 1 : 0,
          target_fasting_min: clampTarget(
            glucoseFromDisplay(n(fastingMin, glucoseToDisplay(80, unit)), unit)
          ),
          target_fasting_max: clampTarget(
            glucoseFromDisplay(n(fastingMax, glucoseToDisplay(100, unit)), unit)
          ),
          target_postmeal_min: clampTarget(
            glucoseFromDisplay(n(postmealMin, glucoseToDisplay(80, unit)), unit)
          ),
          target_postmeal_max: clampTarget(
            glucoseFromDisplay(n(postmealMax, glucoseToDisplay(140, unit)), unit)
          ),
          ...(ratioSetComplete
            ? {
                carb_ratio_breakfast: ratios.breakfast as number,
                carb_ratio_lunch: ratios.lunch as number,
                carb_ratio_dinner: ratios.dinner as number,
                insulin_sensitivity_factor: ratios.isfMgdl as number,
              }
            : {}),
          daily_carb_target_min_g: clampCarbTarget(n(carbMin, 160)),
          daily_carb_target_g: clampCarbTarget(n(carbMax, 200)),
          // Confirmed only when the user typed all four numbers AND ticked the box.
          ...(ratioSetComplete ? { ratios_confirmed: ratiosTick ? 1 : RATIOS_ENTERED } : {}),
        }));
        if (!written) {
          trackSaveFailed("profile", "write");
          toast(t("common.saveFailed"), "error");
          return;
        }
        // From here the profile is the user's own, so the cancel path above must
        // never take it back - set after the write, not before, so a failed one
        // still counts as an abandoned draft.
        savedRef.current = true;
        // The basal choice is written straight to the reminders registry, not the
        // legacy prefs.basal/basalTime bridge (lib/db/remindersBridge.ts): that
        // bridge only ever runs ONCE per device, and has almost always already
        // fired by the time a second (or reset) profile reaches this screen -
        // writing only the legacy prefs left this choice with no effect on any
        // actual reminder. basalTime itself only overwrites an EXISTING row when
        // the user actually picked one (see basalTimeTouched above): each profile
        // keeps its OWN basal row since schema v19 (lib/db/reminders.ts), so this
        // now guards only against an untouched "22:00" placeholder clobbering a
        // time THIS profile already set for itself. The profile is named
        // EXPLICITLY rather than left to syncBasalReminderRow's active-profile
        // fallback: this screen opens right after a switch, and the row has to
        // land on the profile the form is editing whatever became active in the
        // meantime. A full reminders table (MAX_REMINDERS, per profile) blocks
        // only a brand NEW row - an existing basal row is always updated in place.
        // The profile row is already saved: a failing basal row or re-arm is
        // reported as a reminder problem, not as an unsaved profile.
        let basalSynced = true;
        const rearmed = await tryWrite(async () => {
          basalSynced = await syncBasalReminderRow(
            showsBasal,
            basalTime,
            basalTimeTouched,
            profileId
          );
          await applyNotificationPrefs();
        });
        if (!basalSynced) toast(t("reminders.limitReached"), "error");
        if (!rearmed) {
          trackSaveFailed("profile", "schedule");
          toast(t("reminders.scheduleFailed"), "error");
        }
        bumpData();
        router.back();
      } finally {
        setSaving(false);
      }
    });
  }

  // Bidi: writingDirection alone was verified NOT enough on-device for a
  // hyphenated range under RTL (see insights.tsx's target-band fix); this
  // string has no RTL script content at all, so the whole thing is isolated.
  const summary = isolateLtr(
    [glucoseUnitLabel(unit), `${fastingMin}-${fastingMax}`].join(" · ")
  );

  return (
    <AppBackground style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
      <ScreenHeader
        title={t("profiles.add")}
        onBack={() => void closeWithoutSaving()}
        // A write is running: the X stays in place (removing it would jump the
        // header) but stops responding, so a dismiss cannot race the insert
        // that is already in flight.
        backDisabled={busy}
        backIcon="close"
        accessibilityLabel={t("common.close")}
      />

      <ScrollView
        {...keyboardAwareScrollProps}
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: insets.bottom + 28,
          ...columnPad(16),
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity hero (mockup 07) */}
        <View className="items-center mb-5" style={{ gap: 8 }}>
          <ConicAvatar label={initials(displayProfileName(name, t))} size={66} />
          <Txt kind="title" numberOfLines={1}>
            {displayProfileName(name, t)}
          </Txt>
          <View
            className="rounded-full px-3 py-1"
            style={{ backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border }}
          >
            {/* Bidi: "mg/dL · 70-180" holds a hyphenated number range, which
                reorders under RTL unless pinned LTR (same fix as insights'
                target-band line). */}
            <Txt kind="micro" tone="muted" style={{ fontWeight: "400", writingDirection: "ltr" }}>
              {summary}
            </Txt>
          </View>
          <Txt
            kind="caption"
            tone="muted"
            style={{ textAlign: "center", paddingHorizontal: SPACE.lg }}
          >
            {t("profiles.setupHint")}
          </Txt>
        </View>

        <FormCard icon="person-outline" title={t("onboarding.secProfile")}>
          <InputRow
            icon="text-outline"
            label={t("onboarding.profileName")}
            value={name}
            onChangeText={setName}
            placeholder={t("profiles.newNamePlaceholder")}
            last
          />
        </FormCard>

        <FormCard icon="options-outline" title={t("settings.glucoseUnit")}>
          <View className="px-4 py-3.5">
            <Segmented
              options={[
                { value: "mgdl", label: "mg/dL" },
                { value: "mmol", label: "mmol/L" },
              ]}
              value={unit}
              onChange={(u: GlucoseUnit) => changeUnit(u)}
            />
          </View>
        </FormCard>

        <FormCard icon="medkit-outline" title={t("settings.diabetesType")}>
          <View className="px-4 py-3.5">
            <Segmented
              options={(
                ["type1", "type2", "gestational", "prediabetes", "none", "unknown"] as DiabetesType[]
              ).map((d) => ({
                value: d,
                label: d === "unknown" ? t("onboarding.diabetes_other") : t(`onboarding.diabetes_${d}`),
              }))}
              value={diabetesType}
              onChange={(d: DiabetesType) => selectDiabetesType(d)}
            />
            <Text className="text-mut text-xs mt-2 leading-4">{t("settings.diabetesTypeHint")}</Text>
          </View>
        </FormCard>

        <InsulinModeSection
          diabetesType={diabetesType}
          insulinMode={insulinMode}
          onChangeInsulinMode={setInsulinMode}
          oralMeds={oralMeds}
          onChangeOralMeds={setOralMeds}
        />

        <RangeInput
          label={t("settings.fastingRange")}
          unit={glucoseUnitLabel(unit)}
          minText={fastingMin}
          maxText={fastingMax}
          onChangeMin={(v) => {
            setFastingMin(v);
            setTargetsTouched(true);
          }}
          onChangeMax={(v) => {
            setFastingMax(v);
            setTargetsTouched(true);
          }}
          axisMin={glucoseToDisplay(50, unit)}
          axisMax={glucoseToDisplay(250, unit)}
          minLabel={t("common.rangeMin")}
          maxLabel={t("common.rangeMax")}
          invalid={!fastingOk}
          invalidMessage={t("settings.rangeInvalid")}
          bounds={glucoseBounds}
          outOfBoundsMessage={t("settings.rangeOutOfBounds", {
            min: glucoseBounds.min,
            max: glucoseBounds.max,
          })}
          decimals={unit === "mmol"}
        />
        <RangeInput
          label={t("settings.postmealRange")}
          unit={glucoseUnitLabel(unit)}
          minText={postmealMin}
          maxText={postmealMax}
          onChangeMin={(v) => {
            setPostmealMin(v);
            setTargetsTouched(true);
          }}
          onChangeMax={(v) => {
            setPostmealMax(v);
            setTargetsTouched(true);
          }}
          axisMin={glucoseToDisplay(50, unit)}
          axisMax={glucoseToDisplay(300, unit)}
          minLabel={t("common.rangeMin")}
          maxLabel={t("common.rangeMax")}
          invalid={!postmealOk}
          invalidMessage={t("settings.rangeInvalid")}
          bounds={glucoseBounds}
          outOfBoundsMessage={t("settings.rangeOutOfBounds", {
            min: glucoseBounds.min,
            max: glucoseBounds.max,
          })}
          decimals={unit === "mmol"}
        />
        <RangeInput
          label={t("settings.carbRange")}
          unit={t("common.grams")}
          minText={carbMin}
          maxText={carbMax}
          onChangeMin={(v) => {
            setCarbMin(v);
            setCarbRangeTouched(true);
          }}
          onChangeMax={(v) => {
            setCarbMax(v);
            setCarbRangeTouched(true);
          }}
          axisMin={0}
          axisMax={400}
          minLabel={t("common.rangeMin")}
          maxLabel={t("common.rangeMax")}
          invalid={!carbOk}
          invalidMessage={t("settings.rangeInvalid")}
          bounds={CARB_TARGET_BOUNDS}
          outOfBoundsMessage={t("settings.rangeOutOfBounds", {
            min: CARB_TARGET_BOUNDS.min,
            max: CARB_TARGET_BOUNDS.max,
          })}
        />

        {showsBolus ? (
          <FormCard icon="restaurant-outline" title={t("settings.carbRatios")}>
            {(["breakfast", "lunch", "dinner"] as const).map((slot) => (
              <View key={slot} className="px-4 py-3">
                <Text className="text-mut text-xs mb-2">{t(`slot.${slot}`)}</Text>
<CarbRatioInput
                  value={ratios[slot]}
                  onChange={(v) => {
                    setRatios((r) => ({ ...r, [slot]: v }));
                    setRatiosTick(false);
                  }}
                  accessibilityLabel={t(`slot.${slot}`)}
                />
              </View>
            ))}
          </FormCard>
        ) : null}

        {showsBolus || showsBasal ? (
          <FormCard icon="pulse-outline" title={t("onboarding.secReminder")}>
            {showsBolus ? (
              <View className="px-4 py-3">
                <Text className="text-mut text-xs mb-2">{t("settings.isfHint")}</Text>
<IsfInput
                  valueMgdl={ratios.isfMgdl}
                  onChangeMgdl={(v) => {
                    setRatios((r) => ({ ...r, isfMgdl: v }));
                    setRatiosTick(false);
                  }}
                  unit={unit}
                  accessibilityLabel={t("settings.isf")}
                />
                <View className="mt-3">
                  <RatioConfirmCard
                    checked={ratiosTick}
                    onToggle={setRatiosTick}
                    complete={ratioSetComplete}
                    disabled={!ratioSetComplete}
                  />
                </View>
              </View>
            ) : null}
            {showsBasal ? (
              <ActionRow
                icon="alarm-outline"
                label={t("settings.basalTime")}
                value={basalTime}
                onPress={() => setShowTime((s) => !s)}
                last
              />
            ) : null}
          </FormCard>
        ) : null}
        <InlineTimePicker
          visible={showTime}
          value={basalTime}
          onChange={(v) => {
            setBasalTime(v);
            setBasalTimeTouched(true);
          }}
          onClose={() => setShowTime(false)}
        />

        {/* The ready-made measurement layout, offered here exactly as it is at
            the end of onboarding: a preview any line can be pruned from, one
            action that sets it up (and asks for the permissions), and one that
            does nothing at all. Both answers put the card away - this is a
            one-off offer, and Settings > Reminders owns it from then on, which
            is also why removing every line leaves only "Not now". */}
        {isDraft && !planDecided ? (
          <FormCard icon="water-outline" title={t("onboarding.qReminderPlan")}>
            <View className="px-4 py-3.5">
              <Text className="text-mut text-xs mb-3 leading-4">
                {t("onboarding.qReminderPlanHint")}
              </Text>
              <ReminderPlanPreview
                rows={planRows}
                onRemove={(time) => setRemovedPlanTimes((prev) => [...prev, time])}
                alarmKitAvailable={alarmKitAvailable}
              />
              {planRows.length > 0 ? (
                <View className="mt-3">
                  <Button
                    label={t("onboarding.planSetup")}
                    loading={savingPlan}
                    onPress={setupPlan}
                  />
                </View>
              ) : null}
              <Button
                label={t("onboarding.planSkip")}
                variant="tertiary"
                onPress={() => setPlanDecided(true)}
              />
            </View>
          </FormCard>
        ) : null}

        <View className="h-2" />
        <GradientCTA
          label={t("common.save")}
          disabled={saving || !canSave}
          onPress={save}
        />
      </ScrollView>
      <FeedbackHost />
    </AppBackground>
  );
}

export default function ProfileSetupRoute() {
  return (
    <SafeAreaProvider>
      <ProfileSetupScreen />
    </SafeAreaProvider>
  );
}
