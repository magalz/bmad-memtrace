# Memtrace × BMad — Integration Guide

**How the code graph supercharges AI-assisted development workflows.**

---

## 1. What It Is

[Memtrace](https://memtrace.ai) is a static code graph engine that builds a full graph of your repository: functions, classes, calls, imports, types, API endpoints, and their structural relationships. It exposes this via an MCP server that AI agents (OpenCode, Claude Code, Cursor) query to understand, navigate, and modify code safely.

**BMad** is an ecosystem of workflows for AI-assisted development, orchestrating specialized agents (PM, Architect, Dev, QA, Tech Writer, Code Reviewer) in production cycles.

The integration is **additive**: Memtrace adds a layer of structural intelligence that BMad workflows consult — no existing process is replaced, only amplified.

---

## 2. Minimum Setup

```bash
# Global install
npm install -g memtrace@latest

# Workspace anchor (project root)
# Prevents "0 nodes" from anchor mismatch between MCP and CLI
touch .memtrace-workspace

# Initial index
memtrace index .
# or via MCP:
# mcp__memtrace__index_directory(path=".", clear_existing=true)
```

**MCP config** in your `opencode.json` or `claude_desktop_config.json`:

```json
{
  "mcp": {
    "memtrace": {
      "type": "local",
      "command": ["memtrace", "mcp"],
      "enabled": true,
      "environment": {}
    }
  }
}
```

---

## 3. MCP Tool Catalog

All tools Memtrace exposes via MCP, organized by activity type.

### 3.1 Code Navigation & Discovery

| Tool | What it does | Replaces |
|------|-------------|----------|
| `find_code(query)` | Hybrid search (text + semantic) by symbol name, natural description, or pattern. E.g.: `"JWT token authentication"`, `"getUserById"` | `grep -r` + guessing where things are |
| `find_symbol(name)` | Exact or fuzzy symbol lookup. E.g.: `find_symbol(name="validateToken", fuzzy=true)` | `grep -r "validateToken"` |
| `get_source_window(file_path, start_line, end_line)` | Bounded code reading with context (before/after). Returns only the relevant span, with optional compression | `cat file.ts` entirely |
| `get_directory_tree(repo_id)` | Indexed directory tree with subtree drill-down | `tree` + guessing structure |

### 3.2 Architectural Mapping

| Tool | What it does | Replaces |
|------|-------------|----------|
| `get_codebase_briefing(repo_id)` | Structural briefing: modules, high-risk symbols, communities, endpoints, dead code candidates | Reading README + files manually |
| `list_communities(repo_id)` | Louvain communities — natural groupings of tightly-coupled symbols. Reveals undocumented bounded contexts | Manual import analysis |
| `list_processes(repo_id)` | Execution flows (call chains) — HTTP entry points, CLI, background jobs | Manual grep cascading |
| `get_process_flow(repo_id, process)` | Step-by-step trace of an execution flow, from entry point to leaves | Cascading `grep -r "fn("` |

### 3.3 Dependency & Relationship Analysis

| Tool | What it does | Replaces |
|------|-------------|----------|
| `get_symbol_context(repo_id, symbol)` | 360° view: callers, callees, type, community, process. Everything in one call | Multiple grep + reverse grep |
| `analyze_relationships(target, query_type)` | Callers, callees, class hierarchy, imports, exports, type usages | `grep -r "Class"` + `grep -r "extends Class"` |
| `get_impact(repo_id, target)` | Blast radius: who is affected if this symbol changes, at N levels of depth | Mentally tracking who imports what |
| `find_dependency_path(source, target, repo_id)` | Shortest path between two symbols. Useful for "how does X reach Y?" | Debugging with breakpoints |
| `get_api_topology()` | Full cross-service HTTP call map | Outdated API documentation |

### 3.4 Quality Analysis

| Tool | What it does | Replaces |
|------|-------------|----------|
| `find_dead_code(repo_id)` | Functions with no callers — dead code candidates | Manual inspection of every function |
| `find_most_complex_functions(repo_id)` | Top N functions by call-graph complexity | Guessing "what is complex" |
| `find_bridge_symbols(repo_id)` | Bridge symbols — coupling points between seemingly unrelated modules | N/A — undetectable without a graph |
| `find_central_symbols(repo_id)` | Structural PageRank — most "important" symbols by dependent count | Developer intuition |

### 3.5 Temporal Tracking

| Tool | What it does | Replaces |
|------|-------------|----------|
| `get_evolution(repo_id, from, to)` | What changed between two dates — added, modified, removed symbols | `git log --oneline` + reading diffs |
| `get_changes_since(repo_id, since)` | What changed since a point — session anchor for cross-session continuity | Manual `git diff` |
| `get_timeline(repo_id, symbol)` | Full history of a symbol across all episodes (commits + working tree) | `git log -L` |
| `get_episode_replay(repo_id, episode)` | What a specific commit touched: added, modified, removed nodes | `git show --stat` |

### 3.6 Index Management

| Tool | What it does |
|------|-------------|
| `index_directory(path, repo_id)` | Index (or reindex) a repository into the graph |
| `list_indexed_repositories()` | List indexed repos with statistics |
| `watch_directory(path, repo_id)` | Watch for live changes — `get_evolution` captures working-tree episodes |
| `delete_repository(repo_id)` | Remove a repository from the graph |

---

## 4. Day-to-Day Use Cases

From simplest to most complex, with example prompts for the agent.

### Level 1: Replacing grep and file reading

**Before:** `grep -r "someFunction" src/` → open file → find definition

**With Memtrace:**
```
"Find the claimArtistProfileAction function and show me its implementation"
→ find_symbol(name="claimArtistProfileAction")
→ get_source_window(file_path, start_line, end_line)

"Where is the EventWithRelations type defined?"
→ find_code(query="EventWithRelations type definition")

"Show me the directory structure of the calendar module"
→ get_directory_tree(repo_id="my-project", max_depth=3)
```

### Level 2: Understanding code before changing it

**Before:** Read file → trace imports → reverse grep → build mental map

**With Memtrace:**
```
"Who calls updateEvent and what does it call?"
→ get_symbol_context(repo_id="my-project", symbol="updateEvent")
   Returns: 3 callers, 6 callees, community "CalendarEvents"

"What is the full flow of a POST /api/events request?"
→ get_process_flow(repo_id="my-project", process="POST /api/events")
   Returns: handler → validation → service → database → response

"If I change the EventSchema interface, what breaks?"
→ get_impact(repo_id="my-project", target="EventSchema")
   Returns: 12 downstream symbols, RISK: HIGH

"How does authenticateRequest connect to the database?"
→ find_dependency_path(source="authenticateRequest", target="supabaseClient", repo_id="my-project")
```

### Level 3: Quality and maintenance

**Before:** N/A — no automated structural analysis existed

**With Memtrace:**
```
"List dead code in the project"
→ find_dead_code(repo_id="my-project")
→ validate with pitfalls script (if configured)

"Which functions have the highest complexity?"
→ find_most_complex_functions(repo_id="my-project", top_n=20)
   Returns: ranking with score and risk level

"What changed in the code since yesterday?"
→ get_evolution(repo_id="my-project", from="2026-05-10T00:00:00Z", mode="compound")
   Returns: most-changed files + most-touched symbols

"Which symbols are the critical coupling points?"
→ find_bridge_symbols(repo_id="my-project")
```

### Level 4: Session continuity

**Before:** Losing context between sessions, re-reading code from scratch

**With Memtrace:**
```
"What changed since my last session?"
→ get_changes_since(repo_id="my-project", since="2026-05-09T00:00:00Z")

"Keep the index fresh while I work"
→ watch_directory(path=".", repo_id="my-project")
```

---

## 5. Mapping to BMad Workflows

Each BMad workflow benefits from Memtrace at specific points. No workflow *requires* Memtrace, but all gain depth when it is available.

### 5.1 create-story

| Step | What Memtrace offers |
|------|---------------------|
| Understand the current codebase | `get_codebase_briefing` + `get_directory_tree` |
| Identify affected modules | `list_communities` + `find_central_symbols` |
| Map feature dependencies | `get_symbol_context` + `find_dependency_path` |

**Before:** The Architect (Winston) reads files manually to understand structure.
**After:** The agent consults the graph and arrives with the code mental map ready.

### 5.2 dev-story

| Step | What Memtrace offers |
|------|---------------------|
| Before refactoring | `get_impact(symbol)` — calculates blast radius |
| During implementation | `get_symbol_context` — understands relationships |
| After implementation | `get_evolution` — checks for unintended regressions |
| Pre-PR gate | `find_dead_code` → `npm run qa:memtrace` (if configured) |

**Before:** Refactored "blindly", discovered impact in tests.
**After:** Knows the blast radius before touching code.

### 5.3 code-review (bmad-code-review)

| Review layer | What Memtrace offers |
|-------------|---------------------|
| Blind Hunter | `get_impact(modified symbols)` — detects unexpected cascades |
| Edge Case Hunter | `get_symbol_context` — understands all usages of a symbol |
| Acceptance Auditor | `find_dead_code` — verifies no dead code was left behind |

**Before:** Reviewer hunted references with grep.
**After:** `get_impact` reveals the full reach of the change.

### 5.4 QA / bmad-tea

| Activity | What Memtrace offers |
|----------|---------------------|
| Test design | `find_most_complex_functions` — focus tests where complexity lives |
| Risk analysis | `find_bridge_symbols` — test coupling points first |
| Structural coverage | `get_process_flow` — maps flows that need tests |

### 5.5 bmad-memtrace-feedback

Dedicated skill for recording Memtrace usage at end of sessions:

1. Appends entry to `docs/memtrace-sessions-feedbacks.md`
2. Optionally calls `record_external_episode` on the Memtrace graph
3. Generates metrics on which tools were used

### 5.6 bmad-help

The `bmad-help.csv` catalog can list Memtrace-related skills so the BMad system recommends them automatically.

---

## 6. Recommended Supporting Infrastructure

### QA Gate (qa-memtrace.mjs)

Script that turns `find_dead_code` into a deterministic gate:

```
1. find_dead_code (MCP) → candidates.json
2. npm run qa:memtrace → report.md + exit code
3. If exit 0 → proceed
4. If exit 1 → SUSPECTs require review
```

The script:
- Deduplicates candidates
- Cross-references with real `grep` (does the symbol exist in code today?)
- Matches against a known false-positive catalog (Record dispatch, function-as-value, framework entry points)
- Generates a markdown report with classification (SUSPECT / FALSE_POS / GHOST)

### Pitfalls Catalog (memtrace-pitfalls.md)

Documents patterns Memtrace cannot detect via static analysis:

| Pattern | Example | Why it fails |
|---------|---------|-------------|
| Record dispatch | `BUILDERS[h.rule](h)` | Runtime lookup |
| Function as value | `useState(CopyIcon)` | Reference, not call edge |
| Framework entry points | `handler` in route.ts | Invoked by runtime |
| MSW handlers | `setupServer(...)` | Registered, not called |
| Test mocks | `vitest.setup.ts` | Setup-only |

### Workspace Anchor (.memtrace-workspace)

Empty file at project root ensuring `memtrace mcp` and `memtrace start` converge on the same `.memdb`.

---

## 7. Best Practices

1. **Start small.** Index the repo and use `find_code` / `get_symbol_context` for navigation. Scale complexity over time.

2. **Use `get_impact` before refactoring.** It's the highest-return tool: prevents surprises with one MCP call.

3. **Dead code validation with a gate.** `find_dead_code` + `qa-memtrace.mjs` + pitfalls catalog = reliable pipeline. Without the gate, the agent may skip it.

4. **Prefer graph over text.** `get_symbol_context` delivers in 1 call what would require 5-10 grep + file reads.

5. **Keep the index fresh.** Use `watch_directory` so the graph reflects uncommitted changes. Use `index_directory` with `clear_existing=true` after Memtrace upgrades.

6. **Document false positives.** The pitfalls catalog is a living document — every time a SUSPECT turns out to be a false positive, document the pattern.

7. **Register feedback.** `bmad-memtrace-feedback` generates usage traces that help decide where to deepen the integration.

---

## 8. References

- [Memtrace Docs](https://docs.memtrace.dev)
- [Memtrace GitHub](https://github.com/syncable-dev/memtrace-public)
- BMad: skills `bmad-memtrace-feedback`, `bmad-dev-story`, `bmad-code-review`
