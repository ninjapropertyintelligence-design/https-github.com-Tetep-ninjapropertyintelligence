import sharp from "sharp";

/**
 * Synthetic capture media for the demo organization.
 *
 * These are GENERATED, not photographs. Nothing here is a real site. What
 * they are is *structurally* real: decodable JPEGs at realistic dimensions,
 * a PLY with faces and vertex colours that PLYLoader parses, and an XYZ
 * point cloud in the `x y z r g b` form the viewer's parser reads. The
 * previous seed used a 1x1-pixel JPEG and a four-vertex tetrahedron, which
 * proved the upload and parsing paths end to end and looked like nothing.
 *
 * Everything is driven by a fixed seed, so re-running the seed produces
 * byte-identical files. That keeps the seed genuinely idempotent — a second
 * run is not a silent rewrite of storage.
 */

/** mulberry32 — small, fast, and identical across runs and machines. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RGB = [number, number, number];

/** A writable RGB raster with the handful of primitives these scenes need. */
class Raster {
  readonly data: Buffer;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = Buffer.alloc(width * height * 3);
  }

  set(x: number, y: number, [r, g, b]: RGB): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.data[i] = Math.max(0, Math.min(255, Math.round(r)));
    this.data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    this.data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }

  fill(color: RGB): void {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) this.set(x, y, color);
  }

  rect(x0: number, y0: number, w: number, h: number, color: RGB): void {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++) {
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) this.set(x, y, color);
    }
  }

  /** Axis-aligned outline, `t` pixels thick, drawn inside the given bounds. */
  outline(x0: number, y0: number, w: number, h: number, t: number, color: RGB): void {
    this.rect(x0, y0, w, t, color);
    this.rect(x0, y0 + h - t, w, t, color);
    this.rect(x0, y0, t, h, color);
    this.rect(x0 + w - t, y0, t, h, color);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: RGB, alpha = 1): void {
    for (let y = Math.round(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.round(cx - rx); x <= cx + rx; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        // Soften the rim so a stain reads as a stain rather than a sticker.
        const a = alpha * Math.min(1, (1 - d) * 3);
        this.blend(x, y, color, a);
      }
    }
  }

  blend(x: number, y: number, [r, g, b]: RGB, a: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || a <= 0) return;
    const i = (y * this.width + x) * 3;
    this.data[i] = Math.round(this.data[i] * (1 - a) + r * a);
    this.data[i + 1] = Math.round(this.data[i + 1] * (1 - a) + g * a);
    this.data[i + 2] = Math.round(this.data[i + 2] * (1 - a) + b * a);
  }

  /** Per-pixel luminance jitter. Flat fills are the main giveaway of a synthetic raster. */
  grain(random: () => number, amount: number): void {
    for (let i = 0; i < this.data.length; i += 3) {
      const n = (random() - 0.5) * amount;
      this.data[i] = Math.max(0, Math.min(255, this.data[i] + n));
      this.data[i + 1] = Math.max(0, Math.min(255, this.data[i + 1] + n));
      this.data[i + 2] = Math.max(0, Math.min(255, this.data[i + 2] + n));
    }
  }

  vignette(strength = 0.35): void {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const max = Math.hypot(cx, cy);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const d = Math.hypot(x - cx, y - cy) / max;
        this.blend(x, y, [0, 0, 0], d * d * strength);
      }
    }
  }

  toJpeg(quality = 82): Promise<Buffer> {
    return sharp(this.data, { raw: { width: this.width, height: this.height, channels: 3 } })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }
}

const ASPHALT: RGB = [86, 88, 92];
const MEMBRANE: RGB = [178, 180, 176];
const PARAPET: RGB = [138, 140, 137];
const RTU: RGB = [205, 203, 192];
const RUST: RGB = [134, 92, 58];
const PONDING: RGB = [120, 126, 128];
const STRIPE: RGB = [206, 204, 190];

/** Roof-mounted units, in roof-relative fractions, shared by the raster and the 3D geometry. */
const RTU_LAYOUT = [
  { fx: 0.18, fy: 0.24, fw: 0.1, fh: 0.13, label: "RTU-01" },
  { fx: 0.36, fy: 0.22, fw: 0.1, fh: 0.13, label: "RTU-02" },
  { fx: 0.54, fy: 0.25, fw: 0.1, fh: 0.13, label: "RTU-03" },
  { fx: 0.72, fy: 0.23, fw: 0.11, fh: 0.14, label: "RTU-04" },
  { fx: 0.42, fy: 0.62, fw: 0.09, fh: 0.12, label: "RTU-05" },
];

function drawParkingBays(r: Raster, x0: number, y0: number, w: number, h: number, bays: number): void {
  const step = w / bays;
  for (let i = 0; i <= bays; i++) r.rect(x0 + i * step, y0, 2, h, STRIPE);
}

/**
 * Top-down orthomosaic: the whole roof in one frame. This is the image the
 * Exterior tab uses as its marker canvas, so it has to be the widest view.
 */
export async function renderOrthomosaic(): Promise<Buffer> {
  const r = new Raster(1600, 1200);
  const random = rng(20260922);

  r.fill(ASPHALT);
  drawParkingBays(r, 60, 980, 1480, 150, 26);
  drawParkingBays(r, 60, 70, 1480, 120, 26);

  const bx = 180;
  const by = 240;
  const bw = 1240;
  const bh = 700;

  // Cast shadow first so the building reads as sitting above the lot.
  r.rect(bx + 16, by + 18, bw, bh, [62, 64, 68]);
  r.rect(bx, by, bw, bh, MEMBRANE);
  r.outline(bx, by, bw, bh, 14, PARAPET);

  // Membrane seams run the long axis of the roof.
  for (let y = by + 60; y < by + bh - 30; y += 74) {
    r.rect(bx + 16, y, bw - 32, 2, [166, 168, 165]);
  }

  for (const unit of RTU_LAYOUT) {
    const x = bx + unit.fx * bw;
    const y = by + unit.fy * bh;
    const w = unit.fw * bw;
    const h = unit.fh * bh;
    r.rect(x + 9, y + 11, w, h, [140, 141, 138]);
    r.rect(x, y, w, h, RTU);
    r.outline(x, y, w, h, 3, [172, 170, 160]);
    // Fan cowl.
    r.ellipse(x + w * 0.5, y + h * 0.42, w * 0.22, h * 0.3, [186, 184, 174], 0.95);
  }

  // Ponding on the low corner, and rust bleeding off RTU-04's curb — the
  // roof defects the seeded issues describe.
  r.ellipse(bx + bw * 0.78, by + bh * 0.68, 150, 86, PONDING, 0.7);
  r.ellipse(bx + bw * 0.74, by + bh * 0.66, 70, 44, [108, 116, 120], 0.55);
  const rtu4 = RTU_LAYOUT[3];
  r.ellipse(bx + (rtu4.fx + rtu4.fw * 0.5) * bw, by + (rtu4.fy + rtu4.fh) * bh + 26, 52, 22, RUST, 0.55);

  // Roof drains.
  for (const [fx, fy] of [
    [0.28, 0.82],
    [0.62, 0.84],
    [0.88, 0.5],
  ]) {
    r.ellipse(bx + fx * bw, by + fy * bh, 16, 16, [96, 98, 100], 0.9);
  }

  r.grain(random, 16);
  r.vignette(0.28);
  return r.toJpeg(84);
}

/** A closer oblique frame over one roof section — what a single pass returns. */
export async function renderRoofDetail(seed: number, withDefect: boolean): Promise<Buffer> {
  const r = new Raster(1024, 768);
  const random = rng(seed);

  r.fill(MEMBRANE);
  for (let y = 40; y < 768; y += 68) r.rect(0, y, 1024, 2, [164, 166, 163]);
  r.rect(0, 0, 1024, 46, PARAPET);
  r.rect(0, 700, 1024, 68, PARAPET);

  r.rect(300, 232, 250, 196, [142, 143, 140]);
  r.rect(288, 220, 250, 196, RTU);
  r.outline(288, 220, 250, 196, 5, [170, 168, 158]);
  r.ellipse(413, 300, 66, 52, [190, 188, 178], 0.95);
  r.rect(300, 372, 226, 10, [158, 156, 148]);

  if (withDefect) {
    r.ellipse(700, 520, 180, 110, PONDING, 0.68);
    r.ellipse(676, 508, 84, 52, [104, 112, 116], 0.5);
    r.ellipse(430, 452, 58, 26, RUST, 0.6);
  }

  r.grain(random, 18);
  r.vignette(0.22);
  return r.toJpeg(82);
}

/** Oblique exterior: sky, facade, storefront band, parking. */
export async function renderFacade(seed: number): Promise<Buffer> {
  const r = new Raster(1024, 768);
  const random = rng(seed);

  // Sky gradient.
  for (let y = 0; y < 300; y++) {
    const t = y / 300;
    const color: RGB = [150 + 60 * t, 180 + 50 * t, 214 + 30 * t];
    r.rect(0, y, 1024, 1, color);
  }

  r.rect(0, 300, 1024, 468, ASPHALT);
  drawParkingBays(r, 40, 600, 944, 150, 16);

  // Building mass, slightly off-square so it reads as an oblique view.
  r.rect(96, 250, 840, 46, PARAPET);
  r.rect(110, 296, 812, 224, [196, 184, 162]);
  // Storefront glazing.
  r.rect(150, 392, 732, 96, [58, 82, 104]);
  for (let x = 150; x < 882; x += 61) r.rect(x, 392, 3, 96, [120, 140, 158]);
  // Entrance.
  r.rect(470, 392, 96, 128, [42, 62, 82]);
  r.rect(470, 392, 96, 6, [176, 176, 170]);
  // Ground shadow.
  r.rect(110, 520, 812, 26, [70, 72, 76]);

  // RTUs peeking above the parapet.
  for (const [x, w] of [
    [220, 92],
    [430, 88],
    [660, 96],
  ]) {
    r.rect(x, 216, w, 36, RTU);
  }

  // A few parked vehicles.
  const carColors: RGB[] = [
    [150, 40, 40],
    [40, 60, 110],
    [190, 190, 195],
    [30, 30, 34],
  ];
  for (let i = 0; i < 4; i++) {
    const x = 120 + i * 210 + Math.floor(random() * 40);
    r.rect(x, 622, 96, 48, carColors[i]);
    r.rect(x + 14, 610, 66, 18, carColors[i]);
  }

  r.grain(random, 14);
  r.vignette(0.3);
  return r.toJpeg(82);
}

/** Close evidence frame of a single defect, for an Issue's photo record. */
export async function renderDefectEvidence(seed: number): Promise<Buffer> {
  const r = new Raster(1024, 768);
  const random = rng(seed);

  r.fill(MEMBRANE);
  for (let y = 60; y < 768; y += 96) r.rect(0, y, 1024, 3, [162, 164, 160]);

  // Equipment curb with corrosion running down onto the membrane.
  r.rect(240, 120, 540, 330, RTU);
  r.outline(240, 120, 540, 330, 8, [166, 164, 154]);
  r.rect(258, 450, 504, 34, [150, 148, 140]);
  r.ellipse(512, 540, 210, 96, RUST, 0.62);
  r.ellipse(470, 512, 96, 44, [104, 68, 40], 0.55);
  r.ellipse(560, 600, 130, 54, [118, 82, 52], 0.4);

  r.grain(random, 20);
  r.vignette(0.26);
  return r.toJpeg(82);
}

/* ------------------------------------------------------------------ */
/* 3D geometry                                                         */
/* ------------------------------------------------------------------ */

/** Metres. A mid-size big-box retail footprint. */
const BUILDING = { w: 62, d: 38, h: 7.5 };

interface Tri {
  a: number;
  b: number;
  c: number;
}

class MeshBuilder {
  vertices: Array<[number, number, number, number, number, number]> = [];
  faces: Tri[] = [];

  /** Adds an axis-aligned box and returns nothing — colours are per-vertex. */
  box(x: number, y: number, z: number, w: number, d: number, h: number, color: RGB): void {
    const base = this.vertices.length;
    const corners: Array<[number, number, number]> = [
      [x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z],
      [x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h],
    ];
    for (const [cx, cy, cz] of corners) this.vertices.push([cx, cy, cz, ...color]);
    const quads: Array<[number, number, number, number]> = [
      [0, 1, 2, 3], // bottom
      [4, 5, 6, 7], // top
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    for (const [a, b, c, d2] of quads) {
      this.faces.push({ a: base + a, b: base + b, c: base + c });
      this.faces.push({ a: base + a, b: base + c, c: base + d2 });
    }
  }

  toPly(): string {
    const header = [
      "ply",
      "format ascii 1.0",
      "comment Synthetic demo geometry - generated, not surveyed",
      `element vertex ${this.vertices.length}`,
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      `element face ${this.faces.length}`,
      "property list uchar int vertex_indices",
      "end_header",
    ];
    const verts = this.vertices.map(([x, y, z, r, g, b]) => `${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)} ${r} ${g} ${b}`);
    const faces = this.faces.map((f) => `3 ${f.a} ${f.b} ${f.c}`);
    return [...header, ...verts, ...faces, ""].join("\n");
  }
}

/** Building shell, parapet and roof units — the shape the point cloud samples. */
export function buildingMeshPly(): string {
  const m = new MeshBuilder();
  const { w, d, h } = BUILDING;

  // Ground pad, slightly larger than the building.
  m.box(-14, -12, -0.25, w + 28, d + 24, 0.25, [78, 80, 84]);
  // Main shell.
  m.box(0, 0, 0, w, d, h, [196, 184, 162]);
  // Parapet: a thin box ringing the roof edge, raised above the deck.
  const t = 0.7;
  m.box(0, 0, h, w, t, 1.1, PARAPET);
  m.box(0, d - t, h, w, t, 1.1, PARAPET);
  m.box(0, 0, h, t, d, 1.1, PARAPET);
  m.box(w - t, 0, h, t, d, 1.1, PARAPET);

  for (const unit of RTU_LAYOUT) {
    m.box(unit.fx * w, unit.fy * d, h, unit.fw * w, unit.fh * d, 1.8, RTU);
  }
  return m.toPly();
}

/**
 * Point cloud over the same site: ground, walls, roof deck and units, with
 * per-point colour and millimetre-scale jitter so it reads as a scan rather
 * than a lattice.
 */
export function sitePointCloudXyz(): string {
  const random = rng(77712026);
  const { w, d, h } = BUILDING;
  const lines: string[] = ["# Synthetic demo point cloud - generated, not surveyed", "# x y z r g b"];

  const push = (x: number, y: number, z: number, c: RGB, jitter = 0.03) => {
    const j = () => (random() - 0.5) * 2 * jitter;
    lines.push(
      `${(x + j()).toFixed(3)} ${(y + j()).toFixed(3)} ${(z + j()).toFixed(3)} ${c[0]} ${c[1]} ${c[2]}`,
    );
  };

  const shade = (c: RGB, amount: number): RGB => [
    Math.max(0, Math.min(255, Math.round(c[0] + amount))),
    Math.max(0, Math.min(255, Math.round(c[1] + amount))),
    Math.max(0, Math.min(255, Math.round(c[2] + amount))),
  ];

  // Ground.
  for (let i = 0; i < 6000; i++) {
    const x = -14 + random() * (w + 28);
    const y = -12 + random() * (d + 24);
    if (x > -0.5 && x < w + 0.5 && y > -0.5 && y < d + 0.5) continue; // under the building
    push(x, y, 0, shade(ASPHALT, (random() - 0.5) * 22), 0.05);
  }

  // Roof deck, with the ponding area sitting slightly lower and darker.
  for (let i = 0; i < 9000; i++) {
    const x = random() * w;
    const y = random() * d;
    const onUnit = RTU_LAYOUT.some(
      (u) => x >= u.fx * w && x <= (u.fx + u.fw) * w && y >= u.fy * d && y <= (u.fy + u.fh) * d,
    );
    if (onUnit) continue;
    const ponding = Math.hypot(x - 0.78 * w, y - 0.68 * d) < 6.5;
    push(x, y, h + (ponding ? -0.06 : 0), ponding ? PONDING : shade(MEMBRANE, (random() - 0.5) * 18), 0.02);
  }

  // Roof units.
  for (const unit of RTU_LAYOUT) {
    const ux = unit.fx * w;
    const uy = unit.fy * d;
    const uw = unit.fw * w;
    const ud = unit.fh * d;
    for (let i = 0; i < 900; i++) {
      const face = random();
      if (face < 0.45) {
        push(ux + random() * uw, uy + random() * ud, h + 1.8, shade(RTU, (random() - 0.5) * 14), 0.02);
      } else if (face < 0.72) {
        push(ux + random() * uw, random() < 0.5 ? uy : uy + ud, h + random() * 1.8, shade(RTU, -10), 0.02);
      } else {
        push(random() < 0.5 ? ux : ux + uw, uy + random() * ud, h + random() * 1.8, shade(RTU, -16), 0.02);
      }
    }
  }

  // Walls.
  for (let i = 0; i < 5000; i++) {
    const z = random() * h;
    const wall = Math.floor(random() * 4);
    const along = random();
    if (wall === 0) push(along * w, 0, z, shade([196, 184, 162], (random() - 0.5) * 16), 0.02);
    else if (wall === 1) push(along * w, d, z, shade([176, 166, 146], (random() - 0.5) * 16), 0.02);
    else if (wall === 2) push(0, along * d, z, shade([186, 175, 154], (random() - 0.5) * 16), 0.02);
    else push(w, along * d, z, shade([186, 175, 154], (random() - 0.5) * 16), 0.02);
  }

  // Parapet cap.
  for (let i = 0; i < 1800; i++) {
    const along = random();
    const side = Math.floor(random() * 4);
    if (side === 0) push(along * w, 0.35, h + 1.1, PARAPET, 0.02);
    else if (side === 1) push(along * w, d - 0.35, h + 1.1, PARAPET, 0.02);
    else if (side === 2) push(0.35, along * d, h + 1.1, PARAPET, 0.02);
    else push(w - 0.35, along * d, h + 1.1, PARAPET, 0.02);
  }

  return lines.join("\n") + "\n";
}
