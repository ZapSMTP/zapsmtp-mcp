import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);

// The package ships production hosts only: a docs bundle or source built for
// another environment must not name its hosts.
describe('hosts', () => {
  it('names no zapsmtp.xyz host in the bundled docs or the source', () => {
    const hits = [...files('docs'), ...files('src')].filter((f) => readFileSync(join(root, f), 'utf8').includes('zapsmtp.xyz'));
    expect(hits).toEqual([]);
  });
});
