import { isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./CopyButton";

/**
 * Every string inside a node, in order.
 *
 * React has already turned the fence into elements by the time a component
 * override sees it, so the only way back to what the model actually wrote is to
 * walk the tree and rejoin the text. Highlighting would nest it further; this
 * doesn't care how deep it goes.
 */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/**
 * Defined once rather than inline: a fresh object every render would make
 * react-markdown rebuild the whole document for each streamed chunk.
 */
const COMPONENTS: Components = {
  /**
   * A code block is the thing in an answer most likely to be wanted verbatim —
   * a command, a patch, a config — and selecting one by hand in a scrolling
   * transcript is a fight. The button waits until the pointer is over the block.
   */
  pre: ({ children }) => (
    <div className="md-code">
      <pre>{children}</pre>
      <CopyButton
        // The trailing newline is the fence's, not the code's.
        text={textOf(children).replace(/\n$/, "")}
        className="md-code-copy"
        tip="Copy this code block"
      />
    </div>
  ),
};

/**
 * Assistant prose. Raw HTML stays disabled (react-markdown's default), so
 * model output can't inject markup into the app.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
