import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import {
  initialState,
  startSession,
  parseDraft,
  finishSession,
  previousEntry,
  mergeState,
  LLMProgramSchema,
  importProgram,
  validateState,
} from "./domain";
import { DiaryDB } from "./storage";
describe("diary rules", () => {
  it("records ten sets without a prescribed count and shares exercise history across A/C", () => {
    const s = initialState();
    const p = s.programs[0];
    const a = startSession(s, p.id, p.workouts[0].id);
    s.sessions.push(a);
    for (let i = 0; i < 10; i++)
      a.entries[0].sets.push(
        parseDraft({ weight: "80,5", reps: String(12 - i), rir: "2" }),
      );
    finishSession(s, a);
    a.startedAt = "2020-01-01T10:00:00Z";
    const c = startSession(s, p.id, p.workouts[2].id);
    expect(previousEntry(s, c, c.entries[0])?.entry.sets).toHaveLength(10);
    expect(c.entries[0].sets).toHaveLength(0);
    expect(previousEntry(s, c, c.entries[0])?.entry.sets[10]).toBeUndefined();
  });
  it("preserves history snapshots when a template is changed", () => {
    const s = initialState();
    const p = s.programs[0];
    const a = startSession(s, p.id, p.workouts[0].id);
    const name = a.entries[0].name;
    p.workouts[0].exerciseIds.reverse();
    s.exercises[0].name = "Новое имя";
    expect(a.entries[0].name).toBe(name);
  });
  it("does not count missing weights as invalid, validates reps and bounded RIR", () => {
    expect(parseDraft({ weight: "", reps: "12", rir: "6+" }).weight).toBeNull();
    expect(() => parseDraft({ weight: "10", reps: "", rir: "2" })).toThrow();
    expect(() => parseDraft({ weight: "10", reps: "2", rir: "7" })).toThrow();
  });
  it("merges duplicate backups without duplication and validates links", () => {
    const s = initialState();
    const restored = mergeState(s, structuredClone(s), {});
    expect(restored.exercises.length).toBe(s.exercises.length);
    restored.programs[0].workouts[0].exerciseIds.push("missing");
    expect(() => validateState(restored)).toThrow();
  });
  it("imports an LLM program independently without overwriting history and prevents repeated import", () => {
    const s = initialState();
    const f = LLMProgramSchema.parse({
      kind: "program",
      schemaVersion: 1,
      documentId: "1",
      name: "Новая",
      workouts: [{ name: "День", exercises: [{ name: "Жим ногами" }] }],
    });
    const old = s.settings.activeProgramId;
    importProgram(s, f, { "Жим ногами": s.exercises[0].id });
    expect(s.settings.activeProgramId).toBe(old);
    expect(s.programs).toHaveLength(2);
    expect(() => importProgram(s, f, {})).toThrow();
  });
  it("IndexedDB transaction rolls back a failed import", async () => {
    const db = new DiaryDB("test-" + crypto.randomUUID());
    const s = initialState();
    await db.exercises.bulkPut(s.exercises);
    try {
      await db.transaction("rw", db.exercises, async () => {
        await db.exercises.clear();
        throw Error("invalid import");
      });
    } catch {}
    expect(await db.exercises.count()).toBe(s.exercises.length);
    await db.delete();
  });
});
