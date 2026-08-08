import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { Body, Heading } from "./Typography";
import { useTheme } from "@/theme/tokens";

export type SelectOption = { label: string; value: string };

export function SelectModal({ label, value, options, onChange }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value)?.label ?? value;
  return (
    <View style={styles.field}>
      <Body muted>{label}</Body>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected}`} onPress={() => setOpen(true)} style={[styles.trigger, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.triggerText, { color: theme.text }]}>{selected}</Text><Text style={{ color: theme.textMuted }}>⌄</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={[styles.modal, { backgroundColor: theme.background }]}>
          <Heading>{label}</Heading>
          <FlatList
            data={options}
            keyExtractor={(item) => item.value}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => { onChange(item.value); setOpen(false); }}
                style={[styles.option, { backgroundColor: item.value === value ? theme.surfaceMuted : theme.surface, borderColor: theme.border }]}
              >
                <Body>{item.label}</Body>{item.value === value ? <Body>✓</Body> : null}
              </Pressable>
            )}
            contentContainerStyle={styles.list}
          />
          <Button label="Close" variant="secondary" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 7 },
  trigger: { minHeight: 52, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  triggerText: { fontSize: 16, fontWeight: "600" },
  modal: { flex: 1, padding: 20, paddingTop: 32, gap: 16 },
  list: { gap: 8, paddingBottom: 16 },
  option: { minHeight: 54, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
