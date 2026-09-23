export const EXTRACT_ELEMENTS_MAX_FILE_SIZE = 10 * 1024 * 1024;

const EXTRACT_ELEMENTS_ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function validateExtractElementsFile(file: Pick<File, "type" | "size">) {
  if (!EXTRACT_ELEMENTS_ACCEPTED_TYPES.has(file.type)) return "type" as const;
  if (file.size > EXTRACT_ELEMENTS_MAX_FILE_SIZE) return "size" as const;
  return null;
}
