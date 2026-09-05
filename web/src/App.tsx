import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AboutDialog } from "./components/dialogs/AboutDialog";
import { HelpDialog } from "./components/dialogs/HelpDialog";
import { RegisterRepoDialog } from "./components/dialogs/RegisterRepoDialog";
import { TranscriptSearchDialog } from "./components/dialogs/TranscriptSearchDialog";
import { circleMembers, GROVE_ID } from "sylva-shared";
import { api } from "./lib/api";
import { useFileEventInvalidation, usePreferences } from "./lib/queries";
import { useShortcuts } from "./lib/shortcuts";
import { disposeMissingTerminals, setTerminalScrollback } from "./lib/terminals";
import { startWs } from "./lib/ws";
import { useSylva } from "./state/store";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmHost } from "./components/ConfirmDialog";
import { Sidebar } from "./components/Sidebar";
import { MainPanel } from "./components/MainPanel";
import { StatusStrip } from "./components/StatusStrip";
import { TooltipLayer } from "./components/Tooltip";
import { TopBar } from "./components/TopBar";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";
import "./styles/professional.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      /*
       * Sylva is told what changed; it does not need to ask on the way back in.
       *
       * Refetching everything stale on focus meant that alt-tabbing into the
       * app fired a `git status` per worktree, a `git log`, a listing and a
       * read per open file, and — while the Git tab was open — a `gh pr view`,
       * which is a second and a bit of network. All to re-answer questions the
       * WebSocket had already answered: status and worktrees arrive as events,
       * and the file feed now invalidates what it invalidates (see
       * useFileEventInvalidation). What genuinely goes stale on its own — the
       * pull request, the plan usage, the fleet digest — polls on its own
       * schedule and always did.
       */
      refetchOnWindowFocus: false,
    },
  },
});

function Shell() {
  const qc = useQueryClient();
  const [showAbout, setShowAbout] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Every window-level shortcut: the palette, the attention jump, the tabs.
  useShortcuts();

  // Terminals are drawn outside React and outlive every component that shows
  // one, so their scrollback is handed to them here rather than read where they
  // are used — this is the one place that is always mounted.
  const scrollback = usePreferences().data?.terminalScrollback;
  useEffect(() => {
    if (scrollback !== undefined) setTerminalScrollback(scrollback);
  }, [scrollback]);

  // A branch switch means the fetched worktree list is out of date. The status
  // stream carries the new branch, but the *name* shown in the sidebar comes
  // from this list — which is why a checkout used to need a reload.
  const worktreesRevision = useSylva((s) => s.worktreesRevision);
  useEffect(() => {
    if (worktreesRevision === 0) return;
    void qc.invalidateQueries({ queryKey: ["worktrees"] });
    void qc.invalidateQueries({ queryKey: ["branches"] });
    // HEAD moved, so the history drawn against it did too — a commit the dryad
    // made is exactly this case, and the graph used to keep the shape it had
    // when the tab was opened until something else went and asked.
    void qc.invalidateQueries({ queryKey: ["graph"] });
  }, [worktreesRevision, qc]);

  const onFiles = useFileEventInvalidation();

  useEffect(() => {
    startWs({
      onFiles,
      onResync: () => {
        // Reconnected: the world may have moved on. Resync everything.
        void qc.invalidateQueries();
        void api.getFocus().then(({ worktreeId }) => useSylva.getState().setFocus(worktreeId));
        void api.listSessions().then((sessions) => {
          for (const s of sessions) useSylva.getState().setSession(s.worktreeId, s);
        });
        // Permission requests only arrive as live events, so a reload leaves an
        // already-blocked agent looking like it is working. Rebuild them here.
        void api.listPermissions().then((requests) => {
          const byWorktree = new Map<string, typeof requests>();
          for (const r of requests) {
            byWorktree.set(r.worktreeId, [...(byWorktree.get(r.worktreeId) ?? []), r]);
          }
          for (const [worktreeId, list] of byWorktree) {
            useSylva.getState().setPermissions(worktreeId, list);
          }
        });
        // Terminals outlive a page reload — they belong to the server, not to
        // the tab that opened them — so pick them back up, and let go of the
        // emulators for any that were closed while we weren't listening.
        void api.listTerminals().then((infos) => {
          useSylva.getState().seedTerminals(infos);
          disposeMissingTerminals(infos.map((info) => info.id));
        });
        // The server watches what the pane holds; a reconnect has to say so again.
        const held = useSylva.getState().pane.worktreeId;
        const open = (held ? (circleMembers(held) ?? [held]) : []).filter((id) => id !== GROVE_ID);
        void api.setOpenWorktrees(open).catch(() => {});
      },
    });
  }, [qc, onFiles]);

  return (
    <div className="shell">
      <TopBar onHelp={() => setShowHelp(true)} />
      <div className="shell-body">
        <Sidebar />
        <MainPanel onRegister={() => setShowRegister(true)} onAbout={() => setShowAbout(true)} />
      </div>
      <StatusStrip onAbout={() => setShowAbout(true)} />

      <AboutDialog open={showAbout} onClose={() => setShowAbout(false)} />
      <HelpDialog open={showHelp} onClose={() => setShowHelp(false)} />
      <RegisterRepoDialog
        open={showRegister}
        onClose={() => {
          setShowRegister(false);
          void qc.invalidateQueries({ queryKey: ["repos"] });
        }}
      />

      <CommandPalette onHelp={() => setShowHelp(true)} />
      <TranscriptSearchHost />
      <TooltipLayer />
      <ConfirmHost />
    </div>
  );
}

/**
 * The transcript search, mounted once and opened from the store — a tab menu, a
 * palette row and a chord all reach for it, and none of them are near each
 * other in the tree.
 */
function TranscriptSearchHost() {
  const query = useSylva((s) => s.transcriptQuery);
  return (
    <TranscriptSearchDialog
      open={query !== null}
      {...(query ? { initialQuery: query } : {})}
      onClose={() => useSylva.getState().closeTranscriptSearch()}
    />
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
