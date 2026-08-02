# shared-runner

## ADDED Requirements

### Requirement: A control row per worktree
The Run tab SHALL show one control row for each worktree the dryad tends,
carrying its command, start/stop control, status, exit code and detected URL.

#### Scenario: Two projects
- **WHEN** the pane holds a shared dryad over two worktrees
- **THEN** each worktree's command can be started and stopped independently from the same tab

#### Scenario: No command configured
- **WHEN** a member has no run command
- **THEN** its row says so rather than being omitted, because a missing dev server is usually an oversight

### Requirement: One merged log
Output from every member SHALL appear in a single log ordered by when each line
was produced, with each line identifying the worktree it came from. A single
worktree SHALL show no such identifier.

#### Scenario: Both booting
- **WHEN** two dev servers start together and one fails
- **THEN** the failure appears in sequence with the other's output, attributed to its worktree, without the user correlating two scrolling panes

#### Scenario: Following the tail
- **WHEN** output arrives while the user is scrolled to the bottom
- **THEN** the log keeps following, and stops following as soon as the user scrolls up

### Requirement: Run all and stop all
The system SHALL start every member's configured command, and stop every
running one, in a single action.

#### Scenario: Starting a migration
- **WHEN** the user runs all with two worktrees configured
- **THEN** both commands start, and each row reports its own state

#### Scenario: Stopping everything
- **WHEN** the user stops all
- **THEN** every running command and the processes it started are terminated
