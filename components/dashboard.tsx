"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  GraduationCap,
  Headphones,
  History,
  LayoutDashboard,
  Leaf,
  LogOut,
  Menu,
  Mic,
  PenLine,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
  X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { api, supabase } from "@/lib/supabase";
import {
  Attempt,
  Evaluation,
  Mode,
  officialNclc,
  practiceIndex,
  practiceMinutes,
  Question,
  Skill,
  SKILLS,
  SOURCES,
} from "@/lib/exam";
import { ExamRunner, Review, Run } from "./exam-runner";
import { useDialogFocus } from "@/lib/use-dialog-focus";
type View = "dashboard" | "exams" | "results" | "resources" | "settings";
const icons = {
  listening: Headphones,
  reading: BookOpen,
  writing: PenLine,
  speaking: Mic,
};
const nav = [
  { id: "dashboard" as View, label: "Tableau de bord", icon: LayoutDashboard },
  { id: "exams" as View, label: "Mes entraînements", icon: GraduationCap },
  { id: "results" as View, label: "Ma progression", icon: ChartNoAxesCombined },
  { id: "resources" as View, label: "Ressources C2", icon: BookOpen },
];
export default function Dashboard() {
  const [view, setView] = useState<View>("dashboard"),
    [user, setUser] = useState<User | null>(null),
    [attempts, setAttempts] = useState<Attempt[]>([]),
    [localAttempts, setLocalAttempts] = useState<Attempt[]>([]),
    [run, setRun] = useState<Run | null>(null),
    [resume, setResume] = useState<Run | null>(null);
  const [selected, setSelected] = useState<Skill | null>(null),
    [mode, setMode] = useState<Mode>("official"),
    [authOpen, setAuthOpen] = useState(false),
    [sidebar, setSidebar] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [report, setReport] = useState<{
      attempt: Attempt;
      review: Review[];
      practice: boolean;
    } | null>(null),
    [target, setTarget] = useState("10"),
    [examDate, setExamDate] = useState("");
  const allAttempts = user ? attempts : localAttempts;
  useDialogFocus(authOpen ? "auth" : report ? "report" : selected ? "start" : false, () => {
    setSelected(null);
    setAuthOpen(false);
    setReport(null);
  });
  const loadHistory = useCallback(async () => {
    try {
      const data = await api<{ attempts: Attempt[] }>("/api/exam");
      setAttempts(data.attempts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Historique indisponible.");
    }
  }, []);
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setUser(data.user);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
      setUser(session?.user ?? null),
    );
    try {
      setLocalAttempts(JSON.parse(localStorage.getItem("tcf-history") || "[]"));
      const saved = sessionStorage.getItem("tcf-active");
      if (saved) setResume(JSON.parse(saved));
      const p = JSON.parse(localStorage.getItem("tcf-preferences") || "{}");
      setTarget(p.target || "10");
      setExamDate(p.examDate || "");
    } catch {}
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (user) void loadHistory();
    else setAttempts([]);
  }, [user, loadHistory]);
  const navigate = (next: View) => {
    setView(next);
    setSidebar(false);
    setError("");
  };
  async function start() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      let next: Run;
      if (user) {
        const data = await api<{
          attempt: Attempt;
          questions: Question[];
          server_now: string;
        }>("/api/exam", { action: "start", skill: selected, mode });
        next = {
          ...data,
          practice: false,
          serverOffset: Date.parse(data.server_now) - Date.now(),
        };
      } else {
        const data = await api<{ questions: Question[] }>("/api/practice", {
          skill: selected,
          mode,
        });
        const now = Date.now();
        next = {
          questions: data.questions,
          practice: true,
          serverOffset: 0,
          attempt: {
            id: crypto.randomUUID(),
            skill: selected,
            mode,
            status: "active",
            started_at: new Date(now).toISOString(),
            deadline: new Date(
              now + SKILLS.find((s) => s.id === selected)!.minutes * 60000,
            ).toISOString(),
            answers: {},
            audio_claims: [],
            integrity_events: [],
            raw_score: null,
            total: data.questions.length,
          },
        };
        sessionStorage.setItem("tcf-active", JSON.stringify(next));
      }
      setRun(next);
      setSelected(null);
      setResume(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de démarrer.");
    } finally {
      setBusy(false);
    }
  }
  const finish = useCallback(
    (a: Attempt, review: Review[]) => {
      const practice = run?.practice ?? true;
      setRun(null);
      setReport({ attempt: a, review, practice });
      setView("results");
      if (practice)
        setLocalAttempts((previous) => {
          const next = [a, ...previous.filter((x) => x.id !== a.id)].slice(
            0,
            100,
          );
          localStorage.setItem("tcf-history", JSON.stringify(next));
          return next;
        });
      else void loadHistory();
    },
    [run, loadHistory],
  );
  async function openReport(a: Attempt) {
    try {
      const review = user
        ? await api<Review[]>("/api/exam", {
            action: "review",
            attempt_id: a.id,
          })
        : (
            await api<{ review: Review[] }>("/api/practice", {
              skill: a.skill,
              mode: a.mode,
              answers: a.answers,
            })
          ).review;
      setReport({ attempt: a, review, practice: !user });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilan indisponible.");
    }
  }
  if (run) return <ExamRunner run={run} onFinish={finish} />;
  const completed = allAttempts.filter((a) => a.status !== "active"),
    metrics = SKILLS.map((s) => ({
      ...s,
      value: practiceIndex(allAttempts, s.id),
    }));
  const average = metrics.some((m) => m.value !== null)
    ? Math.round(
        metrics.reduce((sum, m) => sum + (m.value ?? 0), 0) /
          metrics.filter((m) => m.value !== null).length,
      )
    : null;
  const days = examDate
    ? Math.max(
        0,
        Math.ceil((Date.parse(examDate + "T12:00:00") - Date.now()) / 86400000),
      )
    : null;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("dashboard");
          }}
        >
          <span className="brand-mark">t.</span>
          <span>
            TCFme<small>C2 PRO</small>
          </span>
        </a>
        <div className="workspace-label">VOTRE ESPACE DE RÉUSSITE</div>
        <nav aria-label="Navigation principale">
          {nav.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${view === n.id ? "active" : ""}`}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={20} />
              {n.label}
              {view === n.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-coach">
          <div className="mini-orb">
            <Sparkles size={24} />
          </div>
          <h3>Un cap. Le niveau C2.</h3>
          <p>Chaque nuance apprise vous rapproche de votre objectif.</p>
          <button
            onClick={() => {
              setMode("c2");
              navigate("exams");
            }}
          >
            Explorer le parcours
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={20} />
            Mes préférences
          </button>
          <div className="profile">
            <div className="avatar">
              <UserRound size={21} />
            </div>
            <div>
              <strong>{user ? user.email?.split("@")[0] : "Mon espace"}</strong>
              <span>
                {user ? "Compte connecté" : "Entraînement découverte"}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label={user ? "Se déconnecter" : "Se connecter"}
              onClick={() =>
                user ? void supabase.auth.signOut() : setAuthOpen(true)
              }
            >
              {user ? <LogOut size={18} /> : <ChevronRight size={18} />}
            </button>
          </div>
        </div>
      </aside>
      {sidebar && (
        <button
          className="sidebar-shade"
          aria-label="Fermer le menu"
          onClick={() => setSidebar(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Ouvrir le menu"
              onClick={() => setSidebar(true)}
            >
              <Menu size={22} />
            </button>
            <span>Mon espace</span>
            <ChevronRight size={14} />
            <strong>
              {nav.find((n) => n.id === view)?.label || "Mes préférences"}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="goal-pill">
              <span />
              Objectif NCLC {target}
              {target === "10" ? "+" : ""}
            </span>
            <button
              className="round-avatar"
              onClick={() => (user ? navigate("settings") : setAuthOpen(true))}
              aria-label="Mon compte"
            >
              <UserRound size={18} />
            </button>
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div role="alert" className="notice error">
              {error}
              <button className="text-button" onClick={() => setError("")}>
                Fermer
              </button>
            </div>
          )}
          {resume && (
            <div className="notice">
              <History size={18} />
              <span>
                Une session locale est en cours. Son chronomètre continue.
              </span>
              <button
                className="text-button"
                onClick={() => {
                  setRun(resume);
                  setResume(null);
                }}
              >
                Reprendre
              </button>
            </div>
          )}
          {view === "dashboard" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    PETITS PROGRÈS, GRANDES AMBITIONS
                  </span>
                  <h1>
                    Votre prochain chapitre commence ici
                    <span className="green-dot">.</span>
                  </h1>
                  <p>
                    Un français plus précis. Une confiance qui grandit. À votre
                    rythme.
                  </p>
                </div>
                <div className="date-chip">
                  <CalendarDays size={17} />
                  {new Intl.DateTimeFormat("fr-FR", {
                    day: "numeric",
                    month: "long",
                    timeZone: "Africa/Douala",
                  }).format(new Date())}
                </div>
              </div>
              <div className="hero-grid">
                <section className="welcome-card">
                  <div className="hero-copy">
                    <div className="hero-label">
                      ✦ &nbsp; VOTRE AMBITION, NOTRE EXIGENCE
                    </div>
                    <h2>
                      Visez plus haut.
                      <br />
                      Exprimez-vous
                      <br />
                      <span>sans limites.</span>
                    </h2>
                    <p>
                      Préparez le TCF Canada avec des simulations exigeantes et
                      un parcours tourné vers le niveau C2.
                    </p>
                    <button
                      className="button lime"
                      onClick={() => {
                        setMode("official");
                        navigate("exams");
                      }}
                    >
                      Commencer une session
                      <ArrowRight size={18} />
                    </button>
                    <div className="hero-foot">
                      <ShieldCheck size={15} />4 compétences · Un objectif à la
                      fois
                    </div>
                  </div>
                  <img
                    className="hero-character"
                    src="/study-companion.png"
                    alt="Un étudiant souriant s’entraîne avec un casque et un ordinateur"
                  />
                  <span className="hero-spark spark-one">✦</span>
                  <span className="hero-spark spark-two">✧</span>
                </section>
                <section className="goal-card card">
                  <div className="section-heading">
                    <h3>Votre cap</h3>
                    <Target size={21} />
                  </div>
                  <div
                    className="readiness-ring"
                    style={
                      {
                        "--progress": `${average ?? 0}%`,
                      } as React.CSSProperties
                    }
                  >
                    <div>
                      <span>{average === null ? "—" : `${average}%`}</span>
                      <small>indice d’entraînement</small>
                    </div>
                  </div>
                  <div className="goal-label">
                    <span>Objectif personnel</span>
                    <strong>
                      NCLC {target}
                      {target === "10" ? "+" : ""}
                    </strong>
                  </div>
                  <p>
                    {average === null
                      ? "Votre première session donnera un point de départ à votre progression."
                      : "Un indicateur pédagogique fondé sur vos réponses récentes."}
                  </p>
                  <button
                    className="text-button"
                    onClick={() => navigate("results")}
                  >
                    Voir ma progression
                    <ArrowRight size={16} />
                  </button>
                </section>
              </div>
              <div className="stats-strip">
                <div>
                  <span className="stat-icon mint">
                    <CheckCircle2 size={22} />
                  </span>
                  <div>
                    <strong>{completed.length}</strong>
                    <span>sessions terminées</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon lavender">
                    <Clock3 size={22} />
                  </span>
                  <div>
                    <strong>
                      {Math.round(
                        completed.reduce(
                          (sum, a) => sum + practiceMinutes(a),
                          0,
                        ),
                      )}
                      <small> min</small>
                    </strong>
                    <span>de pratique cumulée</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon peach">
                    <Target size={22} />
                  </span>
                  <div>
                    <strong>
                      {new Set(completed.map((attempt) => attempt.skill)).size}
                      <small> / 4</small>
                    </strong>
                    <span>compétences explorées</span>
                  </div>
                </div>
                <button
                  className="stat-date"
                  onClick={() => navigate("settings")}
                >
                  <span className="stat-icon pale">
                    <CalendarDays size={22} />
                  </span>
                  <div>
                    <strong>
                      {days === null ? "À définir" : `J − ${days}`}
                    </strong>
                    <span>votre prochain examen</span>
                  </div>
                  <ChevronRight size={18} />
                </button>
              </div>
            </>
          )}
          {(view === "dashboard" || view === "exams") && (
            <>
              <div className="section-heading section-title">
                <div>
                  <h2>
                    {view === "exams"
                      ? "Votre terrain d’entraînement"
                      : "Qu’allez-vous travailler aujourd’hui ?"}
                  </h2>
                  <p>
                    Quatre compétences complémentaires pour aller plus loin.
                  </p>
                </div>
                {view === "dashboard" ? (
                  <button
                    className="text-button"
                    onClick={() => navigate("exams")}
                  >
                    Tout explorer
                    <ArrowRight size={16} />
                  </button>
                ) : (
                  <div className="segmented">
                    <button
                      className={mode === "official" ? "active" : ""}
                      onClick={() => setMode("official")}
                    >
                      Format TCF
                    </button>
                    <button
                      className={mode === "c2" ? "active" : ""}
                      onClick={() => setMode("c2")}
                    >
                      Atelier C2
                      <Sparkles size={13} />
                    </button>
                  </div>
                )}
              </div>
              <div className="skill-grid">
                {SKILLS.map((s, i) => {
                  const Icon = icons[s.id];
                  return (
                    <article className={`skill-card skill-${s.id}`} key={s.id}>
                      <div className="skill-top">
                        <span className="skill-icon">
                          <Icon size={27} />
                        </span>
                        <span className="tag">
                          {s.count} {s.count === 3 ? "tâches" : "questions"}
                        </span>
                      </div>
                      <span className="skill-number">
                        0{i + 1} / {s.short.toUpperCase()}
                      </span>
                      <h3>{s.name}</h3>
                      <p>{s.description}</p>
                      <div className="skill-bottom">
                        <span>
                          <Clock3 size={14} />
                          {s.minutes} min
                        </span>
                        <button
                          aria-label={`Commencer : ${s.name}`}
                          onClick={() => setSelected(s.id)}
                        >
                          <ArrowRight size={20} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {view === "exams" && (
                <div className="notice">
                  <ShieldCheck size={20} />
                  <p>
                    {mode === "official"
                      ? "Durées et tâches selon le format FEI. Sujets originaux, difficulté éditoriale à valider. L’oral est une simulation autonome."
                      : "Atelier personnalisé : brève de 40–60 mots, lettre argumentative, synthèse de 150–180 mots et exercice de persuasion. Ce mode se distingue du format officiel."}
                  </p>
                </div>
              )}
            </>
          )}
          {view === "dashboard" && (
            <div className="lower-grid">
              <section className="card focus-card">
                <div className="focus-symbol">
                  <Sparkles size={28} />
                </div>
                <div>
                  <span className="eyebrow">LE DÉCLIC C2</span>
                  <h3>La nuance fait la différence.</h3>
                  <p>
                    Une idée précise vaut mieux qu’un mot compliqué. Travaillez
                    la concession, le registre et la force de vos arguments.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => navigate("resources")}
                  >
                    Découvrir les repères C2
                    <ArrowRight size={16} />
                  </button>
                </div>
              </section>
              <section className="card last-card">
                <div className="section-heading">
                  <h3>Votre dernière session</h3>
                  <History size={20} />
                </div>
                {completed[0] ? (
                  <>
                    <strong>
                      {SKILLS.find((s) => s.id === completed[0].skill)?.name}
                    </strong>
                    <p>
                      {completed[0].raw_score !== null
                        ? `${completed[0].raw_score} / ${completed[0].total} réponses correctes`
                        : "Production enregistrée"}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => openReport(completed[0])}
                    >
                      Ouvrir le bilan
                      <ArrowRight size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <p>La première étape est souvent la plus importante.</p>
                    <button
                      className="text-button"
                      onClick={() => setSelected("reading")}
                    >
                      Faire mon premier entraînement
                      <ArrowRight size={16} />
                    </button>
                  </>
                )}
              </section>
            </div>
          )}
          {view === "results" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    APPRENDRE. AJUSTER. PROGRESSER.
                  </span>
                  <h1>Votre progression, en perspective.</h1>
                  <p>
                    {user
                      ? "Vos sessions sauvegardées et vos retours pédagogiques."
                      : "Vos entraînements sont conservés dans ce navigateur."}
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => {
                    const link = document.createElement("a"),
                      url = URL.createObjectURL(
                        new Blob([JSON.stringify(allAttempts, null, 2)], {
                          type: "application/json",
                        }),
                      );
                    link.href = url;
                    link.download = "tcfme-progression.json";
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <ArrowDownToLine size={17} />
                  Exporter
                </button>
              </div>
              <div className="analytics-grid">
                <section className="card readiness-card">
                  <div className="section-heading">
                    <h2>Compétence par compétence</h2>
                    <span className="tag">5 dernières sessions</span>
                  </div>
                  {metrics.map((m) => {
                    const Icon = icons[m.id];
                    return (
                      <div className="metric" key={m.id}>
                        <div>
                          <Icon size={18} />
                          <span>{m.name}</span>
                          <strong>
                            {m.value === null
                              ? "Pas encore évaluée"
                              : `${m.value} / 100`}
                          </strong>
                        </div>
                        <div className="bar">
                          <i style={{ width: `${m.value ?? 0}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  <p className="fineprint">
                    Indice interne : exactitude des QCM ou moyenne des critères
                    IA disponibles. Il ne prédit pas un score TCF ni l’obtention
                    du NCLC 9/10. C2 et NCLC 10+ ne sont pas équivalents.
                  </p>
                </section>
                <ScoreConverter />
              </div>
              <section className="card history-card">
                <div className="section-heading">
                  <h2>Historique des sessions</h2>
                  <span className="tag">{allAttempts.length} session(s)</span>
                </div>
                {allAttempts.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Épreuve</th>
                          <th>Date</th>
                          <th>Mode</th>
                          <th>Résultat</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {allAttempts.map((a) => (
                          <tr key={a.id}>
                            <td>
                              {SKILLS.find((s) => s.id === a.skill)?.name}
                            </td>
                            <td>
                              {new Date(a.started_at).toLocaleDateString(
                                "fr-FR",
                              )}
                            </td>
                            <td>
                              <span className="tag">
                                {a.mode === "official"
                                  ? "Format TCF"
                                  : "Atelier C2"}
                              </span>
                            </td>
                            <td>
                              {a.status === "active"
                                ? "En cours"
                                : a.raw_score !== null
                                  ? `${a.raw_score} / ${a.total}`
                                  : "Production sauvegardée"}
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() =>
                                  a.status === "active"
                                    ? (setMode(a.mode), setSelected(a.skill))
                                    : void openReport(a)
                                }
                              >
                                {a.status === "active" ? "Reprendre" : "Bilan"}
                                <ArrowRight size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <ChartNoAxesCombined size={38} />
                    <h3>Votre histoire commence ici.</h3>
                    <p>
                      Terminez une première session pour découvrir vos points
                      d’appui.
                    </p>
                    <button
                      className="button primary"
                      onClick={() => navigate("exams")}
                    >
                      Choisir un entraînement
                      <ArrowRight size={17} />
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
          {view === "resources" && (
            <Resources
              onStart={() => {
                setMode("c2");
                setSelected("writing");
              }}
            />
          )}
          {view === "settings" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    UN PARCOURS QUI VOUS RESSEMBLE
                  </span>
                  <h1>Votre objectif, votre rythme.</h1>
                  <p>Gardez votre cap à portée de vue.</p>
                </div>
              </div>
              <section className="card settings-card">
                <h2>Mon objectif personnel</h2>
                <label>
                  Niveau cible
                  <select
                    value={target}
                    onChange={(e) => {
                      setTarget(e.target.value);
                      localStorage.setItem(
                        "tcf-preferences",
                        JSON.stringify({ target: e.target.value, examDate }),
                      );
                    }}
                  >
                    <option value="9">NCLC 9</option>
                    <option value="10">NCLC 10 et plus</option>
                  </select>
                </label>
                <label>
                  Date prévue de l’examen
                  <input
                    type="date"
                    value={examDate}
                    onChange={(e) => {
                      setExamDate(e.target.value);
                      localStorage.setItem(
                        "tcf-preferences",
                        JSON.stringify({ target, examDate: e.target.value }),
                      );
                    }}
                  />
                </label>
                <div className="notice">
                  <CheckCircle2 size={18} />
                  Préférences enregistrées automatiquement sur cet appareil.
                </div>
                <h2>Mon compte</h2>
                <p>
                  {user
                    ? user.email
                    : "Connectez-vous pour sauvegarder vos tentatives dans votre espace privé."}
                </p>
                <button
                  className="button primary"
                  onClick={() =>
                    user ? void supabase.auth.signOut() : setAuthOpen(true)
                  }
                >
                  {user ? "Se déconnecter" : "Se connecter / Créer un compte"}
                </button>
                <p className="fineprint">
                  Copies et enregistrements des sessions vérifiées sont privés.
                  La correction IA activée transmet votre production au
                  fournisseur du modèle. Les sessions locales restent sur cet
                  appareil ; les QCM sont corrigés sans conservation.
                </p>
              </section>
            </>
          )}
          <footer className="app-footer">
            <span>
              <Leaf size={14} />
              Un peu plus de confiance, chaque jour.
            </span>
            <span>
              TCFme C2 Pro · Préparation indépendante, non affiliée à FEI.
            </span>
          </footer>
        </main>
      </div>
      {selected && (
        <div className="modal-backdrop">
          <div
            className="modal start-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="start-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="Fermer"
              onClick={() => setSelected(null)}
            >
              <X size={20} />
            </button>
            <span className="modal-icon">
              <ShieldCheck size={30} />
            </span>
            <span className="eyebrow">VOTRE PROCHAINE ÉTAPE</span>
            <h2 id="start-title">
              {SKILLS.find((s) => s.id === selected)?.name}
            </h2>
            <div className="session-facts">
              <span>
                <Clock3 size={18} />
                {SKILLS.find((s) => s.id === selected)?.minutes} minutes
              </span>
              <span>
                <BookOpen size={18} />
                {SKILLS.find((s) => s.id === selected)?.count} éléments
              </span>
            </div>
            <div className="segmented">
              <button
                className={mode === "official" ? "active" : ""}
                onClick={() => setMode("official")}
              >
                Format TCF
              </button>
              <button
                className={mode === "c2" ? "active" : ""}
                onClick={() => setMode("c2")}
              >
                Atelier C2
              </button>
            </div>
            <ul className="rules">
              <li>
                <Check size={16} />
                Le temps continue si vous quittez la fenêtre.
              </li>
              <li>
                <Check size={16} />
                Les changements de fenêtre sont signalés.
              </li>
              <li>
                <Check size={16} />
                {selected === "listening"
                  ? "Une lecture par audio, sans retour arrière."
                  : selected === "speaking"
                    ? "Microphone requis. Les tâches s’enchaînent automatiquement."
                    : "Votre travail est sauvegardé au fil de la session."}
              </li>
            </ul>
            <div className="notice">
              {user
                ? "Session liée à votre compte · échéance contrôlée par le serveur."
                : "Mode découverte · sauvegarde locale et correction des QCM. Connectez-vous pour les sessions vérifiées et la correction IA."}
            </div>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button
              autoFocus
              className="button primary full-width"
              disabled={busy}
              onClick={start}
            >
              {busy ? "Préparation…" : "Je suis prêt, commencer"}
              <ArrowRight size={18} />
            </button>
            {!user && (
              <button
                className="text-button centered"
                onClick={() => {
                  setSelected(null);
                  setAuthOpen(true);
                }}
              >
                Me connecter d’abord
              </button>
            )}
          </div>
        </div>
      )}
      {authOpen && <AuthModal close={() => setAuthOpen(false)} />}
      {report && (
        <Report
          report={report}
          close={() => setReport(null)}
          onRefresh={loadHistory}
        />
      )}
    </div>
  );
}
function AuthModal({ close }: { close: () => void }) {
  const [signup, setSignup] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <div
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
      >
        <section className="auth-art">
          <div className="brand">
            <span className="brand-mark">t.</span>
            <span>TCFme C2 Pro</span>
          </div>
          <h2>
            Votre français.
            <br />
            Votre avenir.
          </h2>
          <img src="/study-companion.png" alt="Compagnon d’étude 3D" />
          <p>
            La confiance se construit,
            <br />
            une session à la fois.
          </p>
        </section>
        <section className="auth-form">
          <button
            className="modal-close icon-button"
            aria-label="Fermer"
            onClick={close}
          >
            <X size={20} />
          </button>
          <span className="eyebrow">BIENVENUE CHEZ VOUS</span>
          <h2 id="auth-title">
            {signup ? "Créez votre espace." : "Heureux de vous revoir."}
          </h2>
          <p>
            {signup
              ? "Un premier pas vers de nouvelles possibilités."
              : "Retrouvez votre cap et vos progrès."}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMessage("");
              try {
                const { data, error } = signup
                  ? await supabase.auth.signUp({ email, password })
                  : await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                if (signup && !data.session)
                  setMessage(
                    "Vérifiez votre boîte mail pour confirmer votre compte.",
                  );
                else close();
              } catch (e) {
                setMessage(
                  e instanceof Error ? e.message : "Connexion impossible.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Adresse e-mail
              <input
                autoFocus
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
              />
            </label>
            <label>
              Mot de passe
              <input
                type="password"
                minLength={signup ? 10 : 1}
                autoComplete={signup ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  signup ? "10 caractères minimum" : "Votre mot de passe"
                }
              />
            </label>
            {message && (
              <p role="status" className="notice">
                {message}
              </p>
            )}
            <button className="button primary full-width" disabled={busy}>
              {busy
                ? "Un instant…"
                : signup
                  ? "Créer mon compte"
                  : "Me connecter"}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="auth-switch">
            {signup ? "Déjà un compte ?" : "Pas encore de compte ?"}{" "}
            <button
              className="text-button"
              onClick={() => {
                setSignup(!signup);
                setMessage("");
              }}
            >
              {signup ? "Se connecter" : "Créer un compte"}
            </button>
          </p>
          <p className="fineprint">
            Vos tentatives sont privées. Les corrections IA sont des estimations
            pédagogiques, sans valeur de certification.
          </p>
        </section>
      </div>
    </div>
  );
}
function ScoreConverter() {
  const [skill, setSkill] = useState<Skill>("reading"),
    [score, setScore] = useState("");
  const level = score ? officialNclc(skill, Number(score)) : null;
  return (
    <section className="card converter">
      <span className="eyebrow">REPÈRES OFFICIELS</span>
      <h2>Mon score TCF → NCLC</h2>
      <p>Utilisez uniquement le score d’une attestation officielle.</p>
      <label>
        Compétence
        <select
          value={skill}
          onChange={(e) => {
            setSkill(e.target.value as Skill);
            setScore("");
          }}
        >
          {SKILLS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Score officiel
        <input
          type="number"
          min="0"
          max={["reading", "listening"].includes(skill) ? 699 : 20}
          value={score}
          onChange={(e) => setScore(e.target.value)}
          placeholder={
            ["reading", "listening"].includes(skill) ? "Sur 699" : "Sur 20"
          }
        />
      </label>
      <div className="converted-score">
        {level
          ? `NCLC ${level}${level === 10 ? "+" : ""}`
          : score
            ? "Score hors grille ou sous NCLC 4"
            : "—"}
      </div>
      <a href={SOURCES[2].url} target="_blank" rel="noreferrer">
        Consulter la grille IRCC
        <ExternalLink size={13} />
      </a>
    </section>
  );
}
function Resources({ onStart }: { onStart: () => void }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">LA PRÉCISION S’APPREND</span>
          <h1>Les bons repères pour viser C2.</h1>
          <p>Plus de maîtrise, sans surcharger votre expression.</p>
        </div>
      </div>
      <div className="resource-grid">
        {[
          [
            "01",
            "Nuancer sans affaiblir",
            "« Cette mesure peut améliorer l’accès, pour peu qu’elle s’accompagne de moyens suffisants. »",
            "Distinguez condition, concession et réserve. Chaque connecteur doit servir le raisonnement.",
          ],
          [
            "02",
            "Choisir le bon registre",
            "« Je vous serais reconnaissant de préciser les modalités » / « Tu peux me dire comment ça se passe ? »",
            "La maîtrise se voit dans l’adaptation au destinataire. Une expression soutenue n’est pas toujours la plus juste.",
          ],
          [
            "03",
            "Construire une objection",
            "Position → justification → exemple → objection → réponse nuancée.",
            "Une objection solide éclaire les limites de votre position et précise ce que vous défendez.",
          ],
          [
            "04",
            "Reformuler avec fidélité",
            "Deux documents, deux préoccupations : rendez leur différence intelligible.",
            "Identifiez les présupposés et le point de divergence. Évitez le collage de citations.",
          ],
        ].map(([n, title, example, description]) => (
          <article className="card resource-card" key={n}>
            <span className="resource-number">{n}</span>
            <h2>{title}</h2>
            <blockquote>{example}</blockquote>
            <p>{description}</p>
          </article>
        ))}
      </div>
      <section className="resource-cta">
        <div>
          <h2>À vous de faire la différence.</h2>
          <p>
            Mettez ces repères en pratique dans un atelier d’expression écrite.
          </p>
        </div>
        <button className="button lime" onClick={onStart}>
          Passer à la pratique
          <ArrowRight size={18} />
        </button>
      </section>
      <section className="card sources">
        <h2>Des références, en toute transparence</h2>
        <p>
          Format vérifié le 5 novembre 2026. Sujets et scripts originaux : aucun
          article de presse ni sujet officiel n’est reproduit. Les difficultés
          sont des cibles éditoriales à valider avec des examinateurs et des
          données de candidats.
        </p>
        {SOURCES.map((s) => (
          <a href={s.url} key={s.url} target="_blank" rel="noreferrer">
            <div>
              <strong>{s.name}</strong>
              <span>{s.title}</span>
            </div>
            <ExternalLink size={18} />
          </a>
        ))}
      </section>
    </>
  );
}
function Report({
  report,
  close,
  onRefresh,
}: {
  report: { attempt: Attempt; review: Review[]; practice: boolean };
  close: () => void;
  onRefresh: () => void;
}) {
  const [evaluations, setEvaluations] = useState<Evaluation[]>(
      report.attempt.evaluations ?? [],
    ),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const a = report.attempt;
  const tasks =
    a.skill === "writing"
      ? Object.keys(a.answers)
      : [1, 2, 3].map((n) =>
          a.mode === "c2" && n === 2 ? "c2-speaking-2" : `speaking-${n}`,
        );
  return (
    <div className="modal-backdrop">
      <div
        className="modal report-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
      >
        <button
          className="modal-close icon-button"
          aria-label="Fermer le bilan"
          onClick={close}
        >
          <X size={20} />
        </button>
        <span className="modal-icon">
          <CheckCircle2 size={30} />
        </span>
        <span className="eyebrow">CHAQUE SESSION VOUS FAIT AVANCER</span>
        <h2 id="report-title">Votre bilan de session</h2>
        <p>
          {SKILLS.find((s) => s.id === a.skill)?.name} ·{" "}
          {report.practice ? "Entraînement local" : "Session vérifiée"}
        </p>
        {a.raw_score !== null ? (
          <div className="result-score">
            {a.raw_score}
            <small> / {a.total}</small>
            <span>réponses correctes · résultat brut, sans conversion TCF</span>
          </div>
        ) : (
          <div className="notice">
            Votre production est sauvegardée. La correction IA exige une session
            vérifiée et un fournisseur configuré.
          </div>
        )}
        <div className="report-facts">
          <span>
            {a.status === "expired" ? "Temps écoulé" : "Copie rendue"}
          </span>
          <span>{a.integrity_events.length} événement(s) de vigilance</span>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {report.review.map((r, i) => (
          <details className="review-item" key={r.question_id}>
            <summary>
              <span
                className={
                  a.answers[r.question_id] === String(r.correct)
                    ? "correct-dot"
                    : "incorrect-dot"
                }
              />
              <strong>Question {i + 1}</strong>
              <span>
                {a.answers[r.question_id] === String(r.correct)
                  ? "Bonne réponse"
                  : a.answers[r.question_id]
                    ? "À retravailler"
                    : "Sans réponse"}
              </span>
            </summary>
            <p>
              Bonne réponse : <b>{String.fromCharCode(65 + r.correct)}</b>.{" "}
              {r.rationale}
            </p>
            {r.script && <p className="passage-text">{r.script}</p>}
          </details>
        ))}
        {!report.review.length &&
          tasks.map((id, i) => {
            const result = evaluations.find((e) => e.question_id === id);
            return (
              <section className="task-review" key={id}>
                <div className="section-heading">
                  <h3>Tâche {i + 1}</h3>
                  {!result && (
                    <button
                      className="button secondary"
                      disabled={!!busy || report.practice}
                      onClick={async () => {
                        setBusy(id);
                        setError("");
                        try {
                          const e = await api<Evaluation>("/api/evaluate", {
                            attempt_id: a.id,
                            question_id: id,
                          });
                          setEvaluations((previous) => [
                            ...previous,
                            { ...e, question_id: id },
                          ]);
                          onRefresh();
                        } catch (e) {
                          setError(
                            e instanceof Error
                              ? e.message
                              : "Correction indisponible.",
                          );
                        } finally {
                          setBusy("");
                        }
                      }}
                    >
                      <Sparkles size={16} />
                      {busy === id ? "Analyse en cours…" : "Correction IA"}
                    </button>
                  )}
                </div>
                {a.answers[id] && (
                  <p className="candidate-copy">{a.answers[id]}</p>
                )}
                {result && (
                  <>
                    <span className="tag">
                      Estimation CECR : {result.estimated_level}
                    </span>
                    <div className="evaluation-scores">
                      <span>
                        Lexique <b>{result.lexical_richness_score}/100</b>
                      </span>
                      <span>
                        Grammaire <b>{result.grammatical_accuracy_score}/100</b>
                      </span>
                      <span>
                        Consigne <b>{result.task_achievement_score}/100</b>
                      </span>
                      <span>
                        Registre{" "}
                        <b>{result.pragmatic_appropriateness_score}/100</b>
                      </span>
                    </div>
                    <h4>Construction et argumentation</h4>
                    <p>{result.structural_critique}</p>
                    {result.evidence.map((e, j) => (
                      <p key={j}>
                        <q>{e.excerpt}</q> — {e.comment}
                      </p>
                    ))}
                    <h4>Une proposition de réécriture C2</h4>
                    <p className="rewrite">{result.c2_rewritten_version}</p>
                    <h4>Vos prochains pas</h4>
                    <ul>
                      {result.next_steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                    <p className="fineprint">{result.limitations.join(" ")}</p>
                  </>
                )}
              </section>
            );
          })}
        <button className="button primary full-width" onClick={close}>
          Revenir à ma progression
          <ArrowRight size={17} />
        </button>
      </div>
    </div>
  );
}
