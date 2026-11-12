import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Plus,
  Minus,
  Sun,
  Moon,
  Dumbbell,
  History,
  List,
  ChartNoAxesCombined,
  Settings as SettingsIcon,
  StickyNote,
  GripVertical,
  Trash2,
  Copy,
  Download,
  Upload,
  Archive,
  Play,
  Pause,
  X,
  WifiOff,
  Timer,
  Ellipsis,
  FolderPlus,
} from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { db, readState, writeState } from "./storage";
import {
  uid,
  stamp,
  localDate,
  startSession,
  parseDraft,
  previousEntry,
  finishSession,
  emptyDraft,
  BackupSchema,
  LLMProgramSchema,
  validateState,
  conflicts,
  mergeState,
  importProgram,
  type State,
  type Session,
  type Entry,
  type Program,
  type ProgramFile,
} from "./domain";
import {
  download,
  historyExport,
  markdown,
  csv,
  programExample,
} from "./exchange";
type Page = "home" | "work" | "program" | "history" | "progress" | "settings";
const dateLabel = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
const fmt = (n: unknown) =>
  n === null || n === undefined || n === "" ? "—" : String(n);
function TextDialog({
  title,
  initial = "",
  onSubmit,
  close,
}: {
  title: string;
  initial?: string;
  onSubmit: (s: string) => void;
  close: () => void;
}) {
  const [v, set] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim() || title.includes("заметка")) {
          onSubmit(v.trim());
          close();
        }
      }}
    >
      <h2>{title}</h2>
      <input
        autoFocus
        aria-label={title}
        value={v}
        onChange={(e) => set(e.target.value)}
      />
      <button className="primary">Сохранить</button>
    </form>
  );
}
function Dialog({
  children,
  close,
}: {
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <button
        className="dialog-close icon"
        onClick={close}
        aria-label="Закрыть"
      >
        <X />
      </button>
      {children}
    </dialog>
  );
}
export default function App() {
  const [cachedReady, setCachedReady] = useState(false);
  const [state, setState] = useState<State | null>(null),
    [page, setPage] = useState<Page>(
      (location.hash.slice(1) as Page) || "home",
    ),
    [modal, setModal] = useState<ReactNode>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [clock, setClock] = useState(Date.now()),
    [editId, setEditId] = useState(""),
    [selectedProgram, setSelectedProgram] = useState(""),
    [templateId, setTemplateId] = useState(""),
    [exerciseFilter, setExerciseFilter] = useState(""),
    [chartMetric, setChartMetric] = useState("weight"),
    [from, setFrom] = useState("2000-01-01"),
    [to, setTo] = useState(localDate()),
    [withNotes, setWithNotes] = useState(false),
    [imported, setImported] = useState<State | ProgramFile | null>(null),
    [replace, setReplace] = useState(false),
    [choices, setChoices] = useState<Record<string, boolean>>({}),
    [mapping, setMapping] = useState<Record<string, string>>({});
  const pending = useRef(0);
  const queue = useRef(Promise.resolve()),
    file = useRef<HTMLInputElement>(null),
    alarmDone = useRef<number | null>(null);
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: () =>
      setError(
        "Не удалось подготовить офлайн-кэш. Откройте приложение с сетью ещё раз.",
      ),
  });
  const close = () => setModal(null);
  function go(p: Page) {
    setPage(p);
    location.hash = p;
    setEditId("");
    window.scrollTo({ top: 0 });
  }
  useEffect(() => {
    navigator.serviceWorker?.ready.then(() => setCachedReady(true));
    readState()
      .then(setState)
      .catch((e) => setError("Не удалось открыть дневник: " + e.message));
    const hash = () => {
      const p = location.hash.slice(1);
      if (
        ["home", "work", "program", "history", "progress", "settings"].includes(
          p,
        )
      )
        setPage(p as Page);
    };
    const net = () => setOnline(navigator.onLine);
    addEventListener("hashchange", hash);
    addEventListener("online", net);
    addEventListener("offline", net);
    const t = setInterval(() => setClock(Date.now()), 1000);
    const channel = new BroadcastChannel("podhod-changes");
    channel.onmessage = () =>
      queue.current.then(() => readState().then(setState));
    return () => {
      clearInterval(t);
      removeEventListener("hashchange", hash);
      removeEventListener("online", net);
      removeEventListener("offline", net);
      channel.close();
    };
  }, []);
  useEffect(() => {
    if (!state) return;
    const media = matchMedia("(prefers-color-scheme:dark)");
    const apply = () => {
      const dark =
        state.settings.theme === "dark" ||
        (state.settings.theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", dark ? "#28231f" : "#f6f1e8");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [state?.settings.theme]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 3000);
    return () => clearTimeout(t);
  }, [message]);
  function mutate(fn: (s: State) => void, notice = "") {
    pending.current++;
    setBusy(true);
    let success = false;
    queue.current = queue.current
      .then(async () => {
        const action = async () => {
          const s = await readState();
          fn(s);
          await writeState(s);
          setState(s);
          const c = new BroadcastChannel("podhod-changes");
          c.postMessage("changed");
          c.close();
          if (notice) setMessage(notice);
        };
        if (navigator.locks)
          await navigator.locks.request("podhod-write", action);
        else await action();
        success = true;
      })
      .catch((e) => setError(e.message || "Не удалось сохранить данные"))
      .finally(() => {
        pending.current--;
        setBusy(pending.current > 0);
      });
    return queue.current.then(() => success);
  }
  function ask(title: string, initial: string, fn: (s: string) => void) {
    setModal(
      <TextDialog
        title={title}
        initial={initial}
        onSubmit={fn}
        close={close}
      />,
    );
  }
  const active = state?.sessions.find((s) => s.status === "active");
  const current = editId
    ? state?.sessions.find((s) => s.id === editId)
    : active;
  const total = state?.sessions.filter((s) => s.status === "completed") || [];
  useEffect(() => {
    const end = state?.settings.timerEnd;
    if (end && clock >= end && alarmDone.current !== end) {
      alarmDone.current = end;
      setMessage("Время отдыха закончилось");
      try {
        const ctx = new AudioContext();
        const o = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.08;
        o.connect(gain);
        gain.connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.25);
        o.onended = () => ctx.close();
      } catch {
        /* visual notification remains */
      }
    }
  }, [clock, state?.settings.timerEnd]);
  if (!state)
    return (
      <main className="loading">
        <Dumbbell />
        <h1>Подход</h1>
        <p>{error || "Открываем ваш дневник…"}</p>
        {error && (
          <button onClick={() => location.reload()}>Попробовать снова</button>
        )}
      </main>
    );
  const settings = state.settings;
  function setting(fn: (s: State["settings"]) => void) {
    mutate((s) => {
      fn(s.settings);
      s.settings.updatedAt = stamp();
    });
  }
  function changeSession(fn: (s: Session, root: State) => void, notice = "") {
    const id = current?.id;
    if (id)
      mutate((root) => {
        const s = root.sessions.find((s) => s.id === id);
        if (!s) throw Error("Тренировка уже удалена");
        fn(s, root);
        s.updatedAt = stamp();
      }, notice);
  }
  function addSet(after?: () => void) {
    if (!current) return;
    const entry = current.entries[current.cursor];
    try {
      const value = parseDraft(entry.draft);
      changeSession((s, root) => {
        const e = s.entries.find((e) => e.id === entry.id)!;
        if (e.sets.some((x) => x.id === value.id)) return;
        e.sets.push(value);
        e.draft = emptyDraft();
        if (s.status === "active" && root.settings.timerEnabled) {
          root.settings.timerEnd =
            Date.now() +
            (root.exercises.find((ex) => ex.id === e.exerciseId)?.restSeconds ||
              root.settings.restSeconds) *
              1000;
          root.settings.updatedAt = stamp();
        }
      }, "Подход записан");
      after?.();
    } catch {
      setError(
        "Проверьте результат: повторы — целое число больше 0, вес — неотрицательное число, RIR — 0–5 или 6+.",
      );
    }
  }
  function advance(force = false) {
    if (!current) return;
    const e = current.entries[current.cursor];
    if (!force && Object.values(e.draft).some((v) => v.trim())) {
      setModal(
        <>
          <h2>Подход ещё не записан</h2>
          <p>Что сделать перед переходом?</p>
          <button
            className="primary"
            onClick={() => {
              close();
              addSet(() => advance(true));
            }}
          >
            Записать и перейти
          </button>
          <button
            className="secondary"
            onClick={() => {
              close();
              changeSession((s) => {
                s.entries[s.cursor].draft = emptyDraft();
              });
              advance(true);
            }}
          >
            Перейти без записи
          </button>
        </>,
      );
      return;
    }
    changeSession((s) => {
      s.entries[s.cursor].done = true;
      if (s.cursor < s.entries.length - 1) s.cursor++;
    });
    if (current.cursor === current.entries.length - 1) showSummary();
  }
  function showSummary() {
    setModal(
      <>
        <span className="eyebrow">Итоги занятия</span>
        <h2>Хорошая работа.</h2>
        <p>
          Сохранить тренировку в истории? Записанные подходы можно будет
          исправить позже.
        </p>
        <button
          className="primary"
          onClick={() => {
            const id = current?.id;
            mutate((root) => {
              const s = root.sessions.find((s) => s.id === id)!;
              if (s.status === "active") finishSession(root, s);
            }).then((ok) => {
              if (ok) {
                close();
                go("history");
              }
            });
          }}
        >
          Завершить тренировку
        </button>
        <button className="secondary" onClick={close}>
          Продолжить занятие
        </button>
      </>,
    );
  }
  function begin(programId: string, id: string) {
    if (active) {
      go("work");
      return;
    }
    mutate((s) => {
      s.sessions.push(startSession(s, programId, id));
    }).then((ok) => {
      if (ok) go("work");
    });
  }
  function editSet(entry: Entry, id: string) {
    const value = entry.sets.find((s) => s.id === id)!;
    let w = fmt(value.weight) === "—" ? "" : String(value.weight),
      r = String(value.reps),
      rir = value.rir === null ? "" : String(value.rir);
    setModal(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const parsed = parseDraft({ weight: w, reps: r, rir });
            changeSession((s) => {
              const target = s.entries
                .find((e) => e.id === entry.id)!
                .sets.find((v) => v.id === id)!;
              Object.assign(target, parsed, { id });
            });
            close();
          } catch {
            setError("Проверьте значения подхода");
          }
        }}
      >
        <h2>Исправить подход</h2>
        <label>
          Вес
          <input
            defaultValue={w}
            inputMode="decimal"
            onChange={(e) => (w = e.target.value)}
          />
        </label>
        <label>
          Повторы
          <input
            defaultValue={r}
            inputMode="numeric"
            onChange={(e) => (r = e.target.value)}
          />
        </label>
        <label>
          RIR
          <input
            defaultValue={rir}
            inputMode="text"
            onChange={(e) => (rir = e.target.value)}
          />
        </label>
        <button className="primary">Сохранить</button>
        <button
          type="button"
          className="danger secondary"
          onClick={() => {
            changeSession((s) => {
              const e = s.entries.find((e) => e.id === entry.id)!;
              e.sets = e.sets.filter((v) => v.id !== id);
            });
            close();
          }}
        >
          Удалить этот подход
        </button>
      </form>,
    );
  }
  const program =
    state.programs.find(
      (p) => p.id === (selectedProgram || settings.activeProgramId),
    ) || state.programs[0];
  const template =
    program?.workouts.find((w) => w.id === templateId) || program?.workouts[0];
  function editProgram(fn: (p: Program, s: State) => void) {
    if (program)
      mutate((s) => {
        const p = s.programs.find((p) => p.id === program.id)!;
        fn(p, s);
        p.updatedAt = stamp();
      });
  }
  function chooseExercise(onChoose: (id: string) => void) {
    let query = "";
    const list = (q: string) => (
      <>
        <h2>Добавить упражнение</h2>
        <input
          autoFocus
          placeholder="Найти или создать своё"
          aria-label="Поиск упражнения"
          defaultValue={q}
          onChange={(e) => {
            query = e.target.value;
            setModal(list(query));
          }}
        />
        <div className="picker-list">
          {state!.exercises
            .filter(
              (e) =>
                !e.archived && e.name.toLowerCase().includes(q.toLowerCase()),
            )
            .map((e) => (
              <button
                className="row"
                key={e.id}
                onClick={() => {
                  onChoose(e.id);
                  close();
                }}
              >
                {e.name}
                <Plus size={18} />
              </button>
            ))}
        </div>
        <button
          className="primary"
          onClick={() => {
            close();
            ask("Название упражнения", q, (name) => {
              const id = uid();
              mutate((s) =>
                s.exercises.push({
                  id,
                  name,
                  note: "",
                  weightRule: "single",
                  archived: false,
                  updatedAt: stamp(),
                }),
              ).then((ok) => {
                if (ok) onChoose(id);
              });
            });
          }}
        >
          Создать своё
        </button>
      </>
    );
    setModal(list(query));
  }
  function backup() {
    const time = stamp();
    const snapshot = structuredClone(state!);
    snapshot.settings.lastBackupAt = time;
    snapshot.settings.updatedAt = time;
    download(
      "podhod-backup-" + localDate() + ".json",
      JSON.stringify(
        { kind: "backup", schemaVersion: 1, exportedAt: time, data: snapshot },
        null,
        2,
      ),
    );
    setting((s) => (s.lastBackupAt = time));
    setMessage("Копия подготовлена. Сохраните файл в надёжном месте.");
  }
  async function readFile(f: File) {
    try {
      if (f.size > 30 * 1024 * 1024) throw Error("Файл больше 30 МБ");
      const raw = JSON.parse(await f.text());
      const parsed =
        raw.kind === "backup"
          ? validateState(BackupSchema.parse(raw).data)
          : LLMProgramSchema.parse(raw);
      setImported(parsed);
      setChoices({});
      setMapping({});
      setReplace(false);
      go("settings");
    } catch {
      setError(
        "Файл не подходит. Нужна резервная копия или программа JSON формата «Подход», версия 1.",
      );
    }
  }
  const header = (title: string, back?: () => void) => (
    <header>
      <button
        className="icon"
        aria-label={back ? "Назад" : "Настройки"}
        onClick={back || (() => go("settings"))}
      >
        {back ? <ArrowLeft /> : <SettingsIcon />}
      </button>
      <span>{title}</span>
      <button
        className="icon"
        aria-label="Переключить тему"
        onClick={() =>
          setting(
            (s) =>
              (s.theme =
                document.documentElement.dataset.theme === "dark"
                  ? "light"
                  : "dark"),
          )
        }
      >
        {document.documentElement.dataset.theme === "dark" ? <Sun /> : <Moon />}
      </button>
    </header>
  );
  const pageTitle = (eyebrow: string, title: string) => (
    <div className="page-title">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
    </div>
  );
  function workout() {
    if (!current)
      return (
        <>
          {header("Тренировка")}
          {pageTitle("Ваш ритм", "Начнём?")}
          <p className="muted">Выберите тренировку на главном экране.</p>
          <button className="primary" onClick={() => go("home")}>
            Выбрать тренировку <ArrowRight />
          </button>
        </>
      );
    const entry = current.entries[current.cursor];
    if (!entry)
      return (
        <>
          {header("Тренировка")}
          <p>В тренировке пока нет упражнений.</p>
          <button
            className="primary"
            onClick={() =>
              chooseExercise((id) =>
                changeSession((s, r) =>
                  s.entries.push({
                    id: uid(),
                    exerciseId: id,
                    name: r.exercises.find((e) => e.id === id)!.name,
                    done: false,
                    sets: [],
                    draft: emptyDraft(),
                  }),
                ),
              )
            }
          >
            Добавить упражнение
          </button>
        </>
      );
    const ex = state!.exercises.find((e) => e.id === entry.exerciseId)!;
    const past = previousEntry(state!, current, entry);
    const previous = past?.entry.sets[entry.sets.length];
    function draft(key: keyof Entry["draft"], value: string) {
      const entryId = entry.id;
      changeSession((s) => {
        const e = s.entries.find((e) => e.id === entryId)!;
        if (!s.hasInput) {
          if (!s.dateManuallySet) s.date = localDate();
          s.hasInput = true;
        }
        e.draft[key] = value;
      });
    }
    return (
      <>
        {header(current.name, () => go(editId ? "history" : "home"))}
        <div className="progress-track">
          <span
            style={{
              width: `${(current.entries.filter((e) => e.done).length / current.entries.length) * 100}%`,
            }}
          />
        </div>
        <div className="between">
          <span className="eyebrow">
            Упражнение {String(current.cursor + 1).padStart(2, "0")} /{" "}
            {String(current.entries.length).padStart(2, "0")}
          </span>
          <button
            className="icon"
            aria-label="Все упражнения"
            onClick={() =>
              setModal(
                <>
                  <h2>Вся тренировка</h2>
                  {current.entries.map((e, i) => (
                    <div className="row" key={e.id}>
                      <button
                        className="row-name"
                        onClick={() => {
                          changeSession((s) => (s.cursor = i));
                          close();
                        }}
                      >
                        <span className="muted">{i + 1} </span>
                        {e.name}
                        <small>
                          {e.sets.length} подходов {e.done ? "· завершено" : ""}
                        </small>
                      </button>
                      <button
                        className="icon"
                        aria-label="Поднять упражнение"
                        disabled={!i}
                        onClick={() => {
                          changeSession((s) => {
                            const cursorId = s.entries[s.cursor].id;
                            [s.entries[i], s.entries[i - 1]] = [
                              s.entries[i - 1],
                              s.entries[i],
                            ];
                            s.cursor = s.entries.findIndex(
                              (e) => e.id === cursorId,
                            );
                          });
                          close();
                        }}
                      >
                        ↑
                      </button>
                    </div>
                  ))}
                  <button
                    className="secondary"
                    onClick={() => {
                      close();
                      chooseExercise((id) =>
                        changeSession((s, r) =>
                          s.entries.push({
                            id: uid(),
                            exerciseId: id,
                            name: r.exercises.find((e) => e.id === id)!.name,
                            done: false,
                            sets: [],
                            draft: emptyDraft(),
                          }),
                        ),
                      );
                    }}
                  >
                    + Добавить упражнение сегодня
                  </button>
                  <p className="caption">
                    Состав текущей тренировки меняется отдельно от программы.
                  </p>
                </>,
              )
            }
          >
            <List />
          </button>
        </div>
        <h1 className="exercise-title">{entry.name}</h1>
        <button
          className="note"
          onClick={() =>
            ask("Личная заметка", ex.note, (text) =>
              mutate((s) => {
                const e = s.exercises.find((e) => e.id === ex.id)!;
                e.note = text;
                e.updatedAt = stamp();
              }),
            )
          }
        >
          <StickyNote size={16} />
          {ex.note || "Добавить заметку"}
        </button>
        <div className="rule" />
        <div className="between set-heading">
          <b>Подход {entry.sets.length + 1}</b>
          <button
            className="text muted"
            onClick={() => {
              let v = current.date;
              setModal(
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (v) {
                      changeSession((s) => {
                        s.date = v;
                        s.dateManuallySet = true;
                      });
                      close();
                    }
                  }}
                >
                  <h2>Дата тренировки</h2>
                  <input
                    type="date"
                    defaultValue={v}
                    required
                    onChange={(e) => (v = e.target.value)}
                  />
                  <button className="primary">Сохранить</button>
                </form>,
              );
            }}
          >
            {current.date === localDate() ? "Сегодня" : dateLabel(current.date)}
          </button>
        </div>
        <div className="between past-heading">
          <span>Прошлая тренировка</span>
          <span>
            {past
              ? `${dateLabel(past.session.date)} · ${past.session.name}`
              : "Пока нет истории"}
          </span>
        </div>
        <div className="metrics">
          {(["weight", "reps", "rir"] as const).map((k, i) => (
            <div className="metric" key={k}>
              <label htmlFor={k}>{["кг", "Повторы", "RIR"][i]}</label>
              <input
                id={k}
                aria-label={["Вес", "Повторы", "RIR"][i]}
                inputMode={
                  k === "weight" ? "decimal" : k === "rir" ? "text" : "numeric"
                }
                autoComplete="off"
                key={entry.id + entry.sets.length + k}
                defaultValue={entry.draft[k]}
                placeholder="—"
                onChange={(e) => draft(k, e.target.value)}
              />
              <span className="past">было {fmt(previous?.[k])}</span>
              <div className="steppers">
                {[-1, 1].map((dir) => (
                  <button
                    key={dir}
                    aria-label={`${dir < 0 ? "Уменьшить" : "Увеличить"} ${["вес", "повторы", "RIR"][i]}`}
                    onClick={() => {
                      const field = document.getElementById(
                        k,
                      ) as HTMLInputElement;
                      const n =
                        (field.value === "6+"
                          ? 6
                          : Number(field.value.replace(",", "."))) || 0;
                      const next = Math.max(
                        0,
                        n + dir * (k === "weight" ? 2.5 : 1),
                      );
                      const value =
                        k === "rir"
                          ? next > 5
                            ? "6+"
                            : String(next)
                          : String(next);
                      field.value = value;
                      draft(k, value);
                    }}
                  >
                    {dir < 0 ? <Minus size={18} /> : <Plus size={18} />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          className="primary record"
          disabled={busy}
          onClick={() => addSet()}
        >
          <Check size={21} />
          Записать подход
        </button>
        {entry.sets.length > 0 && (
          <div className="recorded">
            {entry.sets.map((r, i) => (
              <button
                className="row"
                key={r.id}
                onClick={() => editSet(entry, r.id)}
              >
                <span className="muted">Подход {i + 1}</span>
                <span>
                  {r.weight !== null ? `${r.weight} × ` : ""}
                  {r.reps}
                  <span className="muted"> / {fmt(r.rir)} RIR</span>
                </span>
                <Check size={16} />
              </button>
            ))}
          </div>
        )}
        <div className="next">
          <div>
            <span className="caption">
              {current.cursor === current.entries.length - 1
                ? "Финиш"
                : "Далее"}
            </span>
            <p>
              {current.entries[current.cursor + 1]?.name ||
                "Завершить тренировку"}
            </p>
          </div>
          <button
            className="round"
            aria-label="Следующее упражнение"
            disabled={busy}
            onClick={() => advance()}
          >
            <ArrowRight />
          </button>
        </div>
        <div className="work-actions">
          <button
            className="text"
            onClick={() =>
              setModal(
                <>
                  <h2>Изменить упражнение</h2>
                  <button
                    className="row"
                    onClick={() => {
                      close();
                      chooseExercise((id) =>
                        changeSession((s, r) => {
                          const e = s.entries.find((e) => e.id === entry.id)!;
                          if (e.sets.length)
                            throw Error(
                              "Сначала удалите записанные подходы или добавьте другое упражнение отдельно",
                            );
                          e.exerciseId = id;
                          e.name = r.exercises.find((e) => e.id === id)!.name;
                          e.draft = emptyDraft();
                        }),
                      );
                    }}
                  >
                    Заменить только сегодня <ChevronRight />
                  </button>
                  <button
                    className="row danger"
                    onClick={() => {
                      changeSession((s) => {
                        if (entry.sets.length)
                          throw Error(
                            "Упражнение с результатами сначала очистите от подходов",
                          );
                        s.entries = s.entries.filter((e) => e.id !== entry.id);
                        s.cursor = Math.min(
                          s.cursor,
                          Math.max(0, s.entries.length - 1),
                        );
                      });
                      close();
                    }}
                  >
                    Убрать только сегодня <Trash2 size={18} />
                  </button>
                  <button
                    className="row"
                    onClick={() => {
                      changeSession((s, r) => {
                        const p = r.programs.find((p) => p.id === s.programId);
                        const t = p?.workouts.find(
                          (t) => t.id === s.templateId,
                        );
                        if (!p || !t)
                          throw Error("Исходная программа уже удалена");
                        t.exerciseIds = s.entries.map((e) => e.exerciseId);
                        p.updatedAt = stamp();
                      });
                      close();
                      setMessage("Состав сохранён в программу");
                    }}
                  >
                    Сохранить состав в программу
                  </button>
                </>,
              )
            }
          >
            Изменить упражнение
          </button>
          <button className="text" onClick={showSummary}>
            Итоги
          </button>
        </div>
      </>
    );
  }
  function home() {
    const p = state!.programs.find(
      (p) => p.id === settings.activeProgramId && !p.archived,
    );
    const next =
      p?.workouts.find((w) => w.id === settings.nextTemplateId) ||
      p?.workouts[0];
    return (
      <>
        {header("Подход")}
        {pageTitle(
          new Date().toLocaleDateString("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long",
          }),
          "В своём темпе.",
        )}
        <section className="hero">
          <div className="abstract" />
          <span className="eyebrow">
            {active ? "В процессе" : "Следующая тренировка"}
          </span>
          <h2>{active?.name || next?.name || "Ваш новый план"}</h2>
          <p className="muted">
            {active
              ? `${active.entries.reduce((n, e) => n + e.sets.length, 0)} подходов записано`
              : next
                ? `${next.exerciseIds.length} упражнений · без спешки`
                : "Создайте тренировку для первого занятия"}
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              active
                ? go("work")
                : next && p
                  ? begin(p.id, next.id)
                  : go("program")
            }
          >
            {active
              ? "Продолжить"
              : next
                ? "Начать тренировку"
                : "Создать тренировку"}
            <ArrowRight size={19} />
          </button>
        </section>
        <div className="stats">
          <div>
            <strong>
              {total
                .filter(
                  (s) =>
                    s.date >= localDate(new Date(Date.now() - 6 * 86400000)),
                )
                .length.toString()
                .padStart(2, "0")}
            </strong>
            <span>за последние 7 дней</span>
          </div>
          <div>
            <strong>
              {total
                .filter((s) => s.date.slice(0, 7) === localDate().slice(0, 7))
                .length.toString()
                .padStart(2, "0")}
            </strong>
            <span>в этом месяце</span>
          </div>
        </div>
        <div className="between">
          <h3>{p?.name || "Ваша программа"}</h3>
          <button className="text" onClick={() => go("program")}>
            Изменить
          </button>
        </div>
        {p?.workouts.map((w, i) => (
          <button
            className="row workout-row"
            disabled={busy}
            key={w.id}
            onClick={() => begin(p.id, w.id)}
          >
            <span className="workout-letter">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="grow">
              {w.name}
              <small>{w.exerciseIds.length} упражнений</small>
            </span>
            <ChevronRight size={18} />
          </button>
        ))}
        {!total.length && (
          <p className="quiet">
            Прогресс начинается с первой записи.
            <br />
            История появится после завершения занятия.
          </p>
        )}
        {settings.backupEvery > 0 &&
          total.length > 0 &&
          total.filter((s) => (s.endedAt || "") > (settings.lastBackupAt || ""))
            .length >= settings.backupEvery && (
            <button className="notice" onClick={backup}>
              Пора сохранить резервную копию <Download size={18} />
            </button>
          )}
        {needRefresh && (
          <div className="notice">
            <span>Доступна новая версия.</span>
            <button
              className="text"
              disabled={!!active}
              onClick={() => updateServiceWorker(true)}
            >
              {active ? "После тренировки" : "Обновить"}
            </button>
          </div>
        )}
        <div className="connection">
          <span
            className={"dot " + (offlineReady || cachedReady ? "ready" : "")}
          />
          {offlineReady || cachedReady
            ? "Готово к работе без интернета"
            : online
              ? "Подготавливаем офлайн-режим"
              : "Нет сети"}
        </div>
      </>
    );
  }
  function programs() {
    return (
      <>
        {header("Программы")}
        {pageTitle("Под вас", "Ваш план.")}
        <div className="program-select">
          <select
            aria-label="Программа"
            value={program?.id || ""}
            onChange={(e) => {
              setSelectedProgram(e.target.value);
              setTemplateId("");
            }}
          >
            {state!.programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archived ? " · архив" : ""}
              </option>
            ))}
          </select>
          <button
            className="icon"
            aria-label="Новая программа"
            onClick={() =>
              ask("Название программы", "", (name) => {
                const id = uid();
                mutate((s) =>
                  s.programs.push({
                    id,
                    name,
                    archived: false,
                    workouts: [],
                    updatedAt: stamp(),
                  }),
                );
                setSelectedProgram(id);
              })
            }
          >
            <FolderPlus />
          </button>
        </div>
        {program && (
          <>
            <div className="between caption">
              <span>
                {program.id === settings.activeProgramId
                  ? "Активная программа"
                  : program.archived
                    ? "В архиве"
                    : "Другая программа"}
              </span>
              <button
                className="text"
                onClick={() =>
                  setting((s) => {
                    s.activeProgramId = program.id;
                    s.nextTemplateId = program.workouts[0]?.id || "";
                  })
                }
              >
                Сделать активной
              </button>
            </div>
            <div className="chips">
              {program.workouts.map((w) => (
                <button
                  key={w.id}
                  className={w.id === template?.id ? "selected" : ""}
                  onClick={() => setTemplateId(w.id)}
                >
                  {w.name}
                </button>
              ))}
              <button
                aria-label="Добавить тренировку"
                onClick={() =>
                  ask("Название тренировки", "", (name) =>
                    editProgram((p) =>
                      p.workouts.push({ id: uid(), name, exerciseIds: [] }),
                    ),
                  )
                }
              >
                <Plus size={18} />
              </button>
            </div>
            {template && (
              <>
                <div className="between">
                  <h3>{template.name}</h3>
                  <button
                    className="icon"
                    aria-label="Настройки тренировки"
                    onClick={() =>
                      setModal(
                        <>
                          <h2>{template.name}</h2>
                          <button
                            className="row"
                            onClick={() => {
                              close();
                              ask(
                                "Название тренировки",
                                template.name,
                                (name) =>
                                  editProgram(
                                    (p) =>
                                      (p.workouts.find(
                                        (w) => w.id === template.id,
                                      )!.name = name),
                                  ),
                              );
                            }}
                          >
                            Переименовать
                          </button>
                          <button
                            className="row"
                            onClick={() => {
                              editProgram((p) =>
                                p.workouts.push({
                                  ...structuredClone(template),
                                  id: uid(),
                                  name: template.name + " · копия",
                                }),
                              );
                              close();
                            }}
                          >
                            Копировать <Copy size={18} />
                          </button>
                          <button
                            className="row"
                            onClick={() => {
                              editProgram((p) => {
                                const i = p.workouts.findIndex(
                                  (w) => w.id === template.id,
                                );
                                if (i > 0)
                                  [p.workouts[i], p.workouts[i - 1]] = [
                                    p.workouts[i - 1],
                                    p.workouts[i],
                                  ];
                              });
                              close();
                            }}
                          >
                            Передвинуть раньше ↑
                          </button>
                          <button
                            className="row"
                            onClick={() => {
                              editProgram((p) => {
                                const i = p.workouts.findIndex(
                                  (w) => w.id === template.id,
                                );
                                if (i < p.workouts.length - 1)
                                  [p.workouts[i], p.workouts[i + 1]] = [
                                    p.workouts[i + 1],
                                    p.workouts[i],
                                  ];
                              });
                              close();
                            }}
                          >
                            Передвинуть позже ↓
                          </button>
                          <button
                            className="row danger"
                            onClick={() => {
                              editProgram(
                                (p) =>
                                  (p.workouts = p.workouts.filter(
                                    (w) => w.id !== template.id,
                                  )),
                              );
                              setTemplateId("");
                              close();
                            }}
                          >
                            Удалить из программы
                          </button>
                        </>,
                      )
                    }
                  >
                    <Ellipsis />
                  </button>
                </div>
                <p className="caption">
                  Упражнения по порядку. Подходы записываются в зале.
                </p>
                {template.exerciseIds.map((id, i) => {
                  const ex = state!.exercises.find((e) => e.id === id)!;
                  return (
                    <div
                      className="edit-row"
                      key={i}
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/plain", String(i))
                      }
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = Number(
                          e.dataTransfer.getData("text/plain"),
                        );
                        editProgram((p) => {
                          const a = p.workouts.find(
                            (w) => w.id === template.id,
                          )!.exerciseIds;
                          if (from >= 0 && from < a.length)
                            a.splice(i, 0, a.splice(from, 1)[0]);
                        });
                      }}
                    >
                      <GripVertical size={15} className="muted" />
                      <button
                        className="row-name"
                        onClick={() => exerciseSettings(ex.id)}
                      >
                        {ex.name}
                      </button>
                      <button
                        className="icon small-icon"
                        aria-label={`Поднять ${ex.name}`}
                        disabled={i === 0}
                        onClick={() =>
                          editProgram((p) => {
                            const a = p.workouts.find(
                              (w) => w.id === template.id,
                            )!.exerciseIds;
                            [a[i], a[i - 1]] = [a[i - 1], a[i]];
                          })
                        }
                      >
                        ↑
                      </button>
                      <button
                        className="icon small-icon"
                        aria-label={`Опустить ${ex.name}`}
                        disabled={i === template.exerciseIds.length - 1}
                        onClick={() =>
                          editProgram((p) => {
                            const a = p.workouts.find(
                              (w) => w.id === template.id,
                            )!.exerciseIds;
                            [a[i], a[i + 1]] = [a[i + 1], a[i]];
                          })
                        }
                      >
                        ↓
                      </button>
                      <button
                        className="icon small-icon"
                        aria-label={`Изменить ${ex.name}`}
                        onClick={() =>
                          setModal(
                            <>
                              <h2>{ex.name}</h2>
                              <button
                                className="row"
                                onClick={() => {
                                  close();
                                  chooseExercise((newId) =>
                                    editProgram(
                                      (p) =>
                                        (p.workouts.find(
                                          (w) => w.id === template.id,
                                        )!.exerciseIds[i] = newId),
                                    ),
                                  );
                                }}
                              >
                                Заменить в плане
                              </button>
                              <button
                                className="row danger"
                                onClick={() => {
                                  editProgram((p) =>
                                    p.workouts
                                      .find((w) => w.id === template.id)!
                                      .exerciseIds.splice(i, 1),
                                  );
                                  close();
                                }}
                              >
                                Убрать из плана
                              </button>
                            </>,
                          )
                        }
                      >
                        <Ellipsis size={18} />
                      </button>
                    </div>
                  );
                })}
                <button
                  className="add-row"
                  onClick={() =>
                    chooseExercise((id) =>
                      editProgram((p) =>
                        p.workouts
                          .find((w) => w.id === template.id)!
                          .exerciseIds.push(id),
                      ),
                    )
                  }
                >
                  <Plus size={18} />
                  Добавить упражнение
                </button>
                <button
                  className="primary"
                  disabled={busy || !template.exerciseIds.length}
                  onClick={() => begin(program.id, template.id)}
                >
                  {active ? "Продолжить занятие" : "Начать эту тренировку"}
                  <Play size={18} />
                </button>
              </>
            )}
            <div className="rule" />
            <button
              className="row"
              onClick={() =>
                ask("Название программы", program.name, (name) =>
                  editProgram((p) => (p.name = name)),
                )
              }
            >
              Переименовать программу
            </button>
            <button
              className="row"
              onClick={() =>
                mutate((s) => {
                  const copy = structuredClone(program);
                  copy.id = uid();
                  copy.name += " · копия";
                  copy.updatedAt = stamp();
                  copy.workouts.forEach((w) => (w.id = uid()));
                  s.programs.push(copy);
                })
              }
            >
              Копировать программу <Copy size={18} />
            </button>
            <button
              className="row"
              onClick={() => editProgram((p) => (p.archived = !p.archived))}
            >
              {program.archived ? "Вернуть из архива" : "В архив"}{" "}
              <Archive size={18} />
            </button>
          </>
        )}
      </>
    );
  }
  function exerciseSettings(id: string) {
    const ex = state!.exercises.find((e) => e.id === id)!;
    setModal(
      <>
        <h2>{ex.name}</h2>
        <button
          className="row"
          onClick={() => {
            close();
            ask("Название упражнения", ex.name, (name) =>
              mutate((s) => {
                const e = s.exercises.find((e) => e.id === id)!;
                e.name = name;
                e.updatedAt = stamp();
              }),
            );
          }}
        >
          Переименовать
        </button>
        <button
          className="row"
          onClick={() => {
            close();
            ask("Личная заметка", ex.note, (note) =>
              mutate((s) => {
                const e = s.exercises.find((e) => e.id === id)!;
                e.note = note;
                e.updatedAt = stamp();
              }),
            );
          }}
        >
          Заметка
        </button>
        <label>
          Как записывать вес
          <select
            defaultValue={ex.weightRule}
            onChange={(e) => {
              const rule = e.target.value as typeof ex.weightRule;
              mutate((s) => {
                const ex = s.exercises.find((e) => e.id === id)!;
                ex.weightRule = rule;
                ex.updatedAt = stamp();
              });
            }}
          >
            <option value="single">Вес одной гантели / снаряда</option>
            <option value="total">Суммарный вес</option>
            <option value="body">Без отягощения</option>
          </select>
        </label>
        <label>
          Отдых для этого упражнения, секунд
          <input
            type="number"
            min="15"
            max="1800"
            placeholder={String(settings.restSeconds)}
            defaultValue={ex.restSeconds || ""}
            onBlur={(ev) => {
              const n = ev.target.value ? Number(ev.target.value) : undefined;
              if (n === undefined || (n >= 15 && n <= 1800))
                mutate((s) => {
                  const e = s.exercises.find((e) => e.id === id)!;
                  e.restSeconds = n;
                  e.updatedAt = stamp();
                });
            }}
          />
        </label>
        <p className="caption">
          История сохраняется при переименовании. Другой вариант упражнения
          создайте отдельно.
        </p>
      </>,
    );
  }
  function filters() {
    return (
      <div className="filters">
        <label>
          С
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          По
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <select
          aria-label="Фильтр упражнений"
          value={exerciseFilter}
          onChange={(e) => setExerciseFilter(e.target.value)}
        >
          <option value="">Все упражнения</option>
          {state!.exercises.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>
    );
  }
  function historyPage() {
    const items = total
      .filter(
        (s) =>
          s.date >= from &&
          s.date <= to &&
          (!exerciseFilter ||
            s.entries.some((e) => e.exerciseId === exerciseFilter)),
      )
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          b.startedAt.localeCompare(a.startedAt),
      );
    return (
      <>
        {header("История")}
        {pageTitle("Каждое занятие важно", "Ваш путь.")}
        <div className="calendar-strip">
          {Array.from({ length: 14 }, (_, i) => {
            const d = localDate(new Date(Date.now() - (13 - i) * 86400000));
            return (
              <button
                key={d}
                title={d}
                onClick={() => {
                  setFrom(d);
                  setTo(d);
                }}
                className={total.some((s) => s.date === d) ? "trained" : ""}
              >
                <span>
                  {new Date(d + "T12:00:00").toLocaleDateString("ru", {
                    weekday: "narrow",
                  })}
                </span>
                {Number(d.slice(-2))}
                <i />
              </button>
            );
          })}
        </div>
        {filters()}
        <button
          className="text"
          onClick={() => {
            setFrom("2000-01-01");
            setTo(localDate());
            setExerciseFilter("");
          }}
        >
          Показать всю историю
        </button>
        {!items.length && (
          <div className="empty">
            <History />
            <h3>Здесь будет ваша история</h3>
            <p>Завершённые тренировки появятся автоматически.</p>
          </div>
        )}
        {items.map((s) => (
          <button
            className="history-card"
            key={s.id}
            onClick={() => {
              setEditId(s.id);
              setPage("work");
            }}
          >
            <span className="eyebrow">
              {dateLabel(s.date)} · {s.date.slice(0, 4)}
            </span>
            <h2>{s.name}</h2>
            <div className="between muted">
              <span>
                {s.entries.filter((e) => e.sets.length).length} упражнений ·{" "}
                {s.entries.reduce((n, e) => n + e.sets.length, 0)} подходов
              </span>
              <ArrowRight size={18} />
            </div>
          </button>
        ))}
      </>
    );
  }
  function progress() {
    const id = exerciseFilter || state!.exercises[0]?.id;
    const data = total
      .filter((s) => s.date >= from && s.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => ({
        date: s.date,
        sets: s.entries
          .filter((e) => e.exerciseId === id)
          .flatMap((e) => e.sets),
      }))
      .filter((x) => x.sets.length);
    const sets = data.flatMap((x) => x.sets),
      weights = sets
        .map((s) => s.weight)
        .filter((x): x is number => x !== null);
    const max = weights.length ? Math.max(...weights) : null;
    const graphData =
      chartMetric === "weight"
        ? data.filter((x) => x.sets.some((s) => s.weight !== null))
        : data;
    const points = graphData.map((x) =>
      chartMetric === "reps"
        ? Math.max(...x.sets.map((s) => s.reps))
        : chartMetric === "volume"
          ? x.sets.reduce((n, s) => n + (s.weight ?? 0) * s.reps, 0)
          : Math.max(
              ...x.sets.filter((s) => s.weight !== null).map((s) => s.weight!),
            ),
    );
    const ceiling = Math.max(...points, 1);
    return (
      <>
        {header("Прогресс")}
        {pageTitle("История по упражнениям", "Шаг за шагом.")}
        <select
          aria-label="Упражнение для аналитики"
          value={id}
          onChange={(e) => setExerciseFilter(e.target.value)}
        >
          {state!.exercises.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <div className="filters dates">
          <label>
            С
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            По
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        {!sets.length ? (
          <div className="empty">
            <ChartNoAxesCombined />
            <h3>Пока без цифр</h3>
            <p>Запишите первую тренировку с этим упражнением.</p>
          </div>
        ) : (
          <>
            <div className="stats">
              <div>
                <strong>{fmt(max)}</strong>
                <span>лучший вес, кг</span>
              </div>
              <div>
                <strong>{Math.max(...sets.map((s) => s.reps))}</strong>
                <span>максимум повторений</span>
              </div>
            </div>
            <div className="between">
              <h3>Динамика</h3>
              <select
                aria-label="Показатель графика"
                className="chart-select"
                value={chartMetric}
                onChange={(e) => setChartMetric(e.target.value)}
              >
                <option value="weight">Вес</option>
                <option value="reps">Повторы</option>
                <option value="volume">Объём</option>
              </select>
            </div>
            {points.length ? (
              <div className="chart">
                <svg
                  viewBox="0 0 320 150"
                  role="img"
                  aria-label={
                    chartMetric === "reps"
                      ? "Повторения по занятиям"
                      : chartMetric === "volume"
                        ? "Объём по занятиям"
                        : "Рабочий вес по занятиям"
                  }
                >
                  <path
                    d="M10 130H310M10 70H310M10 10H310"
                    className="grid-lines"
                  />
                  <polyline
                    points={points
                      .map(
                        (p, i) =>
                          `${points.length === 1 ? 160 : 10 + (i * 300) / (points.length - 1)},${130 - (p / ceiling) * 115}`,
                      )
                      .join(" ")}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  />
                  {points.map((p, i) => (
                    <circle
                      key={i}
                      cx={
                        points.length === 1
                          ? 160
                          : 10 + (i * 300) / (points.length - 1)
                      }
                      cy={130 - (p / ceiling) * 115}
                      r="4"
                      fill="currentColor"
                    />
                  ))}
                </svg>
                <div className="between caption">
                  <span>{dateLabel(graphData[0].date)}</span>
                  <span>{dateLabel(graphData.at(-1)!.date)}</span>
                </div>
              </div>
            ) : (
              <p className="muted">
                Без отягощения — смотрите повторения ниже.
              </p>
            )}
            <div className="summary-grid">
              <div>
                <b>{sets.length}</b>
                <span>рабочих подходов</span>
              </div>
              <div>
                <b>{sets.reduce((n, s) => n + s.reps, 0)}</b>
                <span>повторений</span>
              </div>
              <div>
                <b>
                  {sets
                    .reduce((n, s) => n + (s.weight ?? 0) * s.reps, 0)
                    .toLocaleString("ru")}
                </b>
                <span>объём с весом, кг</span>
              </div>
            </div>
            <h3>По занятиям</h3>
            {data.map((d, i) => (
              <div className="row" key={i}>
                <span>{dateLabel(d.date)}</span>
                <span className="small">
                  {d.sets
                    .map(
                      (s) =>
                        (s.weight !== null ? s.weight + " × " : "") + s.reps,
                    )
                    .join(" · ")}
                </span>
              </div>
            ))}
          </>
        )}
      </>
    );
  }
  function importPreview() {
    if (!imported) return null;
    const isBackup = "settings" in imported;
    return (
      <section className="import-preview">
        <h3>{isBackup ? "Восстановление копии" : "Программа от LLM"}</h3>
        {isBackup ? (
          <>
            <p>
              {imported.programs.length} программ · {imported.exercises.length}{" "}
              упражнений · {imported.sessions.length} тренировок
            </p>
            <label>
              Режим
              <select
                value={replace ? "replace" : "merge"}
                onChange={(e) => setReplace(e.target.value === "replace")}
              >
                <option value="merge">Объединить с текущими данными</option>
                <option value="replace">
                  Полностью заменить текущие данные
                </option>
              </select>
            </label>
            {replace ? (
              <p className="notice">
                Текущая база будет заменена после подтверждения. Сначала
                сохраните её резервную копию.
              </p>
            ) : (
              conflicts(state!, imported).map((c) => (
                <label key={c.collection + c.id}>
                  {c.label}
                  <select
                    value={
                      choices[c.collection + ":" + c.id]
                        ? "incoming"
                        : "current"
                    }
                    onChange={(e) =>
                      setChoices({
                        ...choices,
                        [c.collection + ":" + c.id]:
                          e.target.value === "incoming",
                      })
                    }
                  >
                    <option value="current">Оставить текущую версию</option>
                    <option value="incoming">
                      Использовать версию из копии
                    </option>
                  </select>
                </label>
              ))
            )}
          </>
        ) : (
          <>
            <h2>{imported.name}</h2>
            {imported.workouts.map((w, i) => (
              <p key={i}>
                <b>{w.name}</b>
                <br />
                {w.exercises.map((e) => e.name).join(" · ")}
              </p>
            ))}
            <p className="caption">
              Сопоставьте упражнения с существующими или создайте новые.
            </p>
            {[
              ...new Set(
                imported.workouts.flatMap((w) =>
                  w.exercises.map((e) => e.name),
                ),
              ),
            ].map((name) => (
              <label key={name}>
                {name}
                <select
                  value={mapping[name] || ""}
                  onChange={(e) =>
                    setMapping({ ...mapping, [name]: e.target.value })
                  }
                >
                  <option value="">Создать отдельное упражнение</option>
                  {state!.exercises.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </>
        )}
        <button className="secondary" onClick={backup}>
          <Download size={17} />
          Сохранить текущую копию
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            mutate((s) => {
              if ("settings" in imported) {
                const next = replace
                  ? validateState(imported)
                  : mergeState(s, imported, choices);
                Object.assign(s, structuredClone(next));
                s.settings.onboarded = true;
              } else importProgram(s, imported, mapping);
            }, "Импорт выполнен").then((ok) => {
              if (ok) setImported(null);
            });
          }}
        >
          Подтвердить {isBackup ? "восстановление" : "добавление программы"}
        </button>
        <button className="secondary" onClick={() => setImported(null)}>
          Отмена
        </button>
      </section>
    );
  }
  function settingsPage() {
    return (
      <>
        {header("Настройки", () => go("home"))}
        {pageTitle("Ваше пространство", "Всё под рукой.")}
        <section className="settings-section">
          <h3>Оформление</h3>
          <label>
            Тема
            <select
              value={settings.theme}
              onChange={(e) => {
                const value = e.target.value as typeof settings.theme;
                setting((s) => (s.theme = value));
              }}
            >
              <option value="system">Как в системе</option>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </label>
        </section>
        <section className="settings-section">
          <h3>Отдых между подходами</h3>
          <label className="toggle">
            Таймер
            <input
              type="checkbox"
              key={String(settings.timerEnabled)}
              defaultChecked={settings.timerEnabled}
              onChange={(e) => {
                const checked = e.target.checked;
                setting((s) => (s.timerEnabled = checked));
              }}
            />
          </label>
          {settings.timerEnabled && (
            <>
              <label>
                Отдых, секунд
                <input
                  type="number"
                  min="15"
                  max="1800"
                  value={settings.restSeconds}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v >= 15 && v <= 1800)
                      setting((s) => (s.restSeconds = v));
                  }}
                />
              </label>
              <p className="caption">
                Запускается после записи подхода. После возвращения из фона
                время пересчитывается. Звук при блокировке экрана не
                гарантируется.
              </p>
            </>
          )}
        </section>
        <section className="settings-section">
          <h3>Резервная копия</h3>
          <p className="caption">
            Весь дневник в одном JSON. Последний экспорт:{" "}
            {settings.lastBackupAt
              ? new Date(settings.lastBackupAt).toLocaleString("ru")
              : "ещё не было"}
            .
          </p>
          <button className="row" onClick={backup}>
            Скачать полную копию <Download size={19} />
          </button>
          <button className="row" onClick={() => file.current?.click()}>
            Загрузить копию или программу <Upload size={19} />
          </button>
          <label>
            Напоминать каждые
            <select
              value={settings.backupEvery}
              onChange={(e) => {
                const value = Number(e.target.value);
                setting((s) => (s.backupEvery = value));
              }}
            >
              <option value="0">Не напоминать</option>
              {[3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n} тренировок
                </option>
              ))}
            </select>
          </label>
          {importPreview()}
        </section>
        <section className="settings-section">
          <h3>История для анализа</h3>
          {filters()}
          <label className="toggle">
            Включить личные заметки
            <input
              type="checkbox"
              checked={withNotes}
              onChange={(e) => setWithNotes(e.target.checked)}
            />
          </label>
          <div className="export-buttons">
            {["JSON", "Markdown", "CSV"].map((format) => (
              <button
                className="chip"
                key={format}
                onClick={() => {
                  const f = historyExport(
                    state!,
                    from,
                    to,
                    exerciseFilter,
                    withNotes,
                  );
                  download(
                    "podhod-history." +
                      { JSON: "json", Markdown: "md", CSV: "csv" }[format],
                    format === "JSON"
                      ? JSON.stringify(f, null, 2)
                      : format === "CSV"
                        ? csv(f)
                        : markdown(f),
                    format === "JSON"
                      ? "application/json"
                      : "text/plain;charset=utf-8",
                  );
                }}
              >
                {format} <Download size={14} />
              </button>
            ))}
          </div>
        </section>
        <section className="settings-section">
          <h3>Программа от LLM</h3>
          <p className="caption">
            Скачайте запрос с примером формата, передайте его модели вместе с
            историей. Готовый JSON загрузите кнопкой импорта выше. Новая
            программа не заменяет историю.
          </p>
          <button
            className="row"
            onClick={() =>
              download(
                "podhod-llm-request.md",
                "Составь редактируемую программу силовых тренировок по моим пожеланиям. Верни только JSON по этому примеру. documentId должен быть уникальным для новой программы. Упражнения — объекты с полем name. Не добавляй фактические результаты или историю тренировок.\n\n" +
                  JSON.stringify(programExample, null, 2),
                "text/markdown;charset=utf-8",
              )
            }
          >
            Запрос и пример формата <Download size={18} />
          </button>
        </section>
        <section className="settings-section">
          <h3>Установка и данные</h3>
          <p className="caption">
            На iPhone откройте опубликованное приложение в Safari → «Поделиться»
            → «На экран Домой». Перед первым занятием дождитесь готовности
            офлайн-режима.
          </p>
          <p className="caption">
            Дневник хранится на этом устройстве. Очистка данных сайта удалит
            локальную базу — сохраняйте копии в «Файлы». Для переноса на другой
            домен используйте экспорт и восстановление.
          </p>
          <button
            className="row"
            onClick={async () => {
              try {
                const ok = await navigator.storage?.persist?.();
                setMessage(
                  ok
                    ? "Запрошено постоянное хранение"
                    : "Браузер сам управляет сохранением. Делайте резервные копии.",
                );
              } catch {
                setMessage("Постоянное хранение недоступно в этом браузере");
              }
            }}
          >
            Защитить локальное хранение
          </button>
        </section>
        {active && (
          <section className="settings-section">
            <h3>Текущая тренировка</h3>
            <button
              className="row"
              onClick={() => {
                go("work");
                showSummary();
              }}
            >
              Завершить с текущими результатами
            </button>
            <button
              className="row danger"
              onClick={() =>
                setModal(
                  <>
                    <h2>Удалить черновик?</h2>
                    <p>
                      Все подходы этой незавершённой тренировки будут удалены.
                      Остальная история сохранится.
                    </p>
                    <button
                      className="primary"
                      onClick={() => {
                        mutate((s) => {
                          s.sessions = s.sessions.filter(
                            (x) => x.id !== active.id,
                          );
                          s.settings.timerEnd = null;
                        });
                        close();
                      }}
                    >
                      Удалить черновик
                    </button>
                    <button className="secondary" onClick={close}>
                      Оставить
                    </button>
                  </>,
                )
              }
            >
              Удалить черновик
            </button>
          </section>
        )}
        <footer className="app-footer">
          ПОДХОД · ВАШ ЛИЧНЫЙ ДНЕВНИК
          <br />
          Версия 1.0 · данные остаются у вас
        </footer>
      </>
    );
  }
  if (!settings.onboarded)
    return (
      <main className="onboarding">
        <span className="brand">
          <Dumbbell /> ПОДХОД
        </span>
        <div className="intro-art">
          <span />
          <span />
          <span />
        </div>
        <span className="eyebrow">Личный дневник силы</span>
        <h1>
          Ваш ритм.
          <br />
          Ваш прогресс.
        </h1>
        <p>
          Записывайте подходы, ориентируйтесь на прошлые результаты и меняйте
          план под себя.
        </p>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setting((s) => (s.onboarded = true));
            navigator.storage?.persist?.().catch(() => {});
          }}
        >
          Начать с Full Body <ArrowRight size={20} />
        </button>
        <button
          className="secondary"
          onClick={() => {
            mutate((s) => {
              const p = {
                id: uid(),
                name: "Моя программа",
                archived: false,
                updatedAt: stamp(),
                workouts: [],
              };
              s.programs = [p];
              s.exercises = [];
              s.settings.activeProgramId = p.id;
              s.settings.nextTemplateId = "";
              s.settings.onboarded = true;
            });
            go("program");
          }}
        >
          Создать свою программу
        </button>
        <button
          className="secondary"
          onClick={() => {
            setting((s) => (s.onboarded = true));
            go("settings");
            file.current?.click();
          }}
        >
          Импортировать файл
        </button>
        <p className="caption">
          Без регистрации. Работает офлайн после подготовки.
        </p>
        <input
          ref={file}
          hidden
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFile(f);
            e.target.value = "";
          }}
        />
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError("")}>Закрыть</button>
          </div>
        )}
      </main>
    );
  const timerLeft = settings.timerEnd
    ? Math.max(0, Math.ceil((settings.timerEnd - clock) / 1000))
    : 0;
  return (
    <div className="layout">
      <aside className="desktop-aside">
        <span className="brand">
          <Dumbbell />
          ПОДХОД
        </span>
        <h1>
          Сила
          <br />в постоянстве.
        </h1>
        <p>
          Личный дневник.
          <br />В вашем темпе.
        </p>
        <div className="aside-art" />
      </aside>
      <main className="app">
        <div className={"content " + (page === "work" ? "work-content" : "")}>
          {!online && (
            <div className="offline">
              <WifiOff size={14} />
              Вы офлайн · записи сохраняются на устройстве
            </div>
          )}
          {error && (
            <div role="alert" className="error">
              {error}
              <button
                className="icon"
                aria-label="Закрыть ошибку"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {(
            {
              home,
              work: workout,
              program: programs,
              history: historyPage,
              progress,
              settings: settingsPage,
            }[page] || home
          )()}
        </div>
        {settings.timerEnabled && active && (
          <div className="timer-bar">
            <Timer size={17} />
            <span>
              {settings.timerEnd
                ? timerLeft
                  ? `${Math.floor(timerLeft / 60)}:${String(timerLeft % 60).padStart(2, "0")}`
                  : "Отдых завершён"
                : "Отдых"}
            </span>
            <button
              aria-label="Запустить таймер"
              onClick={() =>
                setting((s) => (s.timerEnd = Date.now() + s.restSeconds * 1000))
              }
            >
              <Play size={17} />
            </button>
            <button
              onClick={() =>
                setting(
                  (s) =>
                    (s.timerEnd =
                      (s.timerEnd && s.timerEnd > Date.now()
                        ? s.timerEnd
                        : Date.now()) + 30000),
                )
              }
            >
              +30
            </button>
            <button
              aria-label="Остановить таймер"
              onClick={() => setting((s) => (s.timerEnd = null))}
            >
              <X size={17} />
            </button>
          </div>
        )}
        <nav>
          {(
            [
              ["home", "Сегодня", Dumbbell],
              ["work", "Тренировка", List],
              ["history", "История", History],
              ["progress", "Прогресс", ChartNoAxesCombined],
              ["program", "План", GripVertical],
            ] as const
          ).map(([p, name, Icon]) => (
            <button
              key={p}
              className={page === p ? "selected" : ""}
              onClick={() => go(p)}
            >
              <Icon size={20} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
      </main>
      {modal && <Dialog close={close}>{modal}</Dialog>}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
      <input
        type="file"
        ref={file}
        hidden
        accept=".json,application/json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) readFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
