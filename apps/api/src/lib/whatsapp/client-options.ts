import path from "path";

import { isProduction } from "../../config/env.js";
import { buildPuppeteerOptions } from "./puppeteer.js";

export const WWEBJS_AUTH_PATH = isProduction
  ? "/app/.wwebjs_auth"
  : path.resolve(process.cwd(), ".wwebjs_auth");

export function getWhatsappClientOptions() {
  return {
    puppeteer: buildPuppeteerOptions(),
    authTimeoutMs: 120_000,
    qrMaxRetries: 12,
    webVersionCache: {
      type: "remote" as const,
      remotePath:
        "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html",
      strict: false,
    },
  };
}
