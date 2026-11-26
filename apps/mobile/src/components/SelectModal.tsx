import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Body, Heading } from "./Typography";
import { useTheme } from "@/theme/tokens";

export type SelectOption = { label: string; value: string; icon?: string; detail?: string };

/** Lists longer than this get a search field. */
const SEARCH_THRESHOLD = 8;

export function SelectModal({ label, value, options, onChange, hideLabel = false }: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  hideLabel?: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? options.filter((option) => option.label.toLocaleLowerCase().includes(needle)) : options;
  }, [options, query]);
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  return (
    <View style={styles.field}>
      {hideLabel ? null : <Body muted style={styles.label}>{label}</Body>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? value}`}
        accessibilityHint="Opens a list to choose from"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, { backgroundColor: pressed ? theme.surfaceMuted : theme.surface, borderColor: theme.border }]}
      >
        {selected?.icon ? <Text style={styles.triggerIcon}>{selected.icon}</Text> : null}
        <Text numberOfLines={1} style={[styles.triggerText, { color: theme.text }]}>{selected?.label ?? value}</Text>
        <Text style={[styles.caret, { color: theme.textMuted }]}>⌄</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
        <View style={[styles.modal, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Heading style={styles.modalTitle}>{label}</Heading>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} hitSlop={10} style={styles.done}>
              <Text style={[styles.doneLabel, { color: theme.primary }]}>Done</Text>
            </Pressable>
          </View>
          {options.length > SEARCH_THRESHOLD ? (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search"
              placeholderTextColor={theme.textMuted}
              autoCorrect={false}
              clearButtonMode="while-editing"
              accessibilityLabel={`Search ${label.toLocaleLowerCase()}`}
              style={[styles.search, { backgroundColor: theme.surfaceMuted, color: theme.text }]}
            />
          ) : null}
          <FlatList
            data={shown}
            keyExtractor={(item) => item.value}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isSelected = item.value === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => { onChange(item.value); close(); }}
                  style={({ pressed }) => [
                    styles.option,
                    { backgroundColor: isSelected ? theme.primaryTint : pressed ? theme.surfaceMuted : theme.surface, borderColor: isSelected ? theme.primary : theme.border },
                  ]}
                >
                  {item.icon ? <Text style={styles.optionIcon}>{item.icon}</Text> : null}
                  <View style={styles.optionCopy}>
                    <Body style={styles.optionLabel}>{item.label}</Body>
                    {item.detail ? <Body muted style={styles.optionDetail}>{item.detail}</Body> : null}
                  </View>
                  {isSelected ? <Text style={[styles.check, { color: theme.primary }]}>✓</Text> : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={<Body muted style={styles.empty}>No matches</Body>}
            contentContainerStyle={styles.list}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 7 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  trigger: { minHeight: 54, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  triggerIcon: { fontSize: 22, lineHeight: 28 },
  triggerText: { flex: 1, fontSize: 16, fontWeight: "600" },
  caret: { fontSize: 18, lineHeight: 20 },
  modal: { flex: 1, paddingHorizontal: 20, paddingTop: 24, gap: 14 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { flex: 1 },
  done: { minHeight: 44, justifyContent: "center", paddingLeft: 16 },
  doneLabel: { fontSize: 16, fontWeight: "700" },
  search: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  list: { gap: 8, paddingBottom: 32 },
  option: { minHeight: 56, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  optionIcon: { fontSize: 24, lineHeight: 30 },
  optionCopy: { flex: 1 },
  optionLabel: { fontWeight: "600" },
  optionDetail: { fontSize: 13, lineHeight: 18 },
  check: { fontSize: 18, fontWeight: "800" },
  empty: { textAlign: "center", paddingVertical: 24 },
});
