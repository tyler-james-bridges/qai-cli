# Intentional Bugs in Demo Site

This site contains intentional bugs for testing qai.

| Bug                                    | Category      | Severity | Location                 |
| -------------------------------------- | ------------- | -------- | ------------------------ |
| Broken "Resources" link                | Functional    | High     | index.html:14            |
| Missing alt text on hero image         | Accessibility | Medium   | index.html:19            |
| Hero image 404                         | Network       | Medium   | index.html:19            |
| Mobile nav doesn't work                | Functional    | High     | style.css:186, app.js:56 |
| Horizontal scroll on mobile            | Visual        | Medium   | style.css:79             |
| Missing focus styles                   | Accessibility | Medium   | style.css:197            |
| Form has no validation                 | Functional    | Medium   | index.html:75-82         |
| Email input wrong type                 | Accessibility | Low      | index.html:79            |
| Console error: undefined siteConfig    | JavaScript    | Medium   | app.js:7                 |
| Console error: undefined trackPurchase | JavaScript    | Medium   | app.js:51                |
| Console error: undefined analytics     | JavaScript    | Low      | app.js:71                |
| No required fields on form             | Functional    | Medium   | index.html:75-82         |
| Disabled button with no explanation    | UX            | Low      | index.html:66            |
| Scroll handler not throttled           | Performance   | Low      | app.js:62                |
| Generic form error message             | UX            | Low      | app.js:41                |

## Expected QA Findings

A thorough QA test should find:

- **3+** console errors
- **2+** accessibility issues
- **2+** mobile/responsive issues
- **1** broken link
- **1** 404 resource

## Testing This Site

```bash
# Via GitHub Actions
Go to Actions → qai → Run workflow
URL: https://tyler-james-bridges.github.io/qai-cli/

# Via Visual Regression
Go to Actions → Visual Regression Testing → Run workflow
URL: https://tyler-james-bridges.github.io/qai-cli/
```
