import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AboutDialog } from "./components/dialogs/AboutDialog";
import { GlobalSettingsDialog } from "./components/dialogs/GlobalSettingsDialog";
import { HelpDialog } from "./components/dialogs/HelpDialog";
import { RegisterRepoDialog } from "./components/dialogs/RegisterRepoDialog";
import { api } from "./lib/api";
import { startWs } from "./lib/ws";
import { useSylva } from "./state/store";
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
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
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
    });
  }, [qc]);

  return (
    <div className="shell">
      <TopBar onAbout={() => setShowAbout(true)} onGlobalSettings={() => setShowGlobalSettings(true)} onHelp={() => setShowHelp(true)} />
      <div className="shell-body">
        <Sidebar />
        <MainPanel
          onRegister={() => setShowRegister(true)}
          onAbout={() => setShowAbout(true)}
        />
      </div>
      <StatusStrip />

      <AboutDialog open={showAbout} onClose={() => setShowAbout(false)} />
      <HelpDialog open={showHelp} onClose={() => setShowHelp(false)} />
      <GlobalSettingsDialog
        open={showGlobalSettings}
        onClose={() => setShowGlobalSettings(false)}
      />
      <RegisterRepoDialog
        open={showRegister}
        onClose={() => {
          setShowRegister(false);
          void qc.invalidateQueries({ queryKey: ["repos"] });
        }}
      />

      <TooltipLayer />
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
