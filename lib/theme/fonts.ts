/**
 * Brand typography.
 *
 * The type SCALE and tabular figures ship today using the platform system font
 * (see lib/theme/tokens.ts TYPE + TABULAR). Numbers use `fontVariant:
 * tabular-nums`, so animated count-ups never shift width - that requirement is
 * met without any custom font file.
 *
 * Enabling a custom open-licensed family (e.g. Lexend or Inter) is a HUMAN
 * drop-in, because binary .ttf assets can't be generated here:
 *
 *   1. Add the licensed .ttf files under assets/fonts/ (keep the license text
 *      alongside them, e.g. assets/fonts/OFL.txt).
 *   2. Uncomment loadAppFonts() below and point it at those files.
 *   3. Call it from app/_layout.tsx (expo-font is already installed):
 *
 *        const [fontsLoaded] = useFonts(APP_FONTS);
 *        // gate SplashScreen.hideAsync on fontsLoaded alongside `ready`.
 *
 *   4. Set FONT_FAMILY in lib/theme/tokens.ts to the loaded family name and add
 *      `fontFamily: FONT_FAMILY` to the shared Text style / type helpers.
 *
 * Until then FONT_FAMILY stays undefined and the system font is used - the app
 * renders correctly with no missing-asset crash.
 */

// import { useFonts } from "expo-font";
//
// export const APP_FONTS = {
//   "Brand-Regular": require("../../assets/fonts/Brand-Regular.ttf"),
//   "Brand-Medium": require("../../assets/fonts/Brand-Medium.ttf"),
//   "Brand-Semibold": require("../../assets/fonts/Brand-Semibold.ttf"),
//   "Brand-Bold": require("../../assets/fonts/Brand-Bold.ttf"),
// };
//
// export function useAppFonts() {
//   return useFonts(APP_FONTS);
// }

export {};
