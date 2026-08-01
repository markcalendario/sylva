import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./lib/api";
import { startWs } from "./lib/ws";
import { useSylva } from "./state/store";
import { Sidebar } from "./components/Sidebar";
import { MainPanel } from "./components/MainPanel";
import { StatusStrip } from "./components/StatusStrip";
import { TopBar } from "./components/TopBar";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
});

function Shell() {
  const qc = useQueryClient();

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
      <TopBar />
      <div className="shell-body">
        <Sidebar />
        <MainPanel />
      </div>
      <StatusStrip />
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
