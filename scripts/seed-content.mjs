import fs from "node:fs";
import { questionBank, answers, LISTENING } from "../lib/bank.ts";
const quote = (value) =>
  value === null || value === undefined
    ? "null"
    : typeof value === "number"
      ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;
const sql = ["begin;"];
for (const mode of ["official", "c2"])
  for (const skill of ["listening", "reading", "writing", "speaking"]) {
    const id = `${mode}-${skill}`,
      questions = questionBank(skill, mode),
      duration = {
        listening: 2100,
        reading: 3600,
        writing: 3600,
        speaking: 720,
      }[skill];
    sql.push(
      `insert into public.tests(id,skill,mode,title,duration_seconds,question_count,published) values(${[id, skill, mode, `TCFme ${mode} ${skill}`, duration, questions.length].map(quote).join(",")},true) on conflict(id) do nothing;`,
    );
    questions.forEach((q, index) => {
      sql.push(
        `insert into public.questions(test_id,id,position,skill,level,title,passage,prompt,options,min_words,max_words,duration_seconds,preparation_seconds) values(${[id, q.id, index + 1, skill, q.level, q.title, skill === "listening" ? "" : q.passage, q.prompt, JSON.stringify(q.options), q.min_words, q.max_words, q.duration_seconds, q.preparation_seconds].map(quote).join(",")}) on conflict(test_id,id) do nothing;`,
      );
      if (answers[q.id])
        sql.push(
          `insert into private.answer_keys(test_id,question_id,correct,rationale,audio_path,script) values(${[id, q.id, answers[q.id].correct, answers[q.id].rationale, skill === "listening" ? `${q.id}.wav` : null, skill === "listening" ? q.passage : null].map(quote).join(",")}) on conflict(test_id,question_id) do nothing;`,
        );
    });
  }
sql.push("commit;");
fs.mkdirSync("supabase", { recursive: true });
fs.writeFileSync("supabase/seed.sql", sql.join("\n"));
fs.mkdirSync("work", { recursive: true });
fs.writeFileSync(
  "work/listening-scripts.json",
  JSON.stringify(
    LISTENING.map((q) => ({
      id: q.id,
      text: q.passage,
      voice: q.position % 2 ? "Microsoft Hortense Desktop" : "Microsoft Paul",
    })),
  ),
);
console.log(
  "Seed generated: 8 tests, 168 questions, 156 answer keys and 39 audio scripts.",
);
