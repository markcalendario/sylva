import { useState } from "react";
import { Dialog } from "../Dialog";

interface Faq {
  q: string;
  a: React.ReactNode;
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
const SECTIONS: Section[] = [
  {
    title: "Worktrees and sessions",
    items: [
      {
        q: "Is a Claude session tied to a worktree?",
        a: (
          <>
            Yes, one to one. Each worktree gets its own session, started with its working directory
            set to that worktree's path. Prompting in one tree never touches another, and two trees
            can be worked at the same time by two agents that know nothing about each other.
          </>
        ),
      },
      {
        q: "Can a worktree have more than one session at once?",
        a: (
          <>
            No. Sylva allows one active session per worktree. Sending a prompt while a turn is
            running <strong>queues</strong> it rather than starting a second agent — queued prompts
            appear under the chat box and dispatch when the current turn ends.
          </>
        ),
      },
      {
        q: "What happens to a running agent when I switch worktrees?",
        a: (
          <>
            It keeps working. Switching only changes what you're looking at. Its dryad keeps moving
            on the map, it gets an activity dot when something happens, and it notifies you both
            when it finishes <em>and</em> when it stops needing a decision from you — the second
            being the one that actually costs you time.
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
            Every session event is appended to <code>~/.sylva/sessions/&lt;id&gt;.jsonl</code> as it
            happens. Reloading the page replays that file, so a refresh mid-turn doesn't lose the
            conversation.
          </>
        ),
      },
      {
        q: "Does a conversation survive restarting Sylva?",
        a: (
          <>
            Yes. The SDK session id is stored alongside the transcript, and the next prompt resumes
            that session — so the agent still remembers the earlier turns after the server has been
            restarted.
          </>
        ),
      },
      {
        q: "What else is stored, and where?",
        a: (
          <>
            Everything lives under <code>~/.sylva/</code>: <code>settings.json</code> for agent
            defaults, saved prompts and per-worktree overrides; <code>registry.json</code> for the
            repositories you've registered and their session metadata; <code>sessions/</code> for
            transcripts; <code>attachments/</code> for files you attach to prompts. None of it is
            inside your repository, so none of it can be committed — and attachments in particular
            are kept out so they never show up as changes.
          </>
        ),
      },
    ],
  },
  {
    title: "Settings and models",
    items: [
      {
        q: "How do global settings and per-worktree settings interact?",
        a: (
          <>
            A worktree inherits every global default until it overrides one. Overrides are
            per-field: pinning a worktree's effort leaves it following the global model. Changing a
            global value only affects trees that haven't overridden that field.
          </>
        ),
      },
      {
        q: "Why does changing a setting restart the session?",
        a: (
          <>
            Model, effort and permission mode are fixed when the SDK query starts, so they can't be
            changed in place. Sylva ends the query and the next prompt reopens it — resuming by
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
            an approval card. Skipping permissions removes that gate entirely: commands run without
            asking, including deletes, history rewrites and pushes. It's per worktree, and worth it
            only in a tree you'd be happy to throw away.
          </>
        ),
      },
    ],
  },
  {
    title: "Reading the interface",
    items: [
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
        q: "What are the numbers under the forest?",
        a: (
          <>
            The roster under the map carries the facts the scene doesn't. ↑ and ↓ are commits ahead
            of and behind the repository's base branch (resolved from <code>origin/HEAD</code>, then
            main or master). “dirty” counts files changed but not committed. The dollar figure is
            what that worktree's agent session has cost so far.
          </>
        ),
      },
      {
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
            The number of agents stopped on a permission request. A blocked agent is the one failure
            with no other symptom — it simply stops — so it gets a standing counter rather than a
            notification you might miss. Click it to jump straight to the first one.
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
            non-local Host, so another site open in your browser can't drive it. Your prompts go to
            Anthropic the same way they do in Claude Code; nothing else is sent anywhere.
          </>
        ),
      },
      {
        q: "Why can't Sylva open my Desktop or Documents folder?",
        a: (
          <>
            macOS gates those folders behind privacy permissions, so listing them fails even though
            you can open them in Finder. Grant the terminal running Sylva access under System
            Settings → Privacy &amp; Security → Files and Folders, or just paste the repository
            path — registering works even when browsing doesn't.
          </>
        ),
      },
    ],
  },
];

function FaqItem({ item }: { item: Faq }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`faq ${open ? "faq-open" : ""}`}>
      <button className="faq-q" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="faq-chevron">▸</span>
        {item.q}
      </button>
      {open && <div className="faq-a">{item.a}</div>}
    </div>
  );
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog title="Help" open={open} onClose={onClose}>
      <p className="dialog-hint">
        How Sylva actually works, for the person running it. Open a question to read the answer.
      </p>

      <div className="faq-list">
        {SECTIONS.map((section) => (
          <section key={section.title} className="faq-section">
            <h3 className="settings-heading">{section.title}</h3>
            {section.items.map((item) => (
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
