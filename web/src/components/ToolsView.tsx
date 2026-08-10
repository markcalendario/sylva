import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Radar, Skull } from "lucide-react";
import type { KillPortResult, PortListener } from "sylva-shared";
import { api, ApiFailure } from "../lib/api";
import { confirm } from "../lib/confirm";
import { parsePorts } from "../lib/ports";
import { CopyButton } from "./CopyButton";

const TOOLS = [
  { id: "ports", label: "Kill port", icon: Radar },
  { id: "time", label: "Time converter", icon: Clock },
] as const;

type ToolId = (typeof TOOLS)[number]["id"];

/**
 * The workbench: small jobs that belong to the machine rather than to any one
 * worktree.
 *
 * Everything here is something you would otherwise leave Sylva to do — open a
 * terminal, remember an incantation, come back. None of them are worth a tab of
 * their own, which is exactly why they share one.
 */
export function ToolsView() {
  const [tool, setTool] = useState<ToolId>("ports");

  return (
    <div className="tools-page">
      <aside className="tools-rail">
        <div className="pixel-label" data-tip="Odd jobs that aren't about a worktree">
          tools
        </div>
        <nav>
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`settings-rail-item ${tool === id ? "settings-rail-on" : ""}`}
              onClick={() => setTool(id)}
              aria-current={tool === id ? "page" : undefined}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="tools-body">
        {tool === "ports" ? <KillPortTool /> : <TimeTool />}
      </div>
    </div>
  );
}

/* ── Kill port ───────────────────────────────────────────────────────────── */

/** What the port field understands, said once so the hint and the tip agree. */
const PORT_SYNTAX = "3000, 5173 — or a run of them, 8080-8085";

function KillPortTool() {
  const [text, setText] = useState("");
  const [scan, setScan] = useState<PortListener[] | null>(null);
  /** Ports that were asked about and had nothing on them. */
  const [free, setFree] = useState<number[]>([]);
  const [results, setResults] = useState<KillPortResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parsePorts(text), [text]);
  const ports = parsed.ports;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const look = async (which: number[]) => {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const answer = await api.scanPorts(which);
      setScan(answer.listeners);
      setFree(answer.free);
    } catch (e) {
      setScan(null);
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : "Couldn't ask who's listening");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Killing is asked about first, and the question names what will die. "Free
   * port 3000" is abstract; "kill node (48213)" is the thing you can recognise
   * as either your dev server or the database you needed.
   */
  const kill = async (which: number[]) => {
    const holders = (scan ?? []).filter((l) => which.includes(l.port));
    const naming = holders.length
      ? `This stops ${holders.map((h) => `${h.command} (${h.pid}) on :${h.port}`).join(", ")}.`
      : `Whatever is listening on ${which.map((p) => `:${p}`).join(", ")} is stopped.`;
    const ok = await confirm({
      title: which.length === 1 ? `Free port ${which[0]}?` : `Free ${which.length} ports?`,
      body: `${naming} Each process is asked to stop first, and killed outright only if it ignores that.`,
      confirmLabel: "Free them",
      tone: "danger",
    });
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      const answer = await api.killPorts(which);
      setResults(answer.results);
      // What's left holding them is the only honest way to report success.
      const after = await api.scanPorts(which);
      setScan(after.listeners);
      setFree(after.free);
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : "Couldn't free those ports");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tool-card">
      <header className="tool-card-head">
        <h3 className="settings-heading">
          <Radar size={15} /> Kill port
        </h3>
        <p className="dialog-hint">
          "Address already in use", answered without leaving Sylva. Name the ports and Sylva finds
          what is holding them; freeing one sends SIGTERM first and SIGKILL only if that is ignored.
        </p>
      </header>

      <form
        className="port-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ports.length > 0) void look(ports);
        }}
      >
        <input
          ref={inputRef}
          className="port-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PORT_SYNTAX}
          aria-label="Ports"
          data-tip={`Separate with commas or spaces · a dash makes a range (${PORT_SYNTAX})`}
        />
        <button
          type="submit"
          className="btn-quiet"
          disabled={busy || ports.length === 0}
          data-tip="Find out what is holding these ports, without touching it"
        >
          Who's on it?
        </button>
        <button
          type="button"
          className="btn-danger"
          disabled={busy || ports.length === 0}
          onClick={() => void kill(ports)}
          data-tip="Stop whatever is listening on these ports"
        >
          <Skull size={13} /> Free {ports.length > 1 ? `${ports.length} ports` : "it"}
        </button>
      </form>

      <div className="port-note">
        {parsed.error ? (
          <span className="port-error">{parsed.error}</span>
        ) : ports.length > 0 ? (
          <span>
            {ports.length === 1
              ? `Port ${ports[0]}`
              : `${ports.length} ports · ${ports.slice(0, 8).join(", ")}${ports.length > 8 ? "…" : ""}`}
          </span>
        ) : (
          <span>A range counts as every port in it — 8080-8085 is six.</span>
        )}
        <button
          type="button"
          className="ghost port-all"
          disabled={busy}
          onClick={() => {
            setText("");
            void look([]);
          }}
          data-tip="List every TCP port being listened on right now"
        >
          Show everything listening
        </button>
      </div>

      {error && <div className="tool-error">{error}</div>}

      {results && (
        <ul className="kill-results">
          {results.map((result) => (
            <li key={result.port} className={`kill-result kill-${result.outcome}`}>
              <span className="kill-port">:{result.port}</span>
              <span className="kill-outcome">{result.outcome}</span>
              <span className="kill-note">{result.note}</span>
            </li>
          ))}
        </ul>
      )}

      {busy && <div className="tool-waiting">asking the machine…</div>}

      {scan && <Listeners listeners={scan} free={free} busy={busy} onKill={(p) => void kill([p])} />}
    </section>
  );
}

function Listeners({
  listeners,
  free,
  busy,
  onKill,
}: {
  listeners: PortListener[];
  free: number[];
  busy: boolean;
  onKill: (port: number) => void;
}) {
  if (listeners.length === 0) {
    return (
      <div className="tool-empty">
        {free.length > 0
          ? `Nothing is listening on ${free.map((p) => `:${p}`).join(", ")} — ${
              free.length === 1 ? "it's" : "they're"
            } yours.`
          : "Nothing is listening on any TCP port."}
      </div>
    );
  }

  return (
    <>
      {free.length > 0 && (
        <div className="tool-empty">
          Free already: {free.map((p) => `:${p}`).join(", ")}
        </div>
      )}
      <table className="port-table">
        <thead>
          <tr>
            <th>Port</th>
            <th>Process</th>
            <th>PID</th>
            <th>Bound to</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {listeners.map((l) => (
            <tr key={`${l.port}-${l.pid}-${l.address}`} className={l.self ? "port-row-self" : ""}>
              <td className="port-cell">:{l.port}</td>
              <td>
                {l.command}
                {l.self && (
                  <span className="port-self-tag" data-tip="Sylva's own server — it won't kill itself">
                    sylva
                  </span>
                )}
              </td>
              <td className="port-cell">
                {l.pid}
                <CopyButton text={String(l.pid)} tip="Copy this PID" />
              </td>
              <td className="port-cell">
                {l.address}
                {l.user ? ` · ${l.user}` : ""}
              </td>
              <td>
                <button
                  className="ghost port-kill"
                  disabled={busy || l.self}
                  onClick={() => onKill(l.port)}
                  data-tip={
                    l.self
                      ? "This is Sylva — stop it from the terminal you started it in"
                      : `Stop ${l.command} and free :${l.port}`
                  }
                >
                  <Skull size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* ── Time converter ──────────────────────────────────────────────────────── */

/**
 * Read whatever was pasted in.
 *
 * A timestamp arrives from a log, a database or a JSON payload, and it is one
 * of three things: seconds since the epoch, milliseconds since the epoch, or a
 * date someone already formatted. Ten digits is seconds and thirteen is
 * milliseconds — the boundary sits somewhere in 2001 for one and 33658 for the
 * other, so no real timestamp is ever ambiguous.
 */
export function readMoment(input: string): Date | null {
  const text = input.trim();
  if (!text) return null;

  if (/^-?\d+$/.test(text)) {
    const digits = text.replace("-", "").length;
    const value = Number(text);
    if (!Number.isFinite(value)) return null;
    const ms = digits <= 11 ? value * 1000 : digits <= 14 ? value : value / 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // `new Date` is far too willing: it reads "port 3000" as the year 3000 and
  // hands back a date with total confidence. Anything not shaped like a written
  // date — a separator, or a month said by name — never reaches it.
  const dateish = /\d/.test(text) && /[-/:]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(text);
  if (!dateish) return null;

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Largest unit first, with the cut written in seconds rather than derived by
 * dividing down the list — a cascade of divisions leaves a year sitting at
 * 11.99 months and reports it as twelve.
 */
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

/** "3 hours ago", "in 2 days" — the part of a timestamp you actually wanted. */
export function relativeTo(date: Date, from: Date): string {
  const seconds = Math.round((date.getTime() - from.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    // Seconds are the floor: anything smaller is still "now".
    if (Math.abs(seconds) >= size || unit === "second") {
      return format.format(Math.round(seconds / size), unit);
    }
  }
  return "";
}

function TimeTool() {
  const [text, setText] = useState(() => String(Math.floor(Date.now() / 1000)));
  /** Re-read every second so "ago" doesn't go stale while you look at it. */
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const date = useMemo(() => readMoment(text), [text]);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const rows = date
    ? [
        { label: "Local", value: date.toLocaleString(), hint: zone },
        { label: "ISO 8601", value: date.toISOString(), hint: "UTC" },
        { label: "Epoch seconds", value: String(Math.floor(date.getTime() / 1000)), hint: "" },
        { label: "Epoch millis", value: String(date.getTime()), hint: "" },
        { label: "Relative", value: relativeTo(date, new Date(tick)), hint: "from now" },
      ]
    : [];

  return (
    <section className="tool-card">
      <header className="tool-card-head">
        <h3 className="settings-heading">
          <Clock size={15} /> Time converter
        </h3>
        <p className="dialog-hint">
          Paste a timestamp from a log, a row or a JSON payload. Ten digits is read as seconds,
          thirteen as milliseconds, and anything else as a date.
        </p>
      </header>

      <form className="port-form" onSubmit={(e) => e.preventDefault()}>
        <input
          className="port-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="1754812800 · 2026-08-10T09:20:00Z · yesterday's log line"
          aria-label="A timestamp"
          data-tip="Epoch seconds, epoch milliseconds, or anything Date can read"
        />
        <button
          type="button"
          className="btn-quiet"
          onClick={() => setText(String(Math.floor(Date.now() / 1000)))}
          data-tip="Start from this moment"
        >
          Now
        </button>
      </form>

      {date ? (
        <ul className="time-rows">
          {rows.map((row) => (
            <li key={row.label} className="time-row">
              <span className="time-label">{row.label}</span>
              <span className="time-value">{row.value}</span>
              {row.hint && <span className="time-hint">{row.hint}</span>}
              <CopyButton text={row.value} tip={`Copy the ${row.label.toLowerCase()} form`} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="tool-empty">
          {text.trim() ? "That isn't a time anything can read." : "Nothing to convert yet."}
        </div>
      )}
    </section>
  );
}
