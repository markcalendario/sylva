import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AboutDialog } from "./components/dialogs/AboutDialog";
import { HelpDialog } from "./components/dialogs/HelpDialog";
import { RegisterRepoDialog } from "./components/dialogs/RegisterRepoDialog";
import { circleMembers, GROVE_ID } from "sylva-shared";
import { api } from "./lib/api";
import { startWs } from "./lib/ws";
import { useSylva } from "./state/store";
import { ConfirmHost } from "./components/ConfirmDialog";
import { Sidebar } from "./components/Sidebar";
import { MainPanel } from "./components/MainPanel";
import { StatusStrip } from "./components/StatusStrip";
import { TooltipLayer } from "./components/Tooltip";
import { TopBar } from "./components/TopBar";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
});

function Shell() {
  const qc = useQueryClient();
  const [showAbout, setShowAbout] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    startWs(() => {
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
      // Runners keep going across a page reload, so pick them back up.
      void api.listRunners().then((states) => {
        for (const state of states) useSylva.getState().setRunner(state);
      });
      // The server watches what the panes hold; a reconnect has to say so again.
      const open = useSylva
        .getState()
        .panes.flatMap((p) => (p.worktreeId ? (circleMembers(p.worktreeId) ?? [p.worktreeId]) : []))
        .filter((id) => id !== GROVE_ID);
      void api.setOpenWorktrees(open).catch(() => {});
    });
  }, [qc]);

  return (
    <div className="shell">
      <TopBar onHelp={() => setShowHelp(true)} />
      <div className="shell-body">
        <Sidebar />
        <MainPanel
          onRegister={() => setShowRegister(true)}
          onAbout={() => setShowAbout(true)}
        />
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

      <TooltipLayer />
      <ConfirmHost />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
