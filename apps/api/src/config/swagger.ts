export const swaggerDocument = {
  openapi: "3.0.0",
  info: {
    title: "WhatsApp Core Platform API",
    version: "1.0.0",
    description: "REST API for the WhatsApp automation and AI chatbot platform.",
  },
  servers: [{ url: "/api/v1" }],
  tags: [
    { name: "Auth" },
    { name: "Users" },
    { name: "Sessions" },
    { name: "Chats" },
    { name: "Messages" },
    { name: "Contacts" },
    { name: "AI" },
    { name: "Dashboard" },
    { name: "Settings" },
    { name: "Logs" },
    { name: "Notifications" },
  ],
};
