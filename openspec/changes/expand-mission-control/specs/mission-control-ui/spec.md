# mission-control-ui

## ADDED Requirements

### Requirement: Navigation bar
The nav bar SHALL be organized into three deliberate zones: identity and place on the left (the wordmark, and where you currently are), destinations in the middle (Forest, the grove, Settings), and live state on the right (agents waiting on a decision, sound, connection status). Controls SHALL be grouped by what they do rather than by the order they were added, and every control SHALL carry a tooltip saying what it does.

#### Scenario: Knowing where you are
- **WHEN** a worktree is open
- **THEN** the nav bar names the repository and branch, and offers a way back to the forest

#### Scenario: Blocked agents
- **WHEN** one or more agents are waiting on a permission decision
- **THEN** the nav bar shows a live count in the state zone and activating it takes the user to the first one

#### Scenario: Reaching the grove
- **WHEN** the user activates the grove control
- **THEN** the global dryad chat opens without changing which worktrees the panes hold

#### Scenario: Narrow window
- **WHEN** the window is too narrow for every label
- **THEN** controls collapse to their glyphs, keeping their tooltips, rather than wrapping or overflowing

### Requirement: Chat header
The Agent tab SHALL carry a header that states, in one row: which dryad you are talking to and its current state, the model and effort the session is running under, what the session has cost in money and tokens, and the controls that act on the session — per-worktree agent settings, and a way to open the worktree in an editor or terminal.

#### Scenario: Reading the session at a glance
- **WHEN** the user opens the Agent tab on a worktree with an active session
- **THEN** the header shows the branch, the state, the model, and the running cost without the user hovering anything

#### Scenario: Idle worktree
- **WHEN** no session has been started in a worktree
- **THEN** the header shows the branch and an idle state, with cost and model shown as not yet applicable rather than as zero-valued clutter

#### Scenario: Running
- **WHEN** a turn is in flight
- **THEN** the header shows the working state and offers the interrupt control

### Requirement: The Run tab
The worktree tab strip SHALL include a Run tab beside Agent, Files and Git, and SHALL indicate when that worktree's runner is running.

#### Scenario: Running indicator
- **WHEN** a worktree's runner is running and the user is on another tab
- **THEN** the Run tab carries an indicator

## MODIFIED Requirements

### Requirement: Main area views
The main area SHALL show one of: the workspace (one or two worktree panes, or the forest when no worktree is held), the settings page, or the grove. Switching between them SHALL preserve the state of the others.

#### Scenario: Returning from settings
- **WHEN** the user opens settings and then returns to the workspace
- **THEN** the panes, their worktrees, their tabs and their scroll positions are as they were

#### Scenario: First run
- **WHEN** no repository has been registered
- **THEN** the workspace shows the landing view, as it does today

### Requirement: Worktree panel
The worktree panel SHALL show a header naming the branch and its divergence from base with the dryad's state, and a tab strip choosing between Agent, Files, Git and Run. It SHALL render identically whether it is the only pane or one of two.

#### Scenario: In a split
- **WHEN** two panes are open
- **THEN** each renders its own complete header and tab strip, and neither is degraded relative to the single-pane layout
