import { conversationSkills, grammarTopics, isEmptyDrill, lessonDisplayText, type CefrLevel, type LanguageId, type Lesson, type Phrase } from "@resolingo/shared";
import { grammarGoal, grammarGoals, inferConversationGoal, phraseConversationGoal } from "./goals";

export type LanguagePair = { nativeLanguage: LanguageId; targetLanguage: LanguageId };
export type ReviewRating = "got-it" | "almost" | "forgot";
export type ReviewMode = "recall" | "recognition";
export type ReviewProgress = {
  attemptId: string;
  lastRating: ReviewRating;
  lastMode: ReviewMode;
  recallRating: ReviewRating | null;
  reviewedAt: number;
  dueAt: number;
  intervalDays: number;
};
export type ProgressByCard = Record<string, ReviewProgress>;

export type SkillCard = {
  id: string;
  target: string;
  meaning: string;
  otherMeanings?: string[];
  previousIds?: string[];
  practicedAt?: string;
  lessonCount?: number;
  audioPath?: string;
  phraseId?: string;
};

export type SkillGroup = {
  id: string;
  title: string;
  patterns?: { id: string; title: string; description?: string }[];
  cards: SkillCard[];
  reviewCards?: SkillCard[];
};

export type Skills = {
  grammar: SkillGroup[];
  conversations: SkillGroup[];
  phrases: SkillCard[];
  cards: SkillCard[];
};

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1"];
const DAY_MS = 86_400_000;
const MAX_SESSION_QUESTIONS = 5;

export const languagePairKey = ({ nativeLanguage, targetLanguage }: LanguagePair) =>
  `${nativeLanguage}_${targetLanguage}`;

function normalize(text: string, language: LanguageId): string {
  return text.normalize("NFKC").toLocaleLowerCase(language).replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}

function phraseKey(parts: string[]): string {
  const value = JSON.stringify(parts);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(index))) * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function lessonLanguagePair(lesson: Lesson): LanguagePair | null {
  const narratedIntro = lesson.segments.find((segment) => segment.kind === "narration" && segment.phase === "intro" && segment.speaker === "teacher");
  const first = lesson.segments[0];
  const narrator = narratedIntro ?? (first?.kind === "narration" && first.speaker === "teacher" ? first : undefined);
  const nativeLanguage = lesson.nativeLanguage ?? narrator?.language;
  if (!nativeLanguage) return null;
  const targets = new Set(lesson.segments.map((segment) => segment.language).filter((language) => language !== nativeLanguage));
  const [inferred] = targets;
  const targetLanguage = lesson.targetLanguage ?? (targets.size === 1 ? inferred : undefined);
  return targetLanguage && nativeLanguage !== targetLanguage ? { nativeLanguage, targetLanguage } : null;
}

function belongsTo(value: LanguagePair | null, pair: LanguagePair): boolean {
  return value?.nativeLanguage === pair.nativeLanguage && value.targetLanguage === pair.targetLanguage;
}

function makeCard(target: string, meaning: string, pair: LanguagePair): SkillCard | null {
  const spoken = lessonDisplayText(target).trim();
  const translated = lessonDisplayText(meaning).trim();
  const targetKey = normalize(spoken, pair.targetLanguage);
  const meaningKey = normalize(translated, pair.nativeLanguage);
  if (!targetKey || !meaningKey) return null;
  return { id: phraseKey([targetKey]), previousIds: [phraseKey([targetKey, meaningKey])], target: spoken, meaning: translated };
}

function lessonCards(lesson: Lesson, pair: LanguagePair): SkillCard[] {
  const clips = new Map<string, number>();
  for (const segment of lesson.segments) {
    if (segment.audioPath) clips.set(segment.audioPath, (clips.get(segment.audioPath) ?? 0) + 1);
  }
  const collect = (dialogueOnly: boolean) => lesson.segments.flatMap((segment) => {
    if (segment.language !== pair.targetLanguage || !segment.translation || segment.phase === "warmup") return [];
    if (dialogueOnly ? segment.kind !== "dialogue" : segment.kind !== "drill" && segment.kind !== "example") return [];
    if (segment.phase === "review" || segment.phase === "buildup" || isEmptyDrill(segment.text, lesson.speakerNames)) return [];
    const card = makeCard(segment.text, segment.translation, pair);
    if (!card) return [];
    return [{
      ...card,
      practicedAt: lesson.updatedAt,
      ...(segment.audioPath && clips.get(segment.audioPath) === 1 ? { audioPath: segment.audioPath } : {}),
    }];
  });
  const drills = collect(false);
  return drills.length || lesson.type !== "conversation" ? drills : collect(true);
}

export function buildSkills(lessons: readonly Lesson[], saved: readonly Phrase[], pair: LanguagePair): Skills {
  const grammar = new Map<string, SkillGroup>();
  const conversations = new Map<string, SkillGroup>();
  const cards = new Map<string, SkillCard>();
  const memberships = new Map<SkillGroup, Set<string>>();
  const preferredGroup = new Map<string, { group: SkillGroup; priority: number }>();
  const sources = new Map<string, Set<string>>();
  const linkedLessons = new Map<string, Lesson>();
  const catalog = new Map(LEVELS.flatMap((level) => grammarTopics(pair.targetLanguage, level)).map((topic) => [topic.id, topic]));

  const claim = (card: SkillCard, group: SkillGroup, priority: number) => {
    const ids = memberships.get(group) ?? new Set<string>();
    ids.add(card.id);
    memberships.set(group, ids);
    const previous = preferredGroup.get(card.id);
    if (!previous || previous.priority < priority) preferredGroup.set(card.id, { group, priority });
  };

  const merge = (card: SkillCard, lessonId?: string) => {
    const prior = cards.get(card.id);
    const original = prior ?? card;
    const meanings = new Map<string, string>();
    for (const value of [original.meaning, ...(original.otherMeanings ?? []), card.meaning]) {
      const key = normalize(value, pair.nativeLanguage);
      if (!meanings.has(key)) meanings.set(key, value);
    }
    if (lessonId) {
      const seen = sources.get(card.id) ?? new Set<string>();
      seen.add(lessonId);
      sources.set(card.id, seen);
    }
    const practicedAt = original.practicedAt ?? card.practicedAt;
    const audioPath = original.audioPath ?? card.audioPath;
    const count = sources.get(card.id)?.size;
    cards.set(card.id, {
      ...original,
      otherMeanings: [...meanings.values()].slice(1),
      previousIds: [...new Set([...(original.previousIds ?? []), ...(card.previousIds ?? [])])],
      ...(practicedAt ? { practicedAt } : {}),
      ...(count ? { lessonCount: count } : {}),
      ...(audioPath ? { audioPath } : {}),
      ...(!original.phraseId && card.phraseId ? { phraseId: card.phraseId } : {}),
    });
  };

  for (const lesson of [...lessons].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))) {
    if (!lesson.completed || lesson.status !== "ready" || !belongsTo(lessonLanguagePair(lesson), pair)) continue;
    if (lesson.type === "phrase") {
      if (lesson.phraseId && !linkedLessons.has(lesson.phraseId)) linkedLessons.set(lesson.phraseId, lesson);
      continue;
    }
    const examples = lessonCards(lesson, pair);
    if (lesson.type === "conversation") {
      const context = lesson.conversationSkill ?? inferConversationGoal(lesson.topic || lesson.title, lesson.summary);
      for (const card of examples) {
        merge(card, lesson.id);
        const direct = phraseConversationGoal(card.target, card.meaning);
        const id = direct ?? context ?? "everyday";
        let group = conversations.get(id);
        if (!group) {
          group = { id, title: conversationSkills[id], cards: [] };
          conversations.set(id, group);
        }
        claim(card, group, direct ? 4 : id !== "everyday" ? 3 : 1);
      }
      continue;
    }

    const topic = lesson.topic.trim() || lesson.title;
    const normalizedTopic = normalize(topic, pair.nativeLanguage);
    const rule = catalog.get(lesson.ruleId ?? "") ?? [...catalog.values()].find((entry) =>
      normalize(entry.title, pair.nativeLanguage) === normalizedTopic);
    const patternId = rule?.id || lesson.ruleId || normalizedTopic;
    const goal = grammarGoal(patternId);
    let group = grammar.get(goal);
    if (!group) {
      group = { id: goal, title: grammarGoals[goal], cards: [], patterns: [] };
      grammar.set(goal, group);
    }
    if (!group.patterns?.some(({ id }) => id === patternId)) {
      const explanation = lesson.segments.find((segment) =>
        segment.kind === "explanation" && segment.phase === "rule" && segment.language === pair.nativeLanguage)?.text;
      const description = explanation ? lessonDisplayText(explanation).trim() : rule?.insight ?? rule?.focus;
      group.patterns?.push({ id: patternId, title: rule?.title ?? topic, ...(description ? { description } : {}) });
    }
    for (const card of examples) {
      merge(card, lesson.id);
      claim(card, group, 2);
    }
  }

  for (const phrase of saved) {
    if (!belongsTo(phrase, pair)) continue;
    const card = makeCard(phrase.translation, phrase.nativeText, pair);
    if (!card) continue;
    const linked = linkedLessons.get(phrase.id);
    merge({
      ...card,
      ...(linked ? { practicedAt: linked.updatedAt } : {}),
      ...(phrase.audioPath ? { audioPath: phrase.audioPath } : {}),
      phraseId: phrase.id,
    }, linked?.id);
  }

  const all = [...cards.values()];
  for (const card of all) preferredGroup.get(card.id)?.group.cards.push(card);
  for (const [group, ids] of memberships) {
    group.reviewCards = [...ids].flatMap((id) => cards.get(id) ?? []);
  }
  return {
    grammar: [...grammar.values()],
    conversations: [...conversations.values()].filter((group) => group.cards.length > 0),
    phrases: all.filter((card) => card.phraseId),
    cards: all,
  };
}

export function progressForCard(card: SkillCard, progress: ProgressByCard): ReviewProgress | undefined {
  const records = [card.id, ...(card.previousIds ?? [])].flatMap((id) => progress[id] ?? []);
  records.sort((left, right) => right.reviewedAt - left.reviewedAt);
  const latest = records[0];
  const recall = records.find((record) => record.recallRating !== null);
  return latest && recall ? { ...latest, recallRating: recall.recallRating } : latest;
}

export function reviewIsDue(progress: ReviewProgress | undefined, now: number): boolean {
  return !progress || progress.dueAt <= now;
}

export function scheduleReview(previous: ReviewProgress | undefined, input: {
  attemptId: string; mode: ReviewMode; rating: ReviewRating; now: number;
}): ReviewProgress {
  const { attemptId, mode, rating, now } = input;
  const repeatRecall = previous?.lastMode === "recall" && previous.lastRating === "got-it" ? previous : undefined;
  const nextRecall = repeatRecall
    ? Math.min(32, repeatRecall.intervalDays * (repeatRecall.dueAt <= now ? 2 : 1))
    : 3;
  const intervalDays = rating === "forgot" ? 1
    : rating === "almost" || mode === "recognition" ? 2
    : nextRecall;
  return {
    attemptId, lastRating: rating, lastMode: mode,
    recallRating: mode === "recall" ? rating : previous?.recallRating ?? null,
    intervalDays, reviewedAt: now, dueAt: now + intervalDays * DAY_MS,
  };
}

export type ReviewQuestion =
  | { card: SkillCard; mode: "recall" }
  | { card: SkillCard; mode: "recognition"; options: string[] };

function clearlyDifferent(left: string, right: string) {
  const contains = (longer: string, shorter: string) => ` ${longer} `.includes(` ${shorter} `);
  return !contains(left, right) && !contains(right, left);
}

export function reviewQuestions(pool: readonly SkillCard[], progress: ProgressByCard, pair: LanguagePair, now: number, dueOnly: boolean): ReviewQuestion[] {
  const status = (card: SkillCard) => progressForCard(card, progress);
  const candidates = pool.filter((card) => !dueOnly || reviewIsDue(status(card), now));
  const priority = (card: SkillCard) => {
    const review = status(card);
    if (!review) return 2;
    if (!reviewIsDue(review, now)) return 3;
    return review.lastRating === "got-it" ? 1 : 0;
  };
  candidates.sort((left, right) => priority(left) - priority(right)
    || (status(left)?.dueAt ?? now) - (status(right)?.dueAt ?? now));
  return candidates.slice(0, MAX_SESSION_QUESTIONS).map((card, index) => {
    if (index !== 2 || card.otherMeanings?.length) return { card, mode: "recall" };
    const target = normalize(card.target, pair.targetLanguage);
    const used = new Set([normalize(card.meaning, pair.nativeLanguage)]);
    const alternatives: string[] = [];
    for (const candidate of pool) {
      const meaning = normalize(candidate.meaning, pair.nativeLanguage);
      if ([...used].some((other) => !clearlyDifferent(other, meaning)) || normalize(candidate.target, pair.targetLanguage) === target) continue;
      used.add(meaning);
      alternatives.push(candidate.meaning);
      if (alternatives.length === 2) break;
    }
    if (alternatives.length < 2) return { card, mode: "recall" };
    alternatives.splice(Math.floor(Math.random() * 3), 0, card.meaning);
    return { card, mode: "recognition", options: alternatives };
  });
}
