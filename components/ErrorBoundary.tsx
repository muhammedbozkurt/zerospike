import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import i18n from "../lib/i18n";
import { logCrash } from "../lib/analytics";
import { THEME } from "../lib/theme/tokens";
import { AppBackground } from "./rich/AppBackground";
import { GradientCTA } from "./rich/GradientCTA";
import { IconTile } from "./rich/IconTile";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort screen for an uncaught render error anywhere below it. Without
 * this, React unmounts the whole failing subtree and only the dark
 * AppBackground wash is left on screen - reported (WP6) as a totally blank
 * page that only a full app restart recovered from.
 *
 * A class component on purpose: getDerivedStateFromError/componentDidCatch
 * have no hook equivalent. i18n strings are read straight off the i18next
 * singleton (see lib/services/notifications.ts for the same pattern) since
 * hooks are not available here; the fallback is on screen only briefly, so it
 * not re-rendering on a language change mid-crash is an acceptable trade.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (__DEV__) {
      console.error("[ErrorBoundary]", error, info.componentStack);
      return;
    }
    // logCrash already swallows its own failures (lib/analytics/index.ts), but
    // this boundary is the app's last line of defense - the fallback screen
    // below must render even if reporting itself somehow throws.
    try {
      logCrash(error, { componentStack: info.componentStack ?? undefined });
    } catch {
      // the retry screen still renders either way
    }
  }

  // Clears the caught error, which re-renders `children` - the subtree React
  // unmounted when the error was caught mounts fresh, exactly what "try again"
  // promises.
  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <ErrorFallback error={error} onRetry={this.retry} />;
  }
}

/** Function component so it can read the safe-area insets the class body
 *  cannot (no hooks in a class render). */
function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <AppBackground style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 28,
        }}
      >
        <IconTile icon="warning-outline" size={56} radius={18} style={{ marginBottom: 18 }} />
        <Text
          style={{ color: THEME.text, fontSize: 19, fontWeight: "800", textAlign: "center" }}
        >
          {i18n.t("errorBoundary.title")}
        </Text>
        <Text
          style={{
            color: THEME.textMuted,
            fontSize: 13,
            textAlign: "center",
            marginTop: 8,
            lineHeight: 19,
          }}
        >
          {i18n.t("errorBoundary.body")}
        </Text>
        {__DEV__ ? (
          <ScrollView
            style={{ maxHeight: 140, marginTop: 16, alignSelf: "stretch" }}
            contentContainerStyle={{
              borderWidth: 1,
              borderColor: THEME.border,
              borderRadius: 12,
              backgroundColor: THEME.surface,
              padding: 10,
            }}
          >
            <Text style={{ color: THEME.textMuted, fontSize: 11 }} selectable>
              {String(error.stack || error.message || error)}
            </Text>
          </ScrollView>
        ) : null}
        <GradientCTA
          label={i18n.t("errorBoundary.retry")}
          onPress={onRetry}
          style={{ marginTop: 24, alignSelf: "stretch" }}
        />
      </View>
    </AppBackground>
  );
}
