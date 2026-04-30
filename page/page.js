class Page {
  constructor(connection) {
    this.connection = connection;
  }

  async getHTML() {
    const response = await this.connection.send("DOM.getDocument");

    if (!response.result) {
      throw new Error("DOM is not ready");
    }

    const rootNodeId = response.result.root.nodeId;
    const htmlResponse = await this.connection.send("DOM.getOuterHTML", {
      nodeId: rootNodeId
    });

    return htmlResponse.result.outerHTML;
  }

  async click(target) {
    console.log("Finding:", describeLocator(target));

    const { x, y } = await this.findClickablePoint(target);

    console.log("Clicking at:", x, y);

    await this.connection.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y
    });

    await this.connection.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1
    });

    await this.connection.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1
    });
  }

  async type(target, value) {
    const found = await this.focusInput(target);

    if (!found) {
      throw new Error(`No input found for ${describeLocator(target)}`);
    }

    await this.connection.send("Input.insertText", {
      text: String(value)
    });
  }

  async hasText(text) {
    const response = await this.connection.send("Runtime.evaluate", {
      expression: `document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(String(text).toLowerCase())})`,
      returnByValue: true
    });

    return Boolean(response.result?.result?.value);
  }

  async waitForText(text, options = {}) {
    const waitOptions = normalizeWaitOptions(options);

    await waitUntil(
      () => this.hasText(text),
      waitOptions,
      `Timed out after ${waitOptions.timeout}ms waiting for text "${text}"`
    );

    return true;
  }

  async exists(target) {
    const response = await this.connection.send("Runtime.evaluate", {
      expression: buildLocatorExpression(target, "exists"),
      returnByValue: true
    });

    return Boolean(response.result?.result?.value);
  }

  async waitFor(target, options = {}) {
    const waitOptions = normalizeWaitOptions(options);

    await waitUntil(
      () => this.exists(target),
      waitOptions,
      `Timed out after ${waitOptions.timeout}ms waiting for ${describeLocator(target)}`
    );

    return true;
  }

  async text(target) {
    const response = await this.connection.send("Runtime.evaluate", {
      expression: buildLocatorExpression(target, "text"),
      returnByValue: true
    });

    const value = response.result?.result?.value;

    if (value === null || value === undefined) {
      throw new Error(`No element found for ${describeLocator(target)}`);
    }

    return value;
  }

  async findClickablePoint(target) {
    const response = await this.connection.send("Runtime.evaluate", {
      expression: buildLocatorExpression(target, "clickPoint"),
      returnByValue: true
    });

    const value = response.result?.result?.value;

    if (!value) {
      throw new Error(`No clickable element found for ${describeLocator(target)}`);
    }

    return value;
  }

  async focusInput(target) {
    const response = await this.connection.send("Runtime.evaluate", {
      expression: buildLocatorExpression(target, "focusInput"),
      returnByValue: true
    });

    return Boolean(response.result?.result?.value);
  }
}

async function waitUntil(check, options, timeoutMessage) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt <= options.timeout) {
    try {
      if (await check()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(options.interval);
  }

  if (lastError) {
    throw new Error(`${timeoutMessage}. Last error: ${lastError.message || lastError}`);
  }

  throw new Error(timeoutMessage);
}

function normalizeWaitOptions(options = {}) {
  if (typeof options === "number") {
    return {
      timeout: options,
      interval: 100
    };
  }

  return {
    timeout: Number(options.timeout || options.timeoutMs || 5000),
    interval: Number(options.interval || options.intervalMs || 100)
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildLocatorExpression(target, action) {
  const locator = normalizeLocator(target);

  return `(() => {
    const locator = ${JSON.stringify(locator)};
    const action = ${JSON.stringify(action)};

    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;

      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0;
    }

    function isClickable(el) {
      if (!el || !(el instanceof Element)) return false;

      const tag = el.tagName.toLowerCase();

      return ['button', 'a', 'input', 'select', 'textarea'].includes(tag) ||
        Boolean(el.onclick) ||
        el.getAttribute('role') === 'button' ||
        window.getComputedStyle(el).cursor === 'pointer';
    }

    function textFor(el) {
      return [
        el.innerText,
        el.textContent,
        el.value,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('alt')
      ].filter(Boolean).join(' ');
    }

    function getLabelText(input) {
      const labels = input.id
        ? Array.from(document.querySelectorAll('label[for="' + CSS.escape(input.id) + '"]')).map(label => label.innerText)
        : [];

      const parentLabel = input.closest('label')?.innerText;

      return [
        input.getAttribute('aria-label'),
        input.getAttribute('placeholder'),
        input.name,
        input.value,
        parentLabel,
        ...labels
      ].filter(Boolean).join(' ');
    }

    function roleFor(el) {
      const explicitRole = el.getAttribute('role');

      if (explicitRole) return explicitRole.toLowerCase();

      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();

      if (tag === 'button') return 'button';
      if (tag === 'a' && el.hasAttribute('href')) return 'link';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'input' && ['button', 'submit', 'reset'].includes(type)) return 'button';
      if (tag === 'input' && ['checkbox'].includes(type)) return 'checkbox';
      if (tag === 'input' && ['radio'].includes(type)) return 'radio';
      if (tag === 'input' && ['email', 'password', 'search', 'tel', 'text', 'url', ''].includes(type)) return 'textbox';
      if (/^h[1-6]$/.test(tag)) return 'heading';
      if (tag === 'img') return 'img';
      if (tag === 'li') return 'listitem';
      if (tag === 'ul' || tag === 'ol') return 'list';

      return '';
    }

    function accessibleNameFor(el) {
      const labelledBy = el.getAttribute('aria-labelledby');
      const labelledText = labelledBy
        ? labelledBy.split(/\\s+/)
            .map(id => document.getElementById(id)?.innerText || '')
            .filter(Boolean)
            .join(' ')
        : '';

      return [
        el.getAttribute('aria-label'),
        labelledText,
        el.getAttribute('alt'),
        el.getAttribute('title'),
        el.value,
        el.innerText,
        el.textContent
      ].filter(Boolean).join(' ').trim();
    }

    function byCss(selector) {
      try {
        const found = document.querySelector(selector);
        return found ? [found] : [];
      } catch (error) {
        throw new Error('Invalid CSS selector: ' + selector);
      }
    }

    function byXpath(selector) {
      try {
        const result = document.evaluate(
          selector,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );

        const elements = [];

        for (let i = 0; i < result.snapshotLength; i++) {
          const node = result.snapshotItem(i);

          if (node instanceof Element) {
            elements.push(node);
          }
        }

        return elements;
      } catch (error) {
        throw new Error('Invalid XPath selector: ' + selector);
      }
    }

    function byRole(role, name) {
      const targetRole = String(role || '').toLowerCase();
      const targetName = name === undefined || name === null ? null : String(name).toLowerCase();

      return Array.from(document.querySelectorAll('*')).filter(el => {
        if (roleFor(el) !== targetRole) return false;
        if (!targetName) return true;

        return accessibleNameFor(el).toLowerCase().includes(targetName);
      });
    }

    function byAttribute(name, value) {
      const elements = Array.from(document.querySelectorAll('*')).filter(el => el.hasAttribute(name));

      if (value === undefined || value === null) {
        return elements;
      }

      return elements.filter(el => el.getAttribute(name) === String(value));
    }

    function byText(text) {
      const targetText = String(text).toLowerCase();

      return Array.from(document.querySelectorAll('*')).filter(el => {
        return textFor(el).toLowerCase().includes(targetText);
      });
    }

    function findElements() {
      if (locator.type === 'css') return byCss(locator.selector);
      if (locator.type === 'xpath') return byXpath(locator.selector);
      if (locator.type === 'role') return byRole(locator.role, locator.name);
      if (locator.type === 'attribute') return byAttribute(locator.name, locator.value);
      if (locator.type === 'text') return byText(locator.text);

      throw new Error('Unsupported locator type: ' + locator.type);
    }

    function firstVisible(elements) {
      return elements.find(isVisible) || null;
    }

    const elements = findElements();

    if (action === 'exists') {
      return Boolean(firstVisible(elements));
    }

    if (action === 'text') {
      const el = firstVisible(elements);
      return el ? textFor(el).trim() : null;
    }

    if (action === 'focusInput') {
      const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));

      if (locator.type === 'text') {
        const targetText = String(locator.text).toLowerCase();

        for (const input of inputs) {
          if (!isVisible(input)) continue;
          if (!getLabelText(input).toLowerCase().includes(targetText)) continue;

          input.scrollIntoView({ block: 'center', inline: 'center' });
          input.focus();
          return true;
        }

        return false;
      }

      for (const el of elements) {
        const input = ['input', 'textarea'].includes(el.tagName.toLowerCase()) || el.isContentEditable
          ? el
          : el.querySelector('input, textarea, [contenteditable="true"]');

        if (!input || !isVisible(input)) continue;

        input.scrollIntoView({ block: 'center', inline: 'center' });
        input.focus();
        return true;
      }

      return false;
    }

    if (action === 'clickPoint') {
      for (const el of elements) {
        let current = el;

        while (current) {
          if (isClickable(current) && isVisible(current)) {
            current.scrollIntoView({ block: 'center', inline: 'center' });

            const rect = current.getBoundingClientRect();

            return {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            };
          }

          current = current.parentElement;
        }

        if (locator.type !== 'text' && isVisible(el)) {
          el.scrollIntoView({ block: 'center', inline: 'center' });

          const rect = el.getBoundingClientRect();

          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        }
      }

      return null;
    }

    return null;
  })()`;
}

function normalizeLocator(target) {
  if (typeof target === "string") {
    return {
      type: "text",
      text: target
    };
  }

  if (!target || typeof target !== "object") {
    throw new Error("Locator must be a string or an object");
  }

  if (target.css || target.selector || target.type === "css") {
    return {
      type: "css",
      selector: target.css || target.selector
    };
  }

  if (target.xpath || target.type === "xpath") {
    return {
      type: "xpath",
      selector: target.xpath || target.selector
    };
  }

  if (target.role || target.type === "role") {
    return {
      type: "role",
      role: target.role,
      name: target.name
    };
  }

  if (target.attribute || target.type === "attribute") {
    return {
      type: "attribute",
      name: target.attribute || target.name,
      value: target.value
    };
  }

  if (target.text || target.type === "text") {
    return {
      type: "text",
      text: target.text
    };
  }

  throw new Error("Unsupported locator object");
}

function describeLocator(target) {
  const locator = normalizeLocator(target);

  if (locator.type === "css") return `css "${locator.selector}"`;
  if (locator.type === "xpath") return `xpath "${locator.selector}"`;
  if (locator.type === "role") {
    return locator.name
      ? `role "${locator.role}" named "${locator.name}"`
      : `role "${locator.role}"`;
  }
  if (locator.type === "attribute") {
    return locator.value === undefined
      ? `attribute "${locator.name}"`
      : `attribute "${locator.name}"="${locator.value}"`;
  }

  return `"${locator.text}"`;
}

module.exports = Page;
