import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
const port = process.env.E2E_PORT || "4176";
const basePath = process.env.E2E_BASE_PATH || "/";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 60000,
  use: {
    ...devices["iPhone 14"],
    browserName: "chromium",
    baseURL: `http://127.0.0.1:${port}${basePath}`,
    acceptDownloads: true,
    launchOptions: {
      downloadsPath: resolve(process.cwd(), "../../work/browser-downloads"),
    },
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium", isMobile: false } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: `npm run preview -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}${basePath}`,
    reuseExistingServer: false,
  },
  reporter: "list",
});
