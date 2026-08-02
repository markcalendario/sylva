# shared-git

## ADDED Requirements

### Requirement: A section per worktree
The Git tab SHALL show one section for each worktree the dryad tends, each
carrying that worktree's branch, upstream, divergence, staged/changed/untracked
groups, commit box, and its own pull and push. A single worktree SHALL render as
one section, indistinguishable from the panel before this change.

#### Scenario: Two worktrees
- **WHEN** the pane holds a shared dryad over two worktrees
- **THEN** both worktrees' changes are visible at once, each under its own branch, without any control that chooses between them

#### Scenario: One worktree
- **WHEN** the pane holds an ordinary worktree
- **THEN** the panel looks and behaves exactly as it did before shared panels existed

#### Scenario: A quiet worktree
- **WHEN** a member has nothing staged and nothing changed
- **THEN** its section starts collapsed, so the worktree that is actually moving is what you see

### Requirement: One diff pane
Selecting a file in any section SHALL show its diff in the panel's single diff
pane, identified by worktree, path and whether the staged or unstaged copy is
shown.

#### Scenario: The same path in two worktrees
- **WHEN** both worktrees contain `src/index.ts` and the user selects each in turn
- **THEN** each selection shows that worktree's own diff, and the pane names which worktree it belongs to

### Requirement: Commit across worktrees
When two or more members have staged files, the system SHALL offer a single
commit message that commits each of them, and SHALL report the outcome per
worktree. The operation SHALL NOT claim to be atomic.

#### Scenario: A coordinated change
- **WHEN** the user stages files in both worktrees, writes one message, and commits
- **THEN** a commit is made in each worktree with that message, and each is reported as landed

#### Scenario: One worktree rejects
- **WHEN** a commit hook fails in one worktree and succeeds in the other
- **THEN** the result names which worktree committed and which did not, and why

#### Scenario: Only one worktree staged
- **WHEN** only one member has staged files
- **THEN** the shared commit box is not offered, and that section's own commit box is used

### Requirement: Actions that span the circle
The toolbar SHALL offer pull, push and open-pull-requests across every member,
and SHALL report per-worktree results.

#### Scenario: Push all
- **WHEN** the user pushes all with one branch lacking an upstream
- **THEN** the branch with an upstream is pushed, and the other offers to set one rather than failing the whole action

### Requirement: History per worktree
The History view SHALL show one lane per worktree, each labelled with its
branch and base.

#### Scenario: Two branches
- **WHEN** the user opens History on a shared dryad
- **THEN** each worktree's divergence from its own base is drawn separately, without implying a relationship between the two histories
