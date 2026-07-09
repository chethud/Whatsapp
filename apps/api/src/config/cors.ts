import { env, isProduction } from "./env.js";

export function getAllowedOrigins(): string[] {
  if (env.ALLOWED_ORIGINS) {
    return env.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  if (isProduction) {
    return [env.APP_ORIGIN];
  }

  return [env.APP_ORIGIN, "http://localhost:3000", "http://localhost:3001"];
}

export function getCookieSameSite(): "lax" | "none" {
  return isProduction ? "none" : "lax";
}
