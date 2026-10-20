/**
 * W3: the fixed geometry of the store-screenshot widget scene (app/
 * sc-widgets.tsx). Every number here is a POINT (iOS) or a DP (Android)
 * measured from the top-left of the device screen, never a flex share: the
 * previous round stretched each section over whatever height the window had
 * left, which is what produced the stretched empty cards on the tablets and
 * the huge mid-page gap on the iPad.
 *
 * Two hard external constraints shape the numbers:
 *
 * 1. VISIBLE BAND. The v2 composite (zerospike-store/pipeline/v2/
 *    targets-v2.json) scales the capture by width and cuts whatever falls past
 *    the canvas, so only the TOP of each capture is ever seen:
 *      iphone           748 pt of 956   (78.2%)
 *      ipad             790 pt of 1376  (57.4%)
 *      android-phone    456 dp of 800   (57.0%)
 *      android-tablet7  760 dp of 960   (79.1%)
 *      android-tablet10 1013 dp of 1280 (79.1%)
 *    All content is budgeted inside that band; only ONE element crosses it -
 *    the lock-screen notification card on iOS, the launcher filler on
 *    Android.
 *
 * 2. BLEED PROBE. selftest-v2's check 6c samples ONE pixel at the canvas'
 *    horizontal centre on a fixed row and fails when it is not at least 20
 *    luminance above the page margin (this is the check android-phone/
 *    03-widget failed for all nine languages last round: centre 57 vs margin
 *    39). Mapped back through each frame's own scale, that row lands at:
 *      iphone 674 pt, ipad 683 pt, android-phone 406 dp,
 *      android-tablet7 676 dp, android-tablet10 902 dp
 *    and the canvas centre maps to the exact horizontal centre of the screen
 *    on every profile. `probeY` below records it, and each profile's layout
 *    puts a continuous element across that row: on iOS the full-width
 *    notification card, on Android a filler icon row or the search pill.
 *    Filler icon rows carry an ODD number of icons for the same reason: with
 *    `space-between` the middle icon lands dead centre, so the probe can never
 *    fall in a gutter.
 *
 * W4 (this round): the iOS scene no longer draws the launcher filler at all -
 * the user's note was that a store panel has no business showing Apple's own
 * camera/mail/maps squares and a search pill. FillerSpec and DockFiller stay
 * for the three Android profiles, which are out of this round's scope.
 */

/** Which capture profile this window is. Keyed off the real OS + width, not
 *  the ?scPlatform flag: WidgetPreview only draws a real widget bitmap on
 *  Android itself. */
export type ScProfile = "iphone" | "ipad" | "androidPhone" | "androidTablet7" | "androidTablet10";

export function profileFor(os: string, width: number): ScProfile {
  if (os === "android") {
    if (width < 500) return "androidPhone";
    if (width < 700) return "androidTablet7";
    return "androidTablet10";
  }
  return width >= 700 ? "ipad" : "iphone";
}

/** The neutral launcher filler below the widgets: n rows of unbranded glass
 *  app squares, a search pill, then a dock bar that crosses the cut line. */
export interface FillerSpec {
  /** Absolute y of the filler's first row, from the top of the screen. */
  top: number;
  padX: number;
  iconRows: number;
  iconCols: number;
  iconSize: number;
  iconRadius: number;
  iconGlyph: number;
  iconRowGap: number;
  gapBeforePill: number;
  pillH: number;
  gapAfterPill: number;
  dockH: number;
  dockIcon: number;
  dockRadius: number;
}

export interface IosSpec {
  kind: "ios";
  padX: number;
  /** Absolute y the content column starts at (below the real status bar). */
  contentTop: number;
  twoColumn: boolean;
  colGap: number;
  leftW: number;
  rightW: number;
  /** iPad has no Dynamic Island, so it declares none. */
  island: { compactGap: number; gapAfter: number } | null;
  headingSize: number;
  headingH: number;
  /** W4 feedback 4: a heading and its own content are 12 pt apart, two
   *  sections 24 pt. Both are hard numbers here rather than per-scene guesses,
   *  because "the captions sit right on top of the cards" was the single most
   *  repeated note on the previous round. */
  headingGap: number;
  sectionGap: number;
  /** Lock screen, top to bottom exactly as iOS stacks it: the inline accessory
   *  ABOVE the clock, then the clock, the date, and the circular + rectangular
   *  pair under it. */
  inlineH: number;
  gapInlineToClock: number;
  clockSize: number;
  clockLine: number;
  dateSize: number;
  dateLine: number;
  gapClockToAccessory: number;
  accessoryH: number;
  /** The Live Activity is part of the lock screen on a real device, so it
   *  follows the accessories on this inner gap instead of opening a section of
   *  its own. */
  gapAccessoryToLive: number;
  liveH: number;
  /** The home-screen grid unit S: a systemSmall square. A systemMedium is
   *  2S + gridGap wide and S tall, exactly like the real WidgetKit canvas. */
  unit: number;
  gridGap: number;
  /** The lock-screen notification that carries the bleed. Its top is derived
   *  from the stack above it, never fixed, so a copy change cannot leave a gap
   *  between the last widget row and the card. */
  notif: { height: number; pad: number; icon: number; titleSize: number; bodySize: number; metaSize: number };
  probeY: number;
  visibleH: number;
}

export interface AndroidSpec {
  kind: "android";
  padX: number;
  contentTop: number;
  /** Launcher cell geometry. A span-n widget is n*cellW + (n-1)*gutter wide,
   *  which is what keeps every WidgetPreview at a real, fixed cell multiple
   *  instead of being stretched to fill a flex box. */
  cellW: number;
  gutter: number;
  cols: number;
  /** Height of the two glance widgets on row 1. */
  glanceH: number;
  quickAddH: number;
  singleH: number;
  /** Tablets stack LogGlucose over LogMeal in a 1-wide column beside the two
   *  glance widgets, and put Timer beside Quick Add; phones give the three
   *  single tiles their own row. */
  tablet: boolean;
  rowGutter: number;
  headingSize: number;
  headingH: number;
  sectionGap: number;
  rowGap: number;
  filler: FillerSpec;
  probeY: number;
  visibleH: number;
}

export type ScSpec = IosSpec | AndroidSpec;

const IPHONE: IosSpec = {
  kind: "ios",
  padX: 20,
  contentTop: 66,
  twoColumn: false,
  colGap: 0,
  leftW: 400,
  rightW: 400,
  island: { compactGap: 6, gapAfter: 12 },
  headingSize: 11,
  headingH: 14,
  headingGap: 12,
  sectionGap: 24,
  inlineH: 22,
  gapInlineToClock: 6,
  // 40, not the 76 a real lock screen sets: the whole stack is budgeted
  // against a 682 pt band (66..748) and the clock is the one dial this scene
  // is allowed to turn. See the budget below.
  clockSize: 40,
  clockLine: 44,
  dateSize: 14,
  dateLine: 19,
  gapClockToAccessory: 6,
  accessoryH: 52,
  gapAccessoryToLive: 6,
  liveH: 62,
  unit: 84,
  gridGap: 12,
  notif: { height: 130, pad: 14, icon: 26, titleSize: 14, bodySize: 12, metaSize: 11 },
  // THE BUDGET, in points from the top of the screen. Section captions and the
  // 12/24 gaps are fixed by the brief and never absorb an overflow:
  //   66  content top (safe area)
  //   66..216   Dynamic Island: compact 126x37 with the minimal circle beside
  //             it (66..103), +6, expanded 95 (109..204: 10 pad + 30 row + 6 +
  //             29 pill + 8 + 4 bar + 8 pad; it was 83 before the progress
  //             bar), +12
  //   216..230  "Kilit ekrani" caption, +12
  //   242..264  inline accessory, +6
  //   270..314  clock (44) - 314..333 date (19), +6
  //   339..391  circular + rectangular accessories, +6
  //   397..459  Live Activity card (62 = its natural Swift height, no
  //             progress bar: only the island's expanded view has one;
  //             inside the lock screen, no caption of its own: that is where
  //             iOS itself draws it), +24
  //   483..497  "Ana ekran ve mini widget'lar" caption, +12
  //   509..593  the one mini row: systemMedium (180) + systemSmall + one mini
  //             tile (the second row of three mini tiles was dropped for the
  //             island's 98 pt, see sc-widgets.tsx), +24
  //   617..747  the notification card, 130 pt, whole inside the 748 cut
  //             (unchanged from before the bar).
  // The bar's 12 pt were paid for by 12 pt of lock-screen slack: the
  // inline/clock/accessory/live gaps 8 -> 6 (-6), the island compact gap 8 -> 6
  // (-2) and the clock 48 -> 44 line (-4). Section captions and the 12/24 gaps
  // are untouched.
  // The 674 probe therefore lands 57 pt inside that card, which is the one
  // element on this screen with a light fill (ink 0.14) rather than a widget
  // gradient - the failure mode 6c caught on android-phone was a bleed element
  // DARKER than the page margin, and a darkest-wash card would repeat it.
  probeY: 674,
  visibleH: 748,
};

const IPAD: IosSpec = {
  kind: "ios",
  padX: 36,
  contentTop: 44,
  twoColumn: true,
  colGap: 32,
  // 424 + 32 + 504 = 960, the content width. The right column is not a taste
  // number: 504 is exactly 3 units + 2 gutters, so the home row (medium +
  // small) and the first mini row are the same width and the two columns have
  // a straight edge.
  leftW: 424,
  rightW: 504,
  island: null,
  headingSize: 12,
  headingH: 18,
  headingGap: 12,
  sectionGap: 24,
  inlineH: 28,
  gapInlineToClock: 12,
  clockSize: 96,
  clockLine: 106,
  dateSize: 20,
  dateLine: 26,
  gapClockToAccessory: 12,
  accessoryH: 84,
  gapAccessoryToLive: 16,
  // 112, not the 140 the column has room for. LiveActivityScene scales its
  // contents by height / 62 capped at 1.4 (islandSpec LIVE_CARD), so the card
  // keeps this box and the contents centre in it; a bigger scale truncated
  // the Arabic title in a 424 pt column.
  liveH: 112,
  unit: 156,
  gridGap: 18,
  notif: { height: 160, pad: 20, icon: 40, titleSize: 19, bodySize: 16, metaSize: 14 },
  // Budget. Left column (lock screen) 44..498, right column (widgets)
  // 44..614: caption 62, home row 74..230, +24, caption 272, mini row 1
  // 284..440, +18, mini row 2 458..614. The notification card is full width
  // under BOTH columns at 638..798, so it crosses the 790 cut and the 683
  // probe sits 45 pt inside it.
  probeY: 683,
  visibleH: 790,
};

const ANDROID_PHONE: AndroidSpec = {
  kind: "android",
  padX: 16,
  contentTop: 28,
  // The capture device (Medium_Phone_API_36.1) is 1080x2400 px at density
  // 420, i.e. 411 x 914 dp - NOT the 360 dp a 1080-wide phone would be at
  // xxhdpi. 4 columns of 88 dp with 8 dp gutters make the grid 376 dp, so a
  // 2-span widget is 184 dp and clears app.json's 180 dp minWidth for the
  // glance provider.
  cellW: 88,
  gutter: 8,
  cols: 4,
  // Per-row heights measured against what each widget actually draws rather
  // than one shared guess: at a flat 94 the glance card clipped its own
  // "Son 7 gun" meta line, because RemoteViews lays text out taller than the
  // nominal font metrics predict.
  glanceH: 106,
  quickAddH: 84,
  singleH: 90,
  tablet: false,
  rowGutter: 8,
  headingSize: 10,
  headingH: 12,
  // Three widget rows, so the leftover height goes into the space BETWEEN
  // launcher rows rather than into taller, half-empty cards: content runs
  // 28..362 dp, 78% of the 464.7 dp band above the scrim.
  sectionGap: 18,
  rowGap: 12,
  // The filler carries the rest to the cut: one icon row (372..430), then the
  // search pill (444..486) - which is what has to sit on the 463.8 bleed
  // probe, because every widget card's own background gradient bottoms out at
  // the darkest wash stop (luminance ~13 on dark), darker than the page margin check 6c
  // compares against - then the dock bar (498..618) across the 520.9 cut.
  filler: {
    top: 372,
    padX: 16,
    iconRows: 1,
    iconCols: 5,
    iconSize: 58,
    iconRadius: 16,
    iconGlyph: 24,
    iconRowGap: 12,
    gapBeforePill: 14,
    pillH: 42,
    gapAfterPill: 12,
    dockH: 120,
    dockIcon: 58,
    dockRadius: 28,
  },
  probeY: 464,
  visibleH: 521,
};

const ANDROID_TABLET7: AndroidSpec = {
  kind: "android",
  padX: 18,
  contentTop: 40,
  // 1200x1920 px at density 320 -> 600x960 dp. Six columns of 84 dp with 12 dp
  // gutters exactly fills the 564 dp content width, and a 2-span widget is
  // 180 dp - the Zerospike glance provider's own declared minWidth to the dp
  // (app.json). Both rows are a full six columns, so the grid has no ragged
  // right edge to leave empty.
  cellW: 84,
  gutter: 12,
  cols: 6,
  // The glance card carries the next-reminder label and its time pill under
  // the value whenever a reminder is upcoming: ~150 dp of drawn content in
  // ja/ar, whose taller lines cut the pill's bottom edge at 152 and 160; 112 dp cut
  // the card right under the "Last 7 days" line. The shortcut tiles still need only 87 dp, so
  // they keep their own 112 dp row.
  glanceH: 168,
  quickAddH: 112,
  singleH: 112,
  tablet: true,
  rowGutter: 12,
  headingSize: 12,
  headingH: 16,
  // 8 (was 20) so the taller glance row still ends at 360 dp, clear of the
  // launcher filler that starts at 376.
  sectionGap: 8,
  rowGap: 16,
  // Content now ends at 360 dp of a 677 dp clean band, so the launcher filler
  // is what uses the rest of the tablet: three icon rows (376..636), then the
  // search pill (640..712) centred on the 676.4 probe, then a dock bar
  // (732..872) across the 759.7 cut.
  filler: {
    top: 376,
    padX: 18,
    iconRows: 3,
    iconCols: 5,
    iconSize: 80,
    iconRadius: 20,
    iconGlyph: 32,
    iconRowGap: 10,
    gapBeforePill: 4,
    pillH: 72,
    gapAfterPill: 20,
    dockH: 140,
    dockIcon: 88,
    dockRadius: 34,
  },
  probeY: 676,
  visibleH: 760,
};

const ANDROID_TABLET10: AndroidSpec = {
  kind: "android",
  padX: 30,
  contentTop: 44,
  // 1600x2560 px at density 320 -> 800x1280 dp. Six columns of 110 dp with
  // 16 dp gutters fills the 740 dp content width; a 2-span is 236 dp.
  cellW: 110,
  gutter: 16,
  cols: 6,
  // 120 dp: the shortcut tiles are not "compact" at this cell width (110 dp),
  // so they draw the 40 dp icon and the 14 pt two-line label - 110 dp of
  // content - and the glance card wants ~95.
  glanceH: 120,
  quickAddH: 120,
  singleH: 120,
  tablet: true,
  rowGutter: 16,
  headingSize: 13,
  headingH: 18,
  sectionGap: 24,
  rowGap: 18,
  // Content ends at 344 dp of a 903 dp clean band. Four icon rows
  // (390..844) fill the tablet screen, the pill (862..942) is centred on the
  // 902 probe, and the dock (966..1146) crosses the 1012.8 cut.
  filler: {
    top: 390,
    padX: 30,
    iconRows: 4,
    iconCols: 5,
    iconSize: 100,
    iconRadius: 26,
    iconGlyph: 38,
    iconRowGap: 18,
    gapBeforePill: 18,
    pillH: 80,
    gapAfterPill: 24,
    dockH: 180,
    dockIcon: 112,
    dockRadius: 42,
  },
  probeY: 902,
  visibleH: 1013,
};

const SPECS: Record<ScProfile, ScSpec> = {
  iphone: IPHONE,
  ipad: IPAD,
  androidPhone: ANDROID_PHONE,
  androidTablet7: ANDROID_TABLET7,
  androidTablet10: ANDROID_TABLET10,
};

export function specFor(profile: ScProfile): ScSpec {
  return SPECS[profile];
}

/** Width of a widget spanning `n` launcher cells. */
export function spanW(spec: AndroidSpec, n: number): number {
  return n * spec.cellW + (n - 1) * spec.gutter;
}
