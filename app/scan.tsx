import React, { useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { cacheBarcodeFood, getFoodByBarcode } from "../lib/db/foods";
import { lookupBarcode, OFF_SOURCE } from "../lib/services/openFoodFacts";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { AppBackground, GradientCTA, IconTile } from "../components/rich";
import { THEME, glow } from "../lib/theme/tokens";

export default function ScanScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { confirm } = useFeedback();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [searching, setSearching] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const lastCode = useRef<string | null>(null);

  function openCalculator(foodId: string) {
    router.replace({ pathname: "/calculator", params: { foodId } });
  }

  /**
   * Local cache first, then Open Food Facts. A hit is written to the local
   * `foods` table keyed by the barcode, so scanning the same product again
   * resolves offline. Every miss (unknown code, no carbohydrate figure, no
   * network) lands in the same manual flow with the barcode pre-filled.
   */
  async function handleScanned(data: string) {
    // Ignore while a lookup is in flight, and skip the SAME code the user just
    // declined so a barcode sitting in frame does not re-prompt in a loop.
    if (locked || data === lastCode.current) return;
    setLocked(true);
    lastCode.current = data;

    const cached = await getFoodByBarcode(data);
    if (cached) {
      openCalculator(cached.id);
      return;
    }

    setSearching(true);
    const result = await lookupBarcode(data);
    setSearching(false);

    if (result.kind === "found") {
      try {
        const food = await cacheBarcodeFood({
          barcode: result.product.barcode,
          name: result.product.name,
          names: result.product.names,
          brand: result.product.brand,
          category: result.product.category,
          carb_100g: result.product.carb100g,
          portion_size_g: result.product.portionG,
          source: OFF_SOURCE,
        });
        openCalculator(food.id);
        return;
      } catch {
        // Caching failed; fall through to the manual flow rather than dead-end.
      }
    }

    const unreachable = result.kind === "unreachable";
    const saveNew = await confirm({
      title: unreachable ? t("scan.offlineTitle") : t("scan.notFoundTitle"),
      message: unreachable
        ? t("scan.offlineBody", { code: data })
        : t("scan.notFoundBody", { code: data }),
      confirmLabel: t("scan.saveAsNew"),
      cancelLabel: t("scan.scanAgain"),
      icon: unreachable ? "cloud-offline-outline" : "barcode-outline",
    });
    if (saveNew) {
      router.replace({ pathname: "/add-food", params: { barcode: data } });
    } else {
      // Keep lastCode so the same barcode is not re-scanned immediately; a
      // different product scans normally.
      setLocked(false);
    }
  }

  const Frame = (
    <View
      className="absolute left-0 right-0 top-0 bottom-0 items-center justify-center"
      pointerEvents="box-none"
    >
      <View
        className="w-64 h-44 rounded-3xl items-center justify-center"
        style={[
          { borderWidth: 2, borderColor: THEME.accent, backgroundColor: "rgba(46,230,255,0.06)" },
          glow(THEME.accent, 40, 0.7),
        ]}
      >
        <View
          className="rounded-2xl"
          style={{
            position: "absolute",
            left: 14,
            right: 14,
            top: 14,
            bottom: 14,
            borderWidth: 1,
            borderColor: "rgba(46,230,255,0.5)",
            borderStyle: "dashed",
          }}
        />
        {/* glowing scan line */}
        <View
          style={[
            { position: "absolute", left: 18, right: 18, height: 2, backgroundColor: THEME.accent },
            glow(THEME.accent, 14, 0.9),
          ]}
        />
      </View>
      <Text
        style={{ color: THEME.ink, marginTop: 20, textAlign: "center", paddingHorizontal: 40 }}
      >
        {t("scan.hint")}
      </Text>
      {/* The mockup's glass pill: the manual route out of a scan that will not
          resolve, always visible rather than hidden behind a failed lookup. */}
      <Pressable
        onPress={() => router.replace({ pathname: "/add-food" })}
        className="flex-row items-center rounded-full px-4 py-2 mt-4 active:opacity-80"
        style={{ borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.glass }}
      >
        <Ionicons name="create-outline" size={14} color={THEME.accent} />
        <Text style={{ color: THEME.ink, fontSize: 12, marginLeft: 6 }}>
          {t("scan.saveAsNew")}
        </Text>
      </Pressable>
    </View>
  );

  const CloseButton = (
    <Pressable
      onPress={() => router.back()}
      className="absolute right-5"
      style={{ top: insets.top + 8 }}
      hitSlop={10}
      accessibilityLabel={t("common.close")}
    >
      <IconTile icon="close" size={38} radius={19} tint={THEME.ink} />
    </Pressable>
  );

  function renderContent() {
    // Permission still loading
    if (!permission) {
      return (
        <View className="flex-1 items-center justify-center">
          <Text style={{ color: THEME.muted }}>{t("scan.requesting")}</Text>
        </View>
      );
    }

    // Not yet asked: show a short rationale whose only action proceeds to the
    // system permission prompt. No exit button and no "grant"-style wording, per
    // App Review guideline 5.1.1(iv).
    if (!permission.granted && permission.status === "undetermined") {
      return (
        <View className="flex-1 items-center justify-center px-8">
          <IconTile icon="camera-outline" size={64} radius={20} hero />
          <Text style={{ color: THEME.muted, textAlign: "center", marginVertical: 16, lineHeight: 20 }}>
            {t("scan.permissionIntro")}
          </Text>
          <View className="w-full">
            <GradientCTA label={t("common.continue")} onPress={requestPermission} />
          </View>
        </View>
      );
    }

    // Previously denied: this is AFTER the system prompt, so navigation is fine;
    // guide the user to Settings to enable the camera.
    if (!permission.granted) {
      return (
        <View className="flex-1 items-center justify-center px-8">
          <IconTile icon="camera-outline" size={64} radius={20} hero />
          <Text style={{ color: THEME.muted, textAlign: "center", marginVertical: 16, lineHeight: 20 }}>
            {t("scan.permissionDenied")}
          </Text>
          <View className="w-full">
            <GradientCTA label={t("scan.openSettings")} onPress={() => Linking.openSettings()} />
            <View className="h-3" />
            <GradientCTA
              label={t("common.close")}
              variant="sub"
              onPress={() => router.back()}
            />
          </View>
        </View>
      );
    }

    // Camera hardware/mount failure: never leave a black screen with no way out.
    if (cameraError) {
      return (
        <View className="flex-1 items-center justify-center px-8">
          <IconTile icon="alert-circle-outline" size={64} radius={20} hero />
          <Text style={{ color: THEME.muted, textAlign: "center", marginVertical: 16, lineHeight: 20 }}>
            {t("scan.cameraError")}
          </Text>
          <View className="w-full">
            <GradientCTA label={t("scan.retry")} onPress={() => setCameraError(false)} />
            <View className="h-3" />
            <GradientCTA
              label={t("common.close")}
              variant="sub"
              onPress={() => router.back()}
            />
          </View>
        </View>
      );
    }

    return (
      <View className="flex-1">
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          onMountError={() => setCameraError(true)}
          barcodeScannerSettings={{
            barcodeTypes: [
              "ean13",
              "ean8",
              "upc_a",
              "upc_e",
              "code128",
              "code39",
              "qr",
              "itf14",
            ],
          }}
          onBarcodeScanned={
            locked ? undefined : ({ data }) => handleScanned(data)
          }
        />
        {Frame}
        {CloseButton}
      </View>
    );
  }

  // The host stays mounted across every branch so the "not found" dialog is
  // drawn over the camera, inside this screen's own view controller.
  return (
    <AppBackground>
      {renderContent()}

      {searching ? (
        <View
          pointerEvents="none"
          className="absolute left-0 right-0 items-center"
          style={{ bottom: insets.bottom + 48 }}
        >
          <View
            className="flex-row items-center rounded-full px-4 py-2.5"
            style={{
              borderWidth: 1,
              borderColor: THEME.border,
              backgroundColor: "rgba(8,14,20,0.92)",
            }}
          >
            <ActivityIndicator size="small" color={THEME.accent} />
            <Text style={{ color: THEME.ink, fontSize: 13, marginLeft: 10 }}>
              {t("scan.searching")}
            </Text>
          </View>
        </View>
      ) : null}

      <FeedbackHost />
    </AppBackground>
  );
}
