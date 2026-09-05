import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useHasForest, useWords } from "../../lib/theme";
import type { Words } from "../../lib/words";
import { Dialog } from "../Dialog";

interface Faq {
  q: string;
  a: React.ReactNode;
  /**
   * An answer that is only true while there is a wood on screen — where a
   * dryad stands, why it lingers. In a theme with no map these are not
   * rewordings of a question, they are answers to a question nobody can ask,
   * so they are left out rather than translated.
   */
  forestOnly?: boolean;
}

interface Section {
  title: string;
  items: Faq[];
}

/**
 * Answers grounded in how Sylva actually behaves, not how it might. Everything
 * here is checkable against the code — if one of these stops being true, the
 * answer is wrong and should change.
 */
function sections(words: Words): Section[] {
  return [
    {
      title: "Worktrees and sessions",
      items: [
        {
          q: "Is a Claude session tied to a worktree?",
          a: (
            <>
              Yes, one to one. Each worktree gets its own session, started with its working
              directory set to that worktree's path. Prompting in one tree never touches another,
              and two trees can be worked at the same time by two agents that know nothing about
              each other.
            </>
          ),
        },
        {
          q: "Can a worktree have more than one session at once?",
          a: (
            <>
              No. Sylva allows one active session per worktree. Sending a prompt while a turn is
              running <strong>queues</strong> it rather than starting a second agent — queued
              prompts appear under the chat box and dispatch when the current turn ends.
            </>
          ),
        },
        {
          q: "What does “Pull first” do when I grow a worktree?",
          a: (
            <>
              It fetches before git cuts the tree, so the work starts from what the remote has
              rather than from whatever this machine last happened to pull. For a{" "}
              <strong>new branch</strong> that means basing it on the remote's copy of the base ref
              — name <code>main</code> and you get <code>origin/main</code>. For an{" "}
              <strong>existing branch</strong> it means catching that branch up to its upstream, and
              only where that is a fast-forward: a branch with commits of its own is left exactly as
              it is. A repository with no remote skips the whole thing. If the fetch fails, nothing
              is created — untick the box to grow the tree from what is already here.
            </>
          ),
        },
        {
          q: "Why does a new worktree have my .env files?",
          a: (
            <>
              Because <code>git worktree add</code> checks out tracked files and nothing else, and
              env files are gitignored — so a new tree used to arrive unable to run until you
              remembered which directory to copy them out of. Sylva copies every <code>.env</code>{" "}
              and <code>.env.*</code> from the main worktree, in its root and in subdirectories, and
              never overwrites a file the checkout already put there. Turn it off under{" "}
              <strong>Settings → Worktrees</strong>. Ignored directories are skipped wholesale, so
              nothing goes hunting through <code>node_modules</code>.
            </>
          ),
        },
        {
          q: "What happens to a running agent when I switch worktrees?",
          a: (
            <>
              It keeps working. Switching only changes what you're looking at. It gets an activity
              dot when something happens, and it notifies you both when it finishes <em>and</em>{" "}
              when it stops needing a decision from you — the second being the one that actually
              costs you time.
            </>
          ),
        },
        {
          q: "Does the agent see my other worktrees?",
          a: (
            <>
              Its working directory is that one worktree, so its file tools naturally operate there.
              But it runs shell commands as you, so nothing stops a command from reaching elsewhere
              on the machine. Treat it as a process with your permissions, not a sandbox.
            </>
          ),
        },
      ],
    },
    {
      title: "History and state",
      items: [
        {
          q: "Where does conversation history live?",
          a: (
            <>
              Every session event is appended to <code>~/.sylva/sessions/&lt;id&gt;.jsonl</code> as
              it happens. Reloading the page replays that file, so a refresh mid-turn doesn't lose
              the conversation.
            </>
          ),
        },
        {
          q: "Does a conversation survive restarting Sylva?",
          a: (
            <>
              Yes. The SDK session id is stored alongside the transcript, and the next prompt
              resumes that session — so the agent still remembers the earlier turns after the server
              has been restarted.
            </>
          ),
        },
        {
          q: `Can I make ${words.agent === "dryad" ? "a dryad" : "an agent"} forget everything and start over?`,
          a: (
            <>
              Yes — <strong>Clear</strong> in the Agent header. It deletes the transcript, drops the
              SDK session id the next prompt would have resumed into, and puts its token count back
              to zero, so the next thing you ask begins a conversation of its own. The worktrees it
              tends and its model, effort and permission settings are all left alone. It's refused
              mid-turn: stop the turn first.
            </>
          ),
        },
        {
          q: "What else is stored, and where?",
          a: (
            <>
              Everything lives under <code>~/.sylva/</code>: <code>settings.json</code> for agent
              defaults, app preferences and per-worktree overrides; <code>registry.json</code> for
              the repositories you've registered and their session metadata; <code>sessions/</code>{" "}
              for transcripts; <code>attachments/</code> for files you attach to prompts. None of it
              is inside your repository, so none of it can be committed — and attachments in
              particular are kept out so they never show up as changes.
            </>
          ),
        },
      ],
    },
    {
      title: "Settings and models",
      items: [
        {
          q: "How do I change which editor the Code button opens?",
          a: (
            <>
              From the button itself — the caret beside <strong>Code</strong> lists VS Code, Cursor,
              Zed, a custom command, and Off. It used to be a dropdown in Settings, three screens
              away from the button it governed, which is the wrong place for something you decide at
              the moment of opening. The same menu shows the worktree folder in Finder. A custom
              command is run directly rather than through a shell, so it can launch one program with
              arguments and nothing else; <code>{"{path}"}</code> becomes the worktree directory.
            </>
          ),
        },
        {
          q: "How do global settings and per-worktree settings interact?",
          a: (
            <>
              A worktree inherits every global default until it overrides one. Overrides are
              per-field: pinning a worktree's effort leaves it following the global model. Changing
              a global value only affects trees that haven't overridden that field.
            </>
          ),
        },
        {
          q: "Why does changing a setting restart the session?",
          a: (
            <>
              Model, effort and permission mode are fixed when the SDK query starts, so they can't
              be changed in place. Sylva ends the query and the next prompt reopens it — resuming by
              session id, so the conversation carries over.
            </>
          ),
        },
        {
          q: "Where do credentials come from? There's no .env.",
          a: (
            <>
              Sylva doesn't take an API key. The Agent SDK reuses your existing Claude Code login —
              the credentials <code>claude</code> already stored on this machine. If{" "}
              <code>claude</code> works in your terminal, Sylva works. Nothing to configure.
            </>
          ),
        },
        {
          q: "What does “skip permissions” actually turn off?",
          a: (
            <>
              Normally the agent runs with edits auto-accepted and anything riskier routed to you as
              an approval card. Skipping permissions removes that gate entirely: commands run
              without asking, including deletes, history rewrites and pushes. It's per worktree, and
              worth it only in a tree you'd be happy to throw away.
            </>
          ),
        },
      ],
    },
    {
      title: "Reading the interface",
      items: [
        {
          q: "What can I type in the prompt box besides a prompt?",
          a: (
            <>
              <code>@</code> completes a file path across every worktree the {words.agent} can
              reach, so you can name a file without typing it from memory. <code>/</code> at the
              very start of a message lists the commands and skills this worktree offers —
              built-ins, anything in <code>.claude/commands</code>, anything in{" "}
              <code>.claude/skills</code> — read from the agent itself, so what you see is what it
              will actually answer to. The list is asked for the first time you type a slash, which
              takes a moment when no turn is running.
            </>
          ),
        },
        {
          q: "Where do attached files end up in my prompt?",
          a: (
            <>
              Wherever the caret was. Attaching, dropping or pasting a file copies it under{" "}
              <code>~/.sylva/attachments/</code> and writes its path into the sentence at the point
              you were typing — so “compare <em>this</em> against the one on main” is something you
              can actually say, rather than a list bolted onto the end. Deleting the path from the
              box doesn't lose the file: anything still attached but no longer named gets listed at
              the end of the prompt as it always did. Removing the chip takes both away.
            </>
          ),
        },
        {
          q: "What's the difference between the Files tab and the Git tab?",
          a: (
            <>
              Git shows <strong>state</strong> — what differs from HEAD right now. Files shows{" "}
              <strong>events</strong> — what got touched and when, newest first, so you can watch an
              agent work. The feed is seeded from git status when you open a tree, then live changes
              stack on top.
            </>
          ),
        },
        {
          q: "Can I switch tabs from the keyboard?",
          a: (
            <>
              Yes — <strong>Option + Tab</strong> on a Mac steps through Agent, Files, Git and
              Terminal, and round from Terminal back to Agent. Hold shift to walk the other way. It
              works from inside the prompt box and from inside a terminal, where the keystroke is
              taken before the shell can see it. On Windows the same chord is{" "}
              <strong>Alt + `</strong>: Windows keeps both Alt+Tab and Win+Tab for itself, so a
              browser never gets told they happened.
            </>
          ),
        },
        {
          q: `What are the numbers under the ${words.workspace.toLowerCase()}?`,
          a: (
            <>
              The roster carries the facts a glance doesn't. ↑ and ↓ are commits ahead of and behind
              the repository's base branch (resolved from <code>origin/HEAD</code>, then main or
              master). “dirty” counts files changed but not committed. The last figure is how many
              tokens that worktree's session has read and written so far.
            </>
          ),
        },
        {
          forestOnly: true,
          q: "What is a dryad telling me by where it's standing?",
          a: (
            <>
              The forest is one map and each dryad walks to the place its state names. Asleep at the{" "}
              <strong>camp</strong> means nothing is running. At the <strong>workshop</strong> means
              an agent is working. At the <strong>grove</strong> shrine means its last turn finished
              cleanly. At the <strong>notice board</strong> — where the gate is down — means it is
              blocked, waiting for you to answer a permission request.
            </>
          ),
        },
        {
          forestOnly: true,
          q: "Why is a dryad still in the grove long after it finished?",
          a: (
            <>
              Because you haven't looked yet. A finished dryad waits at the grove until you open its
              worktree, so a turn that lands while you're away is still announced when you get back.
              Opening it is the acknowledgement; next time you return to the forest it walks home to
              the camp.
            </>
          ),
        },
        {
          q: "What is “1 waiting” in the top bar?",
          a: (
            <>
              The number of agents stopped on a permission request. A blocked agent is the one
              failure with no other symptom — it simply stops — so it gets a standing counter rather
              than a notification you might miss. Click it to jump straight to the first one.
            </>
          ),
        },
      ],
    },
    {
      title: "Privacy and limits",
      items: [
        {
          q: "Does anything leave my machine?",
          a: (
            <>
              The server binds to localhost only and rejects requests carrying a foreign Origin or a
              non-local Host, so another site open in your browser can't drive it. Your prompts go
              to Anthropic the same way they do in Claude Code; nothing else is sent anywhere.
            </>
          ),
        },
        {
          q: "Why can't Sylva open my Desktop or Documents folder?",
          a: (
            <>
              macOS gates those folders behind privacy permissions, so listing them fails even
              though you can open them in Finder. Grant the terminal running Sylva access under
              System Settings → Privacy &amp; Security → Files and Folders, or just paste the
              repository path — registering works even when browsing doesn't.
            </>
          ),
        },
      ],
    },
  ];
}

function FaqItem({ item }: { item: Faq }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`faq ${open ? "faq-open" : ""}`}>
      <button className="faq-q" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronRight size={12} className="faq-chevron" />
        {item.q}
      </button>
      {open && <div className="faq-a">{item.a}</div>}
    </div>
  );
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const words = useWords();
  const hasForest = useHasForest();
  return (
    <Dialog title="Help" open={open} onClose={onClose}>
      <p className="dialog-hint">
        How Sylva actually works, for the person running it. Open a question to read the answer.
      </p>

      <div className="faq-list">
        {sections(words).map((section) => (
          <section key={section.title} className="faq-section">
            <h3 className="settings-heading">{section.title}</h3>
            {section.items
              .filter((item) => hasForest || !item.forestOnly)
              .map((item) => (
                <FaqItem key={item.q} item={item} />
              ))}
          </section>
        ))}
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
