# qai Benchmark Suite

Measures code review accuracy across LLM providers.

## Methodology

The benchmark uses a curated dataset of **10 realistic code diffs**, each containing a known bug. Bug types span:

| Category         | Cases                                                    |
| ---------------- | -------------------------------------------------------- |
| Security         | SQL injection, XSS, hardcoded secrets, unvalidated input |
| Bugs             | Null pointer / undefined access                          |
| Concurrency      | Race condition (TOCTOU)                                  |
| Error handling   | Missing try/catch on file operations                     |
| Logic            | Off-by-one in pagination                                 |
| Performance      | Memory leak / unclosed resources                         |
| Breaking changes | Public API signature change                              |

Each case includes:

- A unified diff (10-50 lines)
- Surrounding file context
- Expected issues with severity and category

## Scoring

For each test case the runner checks:

1. **True positive** — did the LLM identify the known bug? Matched via fuzzy keyword overlap on the issue description, category, and severity.
2. **False positives** — how many extra issues were reported beyond the expected ones.
3. **Latency** — wall-clock time per review call.

## Running

```bash
# Default provider (uses first available API key)
node benchmarks/run.js

# Specific provider
node benchmarks/run.js --provider anthropic

# JSON output to stdout
node benchmarks/run.js --json
```

Results are always saved to `benchmarks/results/`.

## Adding Test Cases

Create a new JSON file in `benchmarks/dataset/`:

```json
{
  "name": "descriptive-slug",
  "description": "What the bug is",
  "diff": "... unified diff ...",
  "context": { "files": { "path/to/file.js": "full file content" } },
  "expectedIssues": [
    {
      "severity": "critical",
      "category": "security",
      "description": "Short description of expected finding"
    }
  ]
}
```

Then re-run the benchmark. The runner auto-discovers all `.json` files in the dataset directory.
