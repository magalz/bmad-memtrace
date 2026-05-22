/**
 * File Boundary Validator
 *
 * Verifies that key project directories and files are located inside the git repository
 * boundary (inner repo), not in the outer workspace directory.
 *
 * What it checks:
 * - BOUNDARY-01: Every file under `.agents/skills/` resolves inside the git repo
 * - BOUNDARY-02: Every file under `_bmad/scripts/memtrace/` resolves inside the git repo
 * - BOUNDARY-03: No planning artifacts or sprint-status files inside the git repo
 * - BOUNDARY-04: Story file Dev Notes contain only inner-repo paths (no absolute outer-repo leaks)
 *
 * Usage:
 *   node tools/validate-file-boundaries.mjs                    # Warn on violations (exit 0)
 *   node tools/validate-file-boundaries.mjs --strict            # Fail on violations (exit 1)
 *   node tools/validate-file-boundaries.mjs --verbose           # Show all scanned files
 *   node tools/validate-file-boundaries.mjs --json              # JSON output
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = path.resolve(__dirname);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

const args = new Set(process.argv.slice(2));
const STRICT = args.has('--strict');
const VERBOSE = args.has('--verbose');
const JSON_OUTPUT = args.has('--json');

// Patterns for planning / sprint-status artifacts
const PLANNING_FILE_PATTERNS = [/^.*prd.*\.md$/i, /^.*epic.*\.md$/i, /^.*architecture.*\.md$/i, /^sprint-status\.yaml$/];

// Absolute path patterns for Windows and Unix
// We check paths against the outer workspace boundary, not just any absolute path
const ABS_PATH_PATTERN_WIN = /[A-Z]:\\(?:[^\\:*?"<>|\r\n]+\\?)*/g;
const ABS_PATH_PATTERN_UNIX = /\/(?:home|Users|var|tmp|opt|etc)\/[^\s'")\]}>]*/g;

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// Normalize path for case-insensitive comparison on Windows
function pathStartsWith(target, prefix) {
  return target.toLowerCase().startsWith(prefix.toLowerCase());
}

function escapeAnnotation(str) {
  return str.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeTableCell(str) {
  return String(str).replaceAll('|', String.raw`\|`);
}

// --- Git root detection ---

function findGitRoot(startDir) {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: startDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    }).trim();
    return path.resolve(gitRoot);
  } catch {
    return null;
  }
}

// --- File scanning ---

function scanDirectory(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return [];
  } catch {
    return [];
  }
  const results = [];
  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      } else if (entry.isSymbolicLink()) {
        // Resolve symlinks — check the real path
        try {
          const realPath = fs.realpathSync(fullPath);
          const stat = fs.statSync(realPath);
          if (stat.isDirectory()) {
            walk(realPath);
          } else if (stat.isFile()) {
            results.push(realPath);
          }
        } catch {
          /* broken symlink, skip */
        }
      }
    }
  }
  walk(dirPath);
  return results;
}

function findFilesMatching(rootDir, patterns) {
  try {
    if (!fs.existsSync(rootDir)) return [];
  } catch {
    return [];
  }
  const results = [];
  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        for (const p of patterns) {
          if (p.test(entry.name)) {
            results.push(fullPath);
            break;
          }
        }
      } else if (entry.isSymbolicLink()) {
        try {
          const realPath = fs.realpathSync(fullPath);
          const stat = fs.statSync(realPath);
          if (stat.isDirectory()) {
            walk(realPath);
          } else if (stat.isFile()) {
            for (const p of patterns) {
              if (p.test(path.basename(realPath))) {
                results.push(realPath);
                break;
              }
            }
          }
        } catch {
          /* skip broken symlink */
        }
      }
    }
  }
  walk(rootDir);
  return results;
}

// --- Check implementations ---

function checkDirBoundary(gitRoot, dirSegments, ruleName) {
  const findings = [];
  const dirPath = path.join(gitRoot, ...dirSegments);
  const dirLabel = dirSegments.join('/');

  let totalFiles = 0;
  const dirExists = fs.existsSync(dirPath);

  if (dirExists) {
    const files = scanDirectory(dirPath);
    totalFiles = files.length;

    for (const file of files) {
      if (!pathStartsWith(file, gitRoot)) {
        const rel = path.relative(gitRoot, file);
        findings.push({
          rule: ruleName,
          severity: 'CRITICAL',
          title: 'File outside git repo boundary',
          file: rel,
          detail: `Resolves to ${file} which is outside git root ${gitRoot}.`,
        });
      }
    }

    if (VERBOSE) {
      findings.push({
        rule: ruleName,
        severity: 'LOW',
        title: `${dirLabel}/ found at git root`,
        file: `${dirLabel}/`,
        detail: `Directory exists at ${dirPath} with ${totalFiles} files.`,
      });
    }
  } else {
    if (VERBOSE) {
      findings.push({
        rule: ruleName,
        severity: 'LOW',
        title: `${dirLabel}/ not found at git root`,
        file: `${dirLabel}/`,
        detail: `Directory does not exist at ${dirPath}.`,
      });
    }
  }

  const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;

  if (totalFiles === 0 && dirExists) {
    findings.push({
      rule: ruleName,
      severity: 'MEDIUM',
      title: `${dirLabel}/ exists but empty`,
      file: `${dirLabel}/`,
      detail: `Directory exists at ${dirPath} but contains no files.`,
    });
  } else if (totalFiles === 0 && !dirExists) {
    const expectedMsg =
      ruleName === 'BOUNDARY-02'
        ? 'Directory does not exist at git root. Expected if Epics 3-4 scripts are not yet deployed.'
        : 'Directory does not exist at git root.';
    findings.push({
      rule: ruleName,
      severity: 'MEDIUM',
      title: `${dirLabel}/ not found`,
      file: `${dirLabel}/`,
      detail: expectedMsg,
    });
  } else if (criticalCount === 0) {
    findings.push({
      rule: ruleName,
      severity: 'LOW',
      title: `All ${dirLabel}/ files inside git repo`,
      file: `${dirLabel}/`,
      detail: `${totalFiles} files verified, all inside git root.`,
    });
  }

  return findings;
}

function checkBoundary01(gitRoot) {
  return checkDirBoundary(gitRoot, ['.agents', 'skills'], 'BOUNDARY-01');
}

function checkBoundary02(gitRoot) {
  return checkDirBoundary(gitRoot, ['_bmad', 'scripts', 'memtrace'], 'BOUNDARY-02');
}

function checkBoundary03(gitRoot) {
  const findings = [];
  const planningFiles = findFilesMatching(gitRoot, PLANNING_FILE_PATTERNS);

  for (const file of planningFiles) {
    const rel = path.relative(gitRoot, file);
    // Exclude template files under src/ — those are intentional source templates
    if (pathStartsWith(rel, 'src') || pathStartsWith(rel, 'node_modules') || pathStartsWith(rel, '.git')) continue;
    findings.push({
      rule: 'BOUNDARY-03',
      severity: 'CRITICAL',
      title: 'Planning artifact or sprint-status file inside git repo',
      file: rel,
      detail: `File ${rel} should reside outside the git root, in the outer workspace _bmad-output/ directory.`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      rule: 'BOUNDARY-03',
      severity: 'LOW',
      title: 'No planning artifacts or sprint-status files inside git repo',
      file: '(git root)',
      detail: 'Clean — all planning artifacts are correctly outside the inner repo.',
    });
  }

  return findings;
}

function checkBoundary04(gitRoot, cwd) {
  const findings = [];
  const candidateDirs = [path.join(cwd, '_bmad-output', 'implementation-artifacts')];

  let implArtifactsDir = null;
  for (const dir of candidateDirs) {
    const resolved = path.resolve(dir);
    if (fs.existsSync(resolved)) {
      implArtifactsDir = resolved;
      break;
    }
  }

  if (!implArtifactsDir) {
    findings.push({
      rule: 'BOUNDARY-04',
      severity: 'MEDIUM',
      title: '_bmad-output/implementation-artifacts/ directory not found',
      file: '_bmad-output/implementation-artifacts/',
      detail: 'Cannot scan story files for absolute path leaks. Checked git root path.',
    });
    return findings;
  }

  const storyFiles = findFilesMatching(implArtifactsDir, [/\.md$/]);
  if (storyFiles.length === 0) {
    findings.push({
      rule: 'BOUNDARY-04',
      severity: 'LOW',
      title: 'No story files to scan',
      file: '_bmad-output/implementation-artifacts/',
      detail: 'No .md files found in implementation artifacts directory.',
    });
    return findings;
  }

  for (const storyFile of storyFiles) {
    const rel = path.relative(gitRoot, storyFile);
    let content;
    try {
      content = fs.readFileSync(storyFile, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.replaceAll('\r\n', '\n').split('\n');

    let inDevNotes = false;
    for (const [i, line] of lines.entries()) {
      // Track section boundaries
      if (/^## Dev Notes/i.test(line)) {
        inDevNotes = true;
        continue;
      }
      if (/^## /i.test(line) && !/^## Dev Notes/i.test(line)) {
        inDevNotes = false;
        continue;
      }

      // Only check Dev Notes and References sections
      if (!inDevNotes && !/^### References/i.test(line)) continue;

      // Check Windows absolute paths
      let match;
      ABS_PATH_PATTERN_WIN.lastIndex = 0;
      while ((match = ABS_PATH_PATTERN_WIN.exec(line)) !== null) {
        const absPath = match[0];
        // Skip single drive-letter patterns used as examples (e.g., "C:\" alone)
        if (/^[A-Z]:\\$/.test(absPath)) continue;
        // If the path starts inside the git root, it's fine (inner repo ref)
        if (pathStartsWith(absPath, gitRoot)) continue;
        // Flag any absolute path outside the git root
        findings.push({
          rule: 'BOUNDARY-04',
          severity: 'CRITICAL',
          title: 'Absolute path outside git root in story file',
          file: rel,
          line: i + 1,
          detail: `Line ${i + 1} references "${absPath}" which is outside git root ${gitRoot}.`,
        });
      }

      // Check Unix absolute paths
      ABS_PATH_PATTERN_UNIX.lastIndex = 0;
      while ((match = ABS_PATH_PATTERN_UNIX.exec(line)) !== null) {
        const absPath = match[0];
        if (absPath.startsWith('/home/') || absPath.startsWith('/Users/')) {
          findings.push({
            rule: 'BOUNDARY-04',
            severity: 'CRITICAL',
            title: 'Absolute path reference in story file',
            file: rel,
            line: i + 1,
            detail: `Line ${i + 1} contains Unix absolute path "${absPath}" which references outer workspace.`,
          });
        }
      }
    }
  }

  if (findings.length === 0) {
    findings.push({
      rule: 'BOUNDARY-04',
      severity: 'LOW',
      title: 'No absolute path leaks in story files',
      file: '_bmad-output/implementation-artifacts/',
      detail: 'All story file paths use inner-repo references.',
    });
  }

  return findings;
}

// --- Output formatting ---

function formatHumanReadable(allFindings) {
  const output = [];
  const severityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  let totalFindings = 0;

  output.push(
    `\nValidating file boundaries for: ${PROJECT_ROOT}`,
    `Mode: ${STRICT ? 'STRICT (exit 1 on violations)' : 'WARNING (exit 0)'}${JSON_OUTPUT ? ' + JSON' : ''}\n`,
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

      if (process.env.GITHUB_ACTIONS) {
        const level = f.severity === 'LOW' ? 'notice' : f.severity === 'MEDIUM' ? 'warning' : 'error';
        console.log(`::${level} file=${escapeTableCell(f.file)},line=${f.line || 1}::${escapeAnnotation(`${f.rule}: ${f.detail}`)}`);
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
    for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
      if (severityCounts[sev] > 0) {
        output.push(`   | ${sev.padEnd(8)} | ${String(severityCounts[sev]).padStart(5)} |`);
      }
    }
  }

  const hasHighPlus = severityCounts.CRITICAL > 0 || severityCounts.HIGH > 0;

  if (totalFindings === 0) {
    output.push(`\n   All boundary checks passed!`);
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

if (
  process.argv[1] &&
  (process.argv[1].endsWith('validate-file-boundaries.mjs') || process.argv[1].endsWith('validate-file-boundaries.js'))
) {
  const gitRoot = findGitRoot(PROJECT_ROOT);
  if (!gitRoot) {
    console.error('Error: Not inside a git repository. Cannot determine repo boundary.');
    process.exit(2);
  }

  if (VERBOSE) {
    console.log(`Git root: ${gitRoot}`);
    console.log(`CWD:      ${PROJECT_ROOT}`);
    console.log(`Script:   ${SCRIPT_DIR}`);
    console.log('');
  }

  // CWD for relative path scanning: use git root (the inner repo root)
  const cwd = gitRoot;

  const allFindings = [
    ...checkBoundary01(gitRoot),
    ...checkBoundary02(gitRoot),
    ...checkBoundary03(gitRoot),
    ...checkBoundary04(gitRoot, cwd),
  ];

  allFindings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const { output: formatted, hasHighPlus } = JSON_OUTPUT ? formatJson(allFindings) : formatHumanReadable(allFindings);

  console.log(formatted);

  if (STRICT && hasHighPlus) {
    process.exit(1);
  }
}
