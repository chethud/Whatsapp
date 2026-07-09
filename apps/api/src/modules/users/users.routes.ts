import { Router } from "express";
import { createUserSchema, updateUserSchema } from "@whatsapp/shared";
import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { hashPassword } from "../../lib/password.js";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireRole("SUPER_ADMIN", "ADMIN"));

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ success: true, data: users });
});

usersRouter.post("/", validateBody(createUserSchema), async (req, res) => {
  const user = await prisma.user.create({
    data: {
      ...req.body,
      passwordHash: await hashPassword(req.body.password),
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  res.status(201).json({ success: true, data: user });
});

usersRouter.patch("/:id", validateBody(updateUserSchema), async (req, res) => {
  const payload: Prisma.UserUpdateInput & { password?: string } = { ...req.body };
  if (typeof payload.password === "string") {
    payload.passwordHash = await hashPassword(payload.password);
    delete payload.password;
  }

  const user = await prisma.user.update({
    where: { id: String(req.params.id) },
    data: payload,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  res.json({ success: true, data: user });
});

usersRouter.delete("/:id", async (req, res) => {
  await prisma.user.delete({ where: { id: String(req.params.id) } });
  res.json({ success: true, data: null });
});
