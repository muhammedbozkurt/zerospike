import React, { useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { getFoodByBarcode } from "../lib/db/foods";
import { Button } from "../components/ui";
import { useFeedback } from "../components/Feedback";

export default function ScanScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { confirm } = useFeedback();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const lastCode = useRef<string | null>(null);

  async function handleScanned(data: string) {
    // Ignore while a lookup is in flight, and skip the SAME code the user just
    // declined so a barcode sitting in frame does not re-prompt in a loop.
    if (locked || data === lastCode.current) return;
    setLocked(true);
    lastCode.current = data;

    const food = await getFoodByBarcode(data);
    if (food) {
      router.replace({ pathname: "/calculator", params: { foodId: food.id } });
      return;
    }

    const saveNew = await confirm({
      title: t("scan.notFoundTitle"),
      message: t("scan.notFoundBody", { code: data }),
      confirmLabel: t("scan.saveAsNew"),
      cancelLabel: t("scan.scanAgain"),
      icon: "barcode-outline",
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

  // Permission still loading
  if (!permission) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <Text className="text-zinc-400">{t("scan.requesting")}</Text>
      </View>
    );
  }

  // Not yet asked: show a short rationale whose only action proceeds to the
  // system permission prompt. No exit button and no "grant"-style wording, per
  // App Review guideline 5.1.1(iv).
  if (!permission.granted && permission.status === "undetermined") {
    return (
      <View className="flex-1 bg-black items-center justify-center px-8">
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

  // Previously denied: this is AFTER the system prompt, so navigation is fine —
  // guide the user to Settings to enable the camera.
  if (!permission.granted) {
    return (
      <View className="flex-1 bg-black items-center justify-center px-8">
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
      <View className="flex-1 bg-black items-center justify-center px-8">
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
    <View className="flex-1 bg-black">
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
