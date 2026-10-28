#!/usr/bin/env node
// Entry point of the zapsmtp-mcp command.
import { main } from './main.js';

main(process.argv.slice(2), process.env, process).then((r) => {
  if (typeof r === 'number') {
    process.exitCode = r;
    return;
  }
  const stop = () => { void r.close().then(() => process.exit(0)); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}, (err: unknown) => {
  process.stderr.write(`zapsmtp-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
