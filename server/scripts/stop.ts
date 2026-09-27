/**
 * Stops a dev stack left running in another terminal.
 *
 *   npm run stop
 *
 * Targets every process whose command line references this project directory.
 * Matching on listening ports alone is not enough: the `concurrently` / `npm`
 * parents hold no port, so they survive and keep respawning the children.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const isWindows = process.platform === 'win32';

// Only ever match this exact project path. A looser match (e.g. the home
// directory) would also catch unrelated projects living under the same folder.
const PROJECT_MARKERS = ['Marcus Mallari\\Diary', 'Marcus Mallari/Diary'];

// Processes we are willing to terminate, so an unrelated node app that merely
// shares a port is never touched.
const PROCESS_MATCHERS = [
  /concurrently/i,
  /\bnpx\b/i,
  /\btsx\b/i,
  /\bvite\b/i,
  /npm-cli\.js/i,
  /run-dev\.cmd/i,
  /tsconfig-paths/i,
];

interface Proc {
  pid: number;
  parent: number;
  command: string;
}

function allNodeProcesses(): Proc[] {
  try {
    if (isWindows) {
      // PowerShell is driven through a temp script + a temp output file rather
      // than stdout. Piping PowerShell into execSync makes Node try to parse its
      // CLIXML error stream, which fails noisily for reasons unrelated to us.
      const scriptPath = path.join(os.tmpdir(), `ols-procs-${process.pid}.ps1`);
      const outPath = path.join(os.tmpdir(), `ols-procs-${process.pid}.txt`);

      // The whole pipeline must stay on one line: PowerShell treats a line
      // that begins with "|" as an empty pipe element and fails to parse.
      const pipeline =
        `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ` +
        `ForEach-Object { "{0}|{1}|{2}" -f $_.ProcessId, $_.ParentProcessId, $_.CommandLine } | ` +
        `Out-File -FilePath '${outPath}' -Encoding utf8`;

      fs.writeFileSync(
        scriptPath,
        ["$ErrorActionPreference = 'SilentlyContinue'", "$ProgressPreference = 'SilentlyContinue'", pipeline].join('\n'),
        'utf8',
      );

      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      const raw = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
      fs.rmSync(scriptPath, { force: true });
      fs.rmSync(outPath, { force: true });

      return raw
        .split('\n')
        .map((line) => {
          // pid|parent|command — command may itself contain "|", so split twice.
          const first = line.indexOf('|');
          if (first === -1) return null;
          const second = line.indexOf('|', first + 1);
          if (second === -1) return null;
          return {
            pid: Number(line.slice(0, first).trim()),
            parent: Number(line.slice(first + 1, second).trim()),
            command: line.slice(second + 1).trim(),
          };
        })
        .filter((entry): entry is Proc => Boolean(entry) && Number.isFinite(entry!.pid) && entry!.pid > 0);
    }

    const output = execSync('ps -eo pid=,ppid=,command=', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    return output
      .split('\n')
      .map((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        return match ? { pid: Number(match[1]), parent: Number(match[2]), command: match[3]!.trim() } : null;
      })
      .filter((entry): entry is Proc => Boolean(entry));
  } catch (error) {
    // Never fail silently: a silent empty list would tell the user "all clear"
    // while their server is still running.
    console.error('  could not enumerate processes:', error instanceof Error ? error.message : error);
    return [];
  }
}

/** This process and everything that spawned it — never our own parent chain. */
function selfAndAncestors(processes: Proc[]): Set<number> {
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  const protectedPids = new Set<number>([process.pid]);

  let current = byPid.get(process.pid);
  for (let depth = 0; depth < 20 && current; depth++) {
    protectedPids.add(current.parent);
    current = byPid.get(current.parent);
  }
  return protectedPids;
}

function isOurs(command: string): boolean {
  if (!PROJECT_MARKERS.some((marker) => command.includes(marker))) return false;
  return PROCESS_MATCHERS.some((matcher) => matcher.test(command));
}

const all = allNodeProcesses();
const protectedPids = selfAndAncestors(all);
const targets = all.filter((entry) => isOurs(entry.command) && !protectedPids.has(entry.pid));

if (targets.length === 0) {
  console.log('Nothing from this project is running. All clear.');
  process.exit(0);
}

// Children first, so a parent cannot respawn a child mid-teardown.
targets.sort((a, b) => b.pid - a.pid);

let stopped = 0;
for (const target of targets) {
  try {
    if (isWindows) {
      execSync(`taskkill /PID ${target.pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(target.pid, 'SIGKILL');
    }
    console.log(`  stopped  pid ${target.pid}  ${target.command.slice(0, 80)}`);
    stopped++;
  } catch {
    console.log(`  could not stop pid ${target.pid}`);
  }
}

console.log(`\n${stopped} process${stopped === 1 ? '' : 'es'} stopped. Now run: npm run dev\n`);
