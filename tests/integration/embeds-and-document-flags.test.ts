import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { createEmbed, deleteEmbed, listEmbeds, setDocumentFlags } from "@/lib/embed-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * 3D embeds and document flags. What goes wrong without these rules: a fake
 * "Matterport" tour framed inside the app; a site's tours listed to someone
 * who cannot open the site; and anyone who can view a property deciding
 * which documents the field team is handed.
 */

const suffix = `em${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let site: { id: string };
let other: { id: string };
let owner: { id: string };
let manager: { id: string };

function ctx(userId: string, role: Role, extra: Partial<SessionContext> = {}): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Embed Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
    ...extra,
  };
}
const asOwner = () => ctx(owner.id, Role.OWNER);
const asManager = () =>
  ctx(manager.id, Role.FACILITIES_MANAGER, {
    grants: [{ scopeType: "PROPERTY", propertyId: site.id, portfolioId: null, regionId: null }],
  });

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `EM ${suffix}`, slug: `em-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
    });
  site = await mk("site");
  other = await mk("other");
  const user = (label: string) =>
    prisma.user.create({ data: { email: `${label}-${suffix}@example.com`, name: label, passwordHash: "x" } });
  owner = await user("owner");
  manager = await user("manager");
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
});

describe("3D embeds", () => {
  it("stores a tour and lists it to people who can open the site", async () => {
    const embed = await createEmbed(asOwner(), {
      propertyId: site.id,
      kind: "MATTERPORT",
      name: "VR Showcase",
      url: "https://my.matterport.com/show/?m=abc",
    });
    expect((await listEmbeds(asManager(), site.id)).map((e) => e.id)).toEqual([embed.id]);
    await expect(listEmbeds(asManager(), other.id)).rejects.toThrow(/Property not found/);
    await deleteEmbed(asOwner(), embed.id);
    expect(await listEmbeds(asOwner(), site.id)).toEqual([]);
  });

  it("refuses bad links and non-managers", async () => {
    await expect(
      createEmbed(asOwner(), { propertyId: site.id, kind: "MATTERPORT", name: "Fake", url: "https://matterport.example/show" }),
    ).rejects.toThrow(/my.matterport.com/);
    await expect(
      createEmbed(asManager(), { propertyId: site.id, kind: "POINT_CLOUD", name: "PC", url: "https://viewer.example.com" }),
    ).rejects.toThrow(/canManageProperties/);
  });
});

describe("document flags", () => {
  it("are set by property managers, inside their scope", async () => {
    const doc = await prisma.document.create({ data: { organizationId: org.id, propertyId: site.id, title: "Site survey" } });
    expect(doc).toMatchObject({ showInInfoTab: true, availableInCapture: true });

    const updated = await setDocumentFlags(asOwner(), doc.id, { availableInCapture: false });
    expect(updated).toMatchObject({ showInInfoTab: true, availableInCapture: false });
    await expect(setDocumentFlags(asManager(), doc.id, { showInInfoTab: false })).rejects.toThrow(/canManageProperties/);
  });
});
