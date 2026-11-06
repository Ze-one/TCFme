export type Skill = "listening" | "reading" | "writing" | "speaking";
export type Mode = "official" | "c2";
export type Level = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export const SKILLS: {
  id: Skill;
  name: string;
  short: string;
  minutes: number;
  count: number;
  description: string;
}[] = [
  {
    id: "listening",
    name: "Compréhension orale",
    short: "Écouter",
    minutes: 35,
    count: 39,
    description: "Saisir l’intention, entendre la nuance.",
  },
  {
    id: "reading",
    name: "Compréhension écrite",
    short: "Lire",
    minutes: 60,
    count: 39,
    description: "Lire entre les lignes. Aller au-delà du sens.",
  },
  {
    id: "writing",
    name: "Expression écrite",
    short: "Écrire",
    minutes: 60,
    count: 3,
    description: "Construire une pensée précise et convaincante.",
  },
  {
    id: "speaking",
    name: "Expression orale",
    short: "Parler",
    minutes: 12,
    count: 3,
    description: "Argumenter avec aisance et spontanéité.",
  },
];
export interface Question {
  id: string;
  skill: Skill;
  position: number;
  level: Level;
  title: string;
  passage: string;
  prompt: string;
  options: string[];
  min_words?: number;
  max_words?: number;
  audio_path?: string;
  duration_seconds?: number;
  preparation_seconds?: number;
}
export interface Attempt {
  id: string;
  skill: Skill;
  mode: Mode;
  status: "active" | "submitted" | "expired";
  started_at: string;
  deadline: string;
  answers: Record<string, string>;
  audio_claims: string[];
  integrity_events: { type: string; at: string }[];
  raw_score: number | null;
  total: number;
  submitted_at?: string;
  evaluations?: Evaluation[];
}
export interface Evaluation {
  question_id: string;
  estimated_level: Level | "below_A1" | "insufficient_evidence";
  lexical_richness_score: number;
  grammatical_accuracy_score: number;
  task_achievement_score: number;
  pragmatic_appropriateness_score: number;
  structural_critique: string;
  c2_rewritten_version: string;
  evidence: { excerpt: string; comment: string }[];
  next_steps: string[];
  limitations: string[];
}
export const wordCount = (text: string) =>
  text.trim() ? text.trim().split(/\s+/u).length : 0;
export const remainingSeconds = (deadline: string, now = Date.now()) =>
  Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
export const practiceMinutes = (attempt: Pick<Attempt, "started_at" | "deadline" | "submitted_at">) =>
  Math.max(0, (Math.min(Date.parse(attempt.submitted_at || attempt.deadline), Date.parse(attempt.deadline)) - Date.parse(attempt.started_at)) / 60000);
export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
export function officialNclc(skill: Skill, score: number): number | null {
  const receptive = skill === "reading" || skill === "listening";
  if (!Number.isInteger(score) || score < 0 || score > (receptive ? 699 : 20))
    return null;
  const bounds =
    skill === "reading"
      ? [342, 375, 406, 453, 499, 524, 549]
      : skill === "listening"
        ? [331, 369, 398, 458, 503, 523, 549]
        : [4, 6, 7, 10, 12, 14, 16];
  for (let i = bounds.length - 1; i >= 0; i--)
    if (score >= bounds[i]) return i + 4;
  return null;
}
export function practiceIndex(
  attempts: Attempt[],
  skill: Skill,
): number | null {
  const recent = attempts
    .filter((a) => a.skill === skill && a.status !== "active")
    .slice(0, 5);
  const values = recent.flatMap((a) =>
    a.raw_score !== null
      ? [(100 * a.raw_score) / a.total]
      : (a.evaluations?.map(
          (e) =>
            (e.lexical_richness_score +
              e.grammatical_accuracy_score +
              e.task_achievement_score +
              e.pragmatic_appropriateness_score) /
            4,
        ) ?? []),
  );
  return values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : null;
}
export const SOURCES = [
  {
    name: "France Éducation international",
    title: "Format et manuel du candidat TCF",
    url: "https://www.france-education-international.fr/document/manuelcandidattoutes20dc3a9clinaisonsi",
  },
  {
    name: "Conseil de l’Europe",
    title: "CECR · Volume complémentaire",
    url: "https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-descriptors",
  },
  {
    name: "Immigration, Réfugiés et Citoyenneté Canada",
    title: "Correspondances TCF / NCLC",
    url: "https://www.canada.ca/fr/immigration-refugies-citoyennete/services/immigrer-canada/entree-express/documents/examen-linguistique.html",
  },
];
