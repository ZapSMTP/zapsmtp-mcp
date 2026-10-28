#!/usr/bin/env node
// Bundles the docs site's Markdown (llms.txt and the guides) into docs/, which
// the server exposes as MCP resources. Reads landing/zapsmtp-site/dist (built
// by the site); when it is missing, the package ships without docs.
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = process.env.ZAP_SITE_DIST ?? join(pkg, '..', '..', 'landing', 'zapsmtp-site', 'dist');
const out = join(pkg, 'docs');

if (!existsSync(join(site, 'llms.txt'))) {
  console.log(`docs: ${site} has no llms.txt, so no docs are bundled`);
  process.exit(0);
}
rmSync(out, {recursive: true, force: true});
mkdirSync(out, {recursive: true});

const meta = (text, fallback) => ({
  title: /^# (.+)$/m.exec(text)?.[1].trim() ?? fallback,
  description: /^> (.+)$/m.exec(text)?.[1].trim() ?? '',
});
const pages = [];
const add = (src, file, uri, name) => {
  copyFileSync(src, join(out, file));
  pages.push({uri, name, ...meta(readFileSync(src, 'utf8'), name), file});
};
add(join(site, 'llms.txt'), 'llms.txt', 'https://zapsmtp.com/llms.txt', 'llms.txt');
// the guides (docs/<page>.md); the per-operation reference pages are the tools themselves
for (const f of readdirSync(join(site, 'docs')).filter((f) => f.endsWith('.md')).sort()) {
  add(join(site, 'docs', f), f, `https://zapsmtp.com/docs/${f}`, f.replace(/\.md$/, ''));
}
writeFileSync(join(out, 'index.json'), JSON.stringify(pages, null, 1) + '\n');
console.log(`docs: bundled ${pages.length} pages`);
