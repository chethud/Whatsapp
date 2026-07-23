import { z } from "zod";

export const userRoleSchema = z.enum(["SUPER_ADMIN", "ADMIN", "AGENT"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const sessionStatusSchema = z.enum([
  "PENDING",
  "QR_READY",
  "CONNECTED",
  "DISCONNECTED",
  "AUTH_FAILURE",
  "LOGGED_OUT",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const messageDirectionSchema = z.enum(["INBOUND", "OUTBOUND"]);
export const chatTypeSchema = z.enum(["DIRECT", "GROUP"]);
export const notificationTypeSchema = z.enum(["INFO", "SUCCESS", "WARNING", "ERROR"]);
export const aiProviderSchema = z.enum(["OPENAI", "GEMINI", "COMPATIBLE"]);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(20),
  search: z.string().trim().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const createUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8),
  role: userRoleSchema,
});

export const updateUserSchema = createUserSchema.partial().omit({ password: true }).extend({
  password: z.string().min(8).optional(),
});

export const createWhatsappSessionSchema = z.object({
  name: z.string().min(2).max(120),
  autoReconnect: z.boolean().default(true),
});

export const sendMessageSchema = z.object({
  sessionId: z.string().uuid(),
  chatId: z.string().min(1),
  content: z.string().min(1).optional(),
  mediaUrl: z.string().url().optional(),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  quotedMessageId: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
  type: z.enum(["TEXT", "IMAGE", "PDF", "AUDIO", "VIDEO", "LOCATION", "CONTACT"]).default("TEXT"),
});

export const createContactSchema = z.object({
  name: z.string().min(1).max(160),
  phoneNumber: z.string().min(5).max(40),
  email: z.string().email().optional().nullable(),
  notes: z.string().optional().nullable(),
  tags: z.array(z.string().min(1)).default([]),
  labels: z.array(z.string().min(1)).default([]),
  customFields: z.record(z.string()).default({}),
  favorite: z.boolean().default(false),
  blocked: z.boolean().default(false),
  leadScore: z.number().int().min(0).max(100).default(0),
});

export const updateContactSchema = createContactSchema.partial();

export const generateAiReplySchema = z.object({
  sessionId: z.string().uuid(),
  chatId: z.string().min(1),
  prompt: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.4),
  maxTokens: z.number().int().positive().max(4000).default(600),
  provider: aiProviderSchema.default("OPENAI"),
});

export const createPromptTemplateSchema = z.object({
  name: z.string().min(2).max(120),
  content: z.string().min(1),
  description: z.string().optional().nullable(),
});

export const createKnowledgeDocumentSchema = z.object({
  title: z.string().min(2).max(160),
  content: z.string().min(1),
  category: z.string().min(1).max(80).default("general"),
});

export const updateSettingsSchema = z.object({
  timezone: z.string().min(2).max(80).optional(),
  businessName: z.string().min(2).max(120).optional(),
  aiAutoReplyEnabled: z.boolean().optional(),
  defaultAiProvider: aiProviderSchema.optional(),
  slackWebhookUrl: z.string().url().optional().nullable(),
});

export const wsEventNames = {
  sessionUpdate: "session:update",
  qrUpdate: "session:qr",
  messageCreated: "message:created",
  chatUpdated: "chat:updated",
  dashboardUpdated: "dashboard:updated",
  notificationCreated: "notification:created",
} as const;

export type PaginatedResponse<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type ApiSuccess<T> = {
  success: true;
  data: T;
  message?: string;
};

export type ApiError = {
  success: false;
  error: string;
  details?: unknown;
};

export const permissionMap = {
  SUPER_ADMIN: [
    "users.manage",
    "sessions.manage",
    "messages.manage",
    "contacts.manage",
    "ai.manage",
    "settings.manage",
    "logs.read",
  ],
  ADMIN: [
    "sessions.manage",
    "messages.manage",
    "contacts.manage",
    "ai.manage",
    "settings.manage",
    "logs.read",
  ],
  AGENT: ["messages.manage", "contacts.manage", "ai.manage"],
} as const satisfies Record<UserRole, string[]>;

export const navigationItems = [
  "Dashboard",
  "WhatsApp Sessions",
  "Chats",
  "Groups",
  "Broadcast",
  "Contacts",
  "Templates",
  "Campaigns",
  "Automation",
  "AI Assistant",
  "Knowledge Base",
  "Leads",
  "CRM",
  "Analytics",
  "Notifications",
  "Settings",
  "Users",
  "Logs",
  "Profile",
  "Dark Mode",
] as const;
