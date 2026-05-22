/**
 * Memtrace Tool Reference Validator
 *
 * Cross-references Memtrace MCP tool names used in skill files against the
 * actual MCP server tool catalog. Detects hallucinated, stale, or misspelled
 * tool names in SKILL.md, step files, workflow files, and customize.toml.
 *
 * Checks performed:
 * - TOOL-01: Every Memtrace tool name reference in .md files matches a real MCP tool
 * - TOOL-02: Telemetry catalog appendix lists only valid tool names
 * - TOOL-03: Epic 6 files have 13+ self-contained `🧠 Memtrace Context` blocks
 * - TOOL-04: customize.toml persistent_facts reference valid tool names
 *
 * Usage:
 *   node tools/validate-tool-refs.mjs                      # Warn on violations (exit 0)
 *   node tools/validate-tool-refs.mjs --strict              # Fail on CRITICAL/HIGH (exit 1)
 *   node tools/validate-tool-refs.mjs --verbose             # Show all scanned files
 *   node tools/validate-tool-refs.mjs --json                # JSON output
 *   node tools/validate-tool-refs.mjs --strict --json        # Strict + JSON
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = path.resolve(__dirname);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const VERBOSE = args.includes('--verbose');
const JSON_OUTPUT = args.includes('--json');

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

// --- Known-local scripts (valid project files, NOT MCP tools) ---
const LOCAL_SCRIPT_NAMES = new Set([
  'memtrace-adapter.mjs', 'qa-memtrace.mjs', 'validate-dead-code.mjs',
  'memtrace-restart.mjs', 'inject-mcp-config.mjs', 'pitfalls-catalog.json',
]);

// --- Embedded 45-tool authoritative catalog ---
const VALID_TOOLS = [
  'find_code', 'find_symbol', 'get_source_window', 'get_directory_tree',
  'get_codebase_briefing', 'list_communities', 'list_processes', 'get_process_flow',
  'get_symbol_context', 'analyze_relationships', 'get_impact', 'find_dependency_path',
  'get_api_topology', 'find_api_calls', 'find_api_endpoints', 'get_service_diagram',
  'find_dead_code', 'find_most_complex_functions', 'find_bridge_symbols', 'find_central_symbols',
  'calculate_cyclomatic_complexity',
  'get_evolution', 'get_changes_since', 'get_timeline', 'get_episode_replay', 'get_cochange_context',
  'detect_changes',
  'get_repository_stats', 'index_directory', 'list_indexed_repositories',
  'watch_directory', 'unwatch_directory', 'list_jobs', 'list_watched_paths', 'list_worktrees',
  'cleanup_episodes', 'cleanup_stale_records', 'cleanup_worktrees',
  'replay_history', 'link_repositories', 'record_external_episode', 'delete_repository',
  'check_job_status',
  'embed_diag', 'embed_reset_breaker',
];

// Full tool names include both short and memtrace_-prefixed variants
const FULL_VALID_TOOLS = [
  ...VALID_TOOLS,
  ...VALID_TOOLS.map(t => `memtrace_${t}`),
];
const VALID_TOOL_SET = new Set(FULL_VALID_TOOLS);

// Build alternation regex from valid tool names (short + full MCP names)
const TOOL_ALTERNATION = FULL_VALID_TOOLS
  .sort((a, b) => b.length - a.length)  // longer first for greedy matching
  .map(t => t.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const TOOL_REF_RE = new RegExp(`\\b(${TOOL_ALTERNATION})\\b`, 'g');

// Pattern for catching memtrace_-prefixed strings that look like hallucinated tool names
// Only flag patterns with verb-like second word (get_/find_/list_/analyze_/calculate_/detect_/index_/watch_/cleanup_/replay_/link_/record_/delete_/embed_)
const HALLUCINATED_TOOL_RE = /\b(memtrace_(?:[a-z0-9]+_)+[a-z0-9]+)\b/g;

// Heading regex for 🧠 Memtrace Context blocks
const MEMTRACE_CONTEXT_HEADING_RE = /^#{1,6}\s+.*(?:🧠\s*)?Memtrace\s+Context/im;

// --- Utility ---

function escapeAnnotation(str) {
  return str.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeTableCell(str) {
  return String(str).replaceAll('|', '\\|');
}

function pathStartsWith(target, prefix) {
  return target.toLowerCase().startsWith(prefix.toLowerCase());
}

// --- Git root detection ---

function findGitRoot(startDir) {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: startDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim();
    return path.resolve(gitRoot);
  } catch {
    return null;
  }
}

// --- File scanning ---

function scanFiles(rootDir, extensions) {
  const results = [];
  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!extensions || extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  }
  walk(rootDir);
  return results;
}

function safeReadFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch (err) {
    if (err.code === 'ENOENT') return null;
    if (err.code === 'EACCES') { console.error(`Permission denied: ${filePath}`); return null; }
    console.error(`Read error (${err.code}) for ${filePath}: ${err.message}`);
    return null;
  }
}

// --- Memtrace tool name matching (TOOL-01 / TOOL-04) ---

function matchToolNames(content) {
  const found = [];
  // Strip out template variables {{...}} to avoid flagging their contents
  const stripped = content.replaceAll(/\{\{[^}]*\}\}/g, '');
  let match;
  TOOL_REF_RE.lastIndex = 0;
  while ((match = TOOL_REF_RE.exec(stripped)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const before = stripped[start - 1] || '';
    const after = stripped[end] || '';
    if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
    found.push({ name: match[1], index: start });
  }
  return found;
}

function matchHallucinatedToolNames(content) {
  const found = [];
  // Strip out template variables {{...}} to avoid flagging their contents
  const stripped = content.replaceAll(/\{\{[^}]*\}\}/g, '');
  let match;
  HALLUCINATED_TOOL_RE.lastIndex = 0;
  while ((match = HALLUCINATED_TOOL_RE.exec(stripped)) !== null) {
    const fullName = match[1];
    // Skip known non-tool patterns
    if (fullName === 'memtrace_blast_radius' || fullName === 'memtrace_dead_code' ||
        fullName === 'memtrace_structural_insights' || fullName === 'memtrace_tech_insights') continue;
    const shortName = fullName.replace(/^memtrace_/, '');
    if (VALID_TOOL_SET.has(fullName) || VALID_TOOL_SET.has(shortName)) continue;
    found.push({ fullName, shortName, index: match.index });
  }
  return found;
}

// --- Check implementations ---

function checkTool01(skillsDir, srcDir, gitRoot) {
  const findings = [];
  let totalMdFiles = 0;
  let totalToolRefs = 0;
  const toolUsageCounts = {};
  const invalidRefs = [];

  // Scan .agents/skills/ directory
  if (fs.existsSync(skillsDir)) {
    const mdFiles = scanFiles(skillsDir, ['.md']);
    totalMdFiles += mdFiles.length;

    for (const file of mdFiles) {
      const content = safeReadFile(file);
      if (content === null) continue;
      const rel = path.relative(gitRoot, file);

      // Match known-valid tool names (both short and full memtrace_ names)
      const refs = matchToolNames(content);
      for (const ref of refs) {
        totalToolRefs++;
        // Normalize to short name for counting
        const shortName = ref.name.replace(/^memtrace_/, '');
        toolUsageCounts[shortName] = (toolUsageCounts[shortName] || 0) + 1;
      }

      // Check for hallucinated memtrace_-prefixed names
      const hallucinated = matchHallucinatedToolNames(content);
      for (const h of hallucinated) {
        const lineNo = content.slice(0, h.index).split('\n').length;
        invalidRefs.push({ file: rel, line: lineNo, name: h.fullName });
      }

      // Count total valid refs (both short names and full memtrace_ names)
      // The TOOL_REF_RE already matches both forms since FULL_VALID_TOOLS includes both
      const totalInFile = refs.length;
      totalToolRefs += totalInFile;

      if (VERBOSE) {
        findings.push({
          rule: 'TOOL-01',
          severity: 'INFO',
          title: `Scanned ${rel}`,
          file: rel,
          detail: `${totalInFile} tool refs${hallucinated.length > 0 ? `, ${hallucinated.length} hallucinated` : ''}`,
        });
      }
    }
  }

  // Scan src/ directory
  if (fs.existsSync(srcDir)) {
    const srcFiles = scanFiles(srcDir, ['.md']);
    totalMdFiles += srcFiles.length;

    for (const file of srcFiles) {
      const content = safeReadFile(file);
      if (content === null) continue;
      const rel = path.relative(gitRoot, file);

      const refs = matchToolNames(content);
      for (const ref of refs) {
        totalToolRefs++;
        const shortName = ref.name.replace(/^memtrace_/, '');
        toolUsageCounts[shortName] = (toolUsageCounts[shortName] || 0) + 1;
      }

      const hallucinated = matchHallucinatedToolNames(content);
      for (const h of hallucinated) {
        const lineNo = content.slice(0, h.index).split('\n').length;
        invalidRefs.push({ file: rel, line: lineNo, name: h.fullName });
      }

      if (VERBOSE) {
        findings.push({
          rule: 'TOOL-01',
          severity: 'INFO',
          title: `Scanned ${rel}`,
          file: rel,
          detail: `${refs.length} tool refs${hallucinated.length > 0 ? `, ${hallucinated.length} hallucinated` : ''}`,
        });
      }
    }
  }

  // Report invalid tool references
  for (const ref of invalidRefs) {
    findings.push({
      rule: 'TOOL-01',
      severity: 'CRITICAL',
      title: `Invalid/hallucinated Memtrace tool name: ${ref.name}`,
      file: ref.file,
      line: ref.line,
      detail: `"${ref.name}" is not in the known-valid catalog of ${VALID_TOOLS.length} MCP tools. Suggesting use of "${ref.name.replace(/^memtrace_/, '')}" if a valid tool exists.`,
      fix: `Replace with a valid tool name from the catalog or remove the reference.`,
    });
  }

  // Report tool usage summary
  const usedTools = Object.keys(toolUsageCounts);
  const unusedTools = VALID_TOOLS.filter(t => !toolUsageCounts[t]);
  const validCount = usedTools.filter(t => VALID_TOOL_SET.has(t)).length;

  if (VERBOSE) {
    findings.push({
      rule: 'TOOL-01',
      severity: 'INFO',
      title: 'Tool usage distribution',
      file: '(aggregate)',
      detail: `${validCount}/${VALID_TOOLS.length} tools referenced across ${totalMdFiles} .md files. ${usedTools.length - validCount} unrecognized names.`,
    });
    findings.push({
      rule: 'TOOL-01',
      severity: 'INFO',
      title: 'Unreferenced tools',
      file: '(aggregate)',
      detail: `${unusedTools.length} tools in catalog not found in any file: ${unusedTools.join(', ')}`,
    });
  }

  if (invalidRefs.length === 0 && !VERBOSE) {
    findings.push({
      rule: 'TOOL-01',
      severity: 'INFO',
      title: 'All Memtrace tool name references valid',
      file: '.agents/skills/ + src/',
      detail: `${totalToolRefs} references across ${totalMdFiles} files — all match known-valid catalog.`,
    });
  }

  return findings;
}

function checkTool02(telemetrySkillPath, gitRoot) {
  const findings = [];

  if (!fs.existsSync(telemetrySkillPath)) {
    findings.push({
      rule: 'TOOL-02',
      severity: 'MEDIUM',
      title: 'Telemetry SKILL.md not found',
      file: path.relative(gitRoot, telemetrySkillPath),
      detail: 'Cannot validate telemetry catalog. File may not exist at the expected path.',
    });
    return findings;
  }

  const content = safeReadFile(telemetrySkillPath);
  if (content === null) {
    findings.push({
      rule: 'TOOL-02',
      severity: 'MEDIUM',
      title: 'Cannot read telemetry SKILL.md',
      file: path.relative(gitRoot, telemetrySkillPath),
      detail: 'File exists but could not be read.',
    });
    return findings;
  }

  // Parse tools from the Appendix section (listed as - `tool_name` under headings)
  const catalogTools = new Set();
  const headingEnd = content.indexOf('## Appendix: Complete Tool Catalog Reference');
  if (headingEnd === -1) {
    findings.push({
      rule: 'TOOL-02',
      severity: 'CRITICAL',
      title: 'Telemetry catalog appendix missing',
      file: path.relative(gitRoot, telemetrySkillPath),
      detail: 'The "## Appendix: Complete Tool Catalog Reference" section was not found.',
    });
    return findings;
  }

  const appendix = content.slice(headingEnd);
  const listItemRe = /^\s*-\s*`([a-z_]+)`/gm;
  let match;
  while ((match = listItemRe.exec(appendix)) !== null) {
    catalogTools.add(match[1]);
  }

  // Check each catalog tool against valid set
  const invalidTools = [...catalogTools].filter(t => !VALID_TOOL_SET.has(t));
  const missingFromCatalog = VALID_TOOLS.filter(t => !catalogTools.has(t));

  for (const tool of invalidTools) {
    findings.push({
      rule: 'TOOL-02',
      severity: 'CRITICAL',
      title: 'Telemetry catalog contains invalid tool name',
      file: path.relative(gitRoot, telemetrySkillPath),
      detail: `"${tool}" is listed in the telemetry Appendix but is NOT in the known-valid 45-tool catalog. Possible stale or hallucinated entry.`,
      fix: `Remove "${tool}" from the telemetry catalog or add it to the authoritative catalog if it is a real MCP tool.`,
    });
  }

  // Report tools in valid set but not in telemetry catalog
  if (missingFromCatalog.length > 0) {
    findings.push({
      rule: 'TOOL-02',
      severity: 'MEDIUM',
      title: 'Telemetry catalog is incomplete',
      file: path.relative(gitRoot, telemetrySkillPath),
      detail: `${catalogTools.size} tools in telemetry catalog, ${VALID_TOOLS.length} in authoritative catalog. Missing: ${missingFromCatalog.join(', ')}.`,
      fix: `Add missing tools to the telemetry SKILL.md Appendix: ${missingFromCatalog.join(', ')}`,
    });
  }

  if (invalidTools.length === 0 && missingFromCatalog.length === 0) {
    findings.push({
      rule: 'TOOL-02',
      severity: 'INFO',
      title: 'Telemetry catalog is fully valid and complete',
      file: path.relative(gitRoot, telemetrySkillPath),
      detail: `All ${catalogTools.size} tools in catalog match the authoritative set. No missing entries.`,
    });
  } else if (invalidTools.length === 0) {
    findings.push({
      rule: 'TOOL-02',
      severity: 'INFO',
      title: 'Telemetry catalog has no invalid entries',
      file: path.relative(gitRoot, telemetrySkillPath),
      detail: `All ${catalogTools.size} tools in catalog are valid. ${missingFromCatalog.length} tools missing from catalog.`,
    });
  }

  return findings;
}

function checkTool03(skillsDir, gitRoot) {
  const findings = [];
  const epic6Files = [];

  // All Epic 6 related skills and their files
  const epic6Patterns = [
    'bmad-code-review', 'gds-code-review', 'bmad-tea', 'bmad-testarch-trace',
    'bmad-agent-tech-writer', 'bmad-agent-pm', 'bmad-document-project',
    'bmad-party-mode', 'bmad-retrospective', 'bmad-quick-dev', 'bmad-story-automator',
  ];

  if (!fs.existsSync(skillsDir)) {
    findings.push({
      rule: 'TOOL-03',
      severity: 'HIGH',
      title: 'Skills directory not found',
      file: '.agents/skills/',
      detail: 'Cannot scan for 🧠 Memtrace Context blocks.',
    });
    return findings;
  }

  // Find all Epic 6 .md files
  for (const pattern of epic6Patterns) {
    const ep6Dir = path.join(skillsDir, pattern);
    if (!fs.existsSync(ep6Dir)) continue;
    const mdFiles = scanFiles(ep6Dir, ['.md']);
    for (const f of mdFiles) {
      epic6Files.push(f);
    }
  }

  let totalBlocks = 0;
  const filesWithBlocks = [];

  for (const file of epic6Files) {
    const content = safeReadFile(file);
    if (content === null) continue;
    const rel = path.relative(gitRoot, file);

    // Check for 🧠 Memtrace Context heading
    MEMTRACE_CONTEXT_HEADING_RE.lastIndex = 0;
    if (MEMTRACE_CONTEXT_HEADING_RE.test(content)) {
      totalBlocks++;
      filesWithBlocks.push(rel);
    } else if (VERBOSE) {
      // Count any heading containing "Memtrace Context" (without emoji)
      if (/^#{1,6}\s+.*Memtrace\s+Context/im.test(content)) {
        totalBlocks++;
        filesWithBlocks.push(rel);
      }
    }
  }

  if (totalBlocks < 13) {
    findings.push({
      rule: 'TOOL-03',
      severity: 'HIGH',
      title: `Insufficient 🧠 Memtrace Context blocks`,
      file: '.agents/skills/ (Epic 6 files)',
      detail: `Found ${totalBlocks} blocks across ${epic6Patterns.length} Epic 6 skills. Expected at least 13. Found in: ${filesWithBlocks.length > 0 ? filesWithBlocks.join(', ') : 'none'}`,
      fix: 'Add self-contained 🧠 Memtrace Context blocks to all Epic 6 skill files. Check which skills are missing them.',
    });
  } else {
    findings.push({
      rule: 'TOOL-03',
      severity: 'INFO',
      title: `Sufficient 🧠 Memtrace Context blocks`,
      file: '.agents/skills/ (Epic 6)',
      detail: `${totalBlocks} blocks found across ${filesWithBlocks.length} files in Epic 6 skills. Threshold: 13+.`,
    });
  }

  if (VERBOSE) {
    for (const f of filesWithBlocks) {
      findings.push({
        rule: 'TOOL-03',
        severity: 'INFO',
        title: '🧠 Memtrace Context block found',
        file: f,
        detail: 'Self-contained Memtrace context block present.',
      });
    }
  }

  return findings;
}

function checkTool04(skillsDir, gitRoot) {
  const findings = [];

  if (!fs.existsSync(skillsDir)) {
    findings.push({
      rule: 'TOOL-04',
      severity: 'MEDIUM',
      title: 'Skills directory not found',
      file: '.agents/skills/',
      detail: 'Cannot scan customize.toml files.',
    });
    return findings;
  }

  const allTomlFiles = scanFiles(skillsDir, ['.toml']);
  const customizeTomlFiles = allTomlFiles.filter(f => path.basename(f) === 'customize.toml');

  let totalChecked = 0;
  let totalInvalid = 0;

  for (const file of customizeTomlFiles) {
    const content = safeReadFile(file);
    if (content === null) continue;
    const rel = path.relative(gitRoot, file);

    // Extract persistent_facts array values
    const inFacts = content.match(/persistent_facts\s*=\s*\[([\s\S]*?)\]/);
    if (!inFacts) continue;

    const factValues = inFacts[1];
    // Extract string values from the array
    const stringValues = factValues.matchAll(/"([^"]*)"|'([^']*)'/g);

    for (const sv of stringValues) {
      const value = sv[1] || sv[2];
      const toolRefs = matchToolNames(value);
      const hallucinated = matchHallucinatedToolNames(value);

      for (const ref of toolRefs) {
        totalChecked++;
        if (!VALID_TOOL_SET.has(ref.name)) {
          totalInvalid++;
          findings.push({
            rule: 'TOOL-04',
            severity: 'CRITICAL',
            title: 'Invalid tool name in customize.toml persistent_facts',
            file: rel,
            detail: `persistent_facts references "${ref.name}" which is not in the known-valid catalog.`,
            fix: `Replace "${ref.name}" with a valid Memtrace MCP tool name.`,
          });
        }
      }

      for (const h of hallucinated) {
        totalChecked++;
        totalInvalid++;
        findings.push({
          rule: 'TOOL-04',
          severity: 'CRITICAL',
          title: 'Hallucinated tool name in customize.toml persistent_facts',
          file: rel,
          detail: `persistent_facts references "${h.fullName}" which is not a known Memtrace MCP tool.`,
          fix: `Replace "${h.fullName}" with a valid Memtrace MCP tool name.`,
        });
      }
    }
  }

  if (totalChecked === 0) {
    findings.push({
      rule: 'TOOL-04',
      severity: 'INFO',
      title: 'No customize.toml persistent_facts found',
      file: '.agents/skills/',
      detail: 'No customize.toml files with persistent_facts arrays found to check.',
    });
  } else if (totalInvalid === 0) {
    findings.push({
      rule: 'TOOL-04',
      severity: 'INFO',
      title: 'All customize.toml persistent_facts tool names valid',
      file: '.agents/skills/',
      detail: `${totalChecked} tool references checked across ${customizeTomlFiles.length} customize.toml files — all valid.`,
    });
  }

  return findings;
}

// --- Output formatting ---

function formatHumanReadable(allFindings) {
  const output = [];
  const severityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  let totalFindings = 0;

  output.push(
    `\nValidating Memtrace tool references for: ${PROJECT_ROOT}`,
    `Mode: ${STRICT ? 'STRICT (exit 1 on CRITICAL/HIGH)' : 'WARNING (exit 0)'}${JSON_OUTPUT ? ' + JSON' : ''}\n`,
  );

  const checkGroups = {};
  for (const f of allFindings) {
    const group = f.rule;
    if (!checkGroups[group]) checkGroups[group] = [];
    checkGroups[group].push(f);
  }

  for (const [group, findings] of Object.entries(checkGroups)) {
    output.push(`\n--- ${group} ---`);
    for (const f of findings) {
      totalFindings++;
      severityCounts[f.severity]++;
      const location = f.line ? ` (line ${f.line})` : '';
      output.push(`  [${f.severity}] ${f.title}`, `    File: ${f.file}${location}`, `    ${f.detail}`);
      if (f.fix) output.push(`    Fix: ${f.fix}`);

      if (process.env.GITHUB_ACTIONS) {
        const level = f.severity === 'LOW' || f.severity === 'INFO' ? 'notice' : f.severity === 'MEDIUM' ? 'warning' : 'error';
        console.log(`::${level} file=${escapeTableCell(f.file)},line=${f.line || 1}::${escapeAnnotation(`${group}: ${f.detail}`)}`);
      }
    }
  }

  output.push(
    `\n${'─'.repeat(60)}`,
    `\nSummary:`,
    `   Checks executed: ${Object.keys(checkGroups).length}`,
    `   Total findings: ${totalFindings}`,
  );

  if (totalFindings > 0) {
    output.push('', `   | Severity | Count |`, `   |----------|-------|`);
    for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']) {
      if (severityCounts[sev] > 0) {
        output.push(`   | ${sev.padEnd(8)} | ${String(severityCounts[sev]).padStart(5)} |`);
      }
    }
  }

  const hasHighPlus = severityCounts.CRITICAL > 0 || severityCounts.HIGH > 0;

  if (totalFindings === 0) {
    output.push(`\n   All tool reference checks passed!`);
  } else if (STRICT && hasHighPlus) {
    output.push(`\n   [STRICT MODE] CRITICAL/HIGH violations found — exiting with failure.`);
  } else if (STRICT) {
    output.push(`\n   [STRICT MODE] Only MEDIUM/LOW findings — pass.`);
  } else {
    output.push(`\n   Run with --strict to treat CRITICAL/HIGH findings as errors.`);
  }

  output.push('');
  return { output: output.join('\n'), hasHighPlus };
}

function formatJson(allFindings) {
  const hasHighPlus = allFindings.some((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  allFindings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { output: JSON.stringify(allFindings, null, 2), hasHighPlus };
}

// --- Main ---

if (process.argv[1] && (process.argv[1].endsWith('validate-tool-refs.mjs') || process.argv[1].endsWith('validate-tool-refs.js'))) {
  const gitRoot = findGitRoot(PROJECT_ROOT);
  if (!gitRoot) {
    console.error('Error: Not inside a git repository. Cannot determine project root.');
    process.exit(2);
  }

  const skillsDir = path.join(gitRoot, '.agents', 'skills');
  const srcDir = path.join(gitRoot, 'src');
  const telemetrySkillPath = path.join(skillsDir, 'bmad-memtrace-telemetry', 'SKILL.md');

  if (VERBOSE) {
    console.log(`Git root:     ${gitRoot}`);
    console.log(`Skills dir:   ${skillsDir}`);
    console.log(`Src dir:      ${srcDir}`);
    console.log(`Script root:  ${PROJECT_ROOT}`);
    console.log(`Valid tools:  ${VALID_TOOLS.length}`);
    console.log('');
  }

  const allFindings = [
    ...checkTool01(skillsDir, srcDir, gitRoot),
    ...checkTool02(telemetrySkillPath, gitRoot),
    ...checkTool03(skillsDir, gitRoot),
    ...checkTool04(skillsDir, gitRoot),
  ];

  allFindings.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file);
  });

  const { output: formatted, hasHighPlus } = JSON_OUTPUT
    ? formatJson(allFindings)
    : formatHumanReadable(allFindings);

  console.log(formatted);

  if (STRICT && hasHighPlus) {
    process.exit(1);
  }
}
