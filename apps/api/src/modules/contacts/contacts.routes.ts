import { Router } from "express";
import { createContactSchema, paginationQuerySchema, updateContactSchema } from "@whatsapp/shared";

import { prisma } from "../../config/prisma.js";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";

export const contactsRouter = Router();

contactsRouter.use(requireAuth, requirePermission("contacts.manage"));

contactsRouter.get("/", validateQuery(paginationQuerySchema), async (req, res) => {
  const { page, pageSize, search } = req.query as unknown as {
    page: number;
    pageSize: number;
    search?: string;
  };

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { phoneNumber: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      include: { tags: { include: { tag: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.contact.count({ where }),
  ]);

  res.json({
    success: true,
    data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  });
});

contactsRouter.post("/", validateBody(createContactSchema), async (req, res) => {
  const { tags, ...rest } = req.body;

  const contact = await prisma.contact.create({
    data: {
      ...rest,
      labels: req.body.labels ?? [],
      customFields: req.body.customFields ?? {},
      tags: {
        create: tags.map((name: string) => ({
          tag: {
            connectOrCreate: {
              where: { name },
              create: { name },
            },
          },
        })),
      },
    },
    include: { tags: { include: { tag: true } } },
  });

  res.status(201).json({ success: true, data: contact });
});

contactsRouter.patch("/:id", validateBody(updateContactSchema), async (req, res) => {
  const { tags, ...rest } = req.body as typeof req.body & { tags?: string[] };
  const contactId = String(req.params.id);
  if (tags) {
    await prisma.contactTagOnContact.deleteMany({ where: { contactId } });
  }

  const contact = await prisma.contact.update({
    where: { id: contactId },
    data: {
      ...rest,
      ...(tags
        ? {
            tags: {
              create: tags.map((name: string) => ({
                tag: {
                  connectOrCreate: {
                    where: { name },
                    create: { name },
                  },
                },
              })),
            },
          }
        : {}),
    },
    include: { tags: { include: { tag: true } } },
  });

  res.json({ success: true, data: contact });
});

contactsRouter.delete("/:id", async (req, res) => {
  await prisma.contact.delete({ where: { id: String(req.params.id) } });
  res.json({ success: true, data: null });
});
