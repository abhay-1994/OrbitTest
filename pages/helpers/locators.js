function buildLocatorExpression(target, action) {
  const locator = normalizeLocator(target);

  return `(() => {
    const locator = ${JSON.stringify(locator)};
    const action = ${JSON.stringify(action)};

    function normalizeText(value) {
      return String(value || '')
        .replace(/\\u00a0/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
    }

    function lowerText(value) {
      return normalizeText(value).toLowerCase();
    }

    function uniqueTextParts(parts) {
      const seen = new Set();
      const result = [];

      for (const part of parts) {
        const text = normalizeText(part);
        const key = text.toLowerCase();

        if (!text || seen.has(key)) continue;
        seen.add(key);
        result.push(text);
      }

      return result;
    }

    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;

      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.visibility !== 'collapse' &&
        Number(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0;
    }

    function isDisabled(el) {
      if (!el || !(el instanceof Element)) return true;
      if (el.disabled || el.getAttribute('disabled') !== null) return true;
      if (el.getAttribute('aria-disabled') === 'true') return true;

      const disabledFieldset = el.closest('fieldset[disabled]');
      return Boolean(disabledFieldset && !disabledFieldset.querySelector('legend')?.contains(el));
    }

    function isClickable(el) {
      if (!el || !(el instanceof Element)) return false;
      if (isDisabled(el)) return false;

      const tag = el.tagName.toLowerCase();
      const style = window.getComputedStyle(el);
      const role = (el.getAttribute('role') || '').toLowerCase();

      return ['button', 'a', 'input', 'select', 'textarea', 'label', 'summary'].includes(tag) ||
        Boolean(el.onclick) ||
        ['button', 'link', 'menuitem', 'option', 'tab', 'checkbox', 'radio', 'switch'].includes(role) ||
        isCustomControl(el) ||
        isFocusableInteractive(el) ||
        style.cursor === 'pointer';
    }

    function isFocusableInteractive(el) {
      const tabIndex = el.getAttribute('tabindex');

      return tabIndex !== null && Number(tabIndex) >= 0;
    }

    function isCustomControl(el) {
      const role = (el.getAttribute('role') || '').toLowerCase();
      const ariaHasPopup = el.getAttribute('aria-haspopup');
      const ariaExpanded = el.getAttribute('aria-expanded');
      const markerText = [
        el.id,
        el.className,
        el.getAttribute('data-testid'),
        el.getAttribute('data-test'),
        el.getAttribute('data-cy')
      ].filter(Boolean).join(' ').toLowerCase();

      return ['combobox', 'listbox'].includes(role) ||
        ariaHasPopup !== null ||
        ariaExpanded !== null ||
        /(^|[-_\\s])(select|dropdown|combobox|combo|control|option)([-_\\s]|$)/.test(markerText);
    }

    function textFor(el) {
      return uniqueTextParts([
        el.innerText,
        el.textContent,
        el.value,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('alt')
      ]).join(' ');
    }

    function ownTextFor(el) {
      const ownText = Array.from(el.childNodes || [])
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent)
        .join(' ');

      return uniqueTextParts([
        ownText,
        el.value,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('alt')
      ]).join(' ');
    }

    function getLabelText(input) {
      const labels = input.id
        ? Array.from(document.querySelectorAll('label[for="' + CSS.escape(input.id) + '"]')).map(label => label.innerText)
        : [];

      const parentLabel = input.closest('label')?.innerText;

      return uniqueTextParts([
        input.getAttribute('aria-label'),
        input.getAttribute('placeholder'),
        input.name,
        input.value,
        parentLabel,
        ...labels
      ]).join(' ');
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

      return uniqueTextParts([
        el.getAttribute('aria-label'),
        labelledText,
        el.getAttribute('alt'),
        el.getAttribute('title'),
        ['input', 'textarea', 'select'].includes(el.tagName.toLowerCase()) ? getLabelText(el) : '',
        el.value,
        el.innerText,
        el.textContent
      ]).join(' ');
    }

    function byCss(selector) {
      try {
        return Array.from(document.querySelectorAll(selector));
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
      const targetName = name === undefined || name === null ? null : lowerText(name);
      const matches = [];

      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (roleFor(el) !== targetRole) continue;
        if (!targetName) {
          matches.push(el);
          continue;
        }

        if (lowerText(accessibleNameFor(el)).includes(targetName)) {
          matches.push(el);
        }
      }

      return targetName ? rankByText(matches, targetName) : matches;
    }

    function byAttribute(name, value) {
      const elements = Array.from(document.querySelectorAll('*')).filter(el => el.hasAttribute(name));

      if (value === undefined || value === null) {
        return elements;
      }

      return elements.filter(el => el.getAttribute(name) === String(value));
    }

    function byText(text) {
      const targetText = lowerText(text);

      if (!targetText) {
        return [];
      }

      const matches = Array.from(document.querySelectorAll('*')).filter(el => {
        return textCandidatesFor(el).some(candidate => lowerText(candidate).includes(targetText));
      });

      return rankByText(matches, targetText);
    }

    function textCandidatesFor(el) {
      return [
        accessibleNameFor(el),
        ownTextFor(el),
        textFor(el),
        ['input', 'textarea', 'select'].includes(el.tagName.toLowerCase()) ? getLabelText(el) : ''
      ].filter(Boolean);
    }

    function rankByText(elements, targetText) {
      return uniqueElements(elements).sort((a, b) => {
        const scoreA = textScore(a, targetText);
        const scoreB = textScore(b, targetText);

        if (scoreA !== scoreB) return scoreA - scoreB;

        const position = a.compareDocumentPosition(b);
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        return 0;
      });
    }

    function textScore(el, targetText) {
      const candidates = textCandidatesFor(el).map(lowerText).filter(Boolean);
      const exact = candidates.some(value => value === targetText);
      const startsWith = candidates.some(value => value.startsWith(targetText));
      const ownExact = lowerText(ownTextFor(el)) === targetText;
      const visiblePenalty = isVisible(el) ? 0 : 10000;
      const interactiveBonus = isClickable(el) ? -350 : 0;
      const exactBonus = exact ? -700 : startsWith ? -450 : 0;
      const ownBonus = ownExact ? -200 : 0;
      const childPenalty = hasElementChildren(el) ? 35 : 0;
      const areaPenalty = Math.min(elementArea(el) / 1000, 250);
      const textLengthPenalty = Math.min(lowerText(textFor(el)).length / 10, 250);

      return visiblePenalty + interactiveBonus + exactBonus + ownBonus + childPenalty + areaPenalty + textLengthPenalty;
    }

    function hasElementChildren(el) {
      return Array.from(el.children || []).some(child => isVisible(child));
    }

    function elementArea(el) {
      const rect = el.getBoundingClientRect();
      return Math.max(0, rect.width) * Math.max(0, rect.height);
    }

    function uniqueElements(elements) {
      const seen = new Set();
      const result = [];

      for (const el of elements) {
        if (!el || seen.has(el)) continue;
        seen.add(el);
        result.push(el);
      }

      return result;
    }

    function findElementsFor(currentLocator) {
      if (currentLocator.type === 'nth') {
        const elements = findElementsFor(currentLocator.locator);
        const rawIndex = Number(currentLocator.index);
        const index = rawIndex < 0 ? elements.length + rawIndex : rawIndex;
        const element = Number.isInteger(index) ? elements[index] : null;

        return element ? [element] : [];
      }

      if (currentLocator.type === 'css') return byCss(currentLocator.selector);
      if (currentLocator.type === 'xpath') return byXpath(currentLocator.selector);
      if (currentLocator.type === 'role') return byRole(currentLocator.role, currentLocator.name);
      if (currentLocator.type === 'attribute') return byAttribute(currentLocator.name, currentLocator.value);
      if (currentLocator.type === 'text') return byText(currentLocator.text);

      throw new Error('Unsupported locator type: ' + currentLocator.type);
    }

    function firstVisible(elements) {
      return elements.find(isVisible) || null;
    }

    function compactText(value) {
      return String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 240);
    }

    function usefulAttributesFor(el) {
      const names = [
        'id',
        'class',
        'name',
        'type',
        'role',
        'aria-label',
        'title',
        'href',
        'value',
        'data-testid',
        'data-test',
        'data-cy'
      ];
      const attributes = {};

      for (const name of names) {
        if (!el.hasAttribute(name)) continue;
        attributes[name] = el.getAttribute(name);
      }

      return attributes;
    }

    function isTopElementAtPoint(el, x, y) {
      const topElements = document.elementsFromPoint(x, y);
      const top = topElements.find(candidate => {
        if (!candidate || !(candidate instanceof Element)) return false;

        const style = window.getComputedStyle(candidate);
        return style.pointerEvents !== 'none' &&
          style.visibility !== 'hidden' &&
          style.visibility !== 'collapse' &&
          style.display !== 'none' &&
          Number(style.opacity || '1') > 0;
      });

      return Boolean(top && (top === el || el.contains(top)));
    }

    function clickablePointFor(el) {
      if (!isVisible(el)) return null;

      const style = window.getComputedStyle(el);
      if (style.pointerEvents === 'none') return null;

      el.scrollIntoView({ block: 'center', inline: 'center' });

      const rect = el.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(window.innerWidth, rect.right);
      const bottom = Math.min(window.innerHeight, rect.bottom);

      if (right <= left || bottom <= top) return null;

      const points = [
        [left + (right - left) / 2, top + (bottom - top) / 2],
        [left + Math.min(8, (right - left) / 2), top + Math.min(8, (bottom - top) / 2)],
        [right - Math.min(8, (right - left) / 2), top + Math.min(8, (bottom - top) / 2)],
        [left + Math.min(8, (right - left) / 2), bottom - Math.min(8, (bottom - top) / 2)],
        [right - Math.min(8, (right - left) / 2), bottom - Math.min(8, (bottom - top) / 2)]
      ];

      for (const point of points) {
        const x = point[0];
        const y = point[1];

        if (isTopElementAtPoint(el, x, y)) {
          return { x, y };
        }
      }

      return null;
    }

    if (action === 'all') {
      const baseLocator = locator.type === 'nth' ? locator.locator : locator;

      return findElementsFor(baseLocator).map((el, index) => ({
        type: 'nth',
        locator: baseLocator,
        index,
        tag: el.tagName.toLowerCase(),
        text: compactText(textFor(el)),
        visible: isVisible(el),
        attributes: usefulAttributesFor(el)
      }));
    }

    const elements = findElementsFor(locator);

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
        const targetText = lowerText(locator.text);
        const matches = inputs
          .filter(input => !isDisabled(input) && isVisible(input) && lowerText(getLabelText(input)).includes(targetText))
          .sort((a, b) => {
            const aLabel = lowerText(getLabelText(a));
            const bLabel = lowerText(getLabelText(b));
            const aExact = aLabel === targetText ? -1 : 0;
            const bExact = bLabel === targetText ? -1 : 0;

            if (aExact !== bExact) return aExact - bExact;
            return aLabel.length - bLabel.length;
          });

        for (const input of matches) {
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

        if (!input || isDisabled(input) || !isVisible(input)) continue;

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
            const point = clickablePointFor(current);

            if (point) return point;
          }

          current = current.parentElement;
        }

        if (locator.type !== 'text' && isVisible(el)) {
          const point = clickablePointFor(el);

          if (point) return point;
        }
      }

      return null;
    }

    if (action === 'point') {
      const orderedElements = locator.type === 'text'
        ? elements.slice().reverse()
        : elements;

      for (const el of orderedElements) {
        if (!isVisible(el)) continue;

        const point = clickablePointFor(el);

        if (point) return point;
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

  if (target.type === "nth" || target.nth !== undefined) {
    const source = target.locator || target.target || target.of;
    const index = Number(target.index ?? target.nth);

    if (!source) {
      throw new Error("Nth locator requires a locator");
    }

    if (!Number.isInteger(index)) {
      throw new Error("Nth locator index must be an integer");
    }

    return {
      type: "nth",
      locator: normalizeLocator(source),
      index
    };
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

  if (locator.type === "nth") return `${describeLocator(locator.locator)} at index ${locator.index}`;
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

module.exports = {
  buildLocatorExpression,
  describeLocator,
  normalizeLocator
};
