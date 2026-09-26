#!/usr/bin/env bash
# Sample reports for the qa-test severity counter.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
counter="$root/scripts/count-qa-severity.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/prose.md" <<'EOF'
# QA Report

## Summary

SPEED IS CRITICAL. The highlight treatment is high quality. No critical bugs.

## Bugs Found

### Spacing

**Severity:** medium
**Category:** visual

Padding is tight. Not critical.
EOF

cat >"$tmp/critical.md" <<'EOF'
# QA Report

## Summary

SPEED IS CRITICAL but login is broken. Highlight is fine.

## Bugs Found

### Login bypass

**Severity:** critical
**Category:** functional

Anyone can skip auth. This is not a high priority visual nit.
EOF

cat >"$tmp/high.md" <<'EOF'
# QA Report: Checkout

## Summary

SPEED IS CRITICAL. One bug. The highlight state is wrong.

## Bugs Found

### [BUG-001] Checkout button dead

- **Severity**: High
- **Category**: Functional

Button does nothing. Not a critical outage.
EOF

cat >"$tmp/none.md" <<'EOF'
# QA Report

## Bugs Found

No bugs found.
EOF

cat >"$tmp/placeholder.md" <<'EOF'
# QA Report

## Bugs Found

**Severity:** [critical|high|medium|low]
Write exactly one of those words: critical, high, medium, or low.

No bugs found. SPEED IS CRITICAL.
EOF

old_count() {
  local pattern="$1"
  local file="$2"
  local value
  value=$(grep -i -c -E "$pattern" "$file" || echo "0")
  printf '%q' "$value"
}

run_new() {
  local file="$1"
  local out code
  set +e
  out=$(bash "$counter" "$file" 2>&1)
  code=$?
  set -e
  printf '%s\n' "$out"
  printf 'exit=%s\n' "$code"
  printf '%s\n' "$code" >"$tmp/last.exit"
  printf '%s\n' "$out" >"$tmp/last.out"
}

expect() {
  local name="$1"
  local want_exit="$2"
  local want_critical="$3"
  local want_high="$4"
  local got_exit got_critical got_high
  got_exit=$(cat "$tmp/last.exit")
  got_critical=$(sed -n 's/^Critical bugs: //p' "$tmp/last.out")
  got_high=$(sed -n 's/^High severity bugs: //p' "$tmp/last.out")
  if [[ "$got_exit" != "$want_exit" || ! "$got_critical" =~ ^[0-9]+$ || ! "$got_high" =~ ^[0-9]+$ || "$got_critical" != "$want_critical" || "$got_high" != "$want_high" ]]; then
    echo "FAIL $name: exit=$got_exit critical=$(printf '%q' "$got_critical") high=$(printf '%q' "$got_high") (wanted exit=$want_exit critical=$want_critical high=$want_high)" >&2
    exit 1
  fi
}

echo "=== prose: zero findings, word critical in prose ==="
echo "old critical=$(old_count '(critical|severity:\s*critical)' "$tmp/prose.md")"
echo "old high=$(old_count '(high|severity:\s*high)' "$tmp/prose.md")"
run_new "$tmp/prose.md"
expect prose 0 0 0

echo
echo "=== one real critical (qai scan markup) ==="
echo "old critical=$(old_count '(critical|severity:\s*critical)' "$tmp/critical.md")"
echo "old high=$(old_count '(high|severity:\s*high)' "$tmp/critical.md")"
run_new "$tmp/critical.md"
expect critical 1 1 0

echo
echo "=== one real high (Claude list markup) ==="
echo "old critical=$(old_count '(critical|severity:\s*critical)' "$tmp/high.md")"
echo "old high=$(old_count '(high|severity:\s*high)' "$tmp/high.md")"
run_new "$tmp/high.md"
expect high 1 0 1

echo
echo "=== placeholder line is not a finding ==="
run_new "$tmp/placeholder.md"
expect placeholder 0 0 0

echo
echo "=== template file itself ==="
run_new "$root/.claude/qa-engineer-prompt.md"
expect template 0 0 0

echo
echo "=== no severity words (old grep -c || echo 0) ==="
echo "old critical=$(old_count '(critical|severity:\s*critical)' "$tmp/none.md")"
echo "old high=$(old_count '(high|severity:\s*high)' "$tmp/none.md")"
run_new "$tmp/none.md"
expect none 0 0 0

echo
echo "ok"
