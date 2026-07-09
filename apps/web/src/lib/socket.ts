"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { wsEventNames } from "@whatsapp/shared";

import { useAppStore } from "./store";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

let sharedSocket: Socket | null = null;

export function getSocket(token: string) {
  if (!sharedSocket) {
    sharedSocket = io(API_BASE_URL, {
      auth: { token },
      transports: ["websocket"],
    });
  }
  return sharedSocket;
}

export function disconnectSocket() {
  sharedSocket?.disconnect();
  sharedSocket = null;
}

export function useRealtime() {
  const accessToken = useAppStore((state) => state.accessToken);
  const queryClient = useQueryClient();
  const subscribedSessions = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!accessToken) {
      disconnectSocket();
      return;
    }

    const socket = getSocket(accessToken);

    const invalidateDashboard = () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    };

    socket.on(wsEventNames.dashboardUpdated, invalidateDashboard);
    socket.on(wsEventNames.sessionUpdate, () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      invalidateDashboard();
    });
    socket.on(wsEventNames.qrUpdate, (_payload, sessionId?: string) => {
      const id = typeof _payload === "object" && _payload && "sessionId" in _payload
        ? String((_payload as { sessionId: string }).sessionId)
        : sessionId;
      if (id) {
        queryClient.invalidateQueries({ queryKey: ["session", id] });
      }
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    });
    socket.on(wsEventNames.messageCreated, () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["chats"] });
      invalidateDashboard();
    });
    socket.on(wsEventNames.chatUpdated, () => {
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    });
    socket.on(wsEventNames.notificationCreated, (notification: { title: string; body: string }) => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast(notification.title, { description: notification.body });
    });

    return () => {
      socket.off(wsEventNames.dashboardUpdated);
      socket.off(wsEventNames.sessionUpdate);
      socket.off(wsEventNames.qrUpdate);
      socket.off(wsEventNames.messageCreated);
      socket.off(wsEventNames.chatUpdated);
      socket.off(wsEventNames.notificationCreated);
    };
  }, [accessToken, queryClient]);

  const subscribeSession = (sessionId: string) => {
    if (!accessToken || subscribedSessions.current.has(sessionId)) {
      return;
    }
    const socket = getSocket(accessToken);
    socket.emit("session:subscribe", sessionId);
    subscribedSessions.current.add(sessionId);
  };

  return { subscribeSession };
}
