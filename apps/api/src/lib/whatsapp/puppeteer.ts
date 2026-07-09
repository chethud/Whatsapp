import { existsSync } from "fs";

import { env } from "../../config/env.js";

const WINDOWS_BROWSER_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const UNIX_BROWSER_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function findInstalledBrowser(): string | undefined {
  const candidates =
    process.platform === "win32" ? WINDOWS_BROWSER_PATHS : UNIX_BROWSER_PATHS;

  return candidates.find((candidate) => existsSync(candidate));
}

export function resolvePuppeteerExecutablePath(): string | undefined {
  if (env.PUPPETEER_EXECUTABLE_PATH) {
    return env.PUPPETEER_EXECUTABLE_PATH;
  }

  return findInstalledBrowser();
}

export function buildPuppeteerOptions() {
  const executablePath = resolvePuppeteerExecutablePath();

  return {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-default-apps",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-sync",
      "--disable-translate",
      "--mute-audio",
      "--hide-scrollbars",
      "--metrics-recording-only",
    ],
  };
}
