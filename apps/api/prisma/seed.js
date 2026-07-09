import { PrismaClient, UserRole, AiProvider } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();
async function main() {
    const passwordHash = await bcrypt.hash("ChangeMe123!", 12);
    await prisma.user.upsert({
        where: { email: "admin@example.com" },
        update: {},
        create: {
            name: "Super Admin",
            email: "admin@example.com",
            passwordHash,
            role: UserRole.SUPER_ADMIN,
        },
    });
    await prisma.appSetting.upsert({
        where: { id: "default-settings" },
        update: {},
        create: {
            id: "default-settings",
            businessName: "WhatsApp Core Platform",
            timezone: "UTC",
            defaultAiProvider: AiProvider.OPENAI,
        },
    });
    await prisma.promptTemplate.createMany({
        data: [
            {
                name: "default-sales",
                description: "Sales-oriented prompt for conversational assistance.",
                content: "You are a helpful business assistant. Answer clearly, qualify leads, and suggest escalation when confidence is low.",
            },
            {
                name: "faq-mode",
                description: "FAQ assistant mode.",
                content: "Answer using the knowledge base first. If the answer is uncertain, ask clarifying questions.",
            },
        ],
        skipDuplicates: true,
    });
}
main()
    .catch((error) => {
    console.error(error);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
