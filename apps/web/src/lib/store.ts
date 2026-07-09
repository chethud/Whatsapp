import { create } from "zustand";

import { clearAuthTokens } from "./auth-tokens";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  twoFactorEnabled?: boolean;
  createdAt?: string;
};

type AppState = {
  accessToken: string | null;
  user: AuthUser | null;
  setAccessToken: (token: string | null) => void;
  setUser: (user: AuthUser | null) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
};

export const useAppStore = create<AppState>((set) => ({
  accessToken: null,
  user: null,
  setAccessToken: (token) => {
    if (typeof window !== "undefined") {
      if (token) {
        window.localStorage.setItem("wa_access_token", token);
      } else {
        clearAuthTokens();
      }
    }
    set({ accessToken: token });
  },
  setUser: (user) => set({ user }),
  darkMode: true,
  toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),
}));
