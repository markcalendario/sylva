# file-activity

## ADDED Requirements

### Requirement: Watch the focused worktree
The system SHALL watch the focused worktree's filesystem and stream file add, change, and delete events to the UI over the WebSocket. Watching SHALL also cover any worktree with an active agent session, even when unfocused. Watchers MUST ignore `.git/`, `node_modules/`, and other heavy or gitignored paths.

#### Scenario: Agent creates a file
- **WHEN** an agent session writes a new file in the focused worktree
- **THEN** the file appears in the UI's file activity view within two seconds, marked as added

#### Scenario: Background agent activity
- **WHEN** an agent modifies files in an unfocused worktree with an active session
- **THEN** that worktree's sidebar entry shows activity (sprite/badge) without switching the user's focus

### Requirement: Event batching
The system SHALL debounce and batch file events (on the order of 100 ms) so bulk operations (e.g., `npm install`, branch switches) do not flood the UI.

#### Scenario: Bulk change
- **WHEN** hundreds of files change within a second
- **THEN** the UI receives batched summaries rather than one message per file, and remains responsive

### Requirement: Recent activity feed
The UI SHALL show a chronological feed of recent file events for the focused worktree, each entry showing path, change type, and timestamp, with newest first.

#### Scenario: Reviewing what an agent touched
- **WHEN** the user opens the activity feed after an agent turn
- **THEN** the files touched during the turn are listed newest-first and clicking one opens its diff

### Requirement: Git status refresh on changes
The system SHALL refresh the focused worktree's git status after a file-event batch and push the updated status over the WebSocket.

#### Scenario: Status stays fresh
- **WHEN** files change on disk by any means (agent, editor, terminal)
- **THEN** the dirty-file count and status panel update without manual refresh
