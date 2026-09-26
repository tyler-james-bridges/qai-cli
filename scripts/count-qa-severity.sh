#!/usr/bin/env bash
# Count critical/high findings in a qa-report.md.
# qai scan and the Claude prompt: **Severity:** critical
# Previous Claude list item: - **Severity**: Critical
set -euo pipefail

file=${1:?usage: count-qa-severity.sh <qa-report.md>}

if [[ ! -f "$file" ]]; then
  echo "count-qa-severity: report not found: $file" >&2
  exit 2
fi

count_level() {
  local level="$1"
  local scan claude
  # grep -c prints 0 and exits 1 when nothing matches. `|| true` keeps that
  # single 0. `|| echo 0` appends a second 0.
  scan=$(grep -i -c -E '^[[:space:]]*\*\*Severity:\*\*[[:space:]]*'"${level}"'[[:space:]]*$' "$file" || true)
  claude=$(grep -i -c -E '^[[:space:]]*-[[:space:]]+\*\*Severity\*\*:[[:space:]]*'"${level}"'[[:space:]]*$' "$file" || true)
  if [[ ! "$scan" =~ ^[0-9]+$ || ! "$claude" =~ ^[0-9]+$ ]]; then
    echo "count-qa-severity: ${level} count is not a single integer (scan=$(printf '%q' "$scan") claude=$(printf '%q' "$claude"))" >&2
    exit 2
  fi
  echo $((scan + claude))
}

critical=$(count_level critical)
high=$(count_level high)

echo "Critical bugs: $critical"
echo "High severity bugs: $high"

if [[ "$critical" -gt 0 ]]; then
  echo "::error::Found $critical critical bug(s) - failing workflow"
  exit 1
fi

if [[ "$high" -gt 0 ]]; then
  echo "::warning::Found $high high severity bug(s) - failing workflow"
  exit 1
fi

echo "✓ No critical/high severity bugs found"
