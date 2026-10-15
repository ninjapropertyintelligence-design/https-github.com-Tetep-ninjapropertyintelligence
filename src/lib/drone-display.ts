/**
 * How a drone output is shown. Browsers can display a JPEG or PNG map, but
 * not a GeoTIFF — DroneDeploy's default export — so a GeoTIFF is offered for
 * download and its JPEG preview (made when it was uploaded) is what is shown.
 */

export function isBrowserImage(storageKey: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(storageKey);
}

export const OUTPUT_LABELS: Record<string, string> = {
  ORTHOMOSAIC: "Map (orthomosaic)",
  DSM: "Elevation (DSM)",
  DTM: "Terrain (DTM)",
  POINT_CLOUD: "Point cloud",
  MESH_3D: "3D model",
  PHOTO_SET: "Photo set",
};

/** The file name a person would recognise, from the stored key. */
export function displayFilename(storageKey: string): string {
  const last = storageKey.split("/").pop() ?? storageKey;
  // Keys are "<uuid>-<original name>"; the uuid means nothing to anyone.
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

export type FinishedOutputType = "ORTHOMOSAIC" | "DSM" | "DTM" | "POINT_CLOUD" | "MESH_3D";

/** What an exported file most likely is, from its name; the vendor can change it before upload. */
export function guessOutputType(filename: string): FinishedOutputType {
  const name = filename.toLowerCase();
  const ext = name.split(".").pop() ?? "";
  if (["las", "laz", "xyz", "ply"].includes(ext)) return "POINT_CLOUD";
  if (["obj", "glb", "gltf", "fbx"].includes(ext)) return "MESH_3D";
  // Whole-word-ish, so "demo-ortho.tif" is not taken for an elevation model.
  if (/(^|[^a-z])(dtm|terrain)([^a-z]|$)/.test(name)) return "DTM";
  if (/(^|[^a-z])(dsm|dem|elevation|elev)([^a-z]|$)/.test(name)) return "DSM";
  if (ext === "zip" && /model|mesh|obj|3d/.test(name)) return "MESH_3D";
  if (ext === "zip" && /cloud|las|point/.test(name)) return "POINT_CLOUD";
  return "ORTHOMOSAIC";
}

