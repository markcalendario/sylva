# dialog-system

## ADDED Requirements

### Requirement: No native browser dialogs
The web application SHALL NOT call `alert()`, `confirm()` or `prompt()`. Every confirmation, warning and message SHALL be rendered by Sylva's own components.

#### Scenario: Removing a repository
- **WHEN** the user removes a repository from the sidebar
- **THEN** a Sylva confirm dialog appears, styled like the rest of the app, and the page behind it stays responsive

#### Scenario: Pushing a branch with no upstream
- **WHEN** the user pushes a branch that has no upstream
- **THEN** a Sylva confirm dialog offers to push with `--set-upstream origin <branch>`, and on confirmation the push proceeds

#### Scenario: Codebase check
- **WHEN** the web source is searched for `alert(`, `confirm(` or `prompt(` as global calls
- **THEN** no occurrences remain

### Requirement: A reusable confirm dialog
The system SHALL provide one confirm dialog usable from anywhere, taking a title, a body, a confirm label, and a tone that distinguishes destructive actions, and resolving to the user's answer.

#### Scenario: Destructive tone
- **WHEN** a confirm is raised for a destructive action
- **THEN** its confirm button is styled as destructive

#### Scenario: Dismissing
- **WHEN** the user presses Escape, clicks the backdrop, or activates Cancel
- **THEN** the dialog resolves as declined and nothing happens

#### Scenario: Focus
- **WHEN** a confirm dialog opens
- **THEN** focus moves into it, and returns to where it was when it closes

### Requirement: Consistent dialog spacing
All dialogs SHALL use one spacing scale for the gaps between their header, body sections, fields, hints and action row, so that no two dialogs space the same elements differently.

#### Scenario: Comparing dialogs
- **WHEN** the register-repo, new-worktree, remove-worktree, about and help dialogs are opened in turn
- **THEN** the header-to-body, field-to-field, and body-to-actions gaps are identical in each

#### Scenario: Fields with hints
- **WHEN** a dialog field carries a hint below its control
- **THEN** the hint sits closer to its own control than to the next field, in every dialog

### Requirement: Consistent dialog behaviour
All dialogs SHALL close on Escape and on backdrop click, SHALL place their primary action last in the action row, and SHALL disable rather than hide actions that are unavailable.

#### Scenario: Escape
- **WHEN** the user presses Escape in any dialog
- **THEN** it closes without applying changes
