# settings-page

## ADDED Requirements

### Requirement: Settings as a page
The system SHALL present settings as a full-page view in the main area rather than a modal dialog, reached from the nav bar, with a rail listing its sections: Appearance, Sound, Workflow, Runner, Agent defaults, Repositories, and About.

#### Scenario: Opening settings
- **WHEN** the user activates Settings in the nav bar
- **THEN** the main area shows the settings page with its section rail, and the sidebar stays visible

#### Scenario: Jumping to a section
- **WHEN** the user selects a section in the rail
- **THEN** the page scrolls to that section and the rail marks it as current

#### Scenario: Leaving settings
- **WHEN** the user leaves the settings page
- **THEN** the workspace returns with its panes, worktrees and tabs exactly as they were

### Requirement: Settings content
The page SHALL carry every setting the settings dialog carried — text size, sound and ambience, editor and terminal open targets, saved prompts, and the global agent defaults for model, effort and permission mode — and SHALL additionally carry the runner's default command and per-repository commands, and the list of registered repositories.

#### Scenario: Editing an agent default
- **WHEN** the user changes the default model on the settings page and saves
- **THEN** it applies to every worktree that has not overridden it, and running sessions that inherit the change restart while keeping their conversation

#### Scenario: Instant-apply settings
- **WHEN** the user changes text size or volume
- **THEN** the change applies immediately without a save step, as it does today

### Requirement: Unsaved changes are not lost silently
The page SHALL indicate when there are unsaved changes and SHALL ask for confirmation before navigating away from them.

#### Scenario: Navigating away mid-edit
- **WHEN** the user edits an agent default and then activates Forest without saving
- **THEN** a Sylva confirm dialog offers to discard or stay

### Requirement: Repositories section
The settings page SHALL list registered repositories with their paths and availability, and SHALL allow registering, creating and removing repositories from there.

#### Scenario: Removing from settings
- **WHEN** the user removes a repository from the settings page
- **THEN** a Sylva confirm dialog explains that the folder on disk is untouched, and on confirmation the repository is unregistered

### Requirement: The settings modal is retired
The system SHALL NOT present the former settings dialog. Per-worktree agent overrides SHALL remain available in place, next to the chat they affect.

#### Scenario: The nav bar gear
- **WHEN** the user activates the nav bar's settings control
- **THEN** the settings page opens and no modal appears
