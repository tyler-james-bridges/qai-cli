/**
 * PR Code Review Engine
 *
 * Fetches PR diffs, gathers codebase context, and sends to LLM for deep review.
 *
 * Usage:
 *   const { reviewPR } = require('./review');
 *   const report = await reviewPR({ pr: 42, base: 'main' });
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getProvider } = require('./providers');

/**
 * Review a PR or branch diff
 *
 * @param {Object} options
 * @param {number} [options.pr] - PR number to review
 * @param {string} [options.base] - Base branch for diff (default: main)
 * @param {string} [options.cwd] - Working directory (default: process.cwd())
 * @param {string} [options.focus] - Focus area (security, performance, bugs, all)
 * @param {boolean} [options.json] - Output JSON instead of markdown
 * @returns {Promise<ReviewReport>}
 */
async function reviewPR(options = {}) {
  const { pr, base = 'main', cwd = process.cwd(), focus = 'all' } = options;

  // Step 1: Get the diff
  console.log('[1/4] Fetching diff...');
  const diff = getDiff({ pr, base, cwd });

  if (!diff.trim()) {
    return {
      summary: 'No changes found.',
      issues: [],
      score: 100,
      recommendations: [],
    };
  }

  // Step 2: Parse changed files
  console.log('[2/4] Analyzing changed files...');
  const changedFiles = parseChangedFiles(diff);
  console.log(`  ${changedFiles.length} files changed`);

  // Step 3: Gather context for each changed file
  console.log('[3/4] Gathering codebase context...');
  const context = gatherContext(changedFiles, cwd);

  // Step 4: Send to LLM for review
  console.log('[4/4] Reviewing with AI...');
  const provider = getProvider();
  const report = await provider.reviewCode(diff, context, { focus });

  return report;
}

/**
 * Get diff from PR number or branch comparison
 */
function getDiff({ pr, base, cwd }) {
  try {
    if (pr) {
      // Fetch PR diff via gh CLI
      return execSync(`gh pr diff ${pr} --color=never`, {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } else {
      // Diff current branch against base
      return execSync(`git diff ${base}...HEAD`, {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
    }
  } catch (error) {
    throw new Error(`Failed to get diff: ${error.message}`);
  }
}

/**
 * Parse a unified diff into structured file changes
 */
function parseChangedFiles(diff) {
  const files = [];
  const fileDiffs = diff.split(/^diff --git /m).filter(Boolean);

  for (const fileDiff of fileDiffs) {
    const headerMatch = fileDiff.match(/a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const filePath = headerMatch[2];
    const isNew = fileDiff.includes('new file mode');
    const isDeleted = fileDiff.includes('deleted file mode');

    // Extract hunks
    const hunks = [];
    const hunkRegex = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/gm;
    let match;
    while ((match = hunkRegex.exec(fileDiff)) !== null) {
      hunks.push({
        oldStart: parseInt(match[1], 10),
        newStart: parseInt(match[2], 10),
        header: match[3].trim(),
      });
    }

    // Count additions and deletions
    const lines = fileDiff.split('\n');
    const additions = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
    const deletions = lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;

    files.push({
      path: filePath,
      isNew,
      isDeleted,
      hunks,
      additions,
      deletions,
      diff: fileDiff,
    });
  }

  return files;
}

/**
 * Gather relevant context for changed files
 *
 * For each changed file, we collect:
 * - The full current file content (for understanding structure)
 * - Import/require dependencies
 * - Files that import/require the changed file
 * - Related test files
 */
function gatherContext(changedFiles, cwd) {
  const context = {
    files: {},
    dependencies: {},
    dependents: {},
    tests: {},
    summary: '',
  };

  const MAX_CONTEXT_CHARS = 200000; // ~50K tokens
  let totalChars = 0;

  for (const file of changedFiles) {
    if (file.isDeleted) continue;
    if (totalChars > MAX_CONTEXT_CHARS) break;

    const fullPath = path.join(cwd, file.path);

    // Read full file content
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      // Skip huge files
      if (content.length > 50000) {
        context.files[file.path] =
          `[File too large: ${content.length} chars, showing first 5000]\n${content.slice(0, 5000)}`;
      } else {
        context.files[file.path] = content;
      }
      totalChars += Math.min(content.length, 50000);
    } catch {
      // File might not exist locally (renamed, etc.)
    }

    // Find imports in this file
    const deps = findImports(fullPath, cwd);
    if (deps.length > 0) {
      context.dependencies[file.path] = deps;
    }

    // Find files that depend on this file
    const dependents = findDependents(file.path, cwd);
    if (dependents.length > 0) {
      context.dependents[file.path] = dependents;
      // Include first few dependent file contents for context
      for (const dep of dependents.slice(0, 3)) {
        if (totalChars > MAX_CONTEXT_CHARS) break;
        try {
          const depPath = path.join(cwd, dep);
          const depContent = fs.readFileSync(depPath, 'utf-8');
          if (!context.files[dep] && depContent.length < 20000) {
            context.files[dep] = depContent;
            totalChars += depContent.length;
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Find related test files
    const testFile = findTestFile(file.path, cwd);
    if (testFile) {
      context.tests[file.path] = testFile;
    }
  }

  // Build summary
  const fileList = changedFiles.map((f) => {
    const status = f.isNew ? '(new)' : f.isDeleted ? '(deleted)' : '';
    return `  ${f.path} ${status} +${f.additions} -${f.deletions}`;
  });
  context.summary = `${changedFiles.length} files changed:\n${fileList.join('\n')}`;

  return context;
}

/**
 * Find imports/requires in a file
 */
function findImports(filePath, _cwd) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const imports = [];

    // ES imports
    const esImportRegex = /import\s+.*?\s+from\s+['"](.+?)['"]/g;
    let match;
    while ((match = esImportRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // CommonJS requires
    const cjsRegex = /require\(['"](.+?)['"]\)/g;
    while ((match = cjsRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Filter to local imports only (starting with . or /)
    return imports.filter((i) => i.startsWith('.') || i.startsWith('/'));
  } catch {
    return [];
  }
}

/**
 * Find files that import/require a given file
 */
function findDependents(filePath, cwd) {
  const basename = path.basename(filePath, path.extname(filePath));

  try {
    // Use grep to find files that reference this module
    const result = execSync(
      'grep -rl --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" ' +
        '--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=dist ' +
        `"${basename}" . 2>/dev/null | head -20`,
      { cwd, encoding: 'utf-8', timeout: 10000 },
    );

    return result
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((f) => f.replace(/^\.\//, ''))
      .filter((f) => f !== filePath); // Exclude self
  } catch {
    return [];
  }
}

/**
 * Find the test file for a given source file
 */
function findTestFile(filePath, cwd) {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const dir = path.dirname(filePath);

  // Common test file patterns
  const patterns = [
    path.join(dir, `${base}.test${ext}`),
    path.join(dir, `${base}.spec${ext}`),
    path.join(dir, '__tests__', `${base}${ext}`),
    path.join(dir, '__tests__', `${base}.test${ext}`),
    path.join('test', `${base}.test${ext}`),
    path.join('tests', `${base}.test${ext}`),
    path.join('test', `${base}.spec${ext}`),
    path.join('tests', `${base}.spec${ext}`),
  ];

  for (const pattern of patterns) {
    const fullPath = path.join(cwd, pattern);
    if (fs.existsSync(fullPath)) {
      return pattern;
    }
  }

  return null;
}

/**
 * Format review report as markdown
 */
function formatReviewMarkdown(report) {
  const lines = [];

  lines.push('# Code Review Report');
  lines.push('');
  lines.push(`**Score:** ${report.score}/100`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(report.summary || 'No summary provided.');
  lines.push('');

  if (report.issues && report.issues.length > 0) {
    lines.push('## Issues');
    lines.push('');

    for (const issue of report.issues) {
      const emoji =
        { critical: '\u{1F534}', high: '\u{1F7E0}', medium: '\u{1F7E1}', low: '\u{1F7E2}' }[
          issue.severity
        ] || '\u26AA';

      lines.push(`### ${emoji} ${issue.title}`);
      lines.push('');
      lines.push(
        `**Severity:** ${issue.severity} | **File:** \`${issue.file || 'N/A'}\`${issue.line ? ` | **Line:** ${issue.line}` : ''}`,
      );
      lines.push('');
      lines.push(issue.description);
      lines.push('');
      if (issue.suggestion) {
        lines.push('**Suggestion:**');
        lines.push(issue.suggestion);
        lines.push('');
      }
    }
  } else {
    lines.push('## Issues');
    lines.push('');
    lines.push('No issues found. Code looks good!');
    lines.push('');
  }

  if (report.recommendations && report.recommendations.length > 0) {
    lines.push('## Recommendations');
    lines.push('');
    for (const rec of report.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*Generated by [qai](https://github.com/tyler-james-bridges/qai-cli)*');

  return lines.join('\n');
}

module.exports = {
  reviewPR,
  getDiff,
  parseChangedFiles,
  gatherContext,
  findImports,
  findDependents,
  findTestFile,
  formatReviewMarkdown,
};
