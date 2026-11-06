"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Headphones,
  LockKeyhole,
  Maximize2,
  Mic,
  Pause,
  Play,
  ShieldCheck,
  Volume2,
  WifiOff,
  X,
} from "lucide-react";
import { api, supabase } from "@/lib/supabase";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import {
  Attempt,
  Evaluation,
  formatTime,
  Question,
  remainingSeconds,
  SKILLS,
  wordCount,
} from "@/lib/exam";
export interface Run {
  attempt: Attempt;
  questions: Question[];
  practice: boolean;
  serverOffset: number;
}
export interface Review {
  question_id: string;
  correct: number;
  rationale: string;
  script?: string;
}
export function ExamRunner({
  run,
  onFinish,
}: {
  run: Run;
  onFinish: (a: Attempt, review: Review[]) => void;
}) {
  const [attempt, setAttempt] = useState(run.attempt),
    [index, setIndex] = useState(
      Math.max(0, run.attempt.audio_claims.length - 1),
    );
  const [seconds, setSeconds] = useState(
    remainingSeconds(attempt.deadline, Date.now() + run.serverOffset),
  );
  const [saveState, setSaveState] = useState("Sauvegardé"),
    [error, setError] = useState(""),
    [focusLost, setFocusLost] = useState(false),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false),
    [recording, setRecording] = useState(false),
    [recorded, setRecorded] = useState<string[]>([]),
    [uploading, setUploading] = useState(false),
    [micReady, setMicReady] = useState(false),
    [reply, setReply] = useState("");
  const current = useRef(attempt),
    queue = useRef<Promise<unknown>>(Promise.resolve()),
    ending = useRef(false),
    audio = useRef<HTMLAudioElement | null>(null),
    recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    chunks = useRef<Blob[]>([]),
    recordingQuestion = useRef("");
  const localBlobs = useRef<Record<string, Blob>>({}),
    uploadPromise = useRef<Promise<void>>(Promise.resolve()),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const q = run.questions[index],
    skill = SKILLS.find((s) => s.id === attempt.skill)!;
  useDialogFocus(focusLost || confirm, () => {
    setFocusLost(false);
    setConfirm(false);
  });
  const elapsed = skill.minutes * 60 - seconds;
  const speakingIndex = elapsed < 120 ? 0 : elapsed < 450 ? 1 : 2;
  const preparation =
    attempt.skill === "speaking" && elapsed >= 120 && elapsed < 240;
  const stageRemaining =
    attempt.skill === "speaking"
      ? elapsed < 120
        ? 120 - elapsed
        : elapsed < 240
          ? 240 - elapsed
          : elapsed < 450
            ? 450 - elapsed
            : 720 - elapsed
      : seconds;
  const update = useCallback(
    (a: Attempt) => {
      current.current = a;
      setAttempt(a);
      if (run.practice)
        sessionStorage.setItem(
          "tcf-active",
          JSON.stringify({ ...run, attempt: a }),
        );
    },
    [run],
  );
  const persist = useCallback(
    (answers: Record<string, string>) => {
      if (run.practice) {
        setSaveState("Sauvegardé sur cet appareil");
        return;
      }
      setSaveState("Enregistrement…");
      queue.current = queue.current
        .catch(() => undefined)
        .then(() =>
          api<Attempt>("/api/exam", {
            action: "save",
            attempt_id: current.current.id,
            answers,
          }),
        )
        .then(() => setSaveState("Sauvegardé"))
        .catch((e) => {
          setSaveState("Non synchronisé");
          setError(e.message);
        });
    },
    [run.practice],
  );
  const answer = (value: string) => {
    const next = {
      ...current.current,
      answers: { ...current.current.answers, [q.id]: value },
    };
    update(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (attempt.skill === "writing") {
      setSaveState("Enregistrement…");
      saveTimer.current = setTimeout(
        () => persist(current.current.answers),
        500,
      );
    } else persist(next.answers);
  };
  const integrity = useCallback(
    (type: string) => {
      const a = {
        ...current.current,
        integrity_events: [
          ...current.current.integrity_events,
          { type, at: new Date().toISOString() },
        ],
      };
      update(a);
      if (!run.practice)
        void api("/api/exam", {
          action: "integrity",
          attempt_id: a.id,
          type,
        }).catch(() => {});
    },
    [run.practice, update],
  );
  const stopRecording = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    setRecording(false);
  }, []);
  const finish = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    setBusy(true);
    setError("");
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (recorder.current?.state === "recording") {
        await new Promise<void>((resolve) => {
          recorder.current!.addEventListener("stop", () => resolve(), {
            once: true,
          });
          recorder.current!.stop();
        });
      }
      await uploadPromise.current;
      await queue.current;
      audio.current?.pause();
      speechSynthesis.cancel();
      let done: Attempt,
        review: Review[] = [];
      if (run.practice) {
        const response = await api<{ score: number; review: Review[] }>(
          "/api/practice",
          {
            skill: current.current.skill,
            mode: current.current.mode,
            answers: current.current.answers,
          },
        );
        review = response.review;
        done = {
          ...current.current,
          status: remainingSeconds(current.current.deadline)
            ? "submitted"
            : "expired",
          submitted_at: new Date().toISOString(),
          raw_score: ["reading", "listening"].includes(current.current.skill)
            ? response.score
            : null,
        };
        // Recordings remain on this device; the download is explicit in the final task UI.
      } else {
        done = await api<Attempt>("/api/exam", {
          action: "submit",
          attempt_id: current.current.id,
          answers: current.current.answers,
        });
        review = await api<Review[]>("/api/exam", {
          action: "review",
          attempt_id: done.id,
        });
      }
      sessionStorage.removeItem("tcf-active");
      if (document.fullscreenElement)
        await document.exitFullscreen().catch(() => {});
      onFinish(done, review);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
      ending.current = false;
      setBusy(false);
    }
  }, [onFinish, run.practice]);
  useEffect(() => {
    const tick = () =>
      setSeconds(
        remainingSeconds(
          current.current.deadline,
          Date.now() + run.serverOffset,
        ),
      );
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [run.serverOffset]);
  useEffect(() => {
    if (seconds === 0 && !ending.current) void finish();
  }, [seconds, finish]);
  useEffect(() => {
    const lost = () => {
      if (!ending.current) {
        setFocusLost(true);
        integrity("focus_lost");
      }
    };
    const hidden = () => {
      if (document.hidden) lost();
    };
    const full = () => {
      if (!document.fullscreenElement && !ending.current)
        integrity("fullscreen_exit");
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (!ending.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("blur", lost);
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("fullscreenchange", full);
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("blur", lost);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("fullscreenchange", full);
      window.removeEventListener("beforeunload", leave);
    };
  }, [integrity]);
  useEffect(() => {
    if (attempt.skill === "speaking" && speakingIndex !== index) {
      stopRecording();
      setIndex(speakingIndex);
      setReply("");
    }
  }, [attempt.skill, speakingIndex, index, stopRecording]);
  useEffect(
    () => () => {
      audio.current?.pause();
      speechSynthesis.cancel();
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  async function playAudio() {
    if (playing || current.current.audio_claims.includes(q.id)) return;
    setError("");
    setPlaying(true);
    try {
      let url: string;
      if (run.practice) url = `/audio/${q.id}.wav`;
      else {
        await queue.current;
        url = (
          await api<{ url: string }>("/api/exam", {
            action: "audio",
            attempt_id: attempt.id,
            question_id: q.id,
          })
        ).url;
      }
      update({
        ...current.current,
        audio_claims: [...current.current.audio_claims, q.id],
      });
      const player = new Audio(url);
      audio.current = player;
      player.preload = "auto";
      player.onended = () => setPlaying(false);
      player.onerror = () => {
        setPlaying(false);
        setError(
          "Incident audio. Cette écoute est consommée ; signalez l’incident ou recommencez une nouvelle tentative.",
        );
        integrity("audio_error");
      };
      player.onratechange = () => {
        if (player.playbackRate !== 1) player.playbackRate = 1;
      };
      let lastTime = 0;
      player.ontimeupdate = () => {
        if (!player.seeking) lastTime = player.currentTime;
      };
      player.onseeking = () => {
        if (Math.abs(player.currentTime - lastTime) > 1)
          player.currentTime = lastTime;
      };
      await player.play();
    } catch (e) {
      setPlaying(false);
      setError(e instanceof Error ? e.message : "Lecture impossible.");
    }
  }
  async function enableMicrophone() {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      setMicReady(true);
      setFocusLost(false);
    } catch {
      setError(
        "Autorisez le microphone dans votre navigateur, puis réessayez.",
      );
    }
  }
  async function startRecording() {
    if (!stream.current || preparation || recorded.includes(q.id) || uploading)
      return;
    try {
      const mime = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      if (!mime)
        throw new Error(
          "Ce navigateur ne prend pas en charge l’enregistrement audio.",
        );
      const rec = new MediaRecorder(stream.current, {
        mimeType: mime,
        audioBitsPerSecond: 64000,
      });
      recorder.current = rec;
      recordingQuestion.current = q.id;
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        const id = recordingQuestion.current;
        const blob = new Blob(chunks.current, { type: mime.split(";")[0] });
        setRecording(false);
        localBlobs.current[id] = blob;
        setUploading(true);
        uploadPromise.current = (async () => {
          try {
            if (!run.practice) {
              const {
                data: { user },
              } = await supabase.auth.getUser();
              if (!user) throw new Error("Session expirée.");
              const { error: uploadError } = await supabase.storage
                .from("speaking-recordings")
                .upload(`${user.id}/${attempt.id}/${id}.webm`, blob, {
                  contentType: blob.type,
                  upsert: false,
                });
              if (uploadError) throw uploadError;
              await api("/api/exam", {
                action: "recording",
                attempt_id: attempt.id,
                question_id: id,
              });
            }
            setRecorded((r) => [...r, id]);
          } catch (e) {
            setError(
              `Audio conservé localement. ${e instanceof Error ? e.message : "Échec de l’envoi."}`,
            );
            throw e;
          } finally {
            setUploading(false);
          }
        })();
        void uploadPromise.current.catch(() => {});
      };
      rec.start(1000);
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }
  function downloadRecording() {
    const blob = localBlobs.current[q.id];
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tcfme-${q.id}.${blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm"}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const answered = Object.values(attempt.answers).filter(Boolean).length;
  return (
    <div className="exam-shell">
      <header className="exam-header">
        <div className="brand">
          <span className="brand-mark">t.</span>
          <span>
            TCFme <b>C2 PRO</b>
          </span>
        </div>
        <div className="exam-title">
          <ShieldCheck size={17} />
          {skill.name}
          <span className="tag">
            {run.practice ? "Entraînement local" : "Session vérifiée"}
          </span>
        </div>
        <div
          className={`timer ${seconds < 60 ? "urgent" : ""}`}
          aria-label="Temps restant"
        >
          <Clock3 size={19} />
          {formatTime(seconds)}
        </div>
      </header>
      <div className="exam-progress">
        <div
          style={{ width: `${100 * (1 - seconds / (skill.minutes * 60))}%` }}
        />
      </div>
      <div className="exam-toolbar">
        <span>
          {attempt.skill === "speaking" ? "Tâche" : "Question"}{" "}
          <b>{index + 1}</b> / {run.questions.length}{" "}
          <span className="muted">
            · {q.level} · {q.title}
          </span>
        </span>
        <span className="save-state">
          <Check size={15} />
          {saveState}
        </span>
        <button
          className="icon-button"
          aria-label="Passer en plein écran"
          onClick={() =>
            document.documentElement
              .requestFullscreen()
              .catch(() =>
                setError("Le plein écran est indisponible sur ce navigateur."),
              )
          }
        >
          <Maximize2 size={18} />
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button className="text-button" onClick={() => setError("")}>
            Fermer
          </button>
        </div>
      )}
      <main
        className={`exam-body ${attempt.skill === "listening" ? "listening-body" : ""}`}
      >
        <section className="passage-panel">
          <span className="eyebrow">
            {attempt.skill === "listening"
              ? "DOCUMENT AUDIO"
              : "DOCUMENT & CONSIGNE"}
          </span>
          <h1>{q.title}</h1>
          {attempt.skill === "listening" ? (
            <div className="audio-card">
              <div className="audio-icon">
                <Headphones size={36} />
              </div>
              <h2>
                {playing
                  ? "Écoutez attentivement"
                  : attempt.audio_claims.includes(q.id)
                    ? "Écoute terminée"
                    : "Une seule écoute"}
              </h2>
              <p>Le document ne peut être ni mis en pause ni réécouté.</p>
              <div className={`waveform ${playing ? "is-playing" : ""}`}>
                {Array.from({ length: 35 }, (_, i) => (
                  <i key={i} style={{ height: `${15 + ((i * 37) % 63)}px` }} />
                ))}
              </div>
              <button
                className="button primary"
                disabled={playing || attempt.audio_claims.includes(q.id)}
                onClick={playAudio}
              >
                {playing ? (
                  <Volume2 size={18} />
                ) : attempt.audio_claims.includes(q.id) ? (
                  <LockKeyhole size={18} />
                ) : (
                  <Play size={18} />
                )}{" "}
                {playing
                  ? "Lecture en cours"
                  : attempt.audio_claims.includes(q.id)
                    ? "Enregistrement consommé"
                    : "Lancer l’écoute"}
              </button>
              <small>Voix française de synthèse · contenu original</small>
            </div>
          ) : (
            <>
              <div className="passage-text">{q.passage}</div>
              <div className="prompt-box">{q.prompt}</div>
            </>
          )}
          {attempt.skill === "speaking" && index === 1 && !preparation && (
            <div className="interlocutor">
              <h3>Votre interlocuteur</h3>
              <p>
                Choisissez le thème après avoir posé votre question. Ces
                réponses scénarisées servent à l’entraînement autonome.
              </p>
              <div className="chip-row">
                {[
                  "Horaires",
                  "Tarifs",
                  "Niveaux",
                  "Matériel",
                  "Inscription",
                ].map((x, i) => (
                  <button
                    className="chip"
                    key={x}
                    onClick={() => {
                      const replies = [
                        "Les ateliers ont lieu le mardi et le jeudi, de dix-huit heures à vingt heures.",
                        "Le trimestre coûte quatre-vingt-dix dollars ; le premier cours est gratuit.",
                        "Nous proposons deux groupes : débutants et personnes ayant déjà pratiqué.",
                        "Le matériel de base est fourni. Apportez un carnet et une tenue confortable.",
                        "Vous pouvez vous inscrire à l’accueil. Les places sont limitées à douze personnes.",
                      ];
                      setReply(replies[i]);
                    }}
                  >
                    {x}
                  </button>
                ))}
              </div>
              {reply && <p className="prompt-box">{reply}</p>}
            </div>
          )}
        </section>
        <section className="response-panel">
          {["reading", "listening"].includes(attempt.skill) ? (
            <>
              <span className="eyebrow">UNE SEULE RÉPONSE CORRECTE</span>
              <h2>{q.prompt}</h2>
              <div role="radiogroup" aria-label={q.prompt} className="options">
                {q.options.map((option, i) => (
                  <button
                    role="radio"
                    aria-checked={attempt.answers[q.id] === String(i)}
                    key={option}
                    disabled={
                      busy ||
                      (attempt.skill === "listening" &&
                        !attempt.audio_claims.includes(q.id))
                    }
                    className={`option ${attempt.answers[q.id] === String(i) ? "selected" : ""}`}
                    onClick={() => answer(String(i))}
                  >
                    <span>{String.fromCharCode(65 + i)}</span>
                    {option}
                    {attempt.answers[q.id] === String(i) && (
                      <CheckCircle2 size={20} />
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : attempt.skill === "writing" ? (
            <>
              <div className="section-heading">
                <span className="eyebrow">VOTRE PRODUCTION</span>
                <span
                  className={`word-count ${wordCount(attempt.answers[q.id] || "") >= q.min_words! && wordCount(attempt.answers[q.id] || "") <= q.max_words! ? "valid" : ""}`}
                >
                  {wordCount(attempt.answers[q.id] || "")} / {q.min_words}–
                  {q.max_words} mots
                </span>
              </div>
              <label className="sr-only" htmlFor="writing-answer">
                Votre réponse à la tâche {index + 1}
              </label>
              <textarea
                id="writing-answer"
                className="writing-area"
                value={attempt.answers[q.id] || ""}
                onChange={(e) => answer(e.target.value)}
                maxLength={12000}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                placeholder="Commencez à écrire ici…"
                disabled={busy || seconds === 0}
              />
              <p className="fineprint">
                Les mots sont comptés par espaces. La correction automatique est
                désactivée.
              </p>
            </>
          ) : (
            <div className="recorder">
              <span className="eyebrow">
                {preparation ? "PRÉPARATION" : "EXPRESSION ORALE"}
              </span>
              <div className={`mic-orb ${recording ? "recording" : ""}`}>
                <Mic size={42} />
              </div>
              <h2>
                {preparation
                  ? "Organisez vos questions"
                  : recording
                    ? "À vous de parler"
                    : recorded.includes(q.id)
                      ? "Enregistrement sauvegardé"
                      : "Faites entendre votre français"}
              </h2>
              <div className="stage-timer">
                {formatTime(Math.max(0, stageRemaining))}
              </div>
              <p>
                {preparation
                  ? "Le microphone reste inactif pendant les deux minutes de préparation."
                  : "Chaque tâche se termine automatiquement à la fin de son temps imparti."}
              </p>
              {!micReady ? (
                <button className="button primary" onClick={enableMicrophone}>
                  <Mic size={18} />
                  Activer le microphone
                </button>
              ) : (
                <button
                  className="button primary"
                  disabled={preparation || recorded.includes(q.id) || uploading}
                  onClick={recording ? stopRecording : startRecording}
                >
                  {recording ? <Pause size={18} /> : <Mic size={18} />}{" "}
                  {recording
                    ? "Terminer cet enregistrement"
                    : uploading
                      ? "Envoi de l’audio…"
                      : "Commencer à parler"}
                </button>
              )}
              {localBlobs.current[q.id] && (
                <button className="text-button" onClick={downloadRecording}>
                  Télécharger mon enregistrement
                </button>
              )}
              <small>
                Simulation autonome : ne remplace pas l’échange avec un
                examinateur.
              </small>
            </div>
          )}
          <div className="exam-navigation">
            <button
              className="button secondary"
              disabled={
                index === 0 ||
                attempt.skill === "listening" ||
                attempt.skill === "speaking" ||
                busy
              }
              onClick={() => setIndex((i) => i - 1)}
            >
              <ArrowLeft size={17} />
              Précédent
            </button>
            {index < run.questions.length - 1 &&
            attempt.skill !== "speaking" ? (
              <button
                className="button primary"
                disabled={
                  playing ||
                  busy ||
                  (attempt.skill === "listening" &&
                    !attempt.audio_claims.includes(q.id))
                }
                onClick={() => setIndex((i) => i + 1)}
              >
                Suivant
                <ArrowRight size={17} />
              </button>
            ) : (
              <button
                className="button primary"
                disabled={busy || playing || recording || uploading}
                onClick={() => setConfirm(true)}
              >
                Terminer l’épreuve
                <Check size={17} />
              </button>
            )}
          </div>
        </section>
      </main>
      <footer className="exam-footer">
        {attempt.skill === "reading" || attempt.skill === "writing" ? (
          <div className="question-dots">
            {run.questions.map((item, i) => (
              <button
                key={item.id}
                aria-label={`Aller à la question ${i + 1}`}
                className={`${i === index ? "current" : ""} ${attempt.answers[item.id] ? "answered" : ""}`}
                onClick={() => setIndex(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
        ) : (
          <span>
            <LockKeyhole size={15} /> Navigation séquentielle · le chronomètre
            ne s’arrête jamais
          </span>
        )}
        <button className="text-button" onClick={() => setConfirm(true)}>
          Rendre ma copie
        </button>
      </footer>
      {focusLost && !busy && (
        <div className="modal-backdrop">
          <div
            className="modal focus-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="focus-heading"
          >
            <ShieldCheck size={38} />
            <h2 id="focus-heading">Revenez à votre épreuve</h2>
            <p>
              La sortie de la fenêtre a été enregistrée. Le chronomètre continue
              : {formatTime(seconds)} restantes.
            </p>
            <button
              autoFocus
              className="button primary"
              onClick={() => setFocusLost(false)}
            >
              Reprendre
            </button>
          </div>
        </div>
      )}
      {confirm && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-heading"
          >
            <h2 id="submit-heading">Rendre votre copie ?</h2>
            <p>
              {attempt.skill === "speaking"
                ? `${recorded.length} enregistrement(s) sauvegardé(s).`
                : `${answered} réponse(s) sur ${run.questions.length}.`}{" "}
              Après l’envoi, votre travail ne pourra plus être modifié.
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => setConfirm(false)}
              >
                Continuer l’épreuve
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => {
                  setConfirm(false);
                  void finish();
                }}
              >
                Confirmer l’envoi
              </button>
            </div>
          </div>
        </div>
      )}
      {busy && (
        <div className="busy-indicator" role="status">
          Enregistrement de votre copie…
        </div>
      )}
    </div>
  );
}
