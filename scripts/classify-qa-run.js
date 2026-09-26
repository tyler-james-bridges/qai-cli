#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { isProviderUnavailable } = require('./classify-qai-review');

function classifyQaRun(output, reportExists) {
  if (reportExists) {
    return { outcome: 'report', note: 'QA report generated' };
  }
  if (isProviderUnavailable(output)) {
    return { outcome: 'skipped', note: 'skipped: provider unavailable' };
  }
  return { outcome: 'missing', note: 'No QA report generated' };
}

function writeGithubOutput(result) {
  const dest = process.env.GITHUB_OUTPUT;
  if (!dest) return;
  fs.appendFileSync(dest, `outcome=${result.outcome}\nnote=${result.note}\n`);
}

function main(argv, cwd = process.cwd()) {
  const file = argv[2];
  let output = '';
  if (file) {
    const full = path.isAbsolute(file) ? file : path.join(cwd, file);
    try {
      output = fs.readFileSync(full, 'utf8');
    } catch {
      output = '';
    }
  }
  const reportExists = fs.existsSync(path.join(cwd, 'qa-report.md'));
  const result = classifyQaRun(output, reportExists);
  writeGithubOutput(result);
  process.stdout.write(JSON.stringify(result) + '\n');
  return result;
}

if (require.main === module) {
  main(process.argv);
}

module.exports = {
  classifyQaRun,
  main,
};
