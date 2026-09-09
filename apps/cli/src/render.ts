const useColor = process.stdout.isTTY && !process.env["NO_COLOR"];
const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  magenta: wrap("35"),
  cyan: wrap("36"),
};

export function rule(label = ""): string {
  const width = Math.min(process.stdout.columns ?? 80, 100);
  if (!label) return c.dim("─".repeat(width));
  const line = "─".repeat(Math.max(0, width - label.length - 3));
  return c.dim(`── ${label} ${line}`.slice(0, width));
}

/** Wraps text to the terminal width with a hanging indent. */
export function wrapText(text: string, indent = 0, width?: number): string {
  const max = (width ?? Math.min(process.stdout.columns ?? 80, 100)) - indent;
  const pad = " ".repeat(indent);
  return text
    .split("\n")
    .flatMap((paragraph) => {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (words.length === 0) return [""];
      const lines: string[] = [];
      let current = "";
      for (const word of words) {
        if (current.length + word.length + 1 > max && current.length > 0) {
          lines.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      if (current) lines.push(current);
      return lines;
    })
    .map((l) => pad + l)
    .join("\n");
}

export function scoreColor(total: number, draftThreshold: number, maybeThreshold: number): string {
  if (total >= draftThreshold) return c.green(String(total));
  if (total >= maybeThreshold) return c.yellow(String(total));
  return c.red(String(total));
}

export function relativeAge(iso: string, now = Date.now()): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

export function money(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function table(rows: string[][], headers: string[]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => stripAnsi(r[i] ?? "").length)));
  const line = (r: string[], dim = false) =>
    r
      .map((cell, i) => {
        const pad = " ".repeat(Math.max(0, (widths[i] ?? 0) - stripAnsi(cell).length));
        return dim ? c.dim(cell + pad) : cell + pad;
      })
      .join("  ");
  return [line(headers, true), ...rows.map((r) => line(r))].join("\n");
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
