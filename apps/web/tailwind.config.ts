import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(224 71% 4%)",
        foreground: "hsl(213 31% 91%)",
        card: "hsl(222 47% 11%)",
        border: "hsl(217 33% 17%)",
        primary: "hsl(221 83% 53%)",
        muted: "hsl(215 20% 65%)",
      },
    },
  },
  plugins: [],
};

export default config;
