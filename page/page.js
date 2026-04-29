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

  async click(text) {
    console.log("Finding:", text);

    const { x, y } = await this.findClickablePointByText(text);

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

  async type(text, value) {
    const found = await this.focusInputByText(text);

    if (!found) {
      throw new Error(`No input found for "${text}"`);
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

  async findClickablePointByText(text) {
    const response = await this.connection.send("Runtime.evaluate", {
      expression: `(() => {
        const targetText = ${JSON.stringify(String(text).toLowerCase())};

        function isVisible(el) {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0;
        }

        function isClickable(el) {
          const tag = el.tagName.toLowerCase();
          return ['button', 'a', 'input'].includes(tag) ||
            Boolean(el.onclick) ||
            el.getAttribute('role') === 'button' ||
            window.getComputedStyle(el).cursor === 'pointer';
        }

        const elements = Array.from(document.querySelectorAll('*'));

        for (const el of elements) {
          const textContent = (el.innerText || el.value || el.getAttribute('aria-label') || '').toLowerCase();

          if (!textContent.includes(targetText)) continue;

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
        }

        return null;
      })()`,
      returnByValue: true
    });

    const value = response.result?.result?.value;

    if (!value) {
      throw new Error(`No clickable element found for "${text}"`);
    }

    return value;
  }

  async focusInputByText(text) {
    const response = await this.connection.send("Runtime.evaluate", {
      expression: `(() => {
        const targetText = ${JSON.stringify(String(text).toLowerCase())};
        const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));

        function isVisible(el) {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0;
        }

        function textForInput(input) {
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
          ].filter(Boolean).join(' ').toLowerCase();
        }

        for (const input of inputs) {
          if (!isVisible(input)) continue;
          if (!textForInput(input).includes(targetText)) continue;

          input.scrollIntoView({ block: 'center', inline: 'center' });
          input.focus();
          return true;
        }

        return false;
      })()`,
      returnByValue: true
    });

    return Boolean(response.result?.result?.value);
  }
}

module.exports = Page;
