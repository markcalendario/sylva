# runner

## ADDED Requirements

### Requirement: Configured run command
The system SHALL store a run command per repository, falling back to a global default of `npm run dev` when a repository has not set its own. Both SHALL be editable from the settings page and SHALL persist in `settings.json`.

#### Scenario: Default command
- **WHEN** the user opens the Run tab in a worktree of a repository with no configured command
- **THEN** the runner offers `npm run dev`

#### Scenario: Per-repository override
- **WHEN** the user sets a repository's run command to `pnpm dev --port 3001`
- **THEN** every worktree of that repository runs that command, and other repositories keep the default

### Requirement: One-click start
The system SHALL start the configured command as a child process in the focused worktree's directory when the user activates the Run control, and SHALL report the process as running with its pid and start time.

#### Scenario: Starting
- **WHEN** the user clicks Run in a worktree that has no runner going
- **THEN** the command starts with the worktree as its working directory and the control becomes a Stop control

#### Scenario: Already running
- **WHEN** the user activates Run in a worktree whose runner is already running
- **THEN** the request is rejected and the existing process is left untouched

### Requirement: Live output
The system SHALL capture the process's stdout and stderr, retain the most recent 2000 lines, and stream new output to the UI as it arrives. Output SHALL be preserved after the process exits so the user can read why it stopped.

#### Scenario: Streaming
- **WHEN** the running command writes to stdout
- **THEN** the Run tab appends the lines live and follows the bottom unless the user has scrolled up

#### Scenario: Reading history after a crash
- **WHEN** the command exits with a non-zero status
- **THEN** the Run tab reports the exit code and keeps the captured output visible

#### Scenario: Reopening the tab
- **WHEN** the user leaves the Run tab and comes back while the process is still running
- **THEN** the retained output is shown without restarting the process

### Requirement: Stop
The system SHALL stop a running command on request by terminating its whole process group, and SHALL stop every runner when the server shuts down.

#### Scenario: Stopping a dev server
- **WHEN** the user clicks Stop on a running `npm run dev`
- **THEN** the process and the children it spawned are terminated and the runner reports as stopped

#### Scenario: Server shutdown
- **WHEN** the Sylva server shuts down with runners active
- **THEN** each runner's process group is terminated before the process exits

### Requirement: Detected URL
The system SHALL scan runner output for a localhost URL and SHALL surface the most recently seen one as a link that opens in the browser.

#### Scenario: Vite dev server
- **WHEN** the output contains `➜  Local:   http://localhost:5173/`
- **THEN** the Run tab shows `http://localhost:5173/` as a clickable link

#### Scenario: No URL in output
- **WHEN** the command is a build or test that prints no URL
- **THEN** no link is shown and the output is displayed as normal

### Requirement: Runner independence from focus
A runner SHALL keep running when the user focuses a different worktree, switches views, or splits the workspace, and its state SHALL remain visible from that worktree's Run tab.

#### Scenario: Switching away
- **WHEN** the user starts a runner and then focuses a different worktree
- **THEN** the runner keeps running and the worktree it belongs to shows a running indicator
