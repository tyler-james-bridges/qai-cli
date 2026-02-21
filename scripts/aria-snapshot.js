/**
 * ARIA Snapshot Utility for qai
 * Generates AI-friendly DOM snapshots with element references
 * Adapted from dev-browser patterns
 */

/**
 * Browser-executable script that generates ARIA snapshots
 * This gets injected into the page via page.evaluate()
 */
const SNAPSHOT_SCRIPT = `
(function() {
  // Element reference counter
  let refCounter = 0;
  const refs = {};

  // Store refs on window for persistence
  window.__qaRefs = window.__qaRefs || {};

  // Interactive roles that should get refs
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
    'listbox', 'option', 'menuitem', 'tab', 'switch', 'slider',
    'spinbutton', 'searchbox', 'menu', 'menubar', 'dialog',
    'alertdialog', 'listitem', 'treeitem', 'gridcell', 'row',
    'columnheader', 'rowheader'
  ]);

  // Elements that are inherently interactive
  const INTERACTIVE_TAGS = new Set([
    'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY'
  ]);

  // Get computed accessible role
  function getRole(el) {
    // Explicit role
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;

    // Implicit role based on tag
    const tag = el.tagName;
    switch (tag) {
      case 'A': return el.href ? 'link' : null;
      case 'BUTTON': return 'button';
      case 'INPUT':
        const type = el.type || 'text';
        switch (type) {
          case 'button':
          case 'submit':
          case 'reset':
          case 'image': return 'button';
          case 'checkbox': return 'checkbox';
          case 'radio': return 'radio';
          case 'range': return 'slider';
          case 'search': return 'searchbox';
          default: return 'textbox';
        }
      case 'SELECT': return el.multiple ? 'listbox' : 'combobox';
      case 'TEXTAREA': return 'textbox';
      case 'IMG': return 'img';
      case 'NAV': return 'navigation';
      case 'MAIN': return 'main';
      case 'HEADER': return 'banner';
      case 'FOOTER': return 'contentinfo';
      case 'ASIDE': return 'complementary';
      case 'SECTION':
        return el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
          ? 'region' : null;
      case 'FORM': return 'form';
      case 'TABLE': return 'table';
      case 'TH': return 'columnheader';
      case 'TD': return 'cell';
      case 'TR': return 'row';
      case 'UL':
      case 'OL': return 'list';
      case 'LI': return 'listitem';
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6': return 'heading';
      case 'DIALOG': return 'dialog';
      default: return null;
    }
  }

  // Get accessible name
  function getAccessibleName(el) {
    // aria-label first
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    // aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labels = labelledBy.split(' ')
        .map(id => document.getElementById(id))
        .filter(Boolean)
        .map(e => e.textContent)
        .join(' ');
      if (labels) return labels.trim();
    }

    // Label element for form controls
    if (el.labels && el.labels.length) {
      return Array.from(el.labels).map(l => l.textContent).join(' ').trim();
    }

    // Alt text for images
    if (el.tagName === 'IMG' && el.alt) return el.alt;

    // Title attribute
    if (el.title) return el.title;

    // Text content for simple elements
    const text = el.textContent?.trim();
    if (text && text.length < 100) return text;

    // Placeholder for inputs
    if (el.placeholder) return el.placeholder;

    return null;
  }

  // Check if element is hidden
  function isHidden(el) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
    const style = getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden';
  }

  // Check if element should get a ref
  function shouldHaveRef(el, role) {
    if (INTERACTIVE_TAGS.has(el.tagName)) return true;
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.onclick || el.getAttribute('onclick')) return true;
    if (el.tabIndex >= 0) return true;
    return false;
  }

  // Get element state
  function getState(el) {
    const states = [];
    if (el.disabled) states.push('disabled');
    if (el.checked) states.push('checked');
    if (el.selected) states.push('selected');
    if (el.getAttribute('aria-expanded') === 'true') states.push('expanded');
    if (el.getAttribute('aria-expanded') === 'false') states.push('collapsed');
    if (el.getAttribute('aria-pressed') === 'true') states.push('pressed');
    if (el.getAttribute('aria-current')) states.push('current');
    if (el.required) states.push('required');
    if (el.readOnly) states.push('readonly');
    return states;
  }

  // Generate ref for element
  function getRef(el) {
    // Check if we already have a ref
    for (const [ref, element] of Object.entries(window.__qaRefs)) {
      if (element === el) return ref;
    }

    // Generate new ref
    const ref = 'e' + (++refCounter);
    window.__qaRefs[ref] = el;
    refs[ref] = el;
    return ref;
  }

  // Build snapshot tree
  function buildSnapshot(el, indent = 0) {
    if (!el || isHidden(el)) return '';

    const role = getRole(el);
    const name = getAccessibleName(el);
    const states = getState(el);
    const hasRef = shouldHaveRef(el, role);

    let lines = [];
    const prefix = '  '.repeat(indent);

    // Build this element's line if it has a role or is interactive
    if (role || hasRef) {
      let line = prefix + '- ';

      if (role) {
        line += role;
      } else {
        line += el.tagName.toLowerCase();
      }

      if (name) {
        // Escape quotes and limit length
        const safeName = name.replace(/"/g, '\\\\"').substring(0, 60);
        line += ' "' + safeName + '"';
      }

      if (hasRef) {
        line += ' [ref=' + getRef(el) + ']';
      }

      states.forEach(s => {
        line += ' [' + s + ']';
      });

      // Add properties for some elements
      if (el.tagName === 'A' && el.href) {
        lines.push(line);
        lines.push(prefix + '  - /url: "' + el.href.substring(0, 100) + '"');
      } else if (el.tagName === 'IMG' && el.src) {
        lines.push(line);
        lines.push(prefix + '  - /src: "' + el.src.substring(0, 100) + '"');
      } else if (el.placeholder) {
        lines.push(line);
        lines.push(prefix + '  - /placeholder: "' + el.placeholder + '"');
      } else if (el.value && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        lines.push(line);
        lines.push(prefix + '  - /value: "' + el.value.substring(0, 50) + '"');
      } else {
        lines.push(line);
      }
    }

    // Process children
    const childIndent = (role || hasRef) ? indent + 1 : indent;
    for (const child of el.children) {
      const childSnapshot = buildSnapshot(child, childIndent);
      if (childSnapshot) {
        lines.push(childSnapshot);
      }
    }

    return lines.join('\\n');
  }

  // Generate full snapshot
  const snapshot = buildSnapshot(document.body);

  return {
    snapshot,
    refCount: refCounter,
    timestamp: new Date().toISOString()
  };
})()
`;

/**
 * Get ARIA snapshot of the current page
 *
 * @param {import('playwright').Page} page - Playwright page object
 * @returns {Promise<{snapshot: string, refCount: number, timestamp: string}>}
 */
async function getAriaSnapshot(page) {
  return await page.evaluate(SNAPSHOT_SCRIPT);
}

/**
 * Select an element by its ref
 *
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string} ref - Element ref (e.g., 'e5')
 * @returns {Promise<import('playwright').ElementHandle|null>}
 */
async function selectByRef(page, ref) {
  return await page.evaluateHandle((ref) => {
    // eslint-disable-next-line no-undef
    return window.__qaRefs?.[ref] || null;
  }, ref);
}

/**
 * Click an element by its ref
 *
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string} ref - Element ref
 */
async function clickByRef(page, ref) {
  const element = await selectByRef(page, ref);
  if (element) {
    await element.click();
  } else {
    throw new Error(`Element with ref ${ref} not found`);
  }
}

/**
 * Type into an element by its ref
 *
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string} ref - Element ref
 * @param {string} text - Text to type
 */
async function typeByRef(page, ref, text) {
  const element = await selectByRef(page, ref);
  if (element) {
    await element.fill(text);
  } else {
    throw new Error(`Element with ref ${ref} not found`);
  }
}

/**
 * Get a compact snapshot suitable for AI analysis
 *
 * @param {import('playwright').Page} page - Playwright page object
 * @returns {Promise<string>} Formatted snapshot
 */
async function getCompactSnapshot(page) {
  const result = await getAriaSnapshot(page);

  let output = `# Page Snapshot (${result.timestamp})\n`;
  output += `Interactive elements: ${result.refCount}\n\n`;
  output += '```yaml\n';
  output += result.snapshot;
  output += '\n```\n';

  return output;
}

module.exports = {
  getAriaSnapshot,
  selectByRef,
  clickByRef,
  typeByRef,
  getCompactSnapshot,
  SNAPSHOT_SCRIPT,
};
