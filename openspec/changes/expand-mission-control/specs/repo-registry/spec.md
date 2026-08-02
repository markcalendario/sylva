# repo-registry

## ADDED Requirements

### Requirement: Create a new repository
The system SHALL create a brand-new git repository on disk from within Sylva, given a parent directory and a name, and SHALL register it immediately. The new repository SHALL be initialized with a default branch and an initial commit, so that worktrees can be created in it straight away.

#### Scenario: Creating a repository
- **WHEN** the user chooses a parent folder, enters a name, and confirms
- **THEN** the folder is created, initialized as a git repository with an initial commit, registered, and appears in the sidebar

#### Scenario: Ready for worktrees
- **WHEN** the user creates a new repository and immediately grows a worktree in it
- **THEN** the worktree is created successfully, because the repository's HEAD is not unborn

#### Scenario: Name already taken
- **WHEN** the target folder already exists
- **THEN** the request is rejected with a message naming the conflicting path, and nothing on disk is changed

#### Scenario: Invalid name
- **WHEN** the name is empty or contains a path separator
- **THEN** the request is rejected before anything is created

#### Scenario: Unwritable parent
- **WHEN** the parent directory cannot be written to
- **THEN** the failure is reported verbatim and no partial repository is left behind

### Requirement: Choosing between registering and creating
The repository dialog SHALL offer both registering an existing repository and creating a new one, with registering as the default.

#### Scenario: Switching modes
- **WHEN** the user switches the dialog to create mode
- **THEN** the folder browser selects a *parent* directory and a name field appears

## MODIFIED Requirements

### Requirement: Remove a repository
The system SHALL unregister a repository on request, leaving the folder on disk untouched, after confirming with the user through a Sylva dialog rather than a native browser confirm.

#### Scenario: Removing a repository
- **WHEN** the user removes a repository
- **THEN** a Sylva confirm dialog explains that the folder on disk is untouched, and on confirmation the repository is unregistered and disappears from the sidebar

#### Scenario: Declining
- **WHEN** the user declines the confirmation
- **THEN** the repository stays registered
