import Dexie, { type Table } from "dexie";
import {
  initialState,
  validateState,
  StateSchema,
  type State,
  type Exercise,
  type Program,
  type Session,
  type Settings,
} from "./domain";
export class DiaryDB extends Dexie {
  exercises!: Table<Exercise, string>;
  programs!: Table<Program, string>;
  sessions!: Table<Session, string>;
  settings!: Table<Settings, string>;
  constructor(name = "podhod-diary-v1") {
    super(name);
    this.version(1).stores({
      exercises: "id,name",
      programs: "id",
      sessions: "id,status,date",
      settings: "id",
    });
  }
}
export const db = new DiaryDB();
export async function readState(): Promise<State> {
  const [exercises, programs, sessions, settings] = await Promise.all([
    db.exercises.toArray(),
    db.programs.toArray(),
    db.sessions.toArray(),
    db.settings.get("main"),
  ]);
  if (!settings) {
    const s = initialState();
    await writeState(s);
    return s;
  }
  return validateState(
    StateSchema.parse({ exercises, programs, sessions, settings }),
  );
}
export async function writeState(s: State) {
  validateState(StateSchema.parse(s));
  await db.transaction(
    "rw",
    db.exercises,
    db.programs,
    db.sessions,
    db.settings,
    async () => {
      await Promise.all([
        db.exercises.clear(),
        db.programs.clear(),
        db.sessions.clear(),
        db.settings.clear(),
      ]);
      await db.exercises.bulkPut(s.exercises);
      await db.programs.bulkPut(s.programs);
      await db.sessions.bulkPut(s.sessions);
      await db.settings.put(s.settings);
    },
  );
}
