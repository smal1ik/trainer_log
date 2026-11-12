import { type State } from "./domain";
export function download(
  name: string,
  content: string,
  type = "application/json",
) {
  const u = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(u);
  }, 60000);
}
export function historyExport(
  s: State,
  from: string,
  to: string,
  exerciseId: string,
  notes: boolean,
) {
  return {
    kind: "history",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    workouts: s.sessions
      .filter((x) => x.status === "completed" && x.date >= from && x.date <= to)
      .map((x) => ({
        date: x.date,
        name: x.name,
        program: x.programName,
        exercises: x.entries
          .filter((e) => !exerciseId || e.exerciseId === exerciseId)
          .map((e) => ({
            name: e.name,
            exerciseId: e.exerciseId,
            ...(notes
              ? {
                  note:
                    s.exercises.find((x) => x.id === e.exerciseId)?.note || "",
                }
              : {}),
            sets: e.sets.map((v, i) => ({
              set: i + 1,
              weightKg: v.weight,
              reps: v.reps,
              rir: v.rir,
            })),
          })),
      }))
      .filter((x) => x.exercises.length),
  };
}
export function markdown(f: ReturnType<typeof historyExport>) {
  return (
    "# История силовых тренировок\n\n" +
    f.workouts
      .map(
        (w) =>
          `## ${w.date} · ${w.name}\n\n` +
          w.exercises
            .map(
              (e) =>
                `### ${e.name}\n${"note" in e && e.note ? "\nЗаметка: " + e.note + "\n" : ""}\n| Подход | кг | Повторы | RIR |\n|---|---|---|---|\n` +
                e.sets
                  .map(
                    (s) =>
                      `| ${s.set} | ${s.weightKg ?? "—"} | ${s.reps} | ${s.rir ?? "—"} |`,
                  )
                  .join("\n"),
            )
            .join("\n\n"),
      )
      .join("\n\n")
  );
}
export function csv(f: ReturnType<typeof historyExport>) {
  const cell = (v: unknown) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  return (
    "\ufeff" +
    [
      ["Дата", "Тренировка", "Упражнение", "Подход", "кг", "Повторы", "RIR"],
      ...f.workouts.flatMap((w) =>
        w.exercises.flatMap((e) =>
          e.sets.map((s) => [
            w.date,
            w.name,
            e.name,
            s.set,
            s.weightKg,
            s.reps,
            s.rir,
          ]),
        ),
      ),
    ]
      .map((row) => row.map(cell).join(";"))
      .join("\r\n")
  );
}
export const programExample = {
  kind: "program",
  schemaVersion: 1,
  documentId: "my-plan-001",
  name: "Моя программа",
  workouts: [
    {
      name: "Тренировка A",
      exercises: [{ name: "Жим ногами" }, { name: "Жим от груди" }],
    },
  ],
};
