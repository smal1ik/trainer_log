import { z } from "zod";
export const uid = () => crypto.randomUUID();
export const stamp = () => new Date().toISOString();
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const entity = { id: z.string().min(1), updatedAt: z.string() };
export const ExerciseSchema = z.object({
  ...entity,
  name: z.string().min(1),
  note: z.string(),
  weightRule: z.enum(["single", "total", "body"]),
  archived: z.boolean(),
  restSeconds: z.number().int().min(15).max(1800).optional(),
});
export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  exerciseIds: z.array(z.string()),
});
export const ProgramSchema = z.object({
  ...entity,
  name: z.string().min(1),
  archived: z.boolean(),
  workouts: z.array(TemplateSchema),
});
export const SetSchema = z.object({
  id: z.string(),
  weight: z.number().nonnegative().nullable(),
  reps: z.number().int().positive(),
  rir: z.union([z.number().int().min(0).max(5), z.literal("6+")]).nullable(),
  recordedAt: z.string(),
});
export const EntrySchema = z.object({
  id: z.string(),
  exerciseId: z.string(),
  name: z.string(),
  done: z.boolean(),
  sets: z.array(SetSchema),
  draft: z.object({ weight: z.string(), reps: z.string(), rir: z.string() }),
});
export const SessionSchema = z.object({
  ...entity,
  programId: z.string(),
  templateId: z.string(),
  programName: z.string(),
  name: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: z.enum(["active", "completed"]),
  cursor: z.number().int().nonnegative(),
  hasInput: z.boolean().default(false),
  dateManuallySet: z.boolean().default(false),
  entries: z.array(EntrySchema),
});
export const SettingsSchema = z.object({
  id: z.literal("main"),
  updatedAt: z.string(),
  onboarded: z.boolean(),
  activeProgramId: z.string(),
  nextTemplateId: z.string(),
  theme: z.enum(["system", "light", "dark"]),
  timerEnabled: z.boolean(),
  restSeconds: z.number().int().min(15).max(1800),
  timerEnd: z.number().nullable(),
  lastBackupAt: z.string().nullable(),
  backupEvery: z.number().int().min(0).max(100),
});
export type Exercise = z.infer<typeof ExerciseSchema>;
export type Program = z.infer<typeof ProgramSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type Entry = z.infer<typeof EntrySchema>;
export type Result = z.infer<typeof SetSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export const StateSchema = z.object({
  exercises: z.array(ExerciseSchema),
  programs: z.array(ProgramSchema),
  sessions: z.array(SessionSchema),
  settings: SettingsSchema,
});
export type State = z.infer<typeof StateSchema>;
const initialNames = [
  [
    "Жим ногами",
    "Жим от груди",
    "Тяга верхнего блока",
    "Сгибание ног",
    "Махи гантелями",
    "Бицепс",
    "Шраги",
    "Пресс",
  ],
  [
    "Приседания со штангой",
    "Жим гантелей под наклоном",
    "Горизонтальная тяга",
    "Румынская тяга",
    "Обратная бабочка",
    "Трицепс",
    "Икры",
    "Пресс",
  ],
  [
    "Жим ногами",
    "Жим от груди",
    "Тяга верхнего блока",
    "Гиперэкстензия",
    "Махи гантелями",
    "Бицепс",
    "Трицепс",
    "Шраги",
    "Икры",
  ],
];
export function initialState(): State {
  const t = stamp();
  const names = [...new Set(initialNames.flat())];
  const exercises: Exercise[] = names.map((name) => ({
    id: uid(),
    updatedAt: t,
    name,
    note: "",
    weightRule: "single",
    archived: false,
  }));
  const program: Program = {
    id: uid(),
    updatedAt: t,
    name: "Full Body",
    archived: false,
    workouts: initialNames.map((names, i) => ({
      id: uid(),
      name: `Full Body ${"ABC"[i]}`,
      exerciseIds: names.map((n) => exercises.find((e) => e.name === n)!.id),
    })),
  };
  return {
    exercises,
    programs: [program],
    sessions: [],
    settings: {
      id: "main",
      updatedAt: t,
      onboarded: false,
      activeProgramId: program.id,
      nextTemplateId: program.workouts[0].id,
      theme: "system",
      timerEnabled: false,
      restSeconds: 90,
      timerEnd: null,
      lastBackupAt: null,
      backupEvery: 5,
    },
  };
}
export const emptyDraft = () => ({ weight: "", reps: "", rir: "" });
export function startSession(
  state: State,
  programId: string,
  templateId: string,
): Session {
  if (state.sessions.some((s) => s.status === "active"))
    throw Error("Сначала завершите текущую тренировку");
  const p = state.programs.find((p) => p.id === programId)!;
  const t = p.workouts.find((w) => w.id === templateId)!;
  if (!t.exerciseIds.length) throw Error("Добавьте упражнения в тренировку");
  const now = stamp();
  return {
    id: uid(),
    updatedAt: now,
    programId: p.id,
    templateId: t.id,
    programName: p.name,
    name: t.name,
    date: localDate(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    startedAt: now,
    endedAt: null,
    status: "active",
    cursor: 0,
    hasInput: false,
    dateManuallySet: false,
    entries: t.exerciseIds.map((id) => ({
      id: uid(),
      exerciseId: id,
      name: state.exercises.find((e) => e.id === id)!.name,
      done: false,
      sets: [],
      draft: emptyDraft(),
    })),
  };
}
export function parseDraft(d: Entry["draft"]): Result {
  const num = (s: string) => Number(s.trim().replace(",", "."));
  if (!d.reps.trim() || !Number.isInteger(num(d.reps)) || num(d.reps) < 1)
    throw Error("Укажите целое число повторений больше нуля");
  const weight = d.weight.trim() ? num(d.weight) : null;
  if (weight !== null && (!Number.isFinite(weight) || weight < 0))
    throw Error("Проверьте вес");
  const rir = d.rir.trim() === "6+" ? "6+" : d.rir.trim() ? num(d.rir) : null;
  return SetSchema.parse({
    id: uid(),
    weight,
    reps: num(d.reps),
    rir,
    recordedAt: stamp(),
  });
}
export function previousEntry(
  state: State,
  session: Session,
  entry: Entry,
): { session: Session; entry: Entry } | null {
  const occurrence = session.entries
    .slice(0, session.entries.indexOf(entry))
    .filter((e) => e.exerciseId === entry.exerciseId).length;
  const candidates = state.sessions
    .filter(
      (s) =>
        s.id !== session.id &&
        s.status === "completed" &&
        (s.date < session.date ||
          (s.date === session.date && s.startedAt < session.startedAt)),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.startedAt.localeCompare(a.startedAt),
    );
  for (const s of candidates) {
    const e = s.entries.filter((e) => e.exerciseId === entry.exerciseId)[
      occurrence
    ];
    if (e?.sets.length) return { session: s, entry: e };
  }
  return null;
}
export function finishSession(state: State, s: Session) {
  s.status = "completed";
  s.endedAt = stamp();
  s.updatedAt = stamp();
  const p = state.programs.find((p) => p.id === s.programId);
  const index = p?.workouts.findIndex((w) => w.id === s.templateId) ?? -1;
  state.settings.nextTemplateId =
    p?.workouts[(index + 1) % p.workouts.length]?.id || "";
  state.settings.timerEnd = null;
  state.settings.updatedAt = stamp();
}
export const BackupSchema = z.object({
  kind: z.literal("backup"),
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  data: StateSchema,
});
export const LLMProgramSchema = z.object({
  kind: z.literal("program"),
  schemaVersion: z.literal(1),
  documentId: z.string().min(1),
  name: z.string().min(1),
  workouts: z
    .array(
      z.object({
        name: z.string().min(1),
        exercises: z.array(z.object({ name: z.string().min(1) })).min(1),
      }),
    )
    .min(1),
});
export type ProgramFile = z.infer<typeof LLMProgramSchema>;
export function validateState(s: State) {
  const ex = new Set(s.exercises.map((e) => e.id));
  for (const p of s.programs)
    for (const w of p.workouts)
      for (const id of w.exerciseIds)
        if (!ex.has(id))
          throw Error("Программа ссылается на отсутствующее упражнение");
  for (const session of s.sessions) {
    if (session.entries.length && session.cursor >= session.entries.length)
      throw Error("Некорректное текущее упражнение");
    for (const entry of session.entries)
      if (!ex.has(entry.exerciseId))
        throw Error("В истории отсутствует упражнение");
  }
  for (const collection of [s.exercises, s.programs, s.sessions])
    if (new Set(collection.map((x) => x.id)).size !== collection.length)
      throw Error("Повторяющиеся идентификаторы");
  if (s.sessions.filter((x) => x.status === "active").length > 1)
    throw Error("В копии несколько активных тренировок");
  return s;
}
export type Conflict = {
  collection: "exercises" | "programs" | "sessions" | "settings";
  id: string;
  label: string;
};
export function conflicts(a: State, b: State): Conflict[] {
  const out: Conflict[] = [];
  for (const key of ["exercises", "programs", "sessions"] as const)
    for (const item of b[key]) {
      const old = a[key].find((x) => x.id === item.id);
      if (old && JSON.stringify(old) !== JSON.stringify(item))
        out.push({ collection: key, id: item.id, label: item.name });
    }
  if (JSON.stringify(a.settings) !== JSON.stringify(b.settings))
    out.push({
      collection: "settings",
      id: "main",
      label: "Настройки и активная программа",
    });
  return out;
}
export function mergeState(
  a: State,
  b: State,
  choices: Record<string, boolean>,
): State {
  const s = structuredClone(a);
  for (const key of ["exercises", "programs", "sessions"] as const) {
    const map = new Map<string, any>(a[key].map((x) => [x.id, x]));
    for (const x of b[key])
      if (!map.has(x.id) || choices[key + ":" + x.id]) map.set(x.id, x);
    (s[key] as any) = Array.from(map.values());
  }
  if (choices["settings:main"]) s.settings = structuredClone(b.settings);
  return validateState(s);
}
export function importProgram(
  s: State,
  f: ProgramFile,
  mapping: Record<string, string>,
): Program {
  if (s.programs.some((p) => p.id === "import:" + f.documentId))
    throw Error("Эта программа уже импортирована");
  const names = [
    ...new Set(f.workouts.flatMap((w) => w.exercises.map((e) => e.name))),
  ];
  const ids: Record<string, string> = {};
  for (const name of names) {
    const chosen = mapping[name];
    if (chosen && s.exercises.some((e) => e.id === chosen)) ids[name] = chosen;
    else {
      const e: Exercise = {
        id: uid(),
        name,
        note: "",
        weightRule: "single",
        archived: false,
        updatedAt: stamp(),
      };
      s.exercises.push(e);
      ids[name] = e.id;
    }
  }
  const p: Program = {
    id: "import:" + f.documentId,
    updatedAt: stamp(),
    name: f.name,
    archived: false,
    workouts: f.workouts.map((w) => ({
      id: uid(),
      name: w.name,
      exerciseIds: w.exercises.map((e) => ids[e.name]),
    })),
  };
  s.programs.push(p);
  return p;
}
