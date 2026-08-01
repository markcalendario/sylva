# agent-sessions Specification

## Purpose
TBD - created by archiving change build-worktree-mission-control. Update Purpose after archive.
## Requirements
### Requirement: Start an agent session in a worktree
The system SHALL start a Claude Agent SDK session with its working directory set to a chosen worktree. At most one active session per worktree SHALL be allowed; starting a session where one is active MUST be rejected.

#### Scenario: Session start
- **WHEN** the user sends the first prompt from a worktree's agent panel
- **THEN** a session is created with `cwd` set to that worktree's path and the prompt is dispatched to the agent

#### Scenario: Second concurrent session in same worktree
- **WHEN** the user attempts to start a session in a worktree that already has an active session
- **THEN** the system rejects it and directs the user to the existing session

### Requirement: Stream agent output in real time
The system SHALL stream the agent's assistant text, tool invocations (with tool name and key inputs such as file paths), tool results, and final result over the WebSocket as typed events, rendered incrementally in the UI.

#### Scenario: Agent edits a file
- **WHEN** the agent invokes an Edit/Write tool on a file
- **THEN** the UI shows a tool-use entry naming the tool and the file path before the tool result arrives

#### Scenario: Turn completion
- **WHEN** the agent finishes a turn
- **THEN** the UI shows the final result state (success or error) and total cost/duration if the SDK reports them

### Requirement: Prompt an active session
The system SHALL accept follow-up prompts on an active session, preserving conversation context across turns within that session.

#### Scenario: Follow-up prompt
- **WHEN** the user sends a second prompt referencing the first ("now add tests for that")
- **THEN** the agent responds with the prior turn's context intact

### Requirement: Interrupt a session
The system SHALL allow the user to interrupt a running agent turn; the session remains usable for further prompts afterward.

#### Scenario: Stop button
- **WHEN** the user clicks Stop while the agent is working
- **THEN** the current turn halts, the UI marks it interrupted, and a new prompt can be sent

### Requirement: Tool-permission approvals
The system SHALL route agent tool-permission requests (via the SDK's `canUseTool` callback) to the UI as permission-request events and SHALL block the tool call until the user answers Allow, Allow-always-for-this-session, or Deny. Per-session "always allow" rules SHALL auto-approve subsequent requests for the same tool. Requests unanswered after a timeout SHALL resolve as denied.

#### Scenario: Bash command approval
- **WHEN** the agent requests to run a Bash command
- **THEN** an approval card appears inline in the chat showing the command, and the agent proceeds only after the user allows it

#### Scenario: Always allow
- **WHEN** the user answers "Allow always this session" for a tool
- **THEN** subsequent requests for that tool in the same session are approved without prompting

#### Scenario: Unanswered request
- **WHEN** a permission request receives no answer within the timeout
- **THEN** it resolves as denied and the session continues rather than hanging

### Requirement: Prompt queueing
The system SHALL queue prompts submitted while a turn is running and dispatch them in order when the current turn completes. The UI SHALL show queued prompts as pending and allow removing a queued prompt before dispatch.

#### Scenario: Queued follow-up
- **WHEN** the user submits a prompt while the agent is mid-turn
- **THEN** the prompt appears as queued and is sent automatically when the turn finishes

### Requirement: Session cost display
The system SHALL accumulate token usage and cost reported by the SDK's result messages and display per-session totals in the agent panel.

#### Scenario: Cost after a turn
- **WHEN** a turn completes
- **THEN** the session's cumulative token count and cost update in the panel header

### Requirement: Session resume across server restarts
The system SHALL persist each session's SDK session ID and SHALL resume the session (via the SDK resume option) when the next prompt arrives after a server restart, preserving conversation context.

#### Scenario: Backend restart mid-conversation
- **WHEN** the server restarts and the user sends a follow-up prompt in an existing session
- **THEN** the agent responds with prior conversation context intact

### Requirement: Transcript persistence
The system SHALL append every session event to a JSONL transcript on disk (`~/.sylva/sessions/<id>.jsonl`) and SHALL replay the transcript into the UI when the page reloads while a session exists.

#### Scenario: Page reload during a session
- **WHEN** the user reloads the browser while an agent is mid-turn
- **THEN** the UI restores the conversation history and continues streaming live events

### Requirement: Agent unavailability handling
The system SHALL detect when the Agent SDK cannot run (missing credentials or SDK error at startup) and present a clear setup message; all non-agent features MUST remain functional.

#### Scenario: No credentials
- **WHEN** the SDK fails due to missing authentication
- **THEN** the agent panel shows setup instructions instead of a spinner, and worktree/git features still work

