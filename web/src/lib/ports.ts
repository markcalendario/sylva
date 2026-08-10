/**
 * How many ports one expression may name.
 *
 * A typo in a range — `3000-30000` for `3000-3000` — is a request to kill
 * twenty-seven thousand processes, and the server caps what it will accept
 * anyway. Refusing here means the number is explained rather than rejected.
 */
export const MAX_PORTS = 128;

export interface PortParse {
  /** Every port named, in the order given, without repeats. */
  ports: number[];
  /** What couldn't be read, for showing under the field as you type. */
  error: string | null;
}

const RANGE = /^(\d{1,5})\s*(?:-|–|\.\.)\s*(\d{1,5})$/;

function valid(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Read a list of ports the way you'd say one out loud: `3000`, `3000, 5173`,
 * `3000 5173`, or `3000-3010` for a run of them. Ranges accept `-`, an en dash
 * (which is what a phone keyboard and a word processor both produce) and `..`,
 * and they read the same written backwards.
 *
 * Everything is parsed, not just the first failure: a list of five ports with a
 * typo in the third should tell you about the third, not stop at it.
 */
export function parsePorts(input: string): PortParse {
  const ports: number[] = [];
  const seen = new Set<number>();
  const bad: string[] = [];
  let overflowed = false;

  const add = (port: number) => {
    if (seen.has(port)) return;
    if (ports.length >= MAX_PORTS) {
      overflowed = true;
      return;
    }
    seen.add(port);
    ports.push(port);
  };

  // Spaces around a range's dash are pulled in before anything is split apart:
  // "3000 - 3010" is one expression written comfortably, not three.
  const tightened = input.replace(/\s*(-|–|\.\.)\s*/g, "$1");

  for (const raw of tightened.split(/[\s,;]+/)) {
    const piece = raw.trim();
    if (!piece) continue;

    const range = RANGE.exec(piece);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (!valid(from) || !valid(to)) {
        bad.push(piece);
        continue;
      }
      // Written backwards is still a range, and correcting it silently is
      // kinder than an error about which end goes first.
      const [low, high] = from <= to ? [from, to] : [to, from];
      if (high - low + 1 > MAX_PORTS) {
        overflowed = true;
        continue;
      }
      for (let port = low; port <= high; port++) add(port);
      continue;
    }

    const port = Number(piece);
    if (!/^\d+$/.test(piece) || !valid(port)) {
      bad.push(piece);
      continue;
    }
    add(port);
  }

  const problems: string[] = [];
  if (bad.length > 0) {
    problems.push(
      `${bad.length === 1 ? "Not a port" : "Not ports"}: ${bad.slice(0, 4).join(", ")}${
        bad.length > 4 ? "…" : ""
      }`,
    );
  }
  if (overflowed) problems.push(`More than ${MAX_PORTS} ports — narrow the range`);

  return { ports, error: problems.length > 0 ? problems.join(" · ") : null };
}
