# git-essentials

## ADDED Requirements

### Requirement: Rich commit records
Commits reported for the history view SHALL carry, in addition to their sha and subject: the full body, the author name and email with an absolute date, the committer name and email with an absolute date, and a diffstat of files changed with insertions and deletions.

#### Scenario: A commit with a body
- **WHEN** history includes a commit whose message has a body below its subject
- **THEN** the body is available for display, with its line breaks preserved

#### Scenario: Author differs from committer
- **WHEN** a commit was authored by one person and committed by another
- **THEN** both are reported separately

#### Scenario: Cost of the extra detail
- **WHEN** the history view loads
- **THEN** the additional detail is gathered without one git invocation per commit

### Requirement: Commit details on hover
The history view SHALL reveal a commit's full details in a hover card when the user hovers or focuses a commit row, without requiring navigation.

#### Scenario: Hovering a commit
- **WHEN** the user hovers a commit in the history view
- **THEN** a card shows the full subject and body, author and committer with dates, the full sha, and the files-changed/insertions/deletions summary

#### Scenario: Keyboard
- **WHEN** the user moves keyboard focus to a commit row
- **THEN** the same card appears

#### Scenario: Staying on screen
- **WHEN** the hovered commit is near the edge of the viewport
- **THEN** the card is positioned so it stays fully visible

#### Scenario: A commit with no body
- **WHEN** the commit message is a subject only
- **THEN** the card omits the body section rather than showing an empty one

## MODIFIED Requirements

### Requirement: Push and pull
The system SHALL push and pull the focused worktree's branch to/from its upstream, showing progress and reporting errors (auth failures, non-fast-forward, no upstream) verbatim. When no upstream exists, push SHALL offer `--set-upstream origin <branch>` through a Sylva confirm dialog rather than a native browser confirm.

#### Scenario: Push with no upstream
- **WHEN** the user pushes a branch that has no upstream
- **THEN** a Sylva confirm dialog offers to push with `--set-upstream origin <branch>`, and does so on confirmation

#### Scenario: Declining the upstream offer
- **WHEN** the user declines
- **THEN** nothing is pushed and the panel reports that the branch has no upstream

### Requirement: Git panel layout
The Git tab SHALL present its controls in a deliberate structure: a toolbar carrying the branch, its divergence from base, and the pull/push/PR actions; a segmented control choosing between Changes and History; grouped file lists for staged, changed and untracked files; a commit box that stays reachable while the file lists scroll; and a diff pane with its own header naming the file and whether the staged or unstaged copy is shown.

#### Scenario: Many changed files
- **WHEN** a worktree has more changed files than fit on screen
- **THEN** the file lists scroll while the commit box and toolbar stay reachable

#### Scenario: Clean worktree
- **WHEN** there is nothing to commit
- **THEN** the panel says so, and the commit box is not shown

#### Scenario: Selecting a file
- **WHEN** the user selects a file in any group
- **THEN** the diff pane shows it, headed by its path and whether the staged or unstaged copy is displayed
