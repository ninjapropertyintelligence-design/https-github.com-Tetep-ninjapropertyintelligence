import { z } from "zod";

export const createPropertySchema = z.object({
  name: z.string().min(1).max(200),
  portfolioId: z.string().min(1),
  regionId: z.string().min(1).nullish(),
  customerPropertyId: z.string().max(100).nullish(),
  addressLine1: z.string().min(1).max(200),
  addressLine2: z.string().max(200).nullish(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(50),
  postalCode: z.string().min(1).max(20),
  country: z.string().max(56).default("US"),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  propertyType: z.string().max(100).default("Retail"),
  squareFootage: z.number().int().positive().nullish(),
  yearBuilt: z.number().int().min(1800).max(2100).nullish(),
});

export const updatePropertySchema = createPropertySchema.partial().extend({
  version: z.number().int().nonnegative(),
  status: z.enum(["ACTIVE", "INACTIVE", "UNDER_DEVELOPMENT", "DIVESTED"]).optional(),
});

export const createAssetSchema = z.object({
  propertyId: z.string().min(1),
  buildingId: z.string().nullish(),
  floorId: z.string().nullish(),
  areaId: z.string().nullish(),
  systemId: z.string().nullish(),
  name: z.string().min(1).max(200),
  assetType: z.string().min(1).max(100),
  customerAssetId: z.string().max(100).nullish(),
  manufacturer: z.string().max(100).nullish(),
  model: z.string().max(100).nullish(),
  serialNumber: z.string().max(100).nullish(),
  installedAt: z.coerce.date().nullish(),
  expectedUsefulLifeYears: z.number().int().positive().nullish(),
  criticalityScore: z.number().int().min(1).max(5).default(3),
  replacementCost: z.number().int().nonnegative().nullish(),
  conditionScore: z.number().min(0).max(100).nullish(),
});

export const updateAssetSchema = createAssetSchema.partial().extend({
  propertyId: z.string().min(1),
  version: z.number().int().nonnegative(),
  status: z.enum(["ACTIVE", "INACTIVE", "REPLACED", "DECOMMISSIONED"]).optional(),
});

export const assetConditionChangeSchema = z.object({
  newScore: z.number().min(0).max(100),
  reason: z.string().max(1000).optional(),
  evidenceId: z.string().optional(),
});

export const createIssueSchema = z.object({
  propertyId: z.string().min(1),
  buildingId: z.string().nullish(),
  areaId: z.string().nullish(),
  assetId: z.string().nullish(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullish(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  assigneeId: z.string().nullish(),
  vendorId: z.string().nullish(),
  estimatedCost: z.number().int().nonnegative().nullish(),
  dueDate: z.coerce.date().nullish(),
  source: z
    .enum(["MANUAL", "ASSESSMENT", "DRONE", "MATTERPORT", "AI_SUGGESTED", "IMPORT"])
    .default("MANUAL"),
});

export const updateIssueSchema = z.object({
  version: z.number().int().nonnegative(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullish(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  status: z
    .enum(["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "VERIFIED", "CLOSED"])
    .optional(),
  assigneeId: z.string().nullish(),
  vendorId: z.string().nullish(),
  estimatedCost: z.number().int().nonnegative().nullish(),
  actualCost: z.number().int().nonnegative().nullish(),
  dueDate: z.coerce.date().nullish(),
});
