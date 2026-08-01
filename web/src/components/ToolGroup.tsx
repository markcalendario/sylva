import { useState } from "react";

export interface ToolItem {
  id: string;
  tool: string;
  summary: string;
  detail?: string;
  error?: string;
}

const COLLAPSE_AT = 4;
const KEEP_VISIBLE = 3;

/**
 * A run of consecutive tool calls, rendered as one quiet block so a long
 * chain of steps doesn't drown out the conversation around it.
 */
export function ToolGroup({ items }: { items: ToolItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const collapsible = items.length > COLLAPSE_AT;
  const visible = collapsible && !expanded ? items.slice(0, KEEP_VISIBLE) : items;
  const hiddenCount = items.length - visible.length;

  return (
    <div className="tool-group">
      {visible.map((item) => {
        const canOpen = Boolean(item.detail);
        return (
          <div key={item.id} className="tool-row">
            <button
              className={`tool-line ${canOpen ? "" : "tool-line-static"}`}
              onClick={() => canOpen && setOpenId((o) => (o === item.id ? null : item.id))}
              {...(canOpen ? {} : { tabIndex: -1 })}
              data-tip={
                canOpen
                  ? openId === item.id
                    ? "Hide the full input"
                    : "Show the full input for this step"
                  : "A step the dryad took"
              }
            >
              <span className="tool-chip" data-tip="Tool the dryad reached for">
                {item.tool}
              </span>
              <span className="tool-summary">{item.summary}</span>
            </button>
            {openId === item.id && item.detail && (
              <pre className="tool-detail" data-tip="Exactly what the dryad passed to this tool">
                {item.detail}
              </pre>
            )}
            {item.error && (
              <div className="tool-row-error" data-tip="This step failed">
                {item.error}
              </div>
            )}
          </div>
        );
      })}

      {collapsible && (
        <button
          className="tool-more"
          onClick={() => setExpanded((e) => !e)}
          data-tip={expanded ? "Collapse back to the first few steps" : "Show every step in this run"}
        >
          {expanded ? "show fewer steps" : `+${hiddenCount} more step${hiddenCount === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}
