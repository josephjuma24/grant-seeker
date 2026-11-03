// `npm run dev`: the API and the harvester together, so scheduled grant
// scans run without anyone starting a second process.
//
//   node server/scripts/dev.mjs             reload both on file changes
//   node server/scripts/dev.mjs --no-watch  plain run (e.g. a preview pane)
//
// If the API stops, everything stops. If the worker stops, it is restarted
// with backoff: the schedule must keep running even after a crash.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const watch = !process.argv.includes('--no-watch');

const children = new Map();
let stopping = false;

function prefixLines(name, stream, out) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) out.write(`[${name}] ${line}\n`);
  });
  stream.on('end', () => buf && out.write(`[${name}] ${buf}\n`));
}

function start(name, entry, { restart }, attempt = 0) {
  const child = spawn(process.execPath, [tsx, ...(watch ? ['watch'] : []), path.join(root, entry)], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.set(name, child);
  prefixLines(name, child.stdout, process.stdout);
  prefixLines(name, child.stderr, process.stderr);
  const startedAt = Date.now();

  child.on('exit', (code, signal) => {
    children.delete(name);
    if (stopping) return;
    if (!restart) {
      console.error(`[dev] ${name} exited (${signal ?? code}); stopping everything`);
      stopAll(code ?? 1);
      return;
    }
    // A worker that ran for a while starts its backoff over.
    const next = Date.now() - startedAt > 60_000 ? 0 : attempt + 1;
    const delay = Math.min(60_000, 2_000 * 2 ** next);
    console.error(`[dev] ${name} exited (${signal ?? code}); restarting in ${delay / 1000}s`);
    setTimeout(() => !stopping && start(name, entry, { restart }, next), delay);
  });
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) child.kill('SIGTERM');
  // Give children a moment to close database connections.
  setTimeout(() => process.exit(code), 3_000).unref();
  const done = setInterval(() => children.size === 0 && (clearInterval(done), process.exit(code)), 100);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

start('api', 'server/server.ts', { restart: false });
start('worker', 'server/workers/scraperScheduler.ts', { restart: true });
