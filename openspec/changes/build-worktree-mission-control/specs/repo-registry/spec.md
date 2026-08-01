# repo-registry

## ADDED Requirements

### Requirement: Register a repository
The system SHALL allow the user to register a local git repository by absolute path, validating that the path exists and is a git repository (has a `.git` directory or file) before accepting it.

#### Scenario: Successful registration
- **WHEN** the user submits a valid path to a git repository
- **THEN** the repository is added to the registry with an ID, display name (defaulting to the directory name), and path, and appears in the repo list

#### Scenario: Path is not a git repository
- **WHEN** the user submits a path that exists but is not a git repository
- **THEN** the system rejects the registration with a clear error and the registry is unchanged

#### Scenario: Duplicate registration
- **WHEN** the user submits a path already present in the registry
- **THEN** the system rejects it as a duplicate and points to the existing entry

### Requirement: List registered repositories
The system SHALL list all registered repositories with their ID, display name, path, and current availability (path still exists on disk).

#### Scenario: Repository directory was deleted
- **WHEN** a registered repository's path no longer exists on disk
- **THEN** the repository is listed in an "unavailable" state rather than being silently dropped

### Requirement: Remove a repository from the registry
The system SHALL allow the user to remove a repository from the registry without touching the repository on disk.

#### Scenario: Removal
- **WHEN** the user removes a registered repository
- **THEN** the entry disappears from the registry and no files inside the repository are modified or deleted

### Requirement: Registry persistence
The registry SHALL persist to a JSON file under the user's home config directory (`~/.sylva/registry.json`) and be reloaded on server start.

#### Scenario: Server restart
- **WHEN** the server restarts
- **THEN** previously registered repositories are present without re-registration

### Requirement: Server-side path validation
The server SHALL only execute git and filesystem operations against paths belonging to registered repositories (or their registered worktrees); API clients reference repositories by registry ID, never by arbitrary absolute path.

#### Scenario: Operation on unregistered path
- **WHEN** an API request references a repo ID not in the registry
- **THEN** the server responds with a not-found error and executes nothing

### Requirement: Origin and Host validation
The server SHALL reject REST requests and WebSocket upgrades whose Origin header is present but does not match the app's own origin, and SHALL reject non-localhost Host headers.

#### Scenario: Cross-origin request from another website
- **WHEN** a request arrives with an Origin belonging to a foreign website
- **THEN** the server rejects it with a forbidden error and executes nothing
