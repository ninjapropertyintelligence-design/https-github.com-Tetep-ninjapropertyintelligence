import type { TemplateDefinition } from "@/lib/template-service";

/**
 * The equipment of a high-volume scratch restaurant kitchen, zone by zone in
 * the order an auditor walks it: back of house to the front, then the server
 * stations, dish and bar.
 *
 * Two things are built from it. Each item becomes an Asset on the property,
 * filed under an Area named for its zone, so an owner opening the property
 * sees every piece of kitchen equipment and where it stands. And the zones
 * become the sections of the "Restaurant Kitchen Audit" assessment template,
 * one task per item, so an inspection records a score against each one.
 *
 * An asset's `assetType` is the catalog item's `assetType`, which is how the
 * asset page finds the checkpoints to show for it. Change one and existing
 * assets of the old type stop showing their checkpoints.
 */

export type KitchenEquipment = {
  /** Stored as the asset's `assetType`; unique across the catalog. */
  assetType: string;
  function: string;
  /** What the auditor checks, and the standard each check is held to. */
  checkpoints: string[];
  /** 1 = Low … 5 = Business Critical, as on Asset.criticalityScore. */
  criticality: number;
};

export type KitchenZone = {
  /** Stored as the Area's name. */
  name: string;
  equipment: KitchenEquipment[];
};

/** The Area.areaType given to a kitchen zone, so they can be told from other areas. */
export const KITCHEN_ZONE_AREA_TYPE = "Kitchen zone";

export const KITCHEN_AUDIT_TEMPLATE_NAME = "Restaurant Kitchen Audit";

export const KITCHEN_ZONES: KitchenZone[] = [
  {
    name: "1. Back of Line: Receiving, Prep & Storage",
    equipment: [
      {
        assetType: "Walk-In Cooler & Freezer",
        function: "Cooling / Storing",
        checkpoints: [
          "Cooler at or below 41°F; freezer at or below 0°F",
          "Strip curtains intact; door gaskets tight",
          "Raw proteins (steaks, ribs, chicken, seafood) stored below ready-to-eat prep",
        ],
        criticality: 5,
      },
      {
        assetType: "Metro Shelving & Dunnage Racks",
        function: "Storing",
        checkpoints: [
          'At least 6" floor clearance',
          "FIFO date labels on all bulk scratch ingredients",
          "Dry goods sealed in Lexan/Cambro bins",
        ],
        criticality: 2,
      },
      {
        assetType: "Prep Tables & Cutting Boards",
        function: "Preparing",
        checkpoints: [
          "Color-coded boards free of deep grooves and stains",
          "Sanitizer buckets at correct ppm",
          "Undershelves clean",
        ],
        criticality: 3,
      },
      {
        assetType: "Slicers, Processors, Mixers & Dicers",
        function: "Preparing",
        checkpoints: [
          "Blade guards intact",
          "Unplugged when idle",
          "Food-contact parts disassembled and sanitized",
        ],
        criticality: 3,
      },
      {
        assetType: "Vegetable Prep Sink & Handwashing Sink",
        function: "Preparing",
        checkpoints: [
          "Air gap on produce sink drain",
          "Hand sink unobstructed, with soap and towels",
          "Hand sink water at 100°F or above",
        ],
        criticality: 4,
      },
      {
        assetType: "Ice Machine & Cooling Wands",
        function: "Cooling",
        checkpoints: [
          "Bin free of mold and slime",
          "Scoop stored outside the bin in a holder",
          "Cooling paddles clean for scratch sauces and soups",
        ],
        criticality: 4,
      },
      {
        assetType: "Receiving Scale & Probe Thermometers",
        function: "Receiving",
        checkpoints: [
          "Scale calibrated",
          "Probe thermometers calibrated (ice point 32°F)",
          "Deliveries temped and logged at the back door",
        ],
        criticality: 3,
      },
    ],
  },
  {
    name: "2. Hot Line: Broil/Grill & Sauté",
    equipment: [
      {
        assetType: "Charbroiler & Flat-Top Griddle",
        function: "Cooking / Serving",
        checkpoints: [
          "Grease troughs emptied",
          "Burners and pilots firing evenly",
          "Minimal carbon on grates and plates",
        ],
        criticality: 4,
      },
      {
        assetType: "Sauté Range, Convection Oven & Salamander",
        function: "Cooking / Serving",
        checkpoints: [
          "Burners clean for pasta, seafood and scratch sauces",
          "Oven door seals tight; thermostat calibrated",
          "Salamander/cheesemelter drip pans clean",
        ],
        criticality: 4,
      },
      {
        assetType: "Pasta Cooker / Rethermalizer",
        function: "Cooking",
        checkpoints: ["Water level and auto-fill working", "Baskets intact; starch skimmed", "Drain clear"],
        criticality: 3,
      },
      {
        assetType: "Refrigerated Chef Base",
        function: "Cooling / Storing",
        checkpoints: [
          "Product temp at or below 41°F",
          "Drawer tracks clean; gaskets intact",
          "Raw protein pans not overfilled",
        ],
        criticality: 4,
      },
      {
        assetType: "Steam Table / Hot-Holding Wells",
        function: "Holding",
        checkpoints: ["Sauces, soups and sides held at 135°F or above", "Water level correct", "Lids on"],
        criticality: 3,
      },
      {
        assetType: "Exhaust Hood, Baffle Filters & Ansul System",
        function: "Safety",
        checkpoints: [
          "Baffle filters free of heavy grease",
          "Ansul nozzle caps intact",
          "Fire suppression inspection tag current",
          "K-class extinguisher in place",
        ],
        criticality: 5,
      },
    ],
  },
  {
    name: "3. Hot Line: Fry & Appetizer",
    equipment: [
      {
        assetType: "Deep Fryer Battery",
        function: "Cooking / Serving",
        checkpoints: [
          "Oil clarity and TPM test within range",
          "High-limit safety switch working",
          "Filtration working",
        ],
        criticality: 4,
      },
      {
        assetType: "Fry Dump Station & Heat Lamps",
        function: "Cooking / Serving",
        checkpoints: [
          "Shatterproof bulb guards installed",
          "Holding temp at 135°F or above",
          "Seasoning shakers clean and dry",
        ],
        criticality: 3,
      },
      {
        assetType: "Reach-In Freezer / Low-Boy",
        function: "Cooling / Storing",
        checkpoints: [
          "Freezer at or below 0°F; cooler at or below 41°F",
          "Evaporator coils free of ice buildup",
          "Self-closing doors latch",
        ],
        criticality: 4,
      },
      {
        assetType: "Breading Station",
        function: "Preparing",
        checkpoints: [
          "Flour and batter bins covered",
          "Raw-protein breading kept apart from vegetables",
          "Sifted or replaced each shift",
        ],
        criticality: 2,
      },
    ],
  },
  {
    name: "4. Cold Line: Garde Manger / Pantry",
    equipment: [
      {
        assetType: "Sandwich/Salad Prep Rail (Mega-Top)",
        function: "Cooling / Preparing",
        checkpoints: [
          "Product temps at or below 41°F",
          "Rail lid closes cleanly",
          "Cold-air curtain unobstructed",
        ],
        criticality: 4,
      },
      {
        assetType: "Undercounter Reach-In Cooler",
        function: "Cooling / Storing",
        checkpoints: [
          "Air temp at or below 41°F",
          "Backup greens, cut produce and dressings labeled and dated",
          "Gaskets intact; doors self-close",
        ],
        criticality: 4,
      },
      {
        assetType: "Dessert Reach-In / Display Case",
        function: "Cooling / Storing",
        checkpoints: [
          "At or below 41°F",
          "Desserts covered, labeled and within shelf life",
          "Glass and shelves clean",
        ],
        criticality: 3,
      },
      {
        assetType: "Salad Spinner, Mandoline & Portioning Tools",
        function: "Preparing",
        checkpoints: [
          "Cut-resistant glove available",
          "Blades sharp and guarded",
          "Tools sanitized and stored dry",
        ],
        criticality: 2,
      },
      {
        assetType: "Portion Scales & Ladles",
        function: "Preparing",
        checkpoints: ["Scale zeroed and calibrated", "Portion tools match spec cards"],
        criticality: 2,
      },
    ],
  },
  {
    name: "5. Front of Line: Expo",
    equipment: [
      {
        assetType: "Heated Pass-Through & Heat Strips",
        function: "Holding / Serving",
        checkpoints: [
          "Heat strips working end to end",
          "Plates held at 135°F or above",
          "Bulbs guarded; shelf clean",
        ],
        criticality: 3,
      },
      {
        assetType: "Kitchen Display System / Ticket Printer",
        function: "Communication",
        checkpoints: [
          "Screens readable; bump bars responsive",
          "Printer paper stocked",
          "Ticket times within target",
        ],
        criticality: 4,
      },
      {
        assetType: "Plate Warmer / Plate Shelves",
        function: "Serving",
        checkpoints: ["Plates warm, clean and chip-free", "Enough stock for peak volume"],
        criticality: 2,
      },
      {
        assetType: "Garnish & Finishing Station",
        function: "Serving",
        checkpoints: [
          "Garnishes held at or below 41°F",
          "Squeeze bottles labeled and dated",
          "Wiping cloths kept in sanitizer",
        ],
        criticality: 2,
      },
      {
        assetType: "Allergen Protocol Station",
        function: "Safety",
        checkpoints: [
          "Allergen matrix posted",
          "Allergen tickets flagged",
          "Separate tools and purple boards available",
        ],
        criticality: 4,
      },
    ],
  },
  {
    name: "6. Server Stations, Dish Drop & Bar/Keg Room",
    equipment: [
      {
        assetType: "Server Station Reach-In & Ice Bin",
        function: "Cooling / Serving",
        checkpoints: [
          "Cooler at or below 41°F",
          "Ice scoop stored outside the bin",
          "Condiments, lemons and butter dated",
        ],
        criticality: 3,
      },
      {
        assetType: "Beverage Dispensers & Tea/Coffee Brewers",
        function: "Serving",
        checkpoints: [
          "Nozzles and diffusers cleaned daily",
          "Tea brew-dated and discarded on schedule",
          "Drip trays clean",
        ],
        criticality: 2,
      },
      {
        assetType: "Dish Drop & Scrap Station",
        function: "Cleaning",
        checkpoints: [
          "Soiled and clean sides kept apart",
          "Scrap trough and disposer working",
          "Racks stocked; floor mats clean and dry",
        ],
        criticality: 3,
      },
      {
        assetType: "Commercial Dish Machine",
        function: "Cleaning",
        checkpoints: [
          "High-temp: final rinse at 180°F or above; chemical: sanitizer at label ppm",
          "Wash arms clear; curtains in place",
          "Temp/ppm log current",
        ],
        criticality: 5,
      },
      {
        assetType: "3-Compartment Sink",
        function: "Cleaning",
        checkpoints: [
          "Wash, rinse and sanitize set up",
          "Sanitizer at correct ppm; test strips present",
          "Air-dry racks used",
        ],
        criticality: 4,
      },
      {
        assetType: "Bar Coolers, Glass Froster & Ice Wells",
        function: "Cooling",
        checkpoints: [
          "Coolers at or below 41°F",
          "Ice wells free of glass and debris",
          "Glass washer at proper temp/ppm",
        ],
        criticality: 3,
      },
      {
        assetType: "Walk-In Keg Room / Draft Cooler",
        function: "Cooling / Storing",
        checkpoints: [
          "Keg room held at draft temperature (typically 36–38°F)",
          "Kegs dated and rotated; floor drain clear",
          "CO2/blend cylinders chained upright; no gas leaks",
        ],
        criticality: 4,
      },
      {
        assetType: "Draft Lines, Couplers & Faucets",
        function: "Serving",
        checkpoints: [
          "Lines cleaned on schedule (commonly every 14 days), with a log",
          "Couplers and faucets free of buildup",
          "Foam and pour quality acceptable",
        ],
        criticality: 3,
      },
    ],
  },
];

const BY_ASSET_TYPE = new Map(
  KITCHEN_ZONES.flatMap((zone) => zone.equipment.map((item) => [item.assetType, { zone: zone.name, item }] as const)),
);

/** The catalog entry an asset was made from, by its `assetType`, if any. */
export function findKitchenEquipment(assetType: string): { zone: string; item: KitchenEquipment } | null {
  return BY_ASSET_TYPE.get(assetType) ?? null;
}

/** The audit score options, worst last, as the template's choice question offers them. */
export const KITCHEN_AUDIT_SCORES = [
  "1 — Pass",
  "2 — Needs Attention",
  "3 — Critical Fail",
] as const;

/**
 * The audit as an assessment template: a section per zone, a task per piece
 * of equipment, and in each task the columns of the paper checklist — the
 * score, the reading, the unit's ID, notes and a photo — with the checkpoints
 * as the task's description so the inspector sees what to check.
 */
export function kitchenAuditTemplateDefinition(): TemplateDefinition {
  return {
    name: KITCHEN_AUDIT_TEMPLATE_NAME,
    description:
      "Scratch kitchen equipment audit, walked back of house to front. Score each item 1 Pass, 2 Needs Attention, 3 Critical Fail (above 41°F cold, below 135°F hot, a safety hazard or an inoperable unit).",
    sections: [
      {
        name: "Audit details",
        questions: [
          { prompt: "Manager on duty", type: "TEXT", isRequired: true, options: [] },
        ],
        tasks: [],
      },
      ...KITCHEN_ZONES.map((zone) => ({
        name: zone.name,
        questions: [],
        tasks: zone.equipment.map((item) => ({
          name: item.assetType,
          description: `${item.function}. Check: ${item.checkpoints.join("; ")}.`,
          isRequired: true,
          isRepeatable: false,
          isCompletable: false,
          defaultTagValueIds: [],
          questions: [
            { prompt: "Score", type: "SELECT" as const, isRequired: true, options: [...KITCHEN_AUDIT_SCORES] },
            { prompt: "Temperature (°F) or sanitizer (ppm) reading", type: "NUMBER" as const, isRequired: false, options: [] },
            { prompt: "Qty / unit ID", type: "TEXT" as const, isRequired: false, options: [] },
            { prompt: "Action / notes", type: "TEXT" as const, isRequired: false, options: [] },
            { prompt: "Photo", type: "PHOTO" as const, isRequired: false, options: [] },
          ],
        })),
      })),
      {
        name: "Sign-off",
        questions: [
          { prompt: "Corrective actions agreed, with owner and due date", type: "TEXT", isRequired: false, options: [] },
          { prompt: "Kitchen manager signature", type: "SIGNATURE", isRequired: true, options: [] },
        ],
        tasks: [],
      },
    ],
  };
}
