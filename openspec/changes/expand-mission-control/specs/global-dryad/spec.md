# global-dryad

## ADDED Requirements

### Requirement: A session bound to no worktree
The system SHALL provide a single agent session — the grove — that is not scoped to any worktree, reachable from the nav bar without focusing a worktree first. It SHALL run in a dedicated scratch workspace under Sylva's home directory, created on demand.

#### Scenario: Opening the grove with no repositories registered
- **WHEN** the user opens the grove on a fresh install
- **THEN** the chat is available and usable without requiring a repository or worktree

#### Scenario: Working directory
- **WHEN** the grove agent creates a file with a relative path
- **THEN** it lands in the grove's own scratch workspace, not in any registered repository

### Requirement: Awareness of registered repositories
The grove session SHALL be told the absolute path of every registered repository, so it can read and reason across all of them.

#### Scenario: Cross-repo question
- **WHEN** the user asks the grove to compare how two registered repositories handle authentication
- **THEN** the agent can locate and read both repositories without being given their paths in the prompt

#### Scenario: A repository registered mid-conversation
- **WHEN** the user registers a new repository while a grove session is open
- **THEN** the next turn includes the new repository in the paths the agent knows about

### Requirement: Full session behaviour
The grove SHALL support everything a worktree session supports — streaming output, tool-call display, permission requests, prompt queueing, interrupt, cost and token accounting, and a transcript that persists across server restarts.

#### Scenario: Permission request from the grove
- **WHEN** the grove agent asks to run a Bash command
- **THEN** the permission card appears in the grove's chat with Allow / Allow always this session / Deny, and the blocked-agent indicator in the nav bar counts it

#### Scenario: Resuming
- **WHEN** the server restarts and the user reopens the grove
- **THEN** the previous conversation is present and the next prompt continues it

### Requirement: Grove settings
The grove SHALL resolve its model, effort and permission mode from the global agent defaults, and SHALL accept its own overrides in the same way a worktree does.

#### Scenario: Overriding the grove's model
- **WHEN** the user sets a model override on the grove
- **THEN** the grove uses it and worktree sessions are unaffected

### Requirement: Separation from worktree sessions
The grove SHALL NOT appear as a worktree in the sidebar or on the forest map, SHALL NOT be focusable as a worktree, and SHALL NOT interfere with any worktree's session.

#### Scenario: Sidebar
- **WHEN** the user has an active grove session
- **THEN** no extra entry appears under any repository in the sidebar
