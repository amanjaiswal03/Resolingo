import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { languageById, type DailyPick, type LanguageId } from "@resolingo/shared";
import { percentWidth } from "@/lesson/navigation";
import { useTheme } from "@/theme/tokens";
import { LessonArtwork } from "@/components/LessonArtwork";
import { pickDateLabel, typeLabel, type PickCardState } from "./lesson-of-the-day";

const INK = "#08152F";
const WHITE = "#FFFFFF";
const SOFT = "rgba(255,255,255,0.78)";
const FAINT = "rgba(255,255,255,0.18)";

/** Gradients sit on both the light and the navy background, so each starts from deep navy. */
const GRADIENT = {
  conversation: ["#08152F", "#133A62", "#0B7A6B"],
  grammar: ["#08152F", "#1B2F63", "#3E4FA8"],
  welcome: ["#0B7A6B", "#0B4F5C", "#08152F"],
} as const;

const WELCOME_POINTS = [
  "Short audio lessons, 5 to 8 minutes",
  "Answer out loud at every pause",
  "Each lesson builds on the last one",
] as const;

function languageName(id: LanguageId): string {
  return languageById[id]?.label.replace(/\s*\(.*\)$/u, "") ?? id;
}

function Cta({ label, icon, disabled }: { label: string; icon?: string; disabled?: boolean }) {
  return (
    <View style={[styles.cta, disabled ? styles.ctaDisabled : null]}>
      <Text style={[styles.ctaText, disabled ? styles.ctaTextDisabled : null]} maxFontSizeMultiplier={1.4}>{label}</Text>
      {icon ? <Text style={[styles.ctaText, disabled ? styles.ctaTextDisabled : null]} maxFontSizeMultiplier={1.4}>{icon}</Text> : null}
    </View>
  );
}

function Footer({ state, welcome }: { state: PickCardState; welcome: boolean }) {
  if (state.kind === "preparing") {
    return (
      <View style={styles.preparing}>
        <View style={styles.preparingRow}>
          <ActivityIndicator color={WHITE} size="small" />
          <Text style={styles.meta} maxFontSizeMultiplier={1.5}>{welcome ? "Preparing your welcome lesson" : "Writing your lesson"} · {state.progress}%</Text>
        </View>
        <View style={styles.track}><View style={[styles.fill, { width: percentWidth(state.progress) }]} /></View>
      </View>
    );
  }
  const meta = state.kind === "done" ? "Done for today · new pick tomorrow"
    : state.kind === "blocked" ? "Today's 3 lessons are used"
    : state.kind === "ready" ? "Ready · about 6 minutes"
    : welcome ? "Free · ready in about a minute"
    : "5–8 min · Made fresh when you tap";
  return (
    <View style={styles.footer}>
      <Text style={[styles.meta, styles.footerMeta]} maxFontSizeMultiplier={1.5}>{meta}</Text>
      {state.kind === "ready" ? <Cta label="Play" icon="▶" />
        : state.kind === "done" ? <Cta label="Play again" icon="↻" />
        : state.kind === "blocked" ? <Cta label="Tomorrow" disabled />
        : state.kind === "planned" && state.retry ? <Cta label="Try again" icon="↻" />
        : <Cta label={welcome ? "Start" : "Start lesson"} icon="→" />}
    </View>
  );
}

/**
 * The highlighted card above the lesson choices. It shows the topic picked
 * for today, and writes the lesson only when tapped. A new learner sees a
 * welcome lesson in their two languages instead.
 */
export function LessonOfTheDayCard({ pick, state, nativeLanguage, targetLanguage, onPress, onPressIn }: {
  pick: DailyPick;
  state: PickCardState;
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
  onPress: () => void;
  onPressIn?: () => void;
}) {
  const theme = useTheme();
  const welcome = pick.kind === "welcome";
  const accent = pick.type === "grammar" ? theme.mint : theme.amber;
  const colors = welcome ? GRADIENT.welcome : GRADIENT[pick.type];
  const disabled = state.kind === "blocked";
  const label = welcome
    ? `Welcome lesson, ${pick.title}. ${state.kind === "ready" ? "Ready to play." : state.kind === "preparing" ? "Preparing." : "Tap to start."}`
    : `Lesson of the day, ${typeLabel[pick.type]}: ${pick.title}. ${pick.why}.`;
  return (
    <Pressable
      onPressIn={onPressIn}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: state.kind === "preparing" }}
      style={({ pressed }) => [styles.press, pressed && !disabled ? styles.pressed : null]}
    >
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={[styles.glow, { backgroundColor: welcome ? theme.mint : accent }]} pointerEvents="none" />
        <View style={styles.topRow}>
          <Text style={[styles.eyebrow, { color: welcome ? theme.mint : accent }]} maxFontSizeMultiplier={1.4}>
            {welcome ? "✦ WELCOME" : "✦ LESSON OF THE DAY"}
          </Text>
          {welcome ? null : <Text style={styles.date} maxFontSizeMultiplier={1.4}>{pickDateLabel(pick.date)}</Text>}
        </View>

        {welcome ? (
          <View style={styles.pair} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.langPill}><Text style={styles.langText} maxFontSizeMultiplier={1.4}>{languageName(nativeLanguage)}</Text></View>
            <Text style={styles.arrow}>→</Text>
            <View style={[styles.langPill, { backgroundColor: theme.mint }]}><Text style={[styles.langText, { color: INK }]} maxFontSizeMultiplier={1.4}>{languageName(targetLanguage)}</Text></View>
          </View>
        ) : (
          <View style={styles.chips}>
            <View style={[styles.chip, { backgroundColor: accent }]}><Text style={styles.chipText} maxFontSizeMultiplier={1.4}>{typeLabel[pick.type]}</Text></View>
            <View style={[styles.chip, styles.chipGhost]}><Text style={[styles.chipText, { color: WHITE }]} maxFontSizeMultiplier={1.4}>{pick.level}</Text></View>
          </View>
        )}

        <View style={styles.copyRow}>
          <View style={[styles.copy, styles.copyText]}>
            <Text style={styles.title} maxFontSizeMultiplier={1.4} numberOfLines={3}>{state.kind === "ready" || state.kind === "done" ? state.lesson.title : pick.title}</Text>
            <Text style={styles.why} maxFontSizeMultiplier={1.5}>{pick.why}</Text>
          </View>
          {(state.kind === "ready" || state.kind === "done") && state.lesson.artworkPath ? <LessonArtwork lesson={state.lesson} size={84} radius={18} /> : null}
        </View>

        {welcome && state.kind !== "done" ? (
          <View style={styles.points}>
            {WELCOME_POINTS.map((point) => (
              <View key={point} style={styles.point}>
                <View style={[styles.dot, { backgroundColor: theme.mint }]} />
                <Text style={styles.pointText} maxFontSizeMultiplier={1.5}>{point}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Footer state={state} welcome={welcome} />
      </LinearGradient>
    </Pressable>
  );
}

/** Shown while today's pick loads, at the same height so the page does not jump. */
export function LessonOfTheDayPlaceholder() {
  const theme = useTheme();
  return (
    <View style={[styles.card, styles.placeholder, { backgroundColor: theme.surfaceMuted }]} accessibilityLabel="Loading the lesson of the day">
      <View style={[styles.bar, { width: "42%", backgroundColor: theme.border }]} />
      <View style={[styles.bar, styles.barTall, { width: "82%", backgroundColor: theme.border }]} />
      <View style={[styles.bar, { width: "60%", backgroundColor: theme.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  press: { borderRadius: 26, zIndex: 2 },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.96 },
  card: { borderRadius: 26, padding: 20, gap: 14, overflow: "hidden", minHeight: 220 },
  glow: { position: "absolute", width: 220, height: 220, borderRadius: 110, right: -80, top: -90, opacity: 0.22 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: "800", letterSpacing: 1.6 },
  date: { color: SOFT, fontSize: 13, lineHeight: 16, fontWeight: "600" },
  chips: { flexDirection: "row", gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipGhost: { backgroundColor: FAINT },
  chipText: { color: INK, fontSize: 13, lineHeight: 17, fontWeight: "800" },
  pair: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  langPill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: FAINT },
  langText: { color: WHITE, fontSize: 14, lineHeight: 18, fontWeight: "800" },
  arrow: { color: SOFT, fontSize: 16, fontWeight: "800" },
  copy: { gap: 6 },
  copyRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  copyText: { flex: 1 },
  title: { color: WHITE, fontSize: 27, lineHeight: 32, fontWeight: "800", letterSpacing: -0.4 },
  why: { color: SOFT, fontSize: 15, lineHeight: 21 },
  points: { gap: 7 },
  point: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pointText: { color: WHITE, fontSize: 15, lineHeight: 20, fontWeight: "600" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 2 },
  footerMeta: { flex: 1 },
  meta: { color: SOFT, fontSize: 14, lineHeight: 18, fontWeight: "600" },
  cta: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: WHITE, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  ctaDisabled: { backgroundColor: FAINT },
  ctaText: { color: INK, fontSize: 15, lineHeight: 19, fontWeight: "800" },
  ctaTextDisabled: { color: SOFT },
  preparing: { gap: 8, marginTop: 2 },
  preparingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  track: { height: 6, borderRadius: 3, backgroundColor: FAINT, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: WHITE },
  placeholder: { justifyContent: "center", gap: 12 },
  bar: { height: 12, borderRadius: 6 },
  barTall: { height: 26, borderRadius: 8 },
});
