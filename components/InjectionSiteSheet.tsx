import React from "react";
import { useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";

import type { SiteUsage } from "../lib/db/injections";
import { InjectionBodyMap, type PointSelection } from "./InjectionBodyMap";
import { SheetShell } from "./SheetShell";
import { Skeleton } from "./Skeleton";
import { Button } from "./ui";

const USAGE_WINDOW_DAYS = 30;

/**
 * Region picker as a bottom sheet over the silhouette. It rides on SheetShell
 * (fit=false: always the full allowance), so the map, the legend and the close
 * button live under a title row that never moves, on the 560 pt tablet box as
 * on a phone; a short screen or a large font scrolls the map instead of
 * pushing the legend or the button off screen.
 */
export function InjectionSiteSheet({
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
  /** undefined while the lazy fetch hasn't resolved yet: a skeleton holds the
   *  map's place until it does. */
  usage: SiteUsage[] | undefined;
  noSiteCount: number;
  selected: PointSelection | null;
  onSelect: (selection: PointSelection) => void;
  /** Pro gate for the rotation-suggestion ring (passed through as isProUser). */
  showRotationHint: boolean;
}) {
  const { t } = useTranslation();
  const { height: winH } = useWindowDimensions();
  // Matches InjectionBodyMap's own minHeight floor, so the skeleton reserves
  // exactly the space the real silhouette will occupy.
  const mapMinHeight = Math.round(winH * 0.5);

  return (
    <SheetShell
      visible={visible}
      onClose={onClose}
      title={t("injection.selectSite")}
      closeLabel={t("common.close")}
      maxHeightRatio={0.92}
      fit={false}
      footer={<Button label={t("common.close")} variant="ghost" onPress={onClose} />}
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
    </SheetShell>
  );
}
