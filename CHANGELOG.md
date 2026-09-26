# Changelog

## Unreleased

- Add `qai flow <url> <goal>`. Playwright snapshots the page; Jev picks one action from that closed set; only `--data` values are typed. Each step logs the action, Jev latency, and token or cost fields when the API returns them, plus total wall time.
