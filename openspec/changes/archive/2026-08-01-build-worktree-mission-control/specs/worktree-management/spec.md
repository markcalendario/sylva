# worktree-management

## ADDED Requirements

### Requirement: List worktrees
The system SHALL list all worktrees of a registered repository (parsed from `git worktree list --porcelain`), including path, checked-out branch or detached HEAD, and whether it is the main worktree.

#### Scenario: Repository with multiple worktrees
- **WHEN** the user selects a repo that has a main worktree and two linked worktrees
- **THEN** all three appear with their branch names, and the main worktree is visually distinguished

### Requirement: Create a worktree
The system SHALL create a new worktree for a registered repository via `git worktree add`, supporting both a new branch (from a chosen base ref) and an existing branch, with the worktree directory placed in a sibling directory named `<repo>-worktrees/<branch>` by default (user-overridable).

#### Scenario: New branch worktree
- **WHEN** the user creates a worktree with new branch `feature-x` based on `main`
- **THEN** a worktree exists at the target path with branch `feature-x` checked out, and it appears in the worktree list

#### Scenario: Branch already checked out elsewhere
- **WHEN** the user tries to create a worktree for a branch already checked out in another worktree
- **THEN** the system surfaces git's error clearly and creates nothing

### Requirement: Remove a worktree
The system SHALL remove a linked worktree via `git worktree remove`, requiring explicit confirmation, and SHALL require a second explicit "force" confirmation when the worktree has uncommitted changes. The main worktree MUST NOT be removable.

#### Scenario: Clean removal
- **WHEN** the user confirms removal of a clean worktree
- **THEN** the worktree directory is removed and it disappears from the list

#### Scenario: Dirty worktree
- **WHEN** the user attempts to remove a worktree with uncommitted changes
- **THEN** the system refuses unless the user explicitly confirms a forced removal

### Requirement: Focused worktree
The system SHALL track a single "focused" worktree selected by the user; switching focus updates the file watcher, git status panel, and agent panel to that worktree without any process restart.

#### Scenario: Switching focus
- **WHEN** the user clicks a different worktree in the sidebar
- **THEN** within one second the file tree, git status, and agent panel reflect the newly focused worktree
