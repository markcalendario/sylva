# file-search

## ADDED Requirements

### Requirement: Search files by name
The Browse view SHALL provide a search box that finds files in the focused worktree by name, matching anywhere in the worktree-relative path, and SHALL return results ranked so that closer matches come first.

#### Scenario: Finding a file by name
- **WHEN** the user types `gitpanel` in the Browse search box
- **THEN** `web/src/components/GitPanel.tsx` appears among the top results, case-insensitively

#### Scenario: Ranking
- **WHEN** several files match the query
- **THEN** exact name matches rank above prefix matches, which rank above substring matches, which rank above scattered-letter matches

#### Scenario: Searching by path fragment
- **WHEN** the user types `components/dial`
- **THEN** files under `web/src/components/dialogs/` are returned

### Requirement: Results open in the preview
Selecting a search result SHALL open that file in the Browse preview, exactly as selecting it in the tree does.

#### Scenario: Opening a result
- **WHEN** the user selects a search result
- **THEN** the file's contents render in the preview pane

#### Scenario: Clearing the search
- **WHEN** the user clears the search box
- **THEN** the folder tree returns with its expanded folders intact

### Requirement: Search excludes noise and stays bounded
Search SHALL skip the same directories the file watcher ignores — including `.git`, `node_modules`, `dist` and `build` — SHALL include untracked files, and SHALL bound both the directories it walks and the number of results it returns.

#### Scenario: node_modules
- **WHEN** the user searches for `index`
- **THEN** no results from `node_modules` are returned

#### Scenario: A file the agent just created
- **WHEN** an agent creates a new untracked file and the user searches for its name
- **THEN** it is found

#### Scenario: A very large worktree
- **WHEN** the user searches in a worktree with a very large file count
- **THEN** the search returns within a responsive time and reports that results were capped

### Requirement: Responsive typing
Search SHALL run as the user types, debounced, without blocking input, and SHALL show a distinct empty state when nothing matches.

#### Scenario: No matches
- **WHEN** the query matches no file
- **THEN** the panel says so rather than showing an empty list
