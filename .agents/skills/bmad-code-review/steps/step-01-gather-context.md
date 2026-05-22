---
diff_output: '' # set at runtime
spec_file: '' # set at runtime (path or empty)
review_mode: '' # set at runtime: "full" or "no-spec"
story_key: '' # set at runtime when discovered from sprint status
memtrace_blast_radius: '' # set at runtime: structured blast radius data or "unavailable"/"partial"
memtrace_dead_code: '' # set at runtime: structured dead code data or "unavailable"/"partial"
---

# Step 1: Gather Context

## 🧠 Memtrace Context (Self-Contained)

Memtrace structural deep audit is available for independent code review verification.
If activation failed to load persistent_facts, this context is sufficient:

**Blast radius audit:**
`node _bmad/scripts/memtrace/memtrace-adapter.mjs --target <symbol> --query get_impact --check-freshness --summarize`
- Exit 0 → parse `summarized.critical_dependents`, `summarized.module_impact`, `summarized.total_affected`
- Exit 1 + `[FRESHNESS]` in STDERR → stale index, skip
- Exit 1 + `MEMTRACE_MCP_ERROR_TIMEOUT` → server unreachable, skip

**Dead code audit:**
`node _bmad/scripts/memtrace/memtrace-adapter.mjs --target <file> --query find_dead_code --check-freshness`
- Exit 0 → list of dead symbols in that file
- Exit 1 → skip, continue with remaining files

> **Complete Memtrace MCP tool catalog:**
> **Navigation:** find_code, find_symbol, get_source_window, get_directory_tree
> **Architecture:** get_codebase_briefing, list_communities, list_processes, get_process_flow
> **Dependencies:** get_symbol_context, analyze_relationships, get_impact, find_dependency_path, get_api_topology
> **Quality:** find_dead_code, find_most_complex_functions, find_bridge_symbols, find_central_symbols
> **Temporal:** get_evolution, get_changes_since, get_timeline, get_episode_replay
> **Index:** index_directory, list_indexed_repositories, watch_directory, delete_repository

**Rules:**
- All queries are ADVISORY — NEVER block the review on Memtrace availability
- Process STRICTLY SEQUENTIALLY with `for...of` + `await`
- NEVER use `Promise.all` for Memtrace queries
- `--check-freshness` flag is mandatory
- `--summarize` flag required for blast radius to stay under 2000 tokens

**Graceful degradation:**
- Memtrace unavailable or times out → skip blast radius/dead code audit, continue with heuristic review
- Stale index (`[FRESHNESS]` in STDERR) → skip graph queries, proceed with existing review logic
- Partial failure → note diagnostic, apply available data, do not halt the review
- NEVER block the code review workflow on Memtrace availability

---

## RULES

- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`
- The prompt that triggered this workflow IS the intent — not a hint.
- Do not modify any files. This step is read-only.

## INSTRUCTIONS

1. **Find the review target.** The conversation context before this skill was triggered IS your starting point — not a blank slate. Check in this order — stop as soon as the review target is identified:

   **Tier 1 — Explicit argument.**
   Did the user pass a PR, commit SHA, branch, spec file, or diff source this message?
   - PR reference → resolve to branch/commit via `gh pr view`. If resolution fails, ask for a SHA or branch.
   - Commit or branch → use directly.
   - Spec file → set `{spec_file}` to the provided path. Check its frontmatter for `baseline_commit`. If found, use as diff baseline. If not found, continue the cascade (a spec alone does not identify a diff source).
   - Also scan the argument for diff-mode keywords that narrow the scope:
     - "staged" / "staged changes" → Staged changes only
     - "uncommitted" / "working tree" / "all changes" → Uncommitted changes (staged + unstaged)
     - "branch diff" / "vs main" / "against main" / "compared to <branch>" → Branch diff (extract base branch if mentioned)
     - "commit range" / "last N commits" / "<from-sha>..<to-sha>" → Specific commit range
     - "this diff" / "provided diff" / "paste" → User-provided diff (do not match bare "diff" — it appears in other modes)
   - When multiple keywords match, prefer the most specific (e.g., "branch diff" over bare "diff").

   **Tier 2 — Recent conversation.**
   Do the last few messages reveal what the user wants to be reviewed? Look for spec paths, commit refs, branches, PRs, or descriptions of a change. Apply the same diff-mode keyword scan and routing as Tier 1.

   **Tier 3 — Sprint tracking.**
   Look for a sprint status file (`*sprint-status*`) in `{implementation_artifacts}` or `{planning_artifacts}`. If found, scan for stories with status `review`:
   - **Exactly one `review` story:** Set `{story_key}` to the story's key (e.g., `1-2-user-auth`). Suggest it: "I found story <story-id> in `review` status. Would you like to review its changes? [Y] Yes / [N] No, let me choose". If confirmed, use the story context to determine the diff source (branch name derived from story slug, or uncommitted changes). If declined, clear `{story_key}` and fall through.
   - **Multiple `review` stories:** Present them as numbered options alongside a manual choice option. Wait for user selection. If a story is selected, set `{story_key}` and use its context to determine the diff source. If manual choice is selected, clear `{story_key}` and fall through.
   - **None:** Fall through.

   **Tier 4 — Current git state.**
   If version control is unavailable, skip to Tier 5. Otherwise, check the current branch and HEAD. If the branch is not `main` (or the default branch), confirm: "I see HEAD is `<short-sha>` on `<branch>` — do you want to review this branch's changes?" If confirmed, treat as a branch diff against `main`. If declined, fall through.

   **Tier 5 — Ask.**
   Fall through to instruction 2.

   Never ask extra questions beyond what the cascade prescribes. If a tier above already identified the target, skip the remaining tiers and proceed to instruction 3 (construct diff).

2. HALT. Ask the user: **What do you want to review?** Present these options:
   - **Uncommitted changes** (staged + unstaged)
   - **Staged changes only**
   - **Branch diff** vs a base branch (ask which base branch)
   - **Specific commit range** (ask for the range)
   - **Provided diff or file list** (user pastes or provides a path)

3. Construct `{diff_output}` from the chosen source.
   - For **staged changes only**: run `git diff --cached`.
   - For **uncommitted changes** (staged + unstaged): run `git diff HEAD`.
   - For **branch diff**: verify the base branch exists before running `git diff`. If it does not exist, HALT and ask the user for a valid branch.
   - For **commit range**: verify the range resolves. If it does not, HALT and ask the user for a valid range.
   - For **provided diff**: validate the content is non-empty and parseable as a unified diff. If it is not parseable, HALT and ask the user to provide a valid diff.
   - For **file list**: validate each path exists in the working tree. Construct `{diff_output}` by running `git diff HEAD -- <path1> <path2> ...`. If any paths are untracked (new files not yet staged), use `git diff --no-index /dev/null <path>` to include them. If the diff is empty (files have no uncommitted changes and are not untracked), ask the user whether to review the full file contents or to specify a different baseline.
   - After constructing `{diff_output}`, verify it is non-empty regardless of source type. If empty, HALT and tell the user there is nothing to review.

4. **Set the spec context.**
   - If `{spec_file}` is already set (from Tier 1 or Tier 2): verify the file exists and is readable, then set `{review_mode}` = `"full"`.
   - Otherwise, ask the user: **Is there a spec or story file that provides context for these changes?**
     - If yes: set `{spec_file}` to the path provided, verify the file exists and is readable, then set `{review_mode}` = `"full"`.
     - If no: set `{review_mode}` = `"no-spec"`.

5. If `{review_mode}` = `"full"` and the file at `{spec_file}` has a `context` field in its frontmatter listing additional docs, load each referenced document. Warn the user about any docs that cannot be found.

6. Sanity check: if `{diff_output}` exceeds approximately 3000 lines, warn the user and offer to chunk the review by file group.
   - If the user opts to chunk: agree on the first group, narrow `{diff_output}` accordingly, and list the remaining groups for the user to note for follow-up runs.
   - If the user declines: proceed as-is with the full diff.

<!-- CHUNKED-REVIEW SCOPE LIMITATION
When a diff is chunked (exceeds ~3000 lines and user opted to split by file group):

LIMITATION: Each chunk is reviewed in isolation. The reviewer sees only the
files in the current chunk, not the full diff. Cross-chunk interactions --
e.g., a function defined in chunk A and called in chunk B -- are invisible
to the textual review layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor).

MITIGATION: The structural audit (blast radius + dead code, run in this step)
queries the FULL symbol set from the complete diff, NOT per-chunk symbols.
This means cross-chunk dependency detection (via get_impact) and dead code
detection (via find_dead_code) uses the complete change set, preserving
system-level awareness even when the human reviewer only sees one chunk.

When presenting findings, note: "Chunked review -- cross-chunk interactions
may not be reflected in textual findings. Structural audit covers full diff."
-->

7. **Run structural deep audit queries (Memtrace).** If the repository is indexed by Memtrace, independently verify the diff's structural impact. This step is DIAGNOSTIC — the review continues regardless of availability.

   **Check Availability:**
   - Use `list_indexed_repositories` to confirm the project repo is indexed
   - Check the `last_indexed_at` value — if older than 30 minutes, flag as stale and skip graph queries
   - If not indexed or stale, set `{memtrace_blast_radius}` = `"unavailable"` and `{memtrace_dead_code}` = `"unavailable"`, then skip to CHECKPOINT

   **New-file detection (freshness guard):**
   - Parse `{diff_output}` to detect files that are brand-new (only `+` lines, no `-` lines at all)
   - A file is "new" if: file appears in `+++ b/<path>` with zero `-` hunks (no removed lines for that path)
   - For each new file detected:
     - Note: "New file `<path>` — may not be in the Memtrace index yet. Proceeding with text-based review for this file."
     - Skip graph queries (get_impact, find_dead_code) for that file only
     - Continue with remaining (existing) files normally
     - Do NOT skip the whole review — this is per-file, advisory only
   - This guard prevents false negatives when queries return empty for files the index hasn't seen yet

   **Extract modified symbols from the diff:**
   - Parse `{diff_output}` to identify modified functions, methods, classes, and exported variables
   - Extract symbol names from changed lines (lines starting with `+` or `-` in function/class/method declarations)
   - Use language-specific patterns to extract symbol names:
     | Language | Declaration Pattern | Regex (match `+`/`-` lines) | Group |
     |----------|--------------------|------------------------------|-------|
     | JS/TS | `function name(` | `/^[+-]\s*(export\s+)?(async\s+)?function\s+(\w+)/` | 3 |
     | JS/TS | `class Name` | `/^[+-]\s*(export\s+)?class\s+(\w+)/` | 2 |
     | JS/TS | `const name =` | `/^[+-]\s*(export\s+)?const\s+(\w+)\s*=/` | 2 |
     | Python | `def name(` | `/^[+-]\s*def\s+(\w+)\s*\(/` | 1 |
     | Python | `class Name:` | `/^[+-]\s*class\s+(\w+)/` | 1 |
     | Go | `func Name(` | `/^[+-]\s*func\s+(\w+)\s*\(/` | 1 |
     | Go | `func (r *T) Name(` | `/^[+-]\s*func\s+\([^)]*\)\s+(\w+)\s*\(/` | 1 |
     | Rust | `fn name(` | `/^[+-]\s*(pub\s+)?fn\s+(\w+)\s*[<(]/` | 2 |
     | Rust | `impl BlockName` | `/^[+-]\s*impl\s+(\w+)/` | 1 |
     | Ruby | `def name` | `/^[+-]\s*def\s+(\w+)/` | 1 |
     | Ruby | `class Name` | `/^[+-]\s*class\s+(\w+)/` | 1 |
   - Also handle anonymous/arrow function bindings:
     - `const x = () => { ... }` or `const x = function() { ... }` → extract `x`
     - `export default () => { ... }` or `module.exports = () => { ... }` → flag as "unknown-anonymous" (not extracted as named symbol)
     - Arrow callbacks passed as arguments (`.map(() => ...)`, `.then(() => ...)`) → do NOT extract
   - De-duplicate and limit to at most 15 symbols (prioritize: exported > internal, functions > variables)
   - For each symbol, note its containing file path
   - If no modified symbols are extracted (e.g., only config files, comments, or whitespace changes), skip both blast radius and dead code queries — set `{memtrace_blast_radius}` = `"empty"` and `{memtrace_dead_code}` = `"empty"`

   **Run blast radius audit (`get_impact`):**
   - For each extracted symbol, call the adapter:
     `node _bmad/scripts/memtrace/memtrace-adapter.mjs --target <symbol> --query get_impact --check-freshness --summarize`
   - Process STRICTLY SEQUENTIALLY using `for...of` with `await` — NEVER `Promise.all`
   - On exit 0: collect `summarized.critical_dependents`, `summarized.module_impact`, `summarized.total_affected`
   - On exit 1 with `[FRESHNESS]` in STDERR: note "Index stale — skipping blast radius for <symbol>" and continue
   - On exit 1 with `MEMTRACE_MCP_ERROR_TIMEOUT`: note "MCP timeout — skipping blast radius for <symbol>" and continue
   - Set `{memtrace_blast_radius}` to the structured results (or `"partial"` if some queries failed, or `"unavailable"` if ALL queries failed)

   **Run dead code audit (`find_dead_code`):**
   - **Path normalization:** Before iterating files, normalize file paths from the diff:
     - Determine git repo root via `git rev-parse --show-toplevel`
     - For each unique modified file path:
       - If absolute AND starts with git root → strip root prefix to make repo-relative
       - If Windows `\` separators → replace with `/`
       - If path cannot be normalized to repo-relative → flag as "non-standard path" and skip
     - Apply normalization to BOTH `--target` for dead code AND extracted symbol lookups for blast radius
   - **Skip deleted files:** Before iterating, filter out files that appear only in `-` lines (deleted entirely, e.g. `+++ /dev/null` or all hunks are `-`-only). Deleted files have no HEAD symbols — `find_dead_code` would error. Note count of skipped deleted files for CHECKPOINT summary.
   - For each UNIQUE modified file (not per-symbol), call the adapter:
     `node _bmad/scripts/memtrace/memtrace-adapter.mjs --target <file-path> --query find_dead_code --check-freshness`
   - Process STRICTLY SEQUENTIALLY using `for...of` with `await`
   - On exit 0: collect the list of dead code symbols in that file
   - On failure: note the failure and continue with remaining files
   - Set `{memtrace_dead_code}` to the structured results (or `"partial"` if some queries failed, or `"unavailable"` if ALL queries failed)

   **Graceful Degradation:**
   - If `list_indexed_repositories` returns empty or the project repo is not indexed: skip ALL queries, set both variables to `"unavailable"`
   - If any individual query times out or fails: skip that query only, mark results as `"partial"`, continue with remaining symbols/files
   - NEVER block or halt the review on Memtrace availability — the structural audit is supplemental intelligence

<!-- JSON SCHEMA -- Structured Audit Results
These are the shapes produced by `memtrace-adapter.mjs` on exit 0.

Blast radius (`--query get_impact --summarize`):
{
  "symbol": "<function-or-class-name>",
  "total_affected": <number>,
  "critical_dependents": [
    { "name": "<dependent-symbol>", "depth": <1|2|3> }
  ],
  "module_impact": [
    { "module": "<community-or-directory>", "count": <number> }
  ]
}

Dead code (`--query find_dead_code`):
{
  "file": "<repo-relative-path>",
  "dead_symbols": [
    { "name": "<function-or-method-name>", "kind": "Function|Method|Class", "line": <number> }
  ]
}
-->

### CHECKPOINT

Present a summary before proceeding: diff stats (files changed, lines added/removed), `{review_mode}`, loaded spec/context docs (if any), and structural audit status (if `{memtrace_blast_radius}` is not empty/unavailable: if `"partial"`, note "structural audit partially complete — {partial_count}/{total_count} symbol queries failed"; if fully available, include "blast radius queried for {count} symbols, dead code checked in {count} files"). HALT and wait for user confirmation to proceed.


## NEXT

Read fully and follow `./step-02-review.md`
