# git-essentials

## ADDED Requirements

### Requirement: Worktree status
The system SHALL report a worktree's git status (parsed from `git status --porcelain=v2 --branch`): staged, unstaged, and untracked files; current branch; and ahead/behind counts relative to its upstream.

#### Scenario: Status display
- **WHEN** the user focuses a worktree with staged, modified, and untracked files
- **THEN** the status panel groups files by state and shows branch name with ahead/behind counts

### Requirement: Diff viewer
The system SHALL show a unified diff for any changed file (worktree vs index, and index vs HEAD for staged files), rendered with added/removed line highlighting. Binary files SHALL be indicated as binary rather than rendered.

#### Scenario: Viewing a modified file
- **WHEN** the user clicks a modified file in the status panel
- **THEN** a diff of its unstaged changes renders with per-line add/remove coloring

### Requirement: Stage and unstage
The system SHALL stage (`git add`) and unstage (`git restore --staged`) individual files or all files in a worktree.

#### Scenario: Stage one file
- **WHEN** the user stages a modified file
- **THEN** it moves to the staged group and the diff viewer reflects the staged content

### Requirement: Commit
The system SHALL create a commit from staged changes with a user-provided message, rejecting empty messages and commits with nothing staged, and SHALL surface git hook failures verbatim.

#### Scenario: Successful commit
- **WHEN** the user commits staged changes with a message
- **THEN** the commit is created, the status panel clears the staged group, and the worktree's sprite plays its success animation

#### Scenario: Nothing staged
- **WHEN** the user attempts to commit with nothing staged
- **THEN** the commit button is disabled or the request is rejected with a clear message

### Requirement: Branch listing
The system SHALL list local branches of a repository with the current branch of each worktree indicated, and show which branches are checked out in which worktrees.

#### Scenario: Branch overview
- **WHEN** the user opens the branch list
- **THEN** branches checked out in worktrees are labeled with their worktree name

### Requirement: Push and pull
The system SHALL push and pull the focused worktree's branch to/from its upstream, showing progress and reporting errors (auth failures, non-fast-forward, no upstream) verbatim. When no upstream exists, push SHALL offer `--set-upstream origin <branch>`.

#### Scenario: Push with no upstream
- **WHEN** the user pushes a branch that has no upstream
- **THEN** the system offers to push with `--set-upstream origin <branch>` and does so on confirmation

### Requirement: Serialized git operations
The system SHALL serialize mutating git operations per worktree (queue) so concurrent actions (user commit while agent runs git) cannot interleave.

#### Scenario: Concurrent mutations
- **WHEN** two mutating git requests arrive for the same worktree at once
- **THEN** they execute sequentially and both report accurate results
