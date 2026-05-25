// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

function buildLocatorExpression(target, action, options = {}) {
  const locator = normalizeLocator(target);

  return `(() => {
    const locator = ${JSON.stringify(locator)};
    const action = ${JSON.stringify(action)};
    const actionOptions = ${JSON.stringify(options || {})};

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

      if (style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse' ||
          Number(style.opacity || '1') === 0 ||
          rect.width === 0 ||
          rect.height === 0) {
        return false;
      }

      // opacity:0 on an ancestor renders the whole subtree invisible but is
      // NOT reflected in the child's own computed opacity — walk up the tree.
      let parent = el.parentElement;
      while (parent && parent !== document.documentElement) {
        if (Number(window.getComputedStyle(parent).opacity || '1') === 0) return false;
        parent = parent.parentElement;
      }

      return true;
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

    function matchesWordBoundary(text, target) {
      const t = text.toLowerCase();
      const q = target.toLowerCase();
      if (!q) return false;

      // Boundary = start/end of string, whitespace, or common punctuation/separators.
      // Uses char-codes only — avoids regex literals inside this template literal.
      function isBoundary(c) {
        if (!c) return true;
        const code = c.charCodeAt(0);
        // <= 32 covers space, tab, newline, other control chars
        return code <= 32 || code === 45 || code === 95 || code === 47 ||
          code === 124 || code === 46 || code === 44 || code === 59 ||
          code === 58 || code === 33 || code === 63 || code === 40 ||
          code === 41 || code === 91 || code === 93 || code === 123 ||
          code === 125 || code === 34 || code === 39;
      }

      let idx = t.indexOf(q);
      while (idx !== -1) {
        const before = idx > 0 ? t[idx - 1] : '';
        const after = idx + q.length < t.length ? t[idx + q.length] : '';
        if (isBoundary(before) && isBoundary(after)) return true;
        idx = t.indexOf(q, idx + 1);
      }
      return false;
    }

    function semanticTierBonus(el) {
      const tag = el.tagName.toLowerCase();
      // Tier 1: native semantic elements — browser handles focus, keyboard, ARIA
      if (['button', 'a', 'input', 'select', 'textarea', 'label', 'summary'].includes(tag)) return -150;
      // Tier 2: explicit ARIA role declared by author
      if (el.getAttribute('role')) return -75;
      // Tier 3: heuristic (cursor:pointer, tabindex, class name) — no bonus
      return 0;
    }

    function textFor(el) {
      return uniqueTextParts([
        el.innerText,
        el.textContent,
        pseudoContentFor(el),
        el.value,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('alt')
      ]).join(' ');
    }

    function visibleTextFor(el) {
      return normalizeText(el.innerText);
    }

    function domTextFor(el) {
      return normalizeText(el.textContent);
    }

    function ownTextFor(el) {
      const ownText = Array.from(el.childNodes || [])
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent)
        .join(' ');

      return uniqueTextParts([
        ownText,
        pseudoContentFor(el),
        el.value,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('alt')
      ]).join(' ');
    }

    function pseudoContentFor(el) {
      try {
        function extractContent(cssValue) {
          if (!cssValue || cssValue === 'none' || cssValue === 'normal') return '';
          // CSS content strings arrive as quoted literals: '"text"' or "'text'"
          // 34 = double-quote, 39 = single-quote — strip the outer pair.
          const first = cssValue.charCodeAt(0);
          const last = cssValue.charCodeAt(cssValue.length - 1);
          if ((first === 34 && last === 34) || (first === 39 && last === 39)) {
            return cssValue.slice(1, -1);
          }
          return '';
        }
        const before = extractContent(window.getComputedStyle(el, '::before').content);
        const after  = extractContent(window.getComputedStyle(el, '::after').content);
        const parts = [];
        if (before) parts.push(before);
        if (after)  parts.push(after);
        return parts.join(' ');
      } catch (e) {
        return '';
      }
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

        const elName = lowerText(accessibleNameFor(el));
        if (elName === targetName || elName.startsWith(targetName) || matchesWordBoundary(elName, targetName)) {
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

    function byText(text, options = {}) {
      const targetText = lowerText(text);

      if (!targetText) {
        return [];
      }

      const matches = Array.from(document.querySelectorAll('*')).filter(el => {
        return textCandidatesFor(el).some(candidate => lowerText(candidate).includes(targetText));
      });

      return rankByText(matches, targetText, options);
    }

    function byNear(currentLocator, options = {}) {
      const targets = findElementsFor(currentLocator.target, options);
      const anchors = findElementsFor(currentLocator.anchor, {
        preferVisible: true
      });
      const ranked = [];

      for (const target of targets) {
        let bestScore = Infinity;

        for (const anchor of anchors) {
          const score = contextualScore(target, anchor);

          if (score < bestScore) {
            bestScore = score;
          }
        }

        if (Number.isFinite(bestScore)) {
          ranked.push({
            element: target,
            score: bestScore
          });
        }
      }

      return uniqueElements(ranked.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;

        const position = a.element.compareDocumentPosition(b.element);
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        return 0;
      }).map(item => item.element));
    }

    function contextualScore(target, anchor) {
      if (!target || !anchor || !(target instanceof Element) || !(anchor instanceof Element)) {
        return Infinity;
      }

      if (target === anchor || !isVisible(target) || !isVisible(anchor)) {
        return Infinity;
      }

      const container = commonContainer(target, anchor);

      if (!container) {
        return Infinity;
      }

      const anchorInsideTargetPenalty = target.contains(anchor) ? 2500 : 0;
      const targetInsideAnchorPenalty = anchor.contains(target) ? 250 : 0;

      return containerScore(container) +
        rectDistance(target, anchor) / 24 +
        anchorInsideTargetPenalty +
        targetInsideAnchorPenalty;
    }

    function commonContainer(a, b) {
      const ancestors = new Set();
      let current = a;

      while (current && current instanceof Element) {
        ancestors.add(current);
        current = current.parentElement;
      }

      current = b;

      while (current && current instanceof Element) {
        if (ancestors.has(current)) {
          return current;
        }

        current = current.parentElement;
      }

      return null;
    }

    function containerScore(container) {
      if (!container || container === document.documentElement) {
        return 12000;
      }

      if (container === document.body) {
        return 8000;
      }

      const rect = container.getBoundingClientRect();
      const area = Math.max(1, rect.width * rect.height);
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      const areaPenalty = Math.min((area / viewportArea) * 1800, 2200);
      const tag = container.tagName.toLowerCase();
      const role = (container.getAttribute('role') || '').toLowerCase();
      const structureBonus = ['tr', 'li', 'article', 'section', 'form'].includes(tag) ||
        ['row', 'listitem', 'article', 'group'].includes(role)
        ? -500
        : 0;

      return areaPenalty - elementDepth(container) * 18 + structureBonus;
    }

    function rectDistance(a, b) {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      const ax = rectA.left + rectA.width / 2;
      const ay = rectA.top + rectA.height / 2;
      const bx = rectB.left + rectB.width / 2;
      const by = rectB.top + rectB.height / 2;

      return Math.hypot(ax - bx, ay - by);
    }

    function elementDepth(element) {
      let depth = 0;
      let current = element;

      while (current && current.parentElement) {
        depth++;
        current = current.parentElement;
      }

      return depth;
    }

    function textCandidatesFor(el) {
      return [
        accessibleNameFor(el),
        ownTextFor(el),
        textFor(el),
        ['input', 'textarea', 'select'].includes(el.tagName.toLowerCase()) ? getLabelText(el) : ''
      ].filter(Boolean);
    }

    function rankByText(elements, targetText, options = {}) {
      const unique = uniqueElements(elements);

      // Fast path: if exactly one visible element has an exact text match, return
      // it immediately — no need to score and sort the full candidate set.
      const exactVisible = unique.filter(el =>
        isVisible(el) && textCandidatesFor(el).some(c => lowerText(c) === targetText)
      );
      if (exactVisible.length === 1) return exactVisible;

      return unique.sort((a, b) => {
        const scoreA = textScore(a, targetText, options);
        const scoreB = textScore(b, targetText, options);

        if (scoreA !== scoreB) return scoreA - scoreB;

        const position = a.compareDocumentPosition(b);
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        return 0;
      });
    }

    function textScore(el, targetText, options = {}) {
      const candidates = textCandidatesFor(el).map(lowerText).filter(Boolean);
      const exact = candidates.some(value => value === targetText);
      const startsWith = candidates.some(value => value.startsWith(targetText));
      const wordBoundary = !exact && !startsWith && candidates.some(value => matchesWordBoundary(value, targetText));
      const ownExact = lowerText(ownTextFor(el)) === targetText;
      const visiblePenalty = options.preferVisible === false || isVisible(el) ? 0 : 10000;
      const interactiveBonus = isClickable(el) ? -350 : 0;
      const exactBonus = exact ? -700 : startsWith ? -450 : wordBoundary ? -280 : 0;
      const ownBonus = ownExact ? -200 : 0;
      const childPenalty = hasElementChildren(el) ? 35 : 0;
      const areaPenalty = Math.min(elementArea(el) / 1000, 250);
      const textLengthPenalty = Math.min(lowerText(textFor(el)).length / 10, 250);
      const semanticBonus = semanticTierBonus(el);

      return visiblePenalty + interactiveBonus + exactBonus + ownBonus + childPenalty + areaPenalty + textLengthPenalty + semanticBonus;
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

    function findElementsFor(currentLocator, options = {}) {
      if (currentLocator.type === 'nth') {
        const elements = findElementsFor(currentLocator.locator, options);
        const rawIndex = Number(currentLocator.index);
        const index = rawIndex < 0 ? elements.length + rawIndex : rawIndex;
        const element = Number.isInteger(index) ? elements[index] : null;

        return element ? [element] : [];
      }

      if (currentLocator.type === 'near') return byNear(currentLocator, options);
      if (currentLocator.type === 'css') return byCss(currentLocator.selector);
      if (currentLocator.type === 'xpath') return byXpath(currentLocator.selector);
      if (currentLocator.type === 'role') return byRole(currentLocator.role, currentLocator.name);
      if (currentLocator.type === 'attribute') return byAttribute(currentLocator.name, currentLocator.value);
      if (currentLocator.type === 'text') return byText(currentLocator.text, options);

      throw new Error('Unsupported locator type: ' + currentLocator.type);
    }

    function firstVisible(elements) {
      return elements.find(isVisible) || null;
    }

    function firstElement(elements) {
      return elements[0] || null;
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

    function getClippedRect(el) {
      const rect = el.getBoundingClientRect();
      let left = rect.left;
      let top = rect.top;
      let right = rect.right;
      let bottom = rect.bottom;

      // Intersect with each clipping ancestor (overflow hidden/clip/scroll/auto).
      // Skips 'visible' overflow which does not clip children.
      let parent = el.parentElement;
      while (parent && parent !== document.documentElement) {
        const ps = window.getComputedStyle(parent);
        const overflowValues = [ps.overflow, ps.overflowX, ps.overflowY];
        const clips = overflowValues.some(v => v === 'hidden' || v === 'clip' || v === 'scroll' || v === 'auto');
        if (clips) {
          const pr = parent.getBoundingClientRect();
          left   = Math.max(left,   pr.left);
          top    = Math.max(top,    pr.top);
          right  = Math.min(right,  pr.right);
          bottom = Math.min(bottom, pr.bottom);
        }
        parent = parent.parentElement;
      }

      return { left, top, right, bottom };
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

      // Use clipped rect — accounts for overflow:hidden ancestors, not just viewport.
      const clipped = getClippedRect(el);
      const left = Math.max(0, clipped.left);
      const top = Math.max(0, clipped.top);
      const right = Math.min(window.innerWidth, clipped.right);
      const bottom = Math.min(window.innerHeight, clipped.bottom);

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

    if (action === 'diagnose') {
      try {
        const all = findElementsFor(locator, { preferVisible: false });
        const total = all.length;
        const visible = all.filter(isVisible).length;
        const disabled = all.filter(isDisabled).length;
        const clipped = all.filter(el => {
          const r = getClippedRect(el);
          return (r.right - r.left) <= 0 || (r.bottom - r.top) <= 0;
        }).length;
        const top3 = all.slice(0, 3).map(el => ({
          tag: el.tagName.toLowerCase(),
          text: compactText(textFor(el)).slice(0, 80),
          visible: isVisible(el),
          disabled: isDisabled(el),
          clickable: isClickable(el)
        }));
        return { total, visible, hidden: total - visible, disabled, clipped, top3 };
      } catch (e) {
        return { total: 0, visible: 0, hidden: 0, disabled: 0, clipped: 0, top3: [], error: e.message };
      }
    }

    const elements = findElementsFor(locator, {
      preferVisible: action !== 'domText'
    });

    if (action === 'frameElement') {
      const token = actionOptions.token;

      for (const el of elements) {
        const frame = ['iframe', 'frame'].includes(el.tagName.toLowerCase())
          ? el
          : el.querySelector('iframe, frame');

        if (!frame || !isVisible(frame)) continue;

        if (token) {
          frame.setAttribute('data-orbittest-frame-token', token);
        }

        const rect = frame.getBoundingClientRect();

        return {
          tag: frame.tagName.toLowerCase(),
          name: frame.getAttribute('name') || '',
          title: frame.getAttribute('title') || '',
          src: frame.getAttribute('src') || '',
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          }
        };
      }

      return null;
    }

    if (action === 'exists') {
      return Boolean(firstVisible(elements));
    }

    if (action === 'text') {
      const el = firstVisible(elements);
      return el ? textFor(el).trim() : null;
    }

    if (action === 'visibleText') {
      const el = firstVisible(elements);
      return el ? visibleTextFor(el) : null;
    }

    if (action === 'domText') {
      const el = firstElement(elements);
      return el ? domTextFor(el) : null;
    }

    if (action === 'focusInput') {
      const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));

      if (locator.type === 'text') {
        const targetText = lowerText(locator.text);
        const inputCandidates = inputs.filter(input => {
          if (isDisabled(input) || !isVisible(input)) return false;
          return textCandidatesFor(input).some(c => lowerText(c).includes(targetText));
        });
        const ranked = rankByText(inputCandidates, targetText);

        for (const input of ranked) {
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

    if (action === 'clickElement') {
      for (const el of elements) {
        let current = el;

        while (current) {
          if (isClickable(current) && isVisible(current)) {
            current.scrollIntoView({ block: 'center', inline: 'center' });
            current.focus?.();
            current.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
            current.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
            current.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0 }));
            current.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0 }));
            current.click();
            return true;
          }

          current = current.parentElement;
        }

        if (locator.type !== 'text' && isVisible(el)) {
          el.scrollIntoView({ block: 'center', inline: 'center' });
          el.focus?.();
          el.click();
          return true;
        }
      }

      return false;
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

  if (target.type === "near" || target.near !== undefined || (target.target !== undefined && target.anchor !== undefined)) {
    const source = target.target || target.locator || target.of;
    const anchor = target.anchor || target.near || target.context || target.within;

    if (!source) {
      throw new Error("Near locator requires a target locator");
    }

    if (!anchor) {
      throw new Error("Near locator requires an anchor locator");
    }

    return {
      type: "near",
      target: normalizeLocator(source),
      anchor: normalizeLocator(anchor)
    };
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

  if (locator.type === "near") return `${describeLocator(locator.target)} near ${describeLocator(locator.anchor)}`;
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
