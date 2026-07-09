import { Server as HttpServer } from "http";
import { Server } from "socket.io";

import { getAllowedOrigins } from "../config/cors.js";
import { verifyAccessToken } from "../lib/jwt.js";

let io: Server | null = null;

export function createSocketServer(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: getAllowedOrigins(),
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
