// The ZapSMTP docs as MCP resources: llms.txt and the guides in Markdown,
// bundled into the package at build time (scripts/bundle-docs.mjs). Nothing
// is fetched at runtime.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DocPage {
  uri: string;
  name: string;
  title: string;
  description: string;
  /** the file in the docs directory */
  file: string;
}

/** Where the build puts the docs: <package>/docs. */
export const DOCS_DIR = fileURLToPath(new URL('../docs/', import.meta.url));

/** The bundled pages; none when the package was built without them. */
export function loadDocs(dir: string = DOCS_DIR): DocPage[] {
  try {
    const pages = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as DocPage[];
    return Array.isArray(pages) ? pages : [];
  } catch {
    return [];
  }
}

export function readDoc(dir: string, page: DocPage): string {
  return readFileSync(join(dir, page.file), 'utf8');
}
