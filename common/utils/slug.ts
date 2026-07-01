/**
 * Generates a URL-safe slug from a string.
 * e.g. "Dr. John Doe" → "dr-john-doe"
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // remove non-alphanumeric chars except spaces and hyphens
    .replace(/\s+/g, '-')     // replace whitespace runs with a single hyphen
    .replace(/-+/g, '-')      // collapse multiple hyphens
    .replace(/^-|-$/g, '');   // trim leading/trailing hyphens
}

/**
 * Makes a slug unique by appending a numeric suffix if necessary.
 * Pass a `checkExists` function that returns true if the slug is already taken.
 */
export async function uniqueSlug(
  base: string,
  checkExists: (slug: string) => Promise<boolean>,
  excludeId?: string,
): Promise<string> {
  let slug = base;
  let counter = 2;

  while (await checkExists(slug)) {
    slug = `${base}-${counter}`;
    counter++;
  }

  return slug;
}
