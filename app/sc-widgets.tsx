import React, { useEffect, useState } from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isScreenshotMode } from "../lib/screenshotMode";
import { useApp } from "../lib/store/AppContext";
import { computeLiveData, type LiveData } from "../lib/services/liveData";
import { DEFAULT_PROFILE_ID } from "../lib/db/index";
import { AppBackground } from "../components/rich/AppBackground";
import { SectionHeading } from "../components/scWidgets/SectionHeading";
import { DynamicIslandBar } from "../components/scWidgets/DynamicIslandBar";
import { DockFiller } from "../components/scWidgets/DockFiller";
import { LockScreenScene } from "../components/scWidgets/LockScreenScene";
import { LiveActivityScene } from "../components/scWidgets/LiveActivityScene";
import { HomeWidgetsScene } from "../components/scWidgets/HomeWidgetsScene";
import { MiniTile, MiniWidgetsScene } from "../components/scWidgets/MiniWidgetsScene";
import { NotificationCard } from "../components/scWidgets/NotificationCard";
import { AndroidScene } from "../components/scWidgets/AndroidScene";
import { profileFor, specFor, type AndroidSpec, type IosSpec } from "../components/scWidgets/layout";
import { SCENE_TIMER_FRACTION, sceneAnchor, sceneSnapshot } from "../components/scWidgets/sceneData";

/**
 * Store-screenshot ONLY (panel 03-widget): a widget scene, because the real
 * widgets live inside the WidgetKit / android-widget extensions and cannot be
 * captured by pointing the pipeline at a normal in-app route. iOS replicates
 * targets/widget/index.swift, SmallWidgets.swift and PostMealActivity.swift by
 * hand (components/scWidgets/*); Android renders the SAME builders
 * lib/services/androidWidget.ts ships, through the library's own WidgetPreview,
 * so that half can never drift from a real home screen.
 *
 * FIXED GEOMETRY, not flex. Every offset and every box comes from
 * components/scWidgets/layout.ts in points (iOS) or dp (Android), measured
 * from the top of the screen, and the whole composition is top-aligned with no
 * ScrollView.
 *
 * W4 rebuilt the iOS half as an actual lock screen: Dynamic Island, the inline
 * accessory ABOVE the clock, the clock and date, the circular + rectangular
 * accessories under them, the Live Activity where iOS itself draws it, and a
 * real zerospike notification at the bottom. The system's own app squares,
 * dock and search pill are gone - a store panel has no business advertising
 * Apple's camera and mail icons - so on iOS the notification card is what
 * crosses the composite's cut line. DockFiller still runs the Android half,
 * which this round did not touch.
 *
 * Double-locked like every other sc-* route: isScreenshotMode() is
 * __DEV__ + EXPO_PUBLIC_SCREENSHOT_MODE, so a release build only ever
 * redirects to the dashboard.
 */
export default function ScWidgets() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { activeProfile } = useApp();
  // Real widget bitmaps (react-native-android-widget's WidgetPreview) only
  // render on actual Android - the ?scPlatform=android trick other panels use
  // to fake an Android frame from an iOS capture (lib/screenshotMode.ts) cannot
  // stand in for a native widget host, so this scene keys on the real OS.
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const spec = specFor(profileFor(Platform.OS, width));

  const [data, setData] = useState<LiveData | null>(null);
  // One fixed instant for the whole scene, so nothing on the panel depends on
  // when the shoot happened to run. See components/scWidgets/sceneData.ts.
  const [now] = useState(() => sceneAnchor(Platform.OS === "android"));

  useEffect(() => {
    if (!isScreenshotMode()) return;
    let cancelled = false;
    const load = async () => {
      const profileId = activeProfile?.id ?? DEFAULT_PROFILE_ID;
      const unit = activeProfile?.glucose_unit ?? "mgdl";
      const snapshot = await computeLiveData(profileId, unit);
      if (cancelled) return;
      setData(sceneSnapshot(snapshot, now));
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeProfile?.id, activeProfile?.glucose_unit, i18n.language, now]);

  if (!isScreenshotMode()) {
    router.replace("/");
    return null;
  }

  const contentTop = Math.max(spec.contentTop, insets.top + 4);

  return (
    <AppBackground>
      <View style={{ flex: 1 }}>
        {spec.kind === "android" ? (
          <AndroidBleed spec={spec} width={width} />
        ) : null}

        <View style={{ paddingTop: contentTop, paddingHorizontal: spec.padX }}>
          {spec.kind === "android" ? (
            <AndroidScene data={data} spec={spec} />
          ) : (
            <IosScene spec={spec} data={data} now={now} t={t} />
          )}
        </View>
      </View>
    </AppBackground>
  );
}

/** Android only: the neutral launcher filler that carries that half's bleed.
 *  Drawn first, so any rounding that brought the two together leaves the
 *  widgets on top rather than the wallpaper. */
function AndroidBleed({ spec, width }: { spec: AndroidSpec; width: number }) {
  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: spec.filler.top }}>
      <DockFiller spec={spec.filler} width={width} />
    </View>
  );
}

function IosScene({
  spec,
  data,
  now,
  t,
}: {
  spec: IosSpec;
  data: LiveData | null;
  now: number;
  t: (key: string) => string;
}) {
  // One lock screen, not three catalogue rows: the caption names it once and
  // everything iOS actually draws on a locked device follows in its own order,
  // Live Activity included (which is why that card has no caption of its own).
  const lockScreen = (
    <>
      <SectionHeading size={spec.headingSize} height={spec.headingH}>
        {t("scWidgets.lockScreen")}
      </SectionHeading>
      <View style={{ height: spec.headingGap }} />
      <LockScreenScene
        data={data}
        now={now}
        inlineH={spec.inlineH}
        gapInlineToClock={spec.gapInlineToClock}
        clockSize={spec.clockSize}
        clockLine={spec.clockLine}
        dateSize={spec.dateSize}
        dateLine={spec.dateLine}
        gapClockToAccessory={spec.gapClockToAccessory}
        accessoryH={spec.accessoryH}
      />
      <View style={{ height: spec.gapAccessoryToLive }} />
      <LiveActivityScene data={data} now={now} height={spec.liveH} fraction={SCENE_TIMER_FRACTION} />
    </>
  );

  const notification = (
    <NotificationCard
      title={t("notifications.basalTitle")}
      body={t("notifications.basalBody")}
      now={now}
      height={spec.notif.height}
      pad={spec.notif.pad}
      icon={spec.notif.icon}
      titleSize={spec.notif.titleSize}
      bodySize={spec.notif.bodySize}
      metaSize={spec.notif.metaSize}
    />
  );

  if (spec.twoColumn) {
    // Plain "row": RN's own forceRTL mirrors it, so Arabic gets the lock
    // screen on the right without a manual row-reverse fighting that.
    return (
      <>
        <View style={{ flexDirection: "row", gap: spec.colGap }}>
          <View style={{ width: spec.leftW }}>{lockScreen}</View>
          <View style={{ width: spec.rightW }}>
            <SectionHeading size={spec.headingSize} height={spec.headingH}>
              {t("scWidgets.homeScreen")}
            </SectionHeading>
            <View style={{ height: spec.headingGap }} />
            <HomeWidgetsScene data={data} now={now} unit={spec.unit} gap={spec.gridGap} />
            <View style={{ height: spec.sectionGap }} />
            <SectionHeading size={spec.headingSize} height={spec.headingH}>
              {t("scWidgets.miniWidgets")}
            </SectionHeading>
            <View style={{ height: spec.headingGap }} />
            <MiniWidgetsScene
              data={data}
              now={now}
              unit={spec.unit}
              gap={spec.gridGap}
              rows={[
                ["reading", "glucose", "meal"],
                ["third", "timer"],
              ]}
            />
          </View>
        </View>
        <View style={{ height: spec.sectionGap }} />
        {notification}
      </>
    );
  }

  return (
    <>
      {spec.island ? (
        <>
          <DynamicIslandBar
            data={data}
            now={now}
            fraction={SCENE_TIMER_FRACTION}
            width={spec.island.w}
            height={spec.island.h}
          />
          <View style={{ height: spec.island.gapAfter }} />
        </>
      ) : null}
      {lockScreen}
      <View style={{ height: spec.sectionGap }} />
      <SectionHeading size={spec.headingSize} height={spec.headingH}>
        {t("scWidgets.homeAndMini")}
      </SectionHeading>
      <View style={{ height: spec.headingGap }} />
      {/* Two rows of the SAME grid unit, both 372 pt wide: systemMedium +
          systemSmall + the glucose tile, then the three remaining mini tiles.
          The iPhone band cannot hold the iPad's three widget rows - see the
          budget in layout.ts - so the mini reading tile, whose 112 mg/dL the
          systemSmall widget beside it already prints, is the one dropped. */}
      <HomeWidgetsScene
        data={data}
        now={now}
        unit={spec.unit}
        gap={spec.gridGap}
        trailing={<MiniTile tile="glucose" data={data} now={now} unit={spec.unit} />}
      />
      <View style={{ height: spec.gridGap }} />
      <MiniWidgetsScene
        data={data}
        now={now}
        unit={spec.unit}
        gap={spec.gridGap}
        rows={[["meal", "third", "timer"]]}
      />
      <View style={{ height: spec.sectionGap }} />
      {notification}
    </>
  );
}
