import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import {
  MIN_SEARCH_QUERY_LENGTH,
  searchProducts,
  type OffProduct,
} from "../lib/services/openFoodFacts";
import { upsertOffFood } from "../lib/db/foods";
import type { Food, Lang } from "../lib/db/types";
import { num } from "../lib/format";
import { logCrash } from "../lib/analytics";
import { HIT_TARGET, TABULAR, THEME } from "../lib/theme/tokens";
import { DirIcon } from "./DirIcon";
import { Button } from "./ui";

/** Consecutive Open Food Facts SEARCH requests stay this far apart on the
 *  client side too - lib/services/openFoodFacts already refuses a call this
 *  soon, this is only what keeps the button from firing one it would refuse. */
const SEARCH_COOLDOWN_MS = 6000;

type Status = "idle" | "loading" | "done" | "error" | "limited";

interface Props {
  /** The catalogue search text the local FTS already ran on; queried against
   *  Open Food Facts verbatim on request, never on its own. */
  query: string;
  lang: Lang;
  /** The cached local row - not the raw OffProduct - so the caller can treat
   *  a picked result exactly like any other catalogue food from here on. */
  onPicked: (food: Food) => void;
}

/**
 * The catalogue's own FTS only knows what the app ships or the user has typed
 * before; this is the one extra source underneath it - a single,
 * user-initiated Open Food Facts lookup by name, never fired automatically.
 * Picking a result caches it locally (upsertOffFood) exactly the way a
 * scanned barcode does, so it behaves like any other food immediately after.
 */
export function OffSearchResults({ query, lang, onPicked }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<OffProduct[]>([]);
  const [cooldown, setCooldown] = useState(false);
  const [pickingBarcode, setPickingBarcode] = useState<string | null>(null);

  // A new typed query invalidates whatever the last OFF search answered -
  // the cooldown itself is a request-rate concern, not a per-query one, so it
  // is deliberately left running across this reset.
  useEffect(() => {
    setStatus("idle");
    setResults([]);
  }, [query]);

  async function runSearch() {
    if (cooldown || status === "loading") return;
    setStatus("loading");
    setCooldown(true);
    setTimeout(() => setCooldown(false), SEARCH_COOLDOWN_MS);
    try {
      const outcome = await searchProducts(query, lang);
      if (outcome.kind === "rate_limited") setStatus("limited");
      else if (outcome.kind === "unreachable") setStatus("error");
      else {
        setResults(outcome.products);
        setStatus("done");
      }
    } catch (err) {
      logCrash(err, { screen: "food", load: "offSearch" });
      setStatus("error");
    }
  }

  async function pick(product: OffProduct) {
    if (pickingBarcode) return;
    setPickingBarcode(product.barcode);
    try {
      const food = await upsertOffFood(product);
      onPicked(food);
    } catch (err) {
      logCrash(err, { screen: "food", load: "offSearchPick" });
      setStatus("error");
    } finally {
      setPickingBarcode(null);
    }
  }

  // Matches the floor searchProducts itself enforces (lib/services/openFoodFacts
  // MIN_SEARCH_QUERY_LENGTH) - hidden rather than shown-then-disabled, since a
  // one-character query is not a search a tap here could ever act on.
  if (query.trim().length < MIN_SEARCH_QUERY_LENGTH) return null;

  const isLoading = status === "loading";
  const ctaLabel =
    status === "error" || status === "limited" ? t("offSearch.retry") : t("offSearch.cta");

  return (
    <View style={{ marginTop: 4, marginBottom: 12 }}>
      <Button
        label={ctaLabel}
        variant="secondary"
        icon={<Ionicons name="cloud-download-outline" size={16} color={THEME.text} />}
        loading={isLoading}
        disabled={cooldown && !isLoading}
        onPress={runSearch}
      />

      {status === "error" || status === "limited" ? (
        <Text style={{ color: THEME.textMuted, fontSize: 12, marginTop: 8 }}>
          {status === "limited" ? t("offSearch.rateLimited") : t("offSearch.error")}
        </Text>
      ) : null}

      {status === "done" && results.length === 0 ? (
        <Text style={{ color: THEME.textMuted, fontSize: 12, marginTop: 8 }}>
          {t("offSearch.noResults")}
        </Text>
      ) : null}

      {status === "done" && results.length > 0 ? (
        <View style={{ marginTop: 10 }}>
          {results.map((product) => (
            <Pressable
              key={product.barcode}
              onPress={() => pick(product)}
              disabled={!!pickingBarcode}
              accessibilityRole="button"
              accessibilityLabel={`${product.names[lang]}, ${num(product.carb100g)} ${t("common.grams")}`}
              className="flex-row items-center rounded-2xl bg-glass border border-hair px-3 py-2.5 mb-2 active:opacity-80"
              style={{ minHeight: HIT_TARGET + 4 }}
            >
              <View className="flex-1 pr-2">
                <Text
                  style={{ color: THEME.text, fontWeight: "700", fontSize: 14 }}
                  numberOfLines={1}
                >
                  {product.names[lang]}
                </Text>
                {product.brand ? (
                  <Text
                    style={{ color: THEME.textMuted, fontSize: 11, marginTop: 2 }}
                    numberOfLines={1}
                  >
                    {product.brand}
                  </Text>
                ) : null}
              </View>
              <Text style={[TABULAR, { color: THEME.text, fontWeight: "800", fontSize: 14 }]}>
                {num(product.carb100g)}
                <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: "600" }}>
                  {t("common.grams")}
                </Text>
              </Text>
              {pickingBarcode === product.barcode ? (
                <ActivityIndicator size="small" color={THEME.accent} style={{ marginLeft: 8 }} />
              ) : (
                <DirIcon
                  name="chevron-forward"
                  size={16}
                  color={THEME.textMuted}
                  style={{ marginLeft: 8 }}
                />
              )}
            </Pressable>
          ))}
          <Text style={{ color: THEME.textMuted, fontSize: 10, marginTop: 2 }}>
            {t("offSearch.attribution")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
