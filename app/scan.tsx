import React, { useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { cacheBarcodeFood, getFoodByBarcode } from "../lib/db/foods";
import { lookupBarcode, OFF_SOURCE } from "../lib/services/openFoodFacts";
import { Button } from "../components/ui";
import { FeedbackHost, useFeedback } from "../components/Feedback";

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
          brand: result.product.brand,
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
      <View className="w-64 h-44 rounded-3xl border-2 border-brand/80" />
      <Text className="text-zinc-200 mt-5 px-10 text-center">
        {t("scan.hint")}
      </Text>
    </View>
  );

  const CloseButton = (
    <Pressable
      onPress={() => router.back()}
      className="absolute right-5 w-10 h-10 rounded-full bg-black/60 items-center justify-center"
      style={{ top: insets.top + 8 }}
      hitSlop={10}
    >
      <Ionicons name="close" size={22} color="#fafafa" />
    </Pressable>
  );

  function renderContent() {
    // Permission still loading
    if (!permission) {
      return (
        <View className="flex-1 items-center justify-center">
          <Text className="text-zinc-400">{t("scan.requesting")}</Text>
        </View>
      );
    }

    // Not yet asked: show a short rationale whose only action proceeds to the
    // system permission prompt. No exit button and no "grant"-style wording, per
    // App Review guideline 5.1.1(iv).
    if (!permission.granted && permission.status === "undetermined") {
      return (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="camera-outline" size={48} color="#3f3f46" />
          <Text className="text-zinc-300 text-center my-4">
            {t("scan.permissionIntro")}
          </Text>
          <View className="w-full">
            <Button label={t("common.continue")} onPress={requestPermission} />
          </View>
        </View>
      );
    }

    // Previously denied: this is AFTER the system prompt, so navigation is fine;
    // guide the user to Settings to enable the camera.
    if (!permission.granted) {
      return (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="camera-outline" size={48} color="#3f3f46" />
          <Text className="text-zinc-300 text-center my-4">
            {t("scan.permissionDenied")}
          </Text>
          <View className="w-full">
            <Button label={t("scan.openSettings")} onPress={() => Linking.openSettings()} />
            <View className="h-3" />
            <Button
              label={t("common.close")}
              variant="secondary"
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
          <Ionicons name="alert-circle-outline" size={48} color="#3f3f46" />
          <Text className="text-zinc-300 text-center my-4">
            {t("scan.cameraError")}
          </Text>
          <View className="w-full">
            <Button label={t("scan.retry")} onPress={() => setCameraError(false)} />
            <View className="h-3" />
            <Button
              label={t("common.close")}
              variant="secondary"
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
    <View className="flex-1 bg-black">
      {renderContent()}

      {searching ? (
        <View
          pointerEvents="none"
          className="absolute left-0 right-0 items-center"
          style={{ bottom: insets.bottom + 48 }}
        >
          <View className="flex-row items-center rounded-full bg-zinc-900/95 border border-zinc-800 px-4 py-2.5">
            <ActivityIndicator size="small" color="#22d3ee" />
            <Text className="text-zinc-200 text-sm ml-2.5">{t("scan.searching")}</Text>
          </View>
        </View>
      ) : null}

      <FeedbackHost />
    </View>
  );
}
