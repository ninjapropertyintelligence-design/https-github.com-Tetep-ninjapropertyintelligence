/**
 * Bounding boxes for AI findings.
 *
 * STORED FORMAT (AIFinding.boundingBox): `{ x, y, w, h }`, each 0-1 as a
 * fraction of the image's width or height, with x/y the TOP-LEFT corner.
 * Fractions rather than pixels so an overlay lands on the same spot at any
 * display size; top-left because that is what CSS `left`/`top` take.
 *
 * Detectors do not agree on a format, so each one's output is converted here
 * once, on the way in, and nothing downstream ever sees pixel boxes.
 */

export interface NormalizedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A detector's box in pixels. Roboflow reports x/y as the box's CENTRE. */
export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Pixel box → stored box. `origin` says what the detector's x/y point at:
 * Roboflow and YOLO-style detectors give the centre, most others the
 * top-left corner. Parts of a box outside the image are clipped off; a box
 * entirely outside it, or with no area, is null.
 */
export function normalizePixelBox(
  box: PixelBox,
  imageWidth: number,
  imageHeight: number,
  origin: "center" | "top-left",
): NormalizedBox | null {
  if (!(imageWidth > 0 && imageHeight > 0)) return null;
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;
  if (box.width <= 0 || box.height <= 0) return null;

  const left = origin === "center" ? box.x - box.width / 2 : box.x;
  const top = origin === "center" ? box.y - box.height / 2 : box.y;

  const x0 = clamp01(left / imageWidth);
  const y0 = clamp01(top / imageHeight);
  const x1 = clamp01((left + box.width) / imageWidth);
  const y1 = clamp01((top + box.height) / imageHeight);
  if (x1 <= x0 || y1 <= y0) return null;

  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Reads a stored box back, trusting nothing: the column is JSON, so anything
 * malformed — a pixel box stored by mistake, a missing key, a box spilling
 * off the image — is refused or clipped here rather than drawn wrongly.
 */
export function parseStoredBox(value: unknown): NormalizedBox | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { x, y, w, h } = value as Record<string, unknown>;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [nx, ny, nw, nh] = [x, y, w, h] as number[];
  // Values above 1 mean pixels, not fractions. Guessing the image size to
  // rescale would draw a confident box in the wrong place, so refuse instead.
  if (nx < 0 || ny < 0 || nx > 1 || ny > 1 || nw <= 0 || nh <= 0 || nw > 1 || nh > 1) return null;
  const w2 = Math.min(nw, 1 - nx);
  const h2 = Math.min(nh, 1 - ny);
  if (w2 <= 0 || h2 <= 0) return null;
  return { x: nx, y: ny, w: w2, h: h2 };
}
