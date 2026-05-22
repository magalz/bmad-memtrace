<p align="center">
  <img src="banner-bmad-method.png" alt="BMad-Memtrace">
</p>

# BMad-Memtrace

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.12.0-brightgreen)](https://nodejs.org)

**BMad-Memtrace is a [Memtrace](https://memtrace.ai)-integrated fork of the [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD).** It replaces heuristic text search with deterministic graph-based structural intelligence, giving AI agents exact blast radius calculations, dead code detection, and quality gates that are mathematically verified — not hallucinated.

This is **not an npm package** — it is installed via `git clone`. Vanilla BMad's `npx bmad-method install` does not apply to this fork.

This fork ships **core BMad functions only** (the BMM module). It does not include all official BMad modules — just the essential planning, architecture, development, code review, testing, and retrospective workflows, all upgraded with Memtrace graph awareness.

---

## What Is Memtrace?

[Memtrace](https://memtrace.ai) is a static code graph engine that builds a full AST-precise graph of your repository: every function, class, call, import, type, and API endpoint, with their structural relationships. It exposes this via a local MCP server that AI agents query instead of using heuristic text search (grep, sed). The result: agents understand your codebase with surgical precision — blast radius is exact, dead code is proven, and quality gates are mathematically enforced, not hallucinated.

> **Note:** Memtrace is currently in limited access. Visit [memtrace.ai](https://memtrace.ai) to join the waitlist.

For a detailed walkthrough, see the [Memtrace × BMad Integration Guide](./docs/memtrace-bmad-integration.en.md).

---

## What Changed

| Area | Vanilla BMad | BMad-Memtrace |
|------|-------------|---------------|
| Code understanding | grep/sed heuristic search | Memtrace graph engine (AST-precise) |
| Blast radius | LLM guesses what breaks | `get_impact` — exact call graph |
| Dead code | LLM estimates unused functions | `find_dead_code` — zero callers proof |
| Quality gates | Textual justification | Mathematical intersection of tests vs blast radius |
| Architecture | LLM-invented dependencies | Graph-queried symbol relationships |
| Telemetry | None | Autonomous agent-to-human feedback with dedup |
| Server resilience | Crash on MCP timeout | Autonomous recovery + graceful degradation |

---

## Installation

**Prerequisites:** [Node.js](https://nodejs.org) v20.12+ · [Python](https://www.python.org) 3.10+ · Memtrace MCP engine (configured during install)

```bash
# macOS / Linux
git clone <this-repo-url>
cd bmad-memtrace
./install-bmad-memtrace.sh

# Windows
git clone <this-repo-url>
cd bmad-memtrace
.\install-memtrace.bat
```

The installer:
1. Generates the `.memtrace-workspace` anchor file
2. Configures MCP connection JSONs for CLI and Desktop clients
3. Cleans up legacy clone files
4. Verifies the Memtrace server connects successfully
5. Optionally accepts interactive mode selection (Memtrace vs abort)

After install, open your AI IDE (Claude Code, Cursor, etc.) in the project folder.

---

## How It Works

Every workflow that touches code queries the Memtrace graph engine instead of reading source text heuristically. Agents use MCP tools to get exact blast radius, proven dead code, and architectural relationships — all AST-precise, not guessed.

### Structural Quality Gates

Before any code modification, agents must pass a Quality Gate that mathematically proves test coverage intersects the blast radius. Two phases:

- **Phase 1 (textual):** Agent lists and justifies which tests cover which impacted nodes
- **Phase 2 (mathematical):** `qa-memtrace.mjs` blocks progression if test coverage does not intersect the blast radius — no bluffing, no hallucination

### Graceful Degradation

If the Memtrace MCP server is unreachable:
1. Agent attempts autonomous recovery via `npm run memtrace:restart`
2. If recovery fails, agent halts and asks for explicit permission before falling back to text-search heuristics
3. No silent degradation — every fallback is transparent and user-approved

---

## Key Workflows

1. **`bmad-help`** — AI guidance on what to do next
2. **`bmad-create-prd`** — Product requirements with architectural validation
3. **`bmad-create-architecture`** — System design backed by actual graph data
4. **`bmad-create-epics-and-stories`** — Break requirements into implementable stories
5. **`bmad-dev-story`** — Implement stories with structural quality gates
6. **`bmad-code-review`** — Adversarial review with graph-audited blast radius
7. **`bmad-tea`** — Test strategy and coverage gap analysis
8. **`bmad-retrospective`** — Post-epic review with empirical data

For a complete list, run `bmad-help` or explore `.agents/skills/`.

---

## Technical Architecture

```
bmad-memtrace/
├── _bmad/scripts/memtrace/          # Adapter, QA gates, pitfalls catalog
│   ├── memtrace-adapter.mjs         # Timeout, throttling, summarization layer
│   ├── qa-memtrace.mjs              # Mathematical quality gate engine
│   └── pitfalls-catalog.json        # False-positive protection for dead code
├── .agents/skills/                  # BMad skill workflows
├── install-bmad-memtrace.sh         # Bootstrap installer (Linux/macOS)
├── install-memtrace.bat             # Bootstrap installer (Windows)
├── .memtrace-workspace              # Generated anchor file
└── npm run quality                  # Pipeline: format → lint → test → validate
```

The quality pipeline (`npm run quality`) runs 10 sequential checks including format, lint, tests, and validators — **77 tests passing** across adapter, QA gate, restart, and smoke test suites.

### Key Design Decisions

- **Sequential concurrency:** All MCP queries use `for...of` with `await` — `Promise.all` is prohibited to prevent server exhaustion
- **2000-token budget:** Graph responses are hierarchically summarized to protect LLM context windows
- **Index freshness check:** Every workflow verifies the graph is up-to-date before trusting results
- **JSON mutation safety:** Config files are parsed, modified, and reserialized — never rewritten as raw strings

---

## Documentation

- [BMad Method Docs](https://docs.bmad-method.org) — Core framework documentation
- `bmad-help` — In-project AI guidance

## License

MIT License — see [LICENSE](LICENSE) for details.

---

**BMad-Memtrace** is a fork of the [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD). BMad is a trademark of BMad Code, LLC.
