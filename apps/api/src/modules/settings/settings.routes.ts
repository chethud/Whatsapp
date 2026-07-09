import { Router } from "express";
import { updateSettingsSchema } from "@whatsapp/shared";

import { prisma } from "../../config/prisma.js";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get("/", async (_req, res) => {
  const settings = await prisma.appSetting.findFirst();
  res.json({ success: true, data: settings });
});

settingsRouter.patch("/", requirePermission("settings.manage"), validateBody(updateSettingsSchema), async (req, res) => {
  const existing = await prisma.appSetting.findFirst();
  const settings = await prisma.appSetting.upsert({
    where: { id: existing?.id ?? "default-settings" },
    update: req.body,
    create: {
      id: existing?.id ?? "default-settings",
      ...req.body,
    },
  });

  res.json({ success: true, data: settings });
});
