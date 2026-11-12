import { test, expect } from "@playwright/test";
test("ten sets, resume, history by exercise, backup restore and offline cold launch", async ({
  page,
  context,
  browserName,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await page.getByRole("button", { name: "Начать с Full Body" }).click();
  await page
    .getByRole("button", { name: "Начать тренировку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Жим ногами", exact: true }),
  ).toBeVisible();
  for (let i = 0; i < 10; i++) {
    await page.getByRole("textbox", { name: "Вес", exact: true }).fill("80,5");
    await page
      .getByRole("textbox", { name: "Повторы", exact: true })
      .fill(String(12 - i));
    await page.getByRole("textbox", { name: "RIR", exact: true }).fill("2");
    await expect(
      page.getByRole("button", { name: "Записать подход" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Записать подход" }).click();
    await expect(
      page.getByText("Подход " + (i + 2), { exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("textbox", { name: "Вес", exact: true }).fill("82,5");
  await expect(
    page.getByRole("button", { name: "Записать подход" }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Вес", exact: true }),
  ).toHaveValue("82,5");
  await page.getByRole("textbox", { name: "Вес", exact: true }).fill("");
  await expect(
    page.getByRole("button", { name: "Следующее упражнение" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Следующее упражнение" }).click();
  await expect(
    page.getByRole("heading", { name: "Жим от груди", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Итоги", exact: true }).click();
  await page
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Ваш путь." })).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Сегодня", exact: true })
    .click();
  await page.getByRole("button", { name: /Full Body C/ }).click();
  await expect(page.getByText("было 80.5", { exact: true })).toBeVisible();
  await expect(page.getByText("было 12", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Сегодня", exact: true })
    .click();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать полную копию" }).click();
  const dl = await download;
  let backup: Buffer;
  if (browserName === "chromium" && (await dl.failure())) {
    test.info().annotations.push({
      type: "environment",
      description:
        "Chromium disk download canceled in this Windows runner. Inspecting the actual exported Blob; native disk download is covered by WebKit.",
    });
    backup = Buffer.from(
      await page.evaluate(
        async (url) => await (await fetch(url)).text(),
        dl.url(),
      ),
    );
  } else {
    const stream = await dl.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk);
    backup = Buffer.concat(chunks);
  }
  expect(
    JSON.parse(backup.toString()).data.sessions.find(
      (s: { status: string }) => s.status === "completed",
    ).entries[0].sets,
  ).toHaveLength(10);
  await page
    .getByRole("button", { name: "Удалить черновик", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Удалить черновик", exact: true })
    .click();
  await page.locator("input[type=file]").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: backup,
  });
  await page
    .getByRole("combobox", { name: "Режим", exact: true })
    .selectOption("replace");
  await page
    .getByRole("button", { name: "Подтвердить восстановление" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Восстановление копии" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Тренировка", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Жим ногами", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Сегодня", exact: true })
    .click();
  await expect(
    page.getByText("Готово к работе без интернета", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await context.setOffline(true);
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "В своём темпе." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await page.getByRole("textbox", { name: "Повторы", exact: true }).fill("11");
  await expect(
    page.getByRole("button", { name: "Записать подход" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Записать подход" }).click();
  await expect(page.getByText("Подход 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.screenshot({
    path: "../../work/iphone-14-workout.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("program editing and malformed import retain existing data", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Начать с Full Body" }).click();
  await page.getByRole("button", { name: "План", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ваш план." })).toBeVisible();
  await page
    .getByRole("button", { name: "Опустить Жим ногами", exact: true })
    .click();
  await expect(page.locator(".edit-row").first()).toContainText("Жим от груди");
  await page.reload();
  await expect(page.locator(".edit-row").first()).toContainText("Жим от груди");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"kind":"backup","schemaVersion":1,"data":{}}'),
  });
  await expect(page.getByRole("alert")).toContainText("Файл не подходит");
  await page.getByRole("button", { name: "План", exact: true }).click();
  await expect(page.locator(".edit-row").first()).toContainText("Жим от груди");
});
test("LLM program preview, exercise mapping and explicit activation", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Начать с Full Body" }).click();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const program = {
    kind: "program",
    schemaVersion: 1,
    documentId: "e2e-plan",
    name: "Новый цикл",
    workouts: [{ name: "Мой день", exercises: [{ name: "Жим ногами" }] }],
  };
  await page.locator("input[type=file]").setInputFiles({
    name: "program.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(program)),
  });
  await expect(page.getByRole("heading", { name: "Новый цикл" })).toBeVisible();
  await page
    .getByRole("button", { name: "Подтвердить добавление программы" })
    .click();
  await expect(page.getByRole("heading", { name: "Новый цикл" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "План", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Программа", exact: true })
    .selectOption({ label: "Новый цикл" });
  await expect(page.getByRole("heading", { name: "Мой день" })).toBeVisible();
  await page.getByRole("button", { name: "Сделать активной" }).click();
  await expect(
    page.getByText("Активная программа", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Сегодня", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Мой день" })).toBeVisible();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("checkbox", { name: "Таймер", exact: true }).check();
  await expect(
    page.getByRole("spinbutton", { name: "Отдых, секунд" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Таймер", exact: true }),
  ).toBeChecked();
});
