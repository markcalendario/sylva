import { useMemo } from "react";
import type { FileDiff } from "sylva-shared";
import { chunkClass, highlightLines, languageFor } from "../lib/highlight";

export function DiffView({ diff }: { diff: FileDiff }) {
  const language = languageFor(diff.path);

  /**
   * Each hunk coloured as one piece of text rather than line by line.
   *
   * A hunk is a fragment, and a fragment can open a block comment or a template
   * literal on one line and close it three lines later — tokenising per line
   * would forget that between them and colour the middle as code. Joining the
   * hunk back together first keeps those spans intact, and since the join is
   * one line per row the result still lines up one-to-one with the table.
   *
   * Added and deleted lines sit in that text together, which is an
   * approximation: they are alternatives, not neighbours. It reads correctly
   * for ordinary edits and can only mis-tint a hunk that opens a multi-line
   * token on one side and closes it on the other.
   */
  const coloured = useMemo(
    () =>
      diff.hunks.map((hunk) =>
        highlightLines(hunk.lines.map((line) => line.content).join("\n"), language),
      ),
    [diff.hunks, language],
  );

  if (diff.binary) {
    return <div className="diff-binary">Binary file — no text diff.</div>;
  }
  if (diff.hunks.length === 0) {
    return <div className="diff-binary">No changes to show.</div>;
  }
  return (
    <div className="diff">
      {diff.hunks.map((hunk, hi) => (
        <div key={hi} className="hunk">
          <div className="hunk-header" data-tip="Line range this block of changes covers">
            {hunk.header}
          </div>
          <table className="hunk-table">
            <tbody>
              {hunk.lines.map((line, li) => {
                const chunks = coloured[hi]?.[li];
                return (
                  <tr key={li} className={`dl dl-${line.type}`}>
                    <td className="dl-num">{line.oldLine ?? ""}</td>
                    <td className="dl-num">{line.newLine ?? ""}</td>
                    <td className="dl-sign">
                      {line.type === "add" ? "+" : line.type === "del" ? "−" : ""}
                    </td>
                    <td className="dl-text">
                      {/* Falling back to the raw line rather than nothing: a
                          grammar we don't have must not cost you the diff. */}
                      {chunks
                        ? chunks.map((chunk, c) => (
                            <span key={c} className={chunkClass(chunk.type)}>
                              {chunk.text}
                            </span>
                          ))
                        : line.content}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
