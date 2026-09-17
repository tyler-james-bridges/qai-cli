#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function collectTests(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTests(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      acc.push(full);
    }
  }
  return acc;
}

const files = collectTests(__dirname).sort();
const extra = process.argv.slice(2);
const result = spawnSync(process.execPath, ['--test', ...extra, ...files], {
  stdio: 'inherit',
});

process.exit(result.status === null ? 1 : result.status);
