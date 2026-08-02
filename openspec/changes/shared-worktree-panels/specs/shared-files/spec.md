# shared-files

## ADDED Requirements

### Requirement: One change feed
The Changes view SHALL merge the file activity of every worktree the dryad
tends into a single feed, newest first, with each row naming the worktree it
came from. A single worktree SHALL show no such label.

#### Scenario: Both systems moving
- **WHEN** the dryad edits files in two worktrees during one turn
- **THEN** all of the changes appear in one feed in the order they happened, each labelled with its worktree

#### Scenario: Opening a diff from the feed
- **WHEN** the user opens a changed file from the merged feed
- **THEN** the Git tab shows that file's diff in the worktree it actually belongs to

### Requirement: One browse tree
The Browse view SHALL present a root whose top level is the member worktrees,
each expanding into its own file tree. With a single member the root SHALL be
skipped entirely.

#### Scenario: Browsing a shared dryad
- **WHEN** the user opens Browse on a circle
- **THEN** each worktree appears as a top-level entry and expands into its own contents

#### Scenario: Browsing one worktree
- **WHEN** the pane holds an ordinary worktree
- **THEN** the tree begins at that worktree's own root, with no extra level to click through

### Requirement: Search across the circle
Name search and text search SHALL run across every member and group results by
worktree, each group reporting its own truncation.

#### Scenario: A name in both worktrees
- **WHEN** the user searches for a file name that exists in both
- **THEN** both are listed, grouped by worktree, rather than one silently winning

#### Scenario: Capped in one worktree
- **WHEN** one worktree returns more matches than the cap and the other does not
- **THEN** only that worktree's group says its results were capped
