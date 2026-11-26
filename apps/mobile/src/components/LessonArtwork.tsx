import { useEffect, useState } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { Lesson } from "@resolingo/shared";
import { resolveArtworkUrl } from "@/services/lessons";
import { lessonAccent } from "@/theme/colors";
import { useTheme } from "@/theme/tokens";
import { Body } from "./Typography";

const kindMark = { conversation: "C", grammar: "G", phrase: "P" } as const;

/** Resolves a lesson's artwork URL. Undefined while loading and for lessons made before artwork existed. */
export function useArtworkUrl(lesson: Pick<Lesson, "artworkPath" | "artworkUrl">): string | undefined {
  const [resolved, setResolved] = useState<{ path: string; url: string | undefined } | null>(null);
  const path = lesson.artworkUrl ? undefined : lesson.artworkPath;
  useEffect(() => {
    if (!path) return;
    let active = true;
    void resolveArtworkUrl(path).then((url) => {
      if (active) setResolved({ path, url });
    });
    return () => { active = false; };
  }, [path]);
  if (lesson.artworkUrl) return lesson.artworkUrl;
  return resolved && resolved.path === path ? resolved.url : undefined;
}

/**
 * The lesson's topic artwork, or the colored type badge for older lessons and while it loads.
 */
export function LessonArtwork({
  lesson,
  size,
  radius = Math.round(size * 0.3),
  style,
}: {
  lesson: Pick<Lesson, "artworkPath" | "artworkUrl" | "type">;
  size: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const url = useArtworkUrl(lesson);
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = url != null && failed !== url;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, { width: size, height: size, borderRadius: radius, backgroundColor: lessonAccent(theme, lesson.type) }, style]}
    >
      {showImage ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailed(url)} />
      ) : (
        <Body style={[styles.mark, { fontSize: Math.max(14, Math.round(size * 0.4)), lineHeight: Math.max(18, Math.round(size * 0.5)) }]}>{kindMark[lesson.type]}</Body>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
  mark: { color: "#08152F", fontWeight: "800" },
});
