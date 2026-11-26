import { Children, Fragment, type PropsWithChildren, type ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useTheme } from "@/theme/tokens";
import { Body } from "./Typography";

/** A titled group of rows on one rounded surface, like iOS Settings. */
export function SettingsGroup({ title, footer, children }: PropsWithChildren<{ title?: string; footer?: string }>) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {title ? <Text accessibilityRole="header" style={[styles.groupTitle, { color: theme.textMuted }]}>{title}</Text> : null}
      <View style={[styles.groupBody, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 ? <View style={[styles.divider, { backgroundColor: theme.border }]} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? <Text style={[styles.groupFooter, { color: theme.textMuted }]}>{footer}</Text> : null}
    </View>
  );
}

/** A small rounded square with a symbol, tinted so groups scan quickly. */
function RowIcon({ symbol, tint }: { symbol: string; tint: string }) {
  return (
    <View style={[styles.icon, { backgroundColor: tint }]}>
      <Text style={styles.iconSymbol}>{symbol}</Text>
    </View>
  );
}

export function SettingsRow({ icon, iconTint, label, detail, value, onPress, accessory, destructive = false }: {
  icon?: string;
  iconTint?: string;
  label: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  accessory?: ReactNode;
  destructive?: boolean;
}) {
  const theme = useTheme();
  const content = (
    <>
      {icon ? <RowIcon symbol={icon} tint={iconTint ?? theme.primaryTint} /> : null}
      <View style={styles.copy}>
        <Body style={[styles.label, destructive ? { color: theme.danger } : null]}>{label}</Body>
        {detail ? <Body muted style={styles.detail}>{detail}</Body> : null}
      </View>
      {value ? <Body muted numberOfLines={1} style={styles.value}>{value}</Body> : null}
      {accessory}
      {onPress && !accessory ? <Text style={[styles.chevron, { color: theme.textMuted }]}>›</Text> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.surfaceMuted } : null]}
    >
      {content}
    </Pressable>
  );
}

export function SettingsSwitchRow({ icon, iconTint, label, detail, value, onValueChange }: {
  icon?: string;
  iconTint?: string;
  label: string;
  detail?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {icon ? <RowIcon symbol={icon} tint={iconTint ?? theme.primaryTint} /> : null}
      <View style={styles.copy}>
        <Body style={styles.label}>{label}</Body>
        {detail ? <Body muted style={styles.detail}>{detail}</Body> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onValueChange} trackColor={{ true: theme.primary }} />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  groupTitle: { fontSize: 13, lineHeight: 18, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", paddingHorizontal: 4 },
  groupBody: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  groupFooter: { fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 62 },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  iconSymbol: { fontSize: 17, lineHeight: 21 },
  copy: { flex: 1, gap: 1 },
  label: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  detail: { fontSize: 13, lineHeight: 18 },
  value: { fontSize: 15, lineHeight: 20, maxWidth: "45%" },
  chevron: { fontSize: 24, lineHeight: 26, fontWeight: "500", marginLeft: 2 },
});
