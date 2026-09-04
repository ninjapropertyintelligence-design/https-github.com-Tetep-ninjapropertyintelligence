import { ApiError } from "@/lib/api-error";
import { getStorageProvider } from "@/lib/storage";
import { ImportParseError, ParsedTable, parseImportFile } from "@/lib/import/parse";

/**
 * Re-reads an uploaded import file from storage. Preview and commit both go
 * through here so they operate on exactly the same bytes — re-parsing the
 * stored original rather than trusting a client-supplied copy is what makes
 * "what the preview showed is what the commit does" true.
 */
export async function loadImportTable(storageKey: string, filename: string): Promise<ParsedTable> {
  const bytes = await getStorageProvider().readBytes(storageKey);
  if (!bytes) {
    throw new ApiError(410, "The uploaded file is no longer available. Upload it again to continue.");
  }
  try {
    return await parseImportFile(filename, bytes);
  } catch (err) {
    if (err instanceof ImportParseError) throw new ApiError(400, err.message);
    throw err;
  }
}
