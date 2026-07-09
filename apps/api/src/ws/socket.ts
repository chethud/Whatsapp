import { Server as HttpServer } from "http";
import { Server } from "socket.io";

import { env } from "../config/env.js";
import { verifyAccessToken } from "../lib/jwt.js";

let io: Server | null = null;

export function createSocketServer(httpServer: HttpServer) {
  const allowedOrigins =
    env.NODE_ENV === "production"
      ? [env.APP_ORIGIN]
      : [env.APP_ORIGIN, "http://localhost:3000", "http://localhost:3001"];

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token =
      socket.handshake.auth.token ??
      socket.handshake.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return next(new Error("Unauthorized"));
    }

    try {
      const payload = verifyAccessToken(token);
      socket.data.user = payload;
      socket.join(`user:${payload.sub}`);
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("session:subscribe", (sessionId: string) => {
      socket.join(`session:${sessionId}`);
    });
  });

  return io;
}

export function getIo() {
  if (!io) {
    throw new Error("Socket server not initialized");
  }
  return io;
}
