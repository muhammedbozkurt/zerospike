import React from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { WidgetPreview } from "react-native-android-widget";

import {
  buildLogGlucoseWidget,
  buildLogMealWidget,
  buildQuickAddWidget,
  buildReadingWidget,
  buildTimerWidget,
  buildZerospikeWidget,
} from "../../lib/services/androidWidget";
import type { LiveData } from "../../lib/services/liveData";
import { WIDGET_DARK, WIDGET_LIGHT } from "../../lib/services/widgetColors";
import { THEME } from "../../lib/theme/tokens";
import { SectionHeading } from "./SectionHeading";
import { spanW, type AndroidSpec } from "./layout";

/**
 * Android launcher replica: the SAME widget trees the real android-widget task
 * handler renders (lib/services/androidWidget.ts), drawn through the library's
 * own WidgetPreview, so there is no second hand-copied layout to drift out of
 * step with a real home screen.
 *
 * Every preview is given a FIXED dp box that is a whole number of launcher
 * cells (layout.ts: cellW/gutter, and app.json's own minWidth/minHeight for
 * each provider), never a flex share. Last round each preview was handed
 * whatever its column had left, which is what produced the tall empty cards
 * stretched down the tablet screens: the Quick Add provider is declared
 * resizeMode "horizontal" and the three action tiles "none" (android/app/src/
 * main/res/xml/widgetprovider_*.xml), so NONE of them ever grows vertically on
 * a real launcher, and a stretched one is the single clearest tell that a
 * screenshot is a mock.
 *
 * The grid is a fixed-width block centred in the content area, with the
 * section captions sharing its left edge - so the leftover width is a real
 * launcher margin rather than a gap torn open inside the grid.
 *
 * Plain "row": RN's own forceRTL already mirrors a physical row under RTL.
 */
export function AndroidScene({ data, spec }: { data: LiveData | null; spec: AndroidSpec }) {
  const { t } = useTranslation();
  const pal = THEME.scheme === "light" ? WIDGET_LIGHT : WIDGET_DARK;
  const one = spanW(spec, 1);
  const two = spanW(spec, 2);
  const four = spanW(spec, 4);
  const five = spanW(spec, 5);
  const gridW = spanW(spec, spec.tablet ? 6 : 4);

  // TABLET: six columns, two rows, every widget one cell tall and one cell
  // wide unless its provider is declared resizable.
  //   R1  glance 2 | reading 2 | timer 1 | log glucose 1
  //   R2  quick add 5 | log meal 1
  // The timer is ONE cell because ZerospikeTimer is declared resizeMode "none"
  // (android/app/src/main/res/xml/widgetprovider_*.xml): a launcher never
  // offers it a second column, so drawing it across two was showing a
  // placement that cannot exist. Its German title still fits, over two lines,
  // since buildTimerWidget now sets maxLines 2 on a title that has a word
  // break and lets the TextView autosize. Quick Add takes the odd column
  // instead of leaving a hole - that one IS declared resizeMode "horizontal".
  const tabletRows = (
    <>
      <View style={{ flexDirection: "row", gap: spec.gutter }}>
        <WidgetPreview width={two} height={spec.glanceH} renderWidget={(s) => buildZerospikeWidget(data, s, pal)} />
        <WidgetPreview width={two} height={spec.glanceH} renderWidget={(s) => buildReadingWidget(data, s, pal)} />
        <WidgetPreview width={one} height={spec.glanceH} renderWidget={(s) => buildTimerWidget(data, s, pal)} />
        <WidgetPreview width={one} height={spec.glanceH} renderWidget={(s) => buildLogGlucoseWidget(data, s, pal)} />
      </View>
      <SectionGap height={spec.sectionGap} />
      <SectionHeading size={spec.headingSize} height={spec.headingH}>
        {t("scWidgets.miniWidgets")}
      </SectionHeading>
      <View style={{ flexDirection: "row", gap: spec.gutter }}>
        <WidgetPreview width={five} height={spec.quickAddH} renderWidget={(s) => buildQuickAddWidget(data, s, pal)} />
        <WidgetPreview width={one} height={spec.singleH} renderWidget={(s) => buildLogMealWidget(data, s, pal)} />
      </View>
    </>
  );

  // PHONE: four columns, three rows.
  //   R1  glance 2 | reading 2
  //   R2  quick add 4
  //   R3  log glucose 1 | log meal 1 | timer 1 | (empty)
  // There is no fourth row and no fourth tile in row 3: app.json declares
  // exactly six providers and all six are on screen by row 3, so anything more
  // would be the same widget drawn twice. The trailing cell simply stays
  // empty, which is what the end of a real home-screen row looks like.
  const phoneRows = (
    <>
      <View style={{ flexDirection: "row", gap: spec.gutter }}>
        <WidgetPreview width={two} height={spec.glanceH} renderWidget={(s) => buildZerospikeWidget(data, s, pal)} />
        <WidgetPreview width={two} height={spec.glanceH} renderWidget={(s) => buildReadingWidget(data, s, pal)} />
      </View>
      <View style={{ height: spec.rowGap }} />
      <WidgetPreview width={four} height={spec.quickAddH} renderWidget={(s) => buildQuickAddWidget(data, s, pal)} />
      <SectionGap height={spec.sectionGap} />
      <SectionHeading size={spec.headingSize} height={spec.headingH}>
        {t("scWidgets.miniWidgets")}
      </SectionHeading>
      <View style={{ flexDirection: "row", gap: spec.gutter }}>
        <WidgetPreview width={one} height={spec.singleH} renderWidget={(s) => buildLogGlucoseWidget(data, s, pal)} />
        <WidgetPreview width={one} height={spec.singleH} renderWidget={(s) => buildLogMealWidget(data, s, pal)} />
        <WidgetPreview width={one} height={spec.singleH} renderWidget={(s) => buildTimerWidget(data, s, pal)} />
      </View>
    </>
  );

  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ width: gridW }}>
        <SectionHeading size={spec.headingSize} height={spec.headingH}>
          {t("scWidgets.homeScreen")}
        </SectionHeading>
        {spec.tablet ? tabletRows : phoneRows}
      </View>
    </View>
  );
}

function SectionGap({ height }: { height: number }) {
  return <View style={{ height }} />;
}
