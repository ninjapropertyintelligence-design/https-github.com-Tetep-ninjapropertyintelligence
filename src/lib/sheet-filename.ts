/** A download filename from free text: letters, digits and dashes only, so no header injection or odd paths. */
export function sheetFilename(name: string, suffix: string): string {
  const base = name.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "assessment";
  return `${base}-${suffix}.csv`;
}
