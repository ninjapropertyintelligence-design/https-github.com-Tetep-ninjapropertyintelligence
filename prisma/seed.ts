import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { recalculatePropertyHealth } from "../src/lib/scoring";
import { DEFAULT_CATEGORY_WEIGHTS } from "../src/lib/scoring-categories";

// A tiny (43-byte) but fully valid 1x1 JPEG — real bytes on real disk, not a
// fake placeholder string, so verifyUpload()/checksum logic behaves exactly
// as it would for a genuine drone photo upload.
const MINIMAL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64",
);

/**
 * Seeds:
 *  - Platform-wide feature flags + subscription plans (real config, not demo)
 *  - One demo organization ("isDemoData" flagged on its properties) with a
 *    user per role, a portfolio/region structure, one deep pilot property
 *    (full assets/issues/assessment/documents/evidence/matterport/drone
 *    records) and several shallow properties, per spec §58.
 *
 * Safe to re-run: uses upserts / findFirst-guards throughout.
 */
async function main() {
  console.log("Seeding feature flags...");
  const flags: Array<{ key: string; description: string; defaultEnabled: boolean }> = [
    { key: "matterport", description: "Matterport interior capture integration", defaultEnabled: true },
    { key: "drone_processing", description: "Drone/photogrammetry capture + processing", defaultEnabled: true },
    { key: "point_cloud", description: "Point cloud / mesh 3D viewer", defaultEnabled: false },
    { key: "offline_mobile", description: "Offline-capable field app", defaultEnabled: false },
    { key: "owner_ai", description: "Executive/Owner AI ('Ask My Portfolio')", defaultEnabled: true },
    { key: "portfolio_ai", description: "Portfolio-wide AI across dashboards", defaultEnabled: true },
    { key: "computer_vision", description: "Automated AI defect detection (suggested-only)", defaultEnabled: false },
    { key: "enterprise_sso", description: "SSO for Enterprise plan orgs", defaultEnabled: false },
  ];
  for (const flag of flags) {
    await prisma.featureFlag.upsert({ where: { key: flag.key }, create: flag, update: { description: flag.description } });
  }

  console.log("Seeding scoring category weight defaults...");
  for (const [category, weightPercent] of Object.entries(DEFAULT_CATEGORY_WEIGHTS)) {
    // organizationId is nullable (null = platform default), so this uses
    // find-then-write rather than upsert against the compound unique key.
    const existing = await prisma.scoringCategoryWeight.findFirst({ where: { organizationId: null, category } });
    if (existing) {
      await prisma.scoringCategoryWeight.update({ where: { id: existing.id }, data: { weightPercent } });
    } else {
      await prisma.scoringCategoryWeight.create({ data: { organizationId: null, category, weightPercent } });
    }
  }

  console.log("Seeding subscription plans...");
  const plans: Array<{
    key: string;
    name: string;
    priceMonthlyCents: number | null;
    includedProperties: number;
    includedUsers: number;
    includedStorageGB: number;
    includedAIUsage: number;
    hasSSO: boolean;
    hasAPI: boolean;
    hasAdvancedReports: boolean;
    hasAdvancedAI: boolean;
  }> = [
    {
      key: "founding_partner",
      name: "Founding Partner",
      priceMonthlyCents: 200_000, // $2,000/mo — mid-point of the $1,500-$2,500 target band
      includedProperties: 25,
      includedUsers: 15,
      includedStorageGB: 500,
      includedAIUsage: 1000,
      hasSSO: false,
      hasAPI: true,
      hasAdvancedReports: true,
      hasAdvancedAI: true,
    },
    {
      key: "portfolio",
      name: "Portfolio",
      priceMonthlyCents: 250_000, // $2,500/mo
      includedProperties: 25,
      includedUsers: 10,
      includedStorageGB: 250,
      includedAIUsage: 500,
      hasSSO: false,
      hasAPI: false,
      hasAdvancedReports: true,
      hasAdvancedAI: true,
    },
    {
      key: "enterprise",
      name: "Enterprise",
      priceMonthlyCents: null, // custom annual contract
      includedProperties: 100,
      includedUsers: 100,
      includedStorageGB: 2000,
      includedAIUsage: 5000,
      hasSSO: true,
      hasAPI: true,
      hasAdvancedReports: true,
      hasAdvancedAI: true,
    },
  ];
  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({ where: { key: plan.key }, create: plan, update: plan });
  }

  console.log("Seeding demo organization...");
  const org = await prisma.organization.upsert({
    where: { slug: "demo-retail-group" },
    create: { name: "Demo Retail Group", slug: "demo-retail-group" },
    update: {},
  });

  await prisma.organizationSubscription.upsert({
    where: { organizationId: org.id },
    create: {
      organizationId: org.id,
      planId: (await prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: "founding_partner" } })).id,
      status: "active",
    },
    update: {},
  });

  await prisma.onboardingProgress.upsert({
    where: { organizationId: org.id },
    create: {
      organizationId: org.id,
      usersInvited: true,
      propertiesImported: true,
      assetsImported: true,
      interiorConnected: true,
      exteriorConnected: true,
      firstAssessmentDone: true,
      aiReady: true,
    },
    update: {},
  });

  const passwordHash = await bcrypt.hash("password123", 10);

  async function upsertUser(email: string, name: string, isPlatformAdmin = false) {
    return prisma.user.upsert({
      where: { email },
      create: { email, name, passwordHash, isPlatformAdmin },
      update: { name },
    });
  }

  console.log("Seeding users + memberships (one per role)...");
  const owner = await upsertUser("owner@demo.com", "Olivia Owens");
  const portfolioAdmin = await upsertUser("portfolioadmin@demo.com", "Priya Patel");
  const regionalManager = await upsertUser("regionalmanager@demo.com", "Marcus Reid");
  const facilitiesManager = await upsertUser("facilitiesmanager@demo.com", "Frank Nguyen");
  const inspector = await upsertUser("inspector@demo.com", "Ivy Chen");
  const technician = await upsertUser("technician@demo.com", "Tariq Osei");
  const vendorUser = await upsertUser("vendor@demo.com", "Vera Fields");
  const viewer = await upsertUser("viewer@demo.com", "Victor Lang");
  const platformAdmin = await upsertUser("platformadmin@demo.com", "Pat Admin", true);

  const vendor =
    (await prisma.vendor.findFirst({ where: { organizationId: org.id, name: "ABC Roofing" } })) ??
    (await prisma.vendor.create({
      data: { organizationId: org.id, name: "ABC Roofing", trade: "Roofing", contactEmail: "ops@abcroofing.example" },
    }));

  async function upsertMembership(userId: string, role: Parameters<typeof prisma.membership.create>[0]["data"]["role"], vendorId?: string) {
    return prisma.membership.upsert({
      where: { userId_organizationId: { userId, organizationId: org.id } },
      create: { userId, organizationId: org.id, role, vendorId },
      update: { role, vendorId },
    });
  }

  await upsertMembership(owner.id, "OWNER");
  await upsertMembership(portfolioAdmin.id, "PORTFOLIO_ADMIN");
  const regionalMembership = await upsertMembership(regionalManager.id, "REGIONAL_MANAGER");
  const facilitiesMembership = await upsertMembership(facilitiesManager.id, "FACILITIES_MANAGER");
  const inspectorMembership = await upsertMembership(inspector.id, "INSPECTOR");
  const technicianMembership = await upsertMembership(technician.id, "TECHNICIAN");
  const vendorMembership = await upsertMembership(vendorUser.id, "VENDOR", vendor.id);
  await upsertMembership(viewer.id, "VIEWER");

  console.log("Seeding portfolio structure...");
  const portfolio =
    (await prisma.portfolio.findFirst({ where: { organizationId: org.id, name: "National Retail Portfolio" } })) ??
    (await prisma.portfolio.create({ data: { organizationId: org.id, name: "National Retail Portfolio" } }));

  async function upsertRegion(name: string) {
    const existing = await prisma.region.findFirst({ where: { portfolioId: portfolio.id, name } });
    if (existing) return existing;
    return prisma.region.create({ data: { portfolioId: portfolio.id, name } });
  }
  const midwest = await upsertRegion("Midwest");
  const southwest = await upsertRegion("Southwest");
  const southeast = await upsertRegion("Southeast");

  // Scope grants: Regional Manager -> Midwest only; Facilities Manager,
  // Inspector, Technician, Vendor -> the deep pilot property specifically.
  async function ensureGrant(membershipId: string, data: { scopeType: "REGION" | "PROPERTY"; regionId?: string; propertyId?: string }) {
    const existing = await prisma.accessGrant.findFirst({ where: { membershipId, ...data } });
    if (!existing) await prisma.accessGrant.create({ data: { membershipId, ...data } });
  }
  await ensureGrant(regionalMembership.id, { scopeType: "REGION", regionId: midwest.id });

  console.log("Seeding buildings systems...");
  async function upsertSystem(name: string, category: string) {
    const existing = await prisma.buildingSystem.findFirst({ where: { name } });
    if (existing) return existing;
    return prisma.buildingSystem.create({ data: { name, category } });
  }
  const roofSys = await upsertSystem("Roof Membrane System", "Roof");
  const hvacSys = await upsertSystem("Rooftop HVAC System", "HVAC");
  const electricalSys = await upsertSystem("Main Electrical Distribution", "Electrical");
  const plumbingSys = await upsertSystem("Domestic Water System", "Plumbing");
  const fireSys = await upsertSystem("Fire Sprinkler & Alarm System", "FireLifeSafety");
  const interiorSys = await upsertSystem("Interior Finishes", "Interior");
  const exteriorSys = await upsertSystem("Parking & Exterior", "ExteriorParking");

  console.log("Seeding assessment template...");
  const templateExisting = await prisma.assessmentTemplate.findFirst({
    where: { organizationId: org.id, name: "Annual Property Assessment" },
  });
  const template =
    templateExisting ??
    (await prisma.assessmentTemplate.create({
      data: {
        organizationId: org.id,
        name: "Annual Property Assessment",
        description: "Standard annual exterior/interior condition assessment",
        sections: {
          create: [
            {
              name: "Exterior",
              position: 0,
              questions: {
                create: [
                  { prompt: "Roof condition", type: "CONDITION", position: 0, category: "Roof", isRequired: true },
                  { prompt: "Parking lot condition", type: "CONDITION", position: 1, category: "ExteriorParking" },
                  { prompt: "Exterior lighting functional?", type: "YES_NO", position: 2 },
                  { prompt: "Signage condition notes", type: "TEXT", position: 3 },
                  { prompt: "Drainage issues observed?", type: "YES_NO", position: 4 },
                  { prompt: "Exterior photo", type: "PHOTO", position: 5 },
                ],
              },
            },
            {
              name: "Interior",
              position: 1,
              questions: {
                create: [
                  { prompt: "HVAC system condition", type: "CONDITION", position: 0, category: "HVAC", isRequired: true },
                  { prompt: "Electrical panel condition", type: "CONDITION", position: 1, category: "Electrical" },
                  { prompt: "Plumbing condition", type: "CONDITION", position: 2, category: "Plumbing" },
                  { prompt: "Fire safety systems tagged/current?", type: "YES_NO", position: 3 },
                  { prompt: "Flooring condition", type: "CONDITION", position: 4, category: "Interior" },
                  { prompt: "Interior photo", type: "PHOTO", position: 5 },
                ],
              },
            },
          ],
        },
      },
    }));

  console.log("Seeding pilot (deep) property...");
  let pilot = await prisma.property.findFirst({ where: { organizationId: org.id, customerPropertyId: "STORE-1052" } });
  if (!pilot) {
    pilot = await prisma.property.create({
      data: {
        organizationId: org.id,
        portfolioId: portfolio.id,
        regionId: midwest.id,
        name: "Store #1052",
        customerPropertyId: "STORE-1052",
        addressLine1: "4821 W Chestnut Expy",
        city: "Kansas City",
        state: "MO",
        postalCode: "64105",
        latitude: 39.0997,
        longitude: -94.5786,
        propertyType: "Retail",
        squareFootage: 42000,
        yearBuilt: 1998,
        isDemoData: true,
      },
    });
  }

  await ensureGrant(facilitiesMembership.id, { scopeType: "PROPERTY", propertyId: pilot.id });
  await ensureGrant(inspectorMembership.id, { scopeType: "PROPERTY", propertyId: pilot.id });
  await ensureGrant(technicianMembership.id, { scopeType: "PROPERTY", propertyId: pilot.id });

  const building = await (async () => {
    const existing = await prisma.building.findFirst({ where: { propertyId: pilot!.id, name: "Main Building" } });
    return existing ?? prisma.building.create({ data: { propertyId: pilot!.id, name: "Main Building" } });
  })();

  async function upsertAsset(data: {
    name: string;
    assetType: string;
    systemId: string;
    criticalityScore: number;
    conditionScore: number;
    replacementCost: number;
    installedYearsAgo: number;
    usefulLife: number;
    customerAssetId: string;
  }) {
    const existing = await prisma.asset.findFirst({ where: { organizationId: org.id, customerAssetId: data.customerAssetId } });
    if (existing) return existing;
    return prisma.asset.create({
      data: {
        organizationId: org.id,
        propertyId: pilot!.id,
        buildingId: building.id,
        systemId: data.systemId,
        name: data.name,
        assetType: data.assetType,
        customerAssetId: data.customerAssetId,
        criticalityScore: data.criticalityScore,
        conditionScore: data.conditionScore,
        healthScore: data.conditionScore,
        replacementCost: data.replacementCost,
        expectedUsefulLifeYears: data.usefulLife,
        installedAt: new Date(Date.now() - data.installedYearsAgo * 365.25 * 86400000),
        validationStatus: "HUMAN_OBSERVED",
      },
    });
  }

  const rtu04 = await upsertAsset({
    name: "RTU-04",
    assetType: "Rooftop HVAC Unit",
    systemId: hvacSys.id,
    criticalityScore: 4,
    conditionScore: 42,
    replacementCost: 2_100_000,
    installedYearsAgo: 17,
    usefulLife: 15,
    customerAssetId: "STORE-1052-RTU-04",
  });
  await upsertAsset({
    name: "Main Roof — East Wing",
    assetType: "Membrane Roof",
    systemId: roofSys.id,
    criticalityScore: 5,
    conditionScore: 31,
    replacementCost: 7_400_000,
    installedYearsAgo: 22,
    usefulLife: 20,
    customerAssetId: "STORE-1052-ROOF-E",
  });
  await upsertAsset({
    name: "Main Electrical Panel",
    assetType: "400A Distribution Panel",
    systemId: electricalSys.id,
    criticalityScore: 5,
    conditionScore: 58,
    replacementCost: 1_800_000,
    installedYearsAgo: 12,
    usefulLife: 25,
    customerAssetId: "STORE-1052-ELEC-01",
  });
  await upsertAsset({
    name: "Domestic Water Heater",
    assetType: "Water Heater",
    systemId: plumbingSys.id,
    criticalityScore: 2,
    conditionScore: 74,
    replacementCost: 350_000,
    installedYearsAgo: 6,
    usefulLife: 12,
    customerAssetId: "STORE-1052-PLMB-01",
  });
  await upsertAsset({
    name: "Fire Sprinkler System",
    assetType: "Wet Pipe Sprinkler System",
    systemId: fireSys.id,
    criticalityScore: 5,
    conditionScore: 88,
    replacementCost: 900_000,
    installedYearsAgo: 4,
    usefulLife: 30,
    customerAssetId: "STORE-1052-FIRE-01",
  });
  await upsertAsset({
    name: "Sales Floor Flooring",
    assetType: "Polished Concrete Flooring",
    systemId: interiorSys.id,
    criticalityScore: 1,
    conditionScore: 81,
    replacementCost: 600_000,
    installedYearsAgo: 5,
    usefulLife: 20,
    customerAssetId: "STORE-1052-FLR-01",
  });
  await upsertAsset({
    name: "Front Parking Lot",
    assetType: "Asphalt Parking Lot",
    systemId: exteriorSys.id,
    criticalityScore: 2,
    conditionScore: 55,
    replacementCost: 2_800_000,
    installedYearsAgo: 9,
    usefulLife: 18,
    customerAssetId: "STORE-1052-PARK-01",
  });

  console.log("Seeding issues on pilot property...");
  const issueExisting = await prisma.issue.findFirst({ where: { organizationId: org.id, title: "RTU-04 compressor vibration" } });
  if (!issueExisting) {
    await prisma.issue.create({
      data: {
        organizationId: org.id,
        propertyId: pilot.id,
        assetId: rtu04.id,
        title: "RTU-04 compressor vibration",
        description: "Technician reported abnormal compressor vibration and intermittent short-cycling during routine check.",
        severity: "HIGH",
        status: "ASSIGNED",
        source: "MANUAL",
        assigneeId: technician.id,
        estimatedCost: 210_000,
        createdById: technician.id,
      },
    });
  }
  const roofIssueExisting = await prisma.issue.findFirst({ where: { organizationId: org.id, title: "East wing roof membrane failure" } });
  if (!roofIssueExisting) {
    await prisma.issue.create({
      data: {
        organizationId: org.id,
        propertyId: pilot.id,
        title: "East wing roof membrane failure",
        description: "Active leak observed near east wing HVAC curb during storm; water intrusion into ceiling tile.",
        severity: "CRITICAL",
        status: "TRIAGED",
        source: "ASSESSMENT",
        vendorId: vendor.id,
        estimatedCost: 740_000,
        createdById: facilitiesManager.id,
      },
    });
  }

  console.log("Seeding a completed assessment for the pilot property...");
  const assessmentExisting = await prisma.assessment.findFirst({ where: { organizationId: org.id, propertyId: pilot.id } });
  if (!assessmentExisting) {
    await prisma.assessment.create({
      data: {
        organizationId: org.id,
        propertyId: pilot.id,
        templateId: template.id,
        inspectorId: inspector.id,
        status: "COMPLETED",
        startedAt: new Date(Date.now() - 20 * 86400000),
        completedAt: new Date(Date.now() - 19 * 86400000),
      },
    });
  }

  console.log("Recalculating pilot property health snapshot...");
  await recalculatePropertyHealth(pilot.id);

  console.log("Seeding a real drone exterior capture for the pilot property...");
  const existingCapture = await prisma.droneCapture.findFirst({ where: { propertyId: pilot.id } });
  if (!existingCapture) {
    const capture = await prisma.droneCapture.create({
      data: {
        propertyId: pilot.id,
        capturedAt: new Date(Date.now() - 14 * 86400000),
        capturedById: technician.id,
        droneModel: "DJI Mavic 3 Enterprise",
        status: "READY",
        notes: "Seeded demo exterior capture — roof + facade photo set.",
      },
    });
    const dataset = await prisma.droneDataset.create({
      data: { captureId: capture.id, provider: "MANUAL_UPLOAD" },
    });

    const localStorageRoot = path.join(process.cwd(), ".local-storage");
    const checksum = crypto.createHash("sha256").update(MINIMAL_JPEG).digest("hex");
    const photoSpecs = [
      { label: "roof-east-wing-01.jpg", lat: 39.0999, lng: -94.5784 },
      { label: "facade-front-01.jpg", lat: 39.0995, lng: -94.5788 },
    ];
    for (const spec of photoSpecs) {
      const key = `${org.id}/${crypto.randomUUID()}-${spec.label}`;
      const filePath = path.join(localStorageRoot, key);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, MINIMAL_JPEG);
      await prisma.droneImage.create({
        data: {
          datasetId: dataset.id,
          storageKey: key,
          mimeType: "image/jpeg",
          sizeBytes: MINIMAL_JPEG.byteLength,
          checksum,
          latitude: spec.lat,
          longitude: spec.lng,
          capturedAt: capture.capturedAt,
        },
      });
    }
    console.log(`  Wrote ${photoSpecs.length} real JPEG file(s) under .local-storage/${org.id}/`);
  }

  console.log("Seeding shallow properties (5)...");
  const shallow: Array<{
    name: string;
    customerPropertyId: string;
    city: string;
    state: string;
    lat: number;
    lng: number;
    regionId: string;
    healthApprox: number;
  }> = [
    { name: "Store #182", customerPropertyId: "STORE-0182", city: "Phoenix", state: "AZ", lat: 33.4484, lng: -112.074, regionId: southwest.id, healthApprox: 42 },
    { name: "Store #291", customerPropertyId: "STORE-0291", city: "Austin", state: "TX", lat: 30.2672, lng: -97.7431, regionId: southwest.id, healthApprox: 61 },
    { name: "Store #918", customerPropertyId: "STORE-0918", city: "Atlanta", state: "GA", lat: 33.749, lng: -84.388, regionId: southeast.id, healthApprox: 79 },
    { name: "Store #742", customerPropertyId: "STORE-0742", city: "St. Louis", state: "MO", lat: 38.627, lng: -90.1994, regionId: midwest.id, healthApprox: 88 },
    { name: "Store #603", customerPropertyId: "STORE-0603", city: "Orlando", state: "FL", lat: 28.5383, lng: -81.3792, regionId: southeast.id, healthApprox: 95 },
  ];

  for (const s of shallow) {
    let prop = await prisma.property.findFirst({ where: { organizationId: org.id, customerPropertyId: s.customerPropertyId } });
    if (!prop) {
      prop = await prisma.property.create({
        data: {
          organizationId: org.id,
          portfolioId: portfolio.id,
          regionId: s.regionId,
          name: s.name,
          customerPropertyId: s.customerPropertyId,
          addressLine1: "100 Commerce Way",
          city: s.city,
          state: s.state,
          postalCode: "00000",
          latitude: s.lat,
          longitude: s.lng,
          propertyType: "Retail",
          squareFootage: 35000,
          yearBuilt: 2005,
          isDemoData: true,
        },
      });
    }
    const existingAsset = await prisma.asset.findFirst({ where: { organizationId: org.id, propertyId: prop.id } });
    if (!existingAsset) {
      await prisma.asset.create({
        data: {
          organizationId: org.id,
          propertyId: prop.id,
          systemId: hvacSys.id,
          name: "Primary RTU",
          assetType: "Rooftop HVAC Unit",
          criticalityScore: 4,
          conditionScore: s.healthApprox,
          healthScore: s.healthApprox,
          replacementCost: 2_000_000,
          expectedUsefulLifeYears: 15,
          installedAt: new Date(Date.now() - 8 * 365.25 * 86400000),
          validationStatus: "AUTO_CALCULATED",
        },
      });
    }
    await recalculatePropertyHealth(prop.id);
  }

  console.log("Seeding vendor membership scope + assignment...");
  await ensureGrant(vendorMembership.id, { scopeType: "PROPERTY", propertyId: pilot.id });

  console.log("\nSeed complete. Demo login credentials (password: 'password123'):");
  console.log("  Owner:              owner@demo.com");
  console.log("  Portfolio Admin:    portfolioadmin@demo.com");
  console.log("  Regional Manager:   regionalmanager@demo.com  (Midwest region only)");
  console.log("  Facilities Manager: facilitiesmanager@demo.com (Store #1052 only)");
  console.log("  Inspector:          inspector@demo.com (Store #1052 only)");
  console.log("  Technician:         technician@demo.com (Store #1052 only)");
  console.log("  Vendor:             vendor@demo.com (ABC Roofing, Store #1052 only)");
  console.log("  Viewer:             viewer@demo.com (read-only, org-wide)");
  console.log("  Platform Admin:     platformadmin@demo.com (no org membership needed)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
