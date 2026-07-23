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
    update: {
      businessName: "Alliance Square",
      defaultAiProvider: AiProvider.GEMINI,
      aiAutoReplyEnabled: true,
      timezone: "Asia/Kolkata",
    },
    create: {
      id: "default-settings",
      businessName: "Alliance Square",
      timezone: "Asia/Kolkata",
      defaultAiProvider: AiProvider.GEMINI,
      aiAutoReplyEnabled: true,
    },
  });

  const promptTemplates = [
    {
      name: "real-estate-assistant",
      description: "Alliance Square WhatsApp flow assistant.",
      content:
        "Follow revised Alliance Square flow: greeting → buy intent → investment vs home purpose → budget & dimensions → property suggestion by purpose → executive handover. Never share listing prices.",
    },
    {
      name: "lead-qualification",
      description: "Alliance Square purpose and budget qualification.",
      content:
        "Ask whether the property is for investment purposes or to build a home. Then ask budget and dimensions. After that suggest a matching layout and hand over to an executive.",
    },
    {
      name: "site-visit-booking",
      description: "Alliance Square executive handover.",
      content:
        "After suggesting a property, close with: share contact details with executive, they will reach out ASAP, thank the customer for Alliance Square.",
    },
  ];

  for (const template of promptTemplates) {
    await prisma.promptTemplate.upsert({
      where: { name: template.name },
      update: {
        description: template.description,
        content: template.content,
      },
      create: template,
    });
  }

  // Remove old demo listings that include prices.
  await prisma.knowledgeDocument.deleteMany({
    where: {
      title: {
        in: [
          "About Premier Realty",
          "2BHK Apartment - Andheri West",
          "3BHK Villa - Baner, Pune",
          "Commercial Office - BKC",
          "FAQ - Home Loans",
        ],
      },
    },
  });

  const knowledgeDocs = [
    {
      title: "About Alliance Square",
      category: "company",
      content:
        "Alliance Square is Mysuru's trusted real estate partner with 25+ years of experience, 50+ layouts, and 4000+ happy customers. Website: https://www.alliancesquare.com/. Phone: 0821-2541100. Corporate office: CH 16, Prashanth Plaza, Saraswathipuram, Mysuru. Sales office: 693, S&S Complex, Vishwamanava Double Road, Saraswathipuram, Mysuru. Never share prices on WhatsApp; sales experts share pricing on call or site visit.",
    },
    {
      title: "UK Square",
      category: "layout",
      content:
        "UK Square — premium gated plotted community at Mysuru–Kushalnagar Highway exit junction. Excellent connectivity and modern infrastructure. Good for living and investment. https://www.alliancesquare.com/layouts/uk-square Do not share price.",
    },
    {
      title: "CNM Apex City",
      category: "layout",
      content:
        "CNM Apex City — premium residential layout on Srirampura Ring Road, Mysuru. Strong connectivity and future growth; ideal for living and investment. https://www.alliancesquare.com/layouts/cnm-apex-city Do not share price.",
    },
    {
      title: "Sridevi Lake View",
      category: "layout",
      content:
        "Sridevi Lake View — DTCP-approved premium residential layout off T Narasipura Road, Mysuru, with major facilities nearby. https://www.alliancesquare.com/layouts/sridevi-lake-view Do not share price.",
    },
    {
      title: "Jeevan Vihar Phase 2",
      category: "layout",
      content:
        "Jeevan Vihar Phase 2 — premium residential layout right on Bannur–Kanakapura Highway, Mysuru. https://www.alliancesquare.com/layouts/jeevan-vihar-phase-2 Do not share price.",
    },
    {
      title: "Alliance Serene Phase 2",
      category: "layout",
      content:
        "Alliance Serene Phase 2 — premium residential layout off Bannur Road, Mysuru, about 2 mins from ring road. Near schools, hospitals, resorts and hotels — strong home-building option. https://www.alliancesquare.com/layouts/alliance-serene-phase-2 Do not share price.",
    },
    {
      title: "Adhya Enclave",
      category: "layout",
      content:
        "Adhya Enclave — MUDA-approved gated community in Nanjangud (~20 mins from Mysuru) on Chamalapura Main Road. Plots and row houses with modern amenities. https://www.alliancesquare.com/layouts/adhya-enclave Do not share price.",
    },
    {
      title: "Dr. Daya Nagar",
      category: "layout",
      content:
        "Dr. Daya Nagar — fully developed MUDA-approved layout off Bogadi Road, Mysuru. Good city-side home option. https://www.alliancesquare.com/layouts/dr.-daya-nagar Do not share price.",
    },
    {
      title: "Jeevan Vihar",
      category: "layout",
      content:
        "Jeevan Vihar — MUDA-approved layout with 30x40 and 30x50 sites, immediate registration options (off Hunsur Road / related Mysuru corridor). https://www.alliancesquare.com/layouts/jeevan-vihar Do not share price.",
    },
    {
      title: "Dhatri Square",
      category: "layout",
      content:
        "Dhatri Square — fully developed DTCP-approved layout off Hunsur Road, Mysuru. Value-friendly investment option. https://www.alliancesquare.com/layouts/dhatri-square Do not share price.",
    },
    {
      title: "Hasiru Apartments",
      category: "apartment",
      content:
        "Hasiru — apartment project listed by Alliance Square in Mysuru. https://www.alliancesquare.com/properties/hasiru/25 Connect sales expert for availability. Do not share price.",
    },
    {
      title: "Courtyard Apartments",
      category: "apartment",
      content:
        "Courtyard — apartment project listed by Alliance Square in Mysuru. https://www.alliancesquare.com/properties/courtyard/14 Connect sales expert for availability. Do not share price.",
    },
    {
      title: "FAQ - Pricing Policy",
      category: "faq",
      content:
        "Alliance Square does not disclose property prices on WhatsApp chat. Pricing is shared by authorized sales experts via phone callback or during a site visit. Direct customers to call 0821-2541100 or book an appointment.",
    },
  ];

  for (const doc of knowledgeDocs) {
    const existing = await prisma.knowledgeDocument.findFirst({ where: { title: doc.title } });
    if (existing) {
      await prisma.knowledgeDocument.update({
        where: { id: existing.id },
        data: { content: doc.content, category: doc.category },
      });
    } else {
      await prisma.knowledgeDocument.create({ data: doc });
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
