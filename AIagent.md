# AI AGENT PROJECT — COMPLETE SYSTEM SPECIFICATION

I want you to help me build a **real AI Agent system**, not a simple automation workflow or fixed AI pipeline.

The goal is to build a local, modular, tool-using AI agent that can interact with Instagram through browser automation, analyze collected data using a local LLM, store results, and display them in a dashboard.

The entire system should be designed as an **AI Agent architecture** using:

- Local LLM
- Ollama
- Agent Harness / Agent Runtime
- MCP Client
- Custom MCP Server
- Playwright
- Node.js
- MongoDB
- React Dashboard

The system should primarily run on my **local laptop** and avoid paid LLM APIs wherever practical.

---

# 1. MAIN GOAL

The main goal is to build an AI Agent that receives a **natural-language goal from the user**, decides what actions are required, selects appropriate tools, executes those tools, observes their results, decides what to do next, and stops when the goal is completed.

Example user request:

> "Check my latest Instagram posts, collect their comments, identify negative comments, summarize the important complaints, save the results, and show them on my dashboard."

The system should NOT simply execute a hardcoded sequence like:

`collect → analyze → save`

Instead, it should behave like an agent:

`Goal → Understand goal → Plan → Choose tool → Execute tool → Observe result → Evaluate result → Decide next action → Execute another tool if necessary → Repeat → Determine goal completion → Return result`

The agent should be able to change its next action based on the result of the previous action.

---

# 2. IMPORTANT: AGENT VS WORKFLOW

This distinction is extremely important.

I do NOT want to build only a fixed workflow.

A fixed workflow would look like:

`Playwright → Get comments → LLM → Analyze comments → MongoDB → Dashboard`

That is an automation pipeline/workflow.

I want an **AI Agent**.

The AI Agent should have:

- A goal
- Context
- Tools
- Tool selection
- Planning
- Execution loop
- Observation
- State
- Memory
- Validation
- Error handling
- Retry mechanism
- Stop conditions
- Permission controls

The LLM should be able to decide which available tool should be used next based on the current state and goal.

---

# 3. HIGH-LEVEL ARCHITECTURE

The overall architecture should be:

```text
                         USER
                           │
                           ▼
                    React Dashboard
                           │
                           ▼
                       Agent API
                           │
                           ▼
                 ┌─────────────────────┐
                 │   AGENT HARNESS     │
                 │                     │
                 │ Goal Manager        │
                 │ State Manager       │
                 │ Planner             │
                 │ Tool Controller     │
                 │ Validator           │
                 │ Retry Manager       │
                 │ Permission Manager  │
                 │ Agent Loop          │
                 └──────────┬──────────┘
                            │
                            ▼
                      Local LLM
                       Ollama
                            │
                            ▼
                       MCP Client
                            │
                            ▼
                      MCP Server
                            │
            ┌───────────────┼─────────────────┐
            │               │                 │
            ▼               ▼                 ▼
       Playwright        MongoDB         Other Tools
            │
            ▼
        Instagram
```

---

# 4. LOCAL LLM

The LLM should run locally using **Ollama**.

I do NOT want the core architecture to depend on OpenAI/Claude API or another paid API.

The LLM should be responsible for:

- Understanding natural-language user requests
- Reasoning about the current goal
- Creating plans
- Selecting tools
- Generating tool arguments
- Understanding tool results
- Deciding the next action
- Classifying comments
- Detecting sentiment
- Generating summaries
- Producing final responses

The exact model should be selected according to the laptop's available RAM/CPU/GPU.

Do not assume a very large model.

Design the system so the model can be changed later without changing the rest of the architecture.

Example:

`Ollama → Qwen / Llama / another suitable local model`

The LLM layer should be abstracted.

---

# 5. AGENT HARNESS

The Harness is one of the most important parts of this project.

The Harness should act as the **agent runtime/controller**.

It should NOT itself be the LLM.

Its responsibilities should include:

## Goal management

Receive:

`User Goal`

and maintain the goal throughout the task.

## State management

Maintain information such as:

```json
{
  "goal": "...",
  "status": "running",
  "current_step": "...",
  "completed_actions": [],
  "tool_results": [],
  "errors": [],
  "remaining_work": []
}
```

## Agent loop

The core loop should look like:

`Receive Goal → Load Context → Ask LLM what action should be taken → Validate decision → Execute tool → Receive result → Update state → Give result back to LLM → Ask what to do next → Repeat`

The loop should stop when:

- Goal completed
- Agent cannot safely continue
- Human approval required
- Maximum iterations reached

---

# 6. MCP

Use MCP as the **standardized tool communication layer** between the agent and external tools.

The MCP server should expose tools.

Possible tools include:

```text
instagram_get_posts
instagram_get_comments
instagram_get_post_details

browser_open
browser_extract

database_save
database_search

analyze_sentiment
generate_summary
```

Do not put all business logic directly into the LLM.

The LLM should call tools through the agent/harness and MCP layer.

---

# 7. CUSTOM MCP SERVER

I want to build my own MCP server.

The MCP server will act as a gateway to the tools available to the agent.

Conceptually:

```text
Agent / Harness
       ↓
   MCP Client
       ↓
   MCP Server
       ↓
      Tools
```

The MCP server should expose strongly typed tools with:

- Tool name
- Description
- Input schema
- Output schema
- Validation
- Errors

For example:

`instagram_get_comments`

Input:

```json
{
  "postId": "123"
}
```

Output:

```json
{
  "comments": [
    {
      "id": "...",
      "text": "...",
      "author": "...",
      "timestamp": "..."
    }
  ]
}
```

---

# 8. PLAYWRIGHT

Playwright will be used as the browser automation layer.

Conceptually:

```text
MCP Tool
   ↓
Playwright
   ↓
Browser
   ↓
Instagram
```

Playwright should be responsible for browser interaction/data extraction, not agent reasoning.

The browser session should be handled securely.

For account-specific/private information, the browser needs an authenticated session.

Do NOT hardcode passwords or sensitive cookies into source code.

Use secure local session/state handling.

Do not implement CAPTCHA bypassing, anti-bot bypassing, rate-limit bypassing, or other access-control circumvention.

The automation should remain within authorized use and applicable platform rules.

---

# 9. INSTAGRAM DATA

The initial use case is:

- Get Instagram posts accessible to the authenticated account
- Get comments
- Collect comment text
- Analyze comments
- Detect sentiment
- Identify negative comments
- Identify important complaints
- Store results
- Display them on the dashboard

Example raw data:

```json
[
  {
    "postId": "123",
    "commentId": "1",
    "text": "Amazing product"
  },
  {
    "postId": "123",
    "commentId": "2",
    "text": "Worst service ever"
  },
  {
    "postId": "123",
    "commentId": "3",
    "text": "Delivery was very late"
  }
]
```

---

# 10. LOCAL LLM ANALYSIS

The local LLM should analyze comments.

For each comment, determine:

`positive / negative / neutral`

Also generate:

- Confidence
- Reason
- Complaint category if applicable
- Severity if applicable

Example:

```json
{
  "comment": "Delivery was very late",
  "sentiment": "negative",
  "confidence": 0.94,
  "reason": "The user is complaining about delayed delivery.",
  "category": "delivery",
  "severity": "medium"
}
```

The system should support:

- English
- Roman Urdu
- Mixed-language comments
- Informal language
- Sarcasm where possible

But do not assume the LLM is always correct.

Use confidence and validation.

---

# 11. HUMAN REVIEW

If confidence is low, the agent should be able to flag the result.

Example:

```text
confidence >= 0.80
    ↓
automatic classification

confidence < 0.80
    ↓
human review
```

This should be configurable.

---

# 12. AGENT MEMORY

The system should have memory.

## Short-term memory

Current task state:

`Goal / Current action / Previous actions / Tool results / Errors / Remaining work`

## Long-term/application memory

MongoDB can store:

`Users / Agent sessions / Agent tasks / Instagram posts / Comments / Analysis results / Agent history`

The architecture should allow memory to be expanded later.

---

# 13. TOOL REGISTRY

The Harness should maintain a registry of available tools.

Example:

```text
Instagram Tools
 ├── get_posts
 ├── get_comments
 └── get_post_details

Browser Tools
 ├── open_page
 └── extract_data

Database Tools
 ├── save
 ├── search
 └── update

Analysis Tools
 ├── sentiment
 └── summarize
```

The LLM should only see tools that are actually available and permitted.

---

# 14. TOOL PERMISSIONS

The Harness should control which tools the agent can use.

For example:

```text
Read tools:
  get_posts
  get_comments

Write tools:
  save_database

Sensitive actions:
  like
  comment
  delete
  send
```

Sensitive/write actions should optionally require human approval.

The architecture must make this permission layer explicit.

---

# 15. EXAMPLE AGENT TASK

User says:

> "Check my latest Instagram posts and find negative comments. Group them by complaint type and show me the most serious complaints."

The agent should NOT have a hardcoded sequence.

Instead:

```text
Goal
 ↓
LLM understands goal
 ↓
Agent checks available tools
 ↓
Decides it needs Instagram posts
 ↓
Calls get_posts
 ↓
Observes result
 ↓
Decides it needs comments
 ↓
Calls get_comments
 ↓
Observes result
 ↓
Decides it needs sentiment analysis
 ↓
Calls analysis capability / LLM
 ↓
Finds negative comments
 ↓
Groups complaints
 ↓
Determines severity
 ↓
Stores results
 ↓
Returns dashboard result
```

If there are 2,000 comments, the agent should be able to reason about batching.

If a tool fails, the agent should handle the failure.

If the LLM output is malformed, the Harness should validate/retry.

If the task is already complete, the agent should stop.

---

# 16. AGENT LOOP MUST BE DYNAMIC

Do NOT implement only:

```javascript
await getPosts();
await getComments();
await analyze();
await save();
```

Instead implement something conceptually like:

```text
while (!goalCompleted) {

    context = getCurrentState();

    decision = LLM.decide(context, availableTools);

    validate(decision);

    result = executeTool(decision);

    updateState(result);

    if (requiresHumanApproval) {
        pause();
    }
}
```

The actual implementation should be production-quality, typed, validated, observable, and safe.

---

# 17. DATABASE

Use MongoDB.

Suggested collections:

```text
users
agent_sessions
agent_tasks
agent_steps
instagram_posts
instagram_comments
comment_analysis
agent_memory
```

Example comment-analysis document:

```json
{
  "postId": "...",
  "commentId": "...",
  "text": "...",
  "sentiment": "negative",
  "confidence": 0.91,
  "category": "delivery",
  "severity": "high",
  "analyzedAt": "..."
}
```

---

# 18. BACKEND

Use Node.js.

The backend should provide:

```text
POST /agent/tasks
GET  /agent/tasks/:id
GET  /agent/tasks/:id/status
GET  /agent/tasks/:id/steps
GET  /instagram/posts
GET  /instagram/comments
GET  /analytics
```

The backend should communicate with:

- Agent Harness
- MongoDB
- MCP layer
- Dashboard

Keep responsibilities separated.

---

# 19. DASHBOARD

Use React.

The dashboard should contain:

## Agent input

```text
┌─────────────────────────────────────┐
│ What should I do?                   │
│                                     │
│ Find negative comments from latest  │
│ Instagram posts                     │
│                                     │
│             [Run Agent]             │
└─────────────────────────────────────┘
```

## Agent status

```text
Agent Status: Running

Goal:
Find negative comments

Current Action:
Analyzing comments

Progress:
320 / 500 comments
```

## Agent activity

```text
✓ Posts retrieved
✓ Comments retrieved
✓ Sentiment analysis completed
→ Grouping complaints
```

## Results

```text
Positive: 320
Negative: 120
Neutral: 60

Top complaints:

1. Delivery
2. Product quality
3. Customer service
```

---

# 20. REAL-TIME AGENT EVENTS

The dashboard should receive live agent updates.

Use either:

- WebSocket
- Server-Sent Events

Example:

```text
Agent started
Tool selected: instagram_get_posts
Tool completed
500 comments found
Analysis started
Analysis completed
Database updated
Agent completed
```

---

# 21. ERROR HANDLING

The agent must handle:

## Playwright failure

```text
Browser failed
 ↓
Harness detects failure
 ↓
Retry / recover
```

## Tool failure

```text
MCP tool failed
 ↓
Return structured error
 ↓
LLM decides whether to retry
```

## Invalid LLM output

```text
Invalid JSON
 ↓
Validator
 ↓
Retry with correction
```

## Timeout

```text
Tool timeout
 ↓
Harness stops/retries
```

## Goal impossible

Agent should explain why instead of endlessly retrying.

---

# 22. OBSERVABILITY

Every agent execution should be logged.

Example:

```text
Task ID
Goal
Timestamp
LLM decision
Tool called
Tool arguments
Tool result
Execution time
Error
Retry count
Final status
```

This is important for debugging the agent.

---

# 23. SECURITY

Do not expose unrestricted tools to the LLM.

Implement:

- Tool permissions
- Input validation
- Output validation
- Authentication
- Secure session handling
- Secret management
- Rate limiting
- Maximum agent iterations
- Tool timeouts
- Human approval for sensitive actions

Never put:

`Instagram password / session cookies / API secrets`

directly into prompts or source code.

---

# 24. PROJECT DEVELOPMENT ORDER

Build this incrementally.

## Phase 1 — Local LLM

```text
Node.js
 ↓
Ollama
 ↓
Model
```

Make sure local LLM works.

## Phase 2 — Basic Agent Loop

```text
Goal
 ↓
LLM
 ↓
Decision
 ↓
Result
```

## Phase 3 — Tools

Start with simple tools:

- Calculator
- Database
- Test tool

Do not start with Instagram immediately.

## Phase 4 — MCP Server

Build the custom MCP server and expose tools through MCP.

## Phase 5 — Harness + MCP

Connect the Harness to MCP:

```text
LLM
 ↓
Harness
 ↓
MCP
 ↓
Tool
```

## Phase 6 — Playwright

Add browser tools.

## Phase 7 — Authorized Instagram Session

Connect the authorized browser session.

## Phase 8 — MongoDB

Add persistent storage.

## Phase 9 — React Dashboard

Build the dashboard.

## Phase 10 — Real-Time Events

Add WebSocket or SSE.

## Phase 11 — Memory

Add short-term and long-term memory.

## Phase 12 — Reliability

Add:

- Validation
- Retries
- Permissions
- Observability
- Timeouts
- Human approval
- Security controls

---

# 25. FINAL TARGET

The final system should look like:

```text
                         USER
                           │
                           ▼
                      DASHBOARD
                           │
                           ▼
                        BACKEND
                           │
                           ▼
                     AGENT HARNESS
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
         LOCAL LLM                  AGENT STATE
          Ollama                    + Memory
              │
              ▼
          MCP CLIENT
              │
              ▼
          MCP SERVER
              │
      ┌───────┼────────┐
      │       │        │
      ▼       ▼        ▼
 Playwright MongoDB  Analysis
      │
      ▼
 Instagram
```

The key principles are:

```text
LLM = Brain / reasoning

Harness = Agent runtime / controller

MCP = Standardized tool communication

MCP Server = Tool gateway

Playwright = Browser automation

Backend = Application/API layer

MongoDB = Data + memory

React = User interface
```

---

# 26. ARCHITECTURAL CLARIFICATIONS

Please follow these principles while implementing.

## LLM should not directly execute arbitrary tools

The Harness should own:

- Tool permissions
- Tool validation
- State
- Retries
- Iteration limits
- Stop conditions
- Human approval

The LLM proposes an action; the Harness validates and executes it.

## Keep LLM and tool execution separate

The LLM is the reasoning layer.

MCP/Tools are capability layers.

Playwright is the browser automation implementation.

MongoDB is storage.

## Do not make sentiment analysis a mandatory fixed pipeline step

The LLM can analyze comments itself when appropriate.

For example:

```text
MCP:
  get_posts
  get_comments
  database_save
```

Then:

```text
LLM
 ↓
Get comments
 ↓
Analyze comments
 ↓
Decide next action
```

A dedicated `analyze_sentiment` tool may be added later if useful, but it should not turn the whole system into a fixed pipeline.

---

# 27. WHAT I WANT FROM YOU

I want you to **build this project with me step-by-step**, not just give theoretical explanations.

Before writing large amounts of code:

1. Analyze the architecture.
2. Identify missing components.
3. Create the project structure.
4. Explain the responsibility of each module.
5. Implement one phase at a time.
6. Test each phase before moving to the next.
7. Keep the architecture modular so the local LLM can later be replaced by another model.
8. Keep MCP, Harness, Playwright, Backend, Database and Frontend as clearly separated layers.
9. Do not turn the system into a fixed workflow.
10. Preserve the agent loop:

```text
Goal
 ↓
Reason
 ↓
Select Tool
 ↓
Execute
 ↓
Observe
 ↓
Update State
 ↓
Reason Again
 ↓
Continue / Stop
```

The final result should be a **real tool-using AI Agent**, not merely an LLM wrapper, scraper, or predefined automation pipeline.

Start by reviewing this specification, then give me the **complete technical architecture and implementation roadmap**, including the exact responsibilities and communication between:

- LLM
- Harness
- MCP Client
- MCP Server
- Playwright
- Backend
- MongoDB
- React

Do not skip architectural details.

Most importantly, build the first version incrementally and test each layer before adding the next one.