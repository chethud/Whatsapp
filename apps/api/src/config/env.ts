import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const apiEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");

config({
  path: apiEnvPath,
  override: true,
});

// If apps/api/.env has an empty GEMINI_API_KEY=, fill from monorepo root .env.
if (!process.env.GEMINI_API_KEY?.trim()) {
  delete process.env.GEMINI_API_KEY;
  config({ path: rootEnvPath });
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  APP_ORIGIN: z.string().default("http://localhost:3000"),
  ALLOWED_ORIGINS: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  COOKIE_DOMAIN: z.string().optional(),
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  COMPATIBLE_AI_BASE_URL: z.string().optional(),
  COMPATIBLE_AI_API_KEY: z.string().optional(),
  CSRF_SECRET: z.string().default("replace-me"),
});

export const env = envSchema.parse(process.env);
export const isProduction = env.NODE_ENV === "production";
