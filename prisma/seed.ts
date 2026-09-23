import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { recalculatePropertyHealth } from "../src/lib/scoring";
import { DEFAULT_CATEGORY_WEIGHTS } from "../src/lib/scoring-categories";
import { getStorageProvider } from "../src/lib/storage";
import {
  renderOrthomosaic,
  renderRoofDetail,
  renderFacade,
  renderDefectEvidence,
  renderPanorama360,
  buildingMeshPly,
  sitePointCloudXyz,
} from "./seed-media";

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
    { key: "image_360", description: "360° panorama capture (handheld/tripod 360 cameras)", defaultEnabled: true },
    { key: "point_cloud", description: "Point cloud / mesh 3D viewer", defaultEnabled: true },
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
  // Seeded capture files go through the configured StorageProvider, not
  // straight to disk. Writing with fs here worked locally by accident —
  // the seed and the app shared a filesystem — but when the seed runs from
  // a build container (STORAGE_PROVIDER=s3) those bytes land on a disk that
  // is discarded, leaving DroneImage/DroneOutput rows whose files 404. All
  // three files below are tiny, which is what makes writeBytes appropriate;
  // real capture uploads still use signed direct upload (spec §36).
  const storage = getStorageProvider();
  let capture = await prisma.droneCapture.findFirst({ where: { propertyId: pilot.id } });
  if (!capture) {
    capture = await prisma.droneCapture.create({
      data: {
        propertyId: pilot.id,
        capturedAt: new Date(Date.now() - 14 * 86400000),
        capturedById: technician.id,
        droneModel: "DJI Mavic 3 Enterprise",
        status: "READY",
        notes: "Seeded demo exterior capture — roof + facade photo set.",
      },
    });
  }
  let dataset = await prisma.droneDataset.findFirst({ where: { captureId: capture.id } });
  if (!dataset) {
    dataset = await prisma.droneDataset.create({
      data: { captureId: capture.id, provider: "MANUAL_UPLOAD" },
    });
  }

  const existingImageCount = await prisma.droneImage.count({ where: { datasetId: dataset.id } });
  if (existingImageCount === 0) {
    // Six frames with real content at realistic dimensions, spread around
    // the building so the Site Map has a genuine scatter rather than two
    // coincident pins. Coordinates are offsets from the pilot property, at
    // roughly the spacing of a real flight grid.
    const photoSpecs: Array<{ label: string; lat: number; lng: number; render: () => Promise<Buffer> }> = [
      { label: "roof-east-wing-01.jpg", lat: 39.09985, lng: -94.57835, render: () => renderRoofDetail(101, false) },
      { label: "roof-east-wing-02.jpg", lat: 39.09978, lng: -94.57848, render: () => renderRoofDetail(202, true) },
      { label: "roof-west-wing-01.jpg", lat: 39.09992, lng: -94.57882, render: () => renderRoofDetail(303, false) },
      { label: "roof-centre-01.jpg", lat: 39.09970, lng: -94.57866, render: () => renderRoofDetail(404, true) },
      { label: "facade-front-01.jpg", lat: 39.09948, lng: -94.57872, render: () => renderFacade(505) },
      { label: "facade-north-01.jpg", lat: 39.10002, lng: -94.57861, render: () => renderFacade(606) },
    ];
    for (const spec of photoSpecs) {
      const bytes = await spec.render();
      const key = `${org.id}/${crypto.randomUUID()}-${spec.label}`;
      await storage.writeBytes(key, bytes);
      await prisma.droneImage.create({
        data: {
          datasetId: dataset.id,
          storageKey: key,
          mimeType: "image/jpeg",
          sizeBytes: bytes.byteLength,
          checksum: crypto.createHash("sha256").update(bytes).digest("hex"),
          latitude: spec.lat,
          longitude: spec.lng,
          capturedAt: capture.capturedAt,
        },
      });
    }
    console.log(`  Wrote ${photoSpecs.length} generated JPEG(s) via ${storage.constructor.name} under ${org.id}/`);
  }

  /**
   * Outputs are written through one helper because the three differ only in
   * type, extension and payload. Each is generated, not surveyed — see
   * prisma/seed-media.ts.
   */
  async function upsertOutput(
    outputType: "ORTHOMOSAIC" | "MESH_3D" | "POINT_CLOUD",
    filename: string,
    mimeType: string,
    produce: () => Promise<Buffer> | Buffer,
    metadata: Record<string, unknown>,
  ) {
    const existing = await prisma.droneOutput.findFirst({ where: { datasetId: dataset!.id, outputType } });
    if (existing) return;
    const bytes = await produce();
    const key = `${org.id}/${crypto.randomUUID()}-${filename}`;
    await storage.writeBytes(key, bytes);
    await prisma.droneOutput.create({
      data: {
        datasetId: dataset!.id,
        outputType,
        storageKey: key,
        mimeType,
        sizeBytes: bytes.byteLength,
        checksum: crypto.createHash("sha256").update(bytes).digest("hex"),
        metadata: { source: "seed", synthetic: true, ...metadata },
      },
    });
    console.log(`  Wrote ${outputType} (${(bytes.byteLength / 1024).toFixed(0)} KB) via ${storage.constructor.name}`);
  }

  // The orthomosaic is the Exterior tab's marker canvas — without one, that
  // tab renders its "add a marker" control over the first raw photo, which
  // is why the capture card looked empty.
  await upsertOutput("ORTHOMOSAIC", "roof-orthomosaic.jpg", "image/jpeg", renderOrthomosaic, {
    format: "jpeg",
    widthPx: 1600,
    heightPx: 1200,
  });

  await upsertOutput(
    "MESH_3D",
    "site-mesh.ply",
    "application/octet-stream",
    () => Buffer.from(buildingMeshPly(), "utf-8"),
    { format: "ply", hasVertexColors: true },
  );

  await upsertOutput(
    "POINT_CLOUD",
    "site-point-cloud.xyz",
    "text/plain",
    () => Buffer.from(sitePointCloudXyz(), "utf-8"),
    { format: "xyz", hasVertexColors: true },
  );

  // Geotagged evidence attached to the two seeded issues. Evidence is the
  // only other model in the schema carrying coordinates, so this is what
  // makes the Site Map's second placeable layer real rather than an empty
  // toggle.
  const existingEvidence = await prisma.evidence.count({ where: { propertyId: pilot.id } });
  if (existingEvidence === 0) {
    const rtuIssue = await prisma.issue.findFirst({ where: { organizationId: org.id, title: "RTU-04 compressor vibration" } });
    const roofIssue = await prisma.issue.findFirst({ where: { organizationId: org.id, title: "East wing roof membrane failure" } });
    const evidenceSpecs = [
      { issueId: rtuIssue?.id, label: "rtu-04-corrosion.jpg", lat: 39.09981, lng: -94.57852, seed: 711 },
      { issueId: roofIssue?.id, label: "east-wing-ponding.jpg", lat: 39.09976, lng: -94.57841, seed: 822 },
    ];
    for (const spec of evidenceSpecs) {
      const bytes = await renderDefectEvidence(spec.seed);
      const key = `${org.id}/${crypto.randomUUID()}-${spec.label}`;
      await storage.writeBytes(key, bytes);
      await prisma.evidence.create({
        data: {
          organizationId: org.id,
          propertyId: pilot.id,
          issueId: spec.issueId ?? null,
          type: "PHOTO",
          source: "MANUAL",
          captureDate: capture.capturedAt,
          uploadedById: technician.id,
          latitude: spec.lat,
          longitude: spec.lng,
          storageKey: key,
          mimeType: "image/jpeg",
          sizeBytes: bytes.byteLength,
          metadata: { source: "seed", synthetic: true },
        },
      });
    }
    console.log(`  Wrote ${evidenceSpecs.length} geotagged evidence photo(s)`);
  }

  // 360 panoramas — the third capture kind, alongside Matterport interiors
  // and drone exteriors. Seeded as geotagged IMAGE_360 evidence, which is
  // what the 360 tab reads and what puts a real pin on the Site Map's 360
  // layer rather than an empty toggle.
  const existingPanoramas = await prisma.evidence.count({ where: { propertyId: pilot.id, type: "IMAGE_360" } });
  if (existingPanoramas === 0) {
    const panoramaSpecs = [
      { label: "north-lot-360.jpg", lat: 39.09992, lng: -94.57869, seed: 4101 },
      { label: "south-entrance-360.jpg", lat: 39.09963, lng: -94.57833, seed: 4207 },
    ];
    for (const spec of panoramaSpecs) {
      const bytes = await renderPanorama360(spec.seed);
      const key = `${org.id}/${crypto.randomUUID()}-${spec.label}`;
      await storage.writeBytes(key, bytes);
      await prisma.evidence.create({
        data: {
          organizationId: org.id,
          propertyId: pilot.id,
          type: "IMAGE_360",
          source: "MANUAL",
          captureDate: capture.capturedAt,
          uploadedById: technician.id,
          latitude: spec.lat,
          longitude: spec.lng,
          storageKey: key,
          mimeType: "image/jpeg",
          sizeBytes: bytes.byteLength,
          // projection is recorded because a 2:1 JPEG is not self-describing:
          // nothing in the file says whether it is equirectangular, and the
          // viewer would happily wrap a flat photo onto a sphere.
          metadata: { source: "seed", synthetic: true, projection: "equirectangular" },
        },
      });
    }
    console.log(`  Wrote ${panoramaSpecs.length} geotagged 360 panorama(s)`);
  }

  // A completed processing job for the dataset above. Without one, the
  // queue-recovery check in scripts/dr-verify.ts has nothing to restore and
  // reports INCONCLUSIVE rather than passing vacuously.
  const existingJob = await prisma.droneProcessingJob.findFirst({ where: { datasetId: dataset.id } });
  if (!existingJob) {
    await prisma.droneProcessingJob.create({
      data: {
        datasetId: dataset.id,
        status: "READY",
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 90 * 60 * 1000),
      },
    });
    console.log("  Created 1 completed drone processing job");
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

  // An open capture job, so the Capture Jobs page shows the real shape of
  // subcontractor work rather than an empty state. Issued, because a draft is
  // invisible to the vendor and would make the demo look broken when signed
  // in as vendor@demo.com.
  const existingCaptureJob = await prisma.captureJob.findFirst({ where: { organizationId: org.id } });
  if (!existingCaptureJob) {
    const job = await prisma.captureJob.create({
      data: {
        organizationId: org.id,
        vendorId: vendor.id,
        title: "Q4 condition sweep — Midwest",
        instructions:
          "Fly the roof and parking areas, shoot a 360 at each entrance, and score every rooftop unit. " +
          "Condition scores are the deliverable: imagery alone does not move the site's health score.",
        status: "ISSUED",
        issuedAt: new Date(),
        dueDate: new Date(Date.now() + 21 * 86400000),
        createdById: owner.id,
        sites: {
          create: [
            { propertyId: pilot.id, deliverables: ["DRONE", "IMAGE_360", "CONDITION_SCORES"] },
          ],
        },
      },
    });
    console.log(`  Created capture job "${job.title}" (1 site, issued to ${vendor.name})`);
  }

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
