/** Pretty console output for the onboarding CLIs: step headers, timings, tables, swatches. */
const TTY = !!process.stdout.isTTY && !process.env.NO_COLOR;
const esc = (code: string) => (s: string) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: esc('1'),
  dim: esc('2'),
  red: esc('31'),
  green: esc('32'),
  yellow: esc('33'),
  blue: esc('34'),
  magenta: esc('35'),
  cyan: esc('36'),
  grey: esc('90'),
};

export function banner(title: string, subtitle?: string) {
  const line = '═'.repeat(Math.max(40, title.length + 8));
  console.log('\n' + c.cyan(line));
  console.log(c.cyan('  ') + c.bold(title));
  if (subtitle) console.log(c.grey('  ' + subtitle));
  console.log(c.cyan(line));
}

let stepStart = 0;
let stepNo = 0;
export function step(total: number, title: string) {
  stepNo++;
  stepStart = Date.now();
  console.log('\n' + c.bold(c.blue(`━━ Step ${stepNo}/${total} · ${title} `)) + c.blue('━'.repeat(Math.max(4, 56 - title.length))));
}
export function stepDone(summary?: string) {
  const ms = Date.now() - stepStart;
  console.log(c.green('   ✔ ') + (summary ? summary + ' ' : '') + c.grey(`(${fmtMs(ms)})`));
}
export function resetSteps() {
  stepNo = 0;
}

export const info = (s: string) => console.log('   ' + s);
export const ok = (s: string) => console.log('   ' + c.green('✔ ') + s);
export const warn = (s: string) => console.log('   ' + c.yellow('⚠ ') + s);
export const fail = (s: string) => console.log('   ' + c.red('✖ ') + s);
export const dim = (s: string) => console.log('   ' + c.grey(s));

export function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** In-place progress line (falls back to plain lines when not a TTY). */
export function progress(text: string, done = false) {
  if (TTY) {
    process.stdout.write('\r\x1b[2K   ' + text + (done ? '\n' : ''));
  } else if (done) {
    console.log('   ' + text);
  }
}

/** Minimal column table. */
export function table(rows: (string | number)[][], header?: string[]) {
  const all = header ? [header, ...rows] : rows;
  const strRows = all.map((r) => r.map((v) => String(v)));
  const widths: number[] = [];
  for (const r of strRows) r.forEach((v, i) => (widths[i] = Math.max(widths[i] || 0, visibleLen(v))));
  const fmt = (r: string[]) => '   ' + r.map((v, i) => v + ' '.repeat(widths[i] - visibleLen(v))).join('  ');
  if (header) {
    console.log(c.bold(fmt(strRows[0])));
    console.log(c.grey('   ' + widths.map((w) => '─'.repeat(w)).join('  ')));
    strRows.slice(1).forEach((r) => console.log(fmt(r)));
  } else strRows.forEach((r) => console.log(fmt(r)));
}

function visibleLen(s: string) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Terminal colour swatch (24-bit) followed by the hex. */
export function swatch(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!TTY || !m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `\x1b[48;2;${r};${g};${b}m    \x1b[0m ${hex}`;
}
