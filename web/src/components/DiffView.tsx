import type { FileDiff } from "sylva-shared";

export function DiffView({ diff }: { diff: FileDiff }) {
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
              {hunk.lines.map((line, li) => (
                <tr key={li} className={`dl dl-${line.type}`}>
                  <td className="dl-num">{line.oldLine ?? ""}</td>
                  <td className="dl-num">{line.newLine ?? ""}</td>
                  <td className="dl-sign">
                    {line.type === "add" ? "+" : line.type === "del" ? "−" : ""}
                  </td>
                  <td className="dl-text">{line.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
