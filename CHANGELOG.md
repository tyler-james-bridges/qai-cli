# Changelog

## Unreleased

- Add `qai flow <url> <goal>`. Playwright snapshots the page; Jev picks one action from that closed set; only `--data` values are typed. Each step logs the action, Jev latency, and token or cost fields when the API returns them, plus total wall time.
- After an action, wait until the accessibility snapshot changes and the network is idle, so a client-side navigation is not judged from the previous page.
- Offer a fill only when the `--data` key matches the field name, so one value is not typed into every textbox.
