# workspace-panes

## ADDED Requirements

### Requirement: Two side-by-side panes
The system SHALL allow the main workspace area to be split into two panes, each holding its own worktree. One pane SHALL be the default and SHALL behave exactly as the current single-worktree view.

#### Scenario: Splitting
- **WHEN** the user splits the workspace
- **THEN** a second pane appears beside the first, and the first keeps its worktree, tab and scroll position

#### Scenario: Closing a pane
- **WHEN** the user closes one of two panes
- **THEN** the remaining pane takes the full width and becomes the active pane

#### Scenario: Old system and new system
- **WHEN** the user puts a worktree from one repository in the left pane and a worktree from a different repository in the right pane
- **THEN** both render fully and independently, each with its own branch header and tabs

### Requirement: Independent pane state
Each pane SHALL own its selected tab, its selected diff file, and its chat scroll position, and changing one SHALL NOT affect the other.

#### Scenario: Different tabs
- **WHEN** the left pane is on Agent and the user switches the right pane to Git
- **THEN** the left pane stays on Agent

#### Scenario: The same worktree in both panes
- **WHEN** the user opens the same worktree in both panes
- **THEN** both render it, share its live session and status, and keep their own tab selection

### Requirement: The active pane receives navigation
Exactly one pane SHALL be active at a time. Choosing a worktree from the sidebar or the forest map SHALL load it into the active pane. Clicking anywhere in a pane SHALL make it active.

#### Scenario: Sidebar click with two panes open
- **WHEN** the right pane is active and the user clicks a worktree in the sidebar
- **THEN** it opens in the right pane and the left pane is untouched

#### Scenario: Single pane
- **WHEN** only one pane is open and the user clicks a worktree in the sidebar
- **THEN** it opens in that pane, exactly as before this change

### Requirement: Every open worktree stays live
The system SHALL watch the filesystem of, and stream agent and git events for, every worktree held by a pane — not only the primary one.

#### Scenario: File changes in the non-primary pane
- **WHEN** an agent edits files in the worktree held by the second pane
- **THEN** that pane's Files feed and git status update live, without the user switching panes

#### Scenario: Reconnect
- **WHEN** the live connection drops and reconnects with two panes open
- **THEN** both panes' worktrees resume receiving events

### Requirement: Pane layout persists
The pane layout SHALL survive a page reload.

#### Scenario: Reload with two panes
- **WHEN** the user reloads the page with two worktrees open side by side
- **THEN** both panes come back with the same worktrees
