# mission-control-ui

## ADDED Requirements

### Requirement: Application shell and navigation
The UI SHALL present a left sidebar of registered repos expandable into their worktrees, a main panel with tabs for the focused worktree (Agent, Files, Diff/Status), and a persistent status strip showing the focused worktree's branch, dirty count, and ahead/behind. The layout SHALL be usable at 1280 px wide and above.

#### Scenario: Navigating between worktrees
- **WHEN** the user expands a repo and clicks one of its worktrees
- **THEN** the main panel switches to that worktree's tabs and the status strip updates, preserving each panel's scroll state where practical

### Requirement: Sprite state visualization
Each worktree SHALL display a pixel-art sprite character whose animation encodes live state: idle when nothing is happening, working (e.g., typing) while an agent session is active, a brief celebration on successful commit or agent completion, and an alert/panic state on errors or merge conflicts. Sprites SHALL be rendered crisply (`image-rendering: pixelated`) and animated with CSS steps from sprite sheets.

#### Scenario: Agent starts working
- **WHEN** an agent turn begins in a worktree
- **THEN** that worktree's sprite switches to its working animation within one second, in the sidebar as well as the main panel

#### Scenario: State readable at a glance
- **WHEN** three worktrees have states idle, working, and error simultaneously
- **THEN** the three sprites are visibly distinct without reading any text

### Requirement: Agent chat panel
The agent panel SHALL render the conversation as a chat: user prompts, streaming assistant text, and collapsible tool-call entries showing tool name and target (e.g., file path), with a prompt input and Stop button while a turn is running.

#### Scenario: Streaming render
- **WHEN** the agent streams a long response
- **THEN** text appears incrementally, the view follows the bottom unless the user has scrolled up, and tool calls appear as discrete collapsible entries

### Requirement: New-task quick-start
The UI SHALL provide a prominent "New task" action that collects a task name, an initial prompt, and a base ref, then creates a worktree and starts an agent session in it as one flow, landing the user in the new worktree's agent panel.

#### Scenario: One-step task launch
- **WHEN** the user submits the New task dialog
- **THEN** a worktree is created, focus switches to it, and the agent begins working on the prompt without further clicks

#### Scenario: Partial failure
- **WHEN** worktree creation succeeds but the agent session fails to start
- **THEN** the UI reports exactly what succeeded and failed, and the created worktree remains usable

### Requirement: Agent completion notifications
The UI SHALL fire a browser notification when an agent turn completes or errors in an unfocused worktree or while the tab is hidden, after requesting Notification permission on first agent use.

#### Scenario: Background completion
- **WHEN** an agent finishes in an unfocused worktree
- **THEN** a browser notification names the worktree and outcome, and clicking it focuses that worktree

### Requirement: Visual design quality
The UI SHALL follow a cohesive visual system: a modern dark theme with an accent palette, consistent typography and spacing, and pixel-art accents (sprites, progress indicators) as personality — not a wall of default component-library styling. Interactive elements SHALL have hover/focus states, and loading/empty/error states SHALL be designed (empty states MAY feature the sprites).

#### Scenario: Empty state
- **WHEN** the user opens the app with no repositories registered
- **THEN** a designed welcome/empty state with a sprite and a clear "register a repo" call-to-action appears, not a blank panel

### Requirement: Connection resilience
The UI SHALL indicate when the WebSocket disconnects, attempt automatic reconnection with backoff, and resync state (git status, session transcript) on reconnect.

#### Scenario: Server restart
- **WHEN** the backend restarts while the UI is open
- **THEN** the UI shows a disconnected indicator, reconnects automatically, and restores current state without a manual page reload
