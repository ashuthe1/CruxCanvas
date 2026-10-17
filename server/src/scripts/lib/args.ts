/**
 * Tiny CLI argument parser: `--key value`, `--key=value`, `--flag`, `--no-flag`.
 * Positional args land in `_`. No dependencies.
 */
export type Args = { _: string[]; [key: string]: string | boolean | string[] | undefined };

export function parseArgs(argv: string[] = process.argv.slice(2)): Args {
  const out: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const body = a.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      out[camel(body.slice(0, eq))] = body.slice(eq + 1);
      continue;
    }
    if (body.startsWith('no-')) {
      out[camel(body.slice(3))] = false;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[camel(body)] = next;
      i++;
    } else {
      out[camel(body)] = true;
    }
  }
  return out;
}

function camel(s: string) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export function str(args: Args, key: string, fallback?: string): string | undefined {
  const v = args[key];
  if (typeof v === 'string') return v;
  return fallback;
}

export function bool(args: Args, key: string, fallback = false): boolean {
  const v = args[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return !/^(0|false|no)$/i.test(v);
  return fallback;
}

export function num(args: Args, key: string, fallback: number): number {
  const v = args[key];
  const n = typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function requireStr(args: Args, key: string, usage: string): string {
  const v = str(args, key);
  if (!v) {
    console.error(`Missing --${key}\n\n${usage}`);
    process.exit(2);
  }
  return v;
}
