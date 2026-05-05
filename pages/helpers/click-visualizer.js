async function showClickPoint(connection, x, y, options = {}) {
  if (options.visualize === false || options.showClickPoint === false) {
    return;
  }

  await connection.send("Runtime.evaluate", {
    expression: buildClickPointExpression(x, y),
    returnByValue: true
  }).catch(() => {
    // Click visualization is helpful, but it should never break the action.
  });
}

function buildClickPointExpression(x, y) {
  return `(() => {
    const x = ${JSON.stringify(Number(x))};
    const y = ${JSON.stringify(Number(y))};
    const existing = document.querySelectorAll('[data-orbittest-click-point]');

    existing.forEach(el => el.remove());

    const dot = document.createElement('div');
    const ring = document.createElement('div');
    const size = 18;
    const ringSize = 34;

    dot.setAttribute('data-orbittest-click-point', 'dot');
    ring.setAttribute('data-orbittest-click-point', 'ring');

    Object.assign(dot.style, {
      position: 'fixed',
      left: (x - size / 2) + 'px',
      top: (y - size / 2) + 'px',
      width: size + 'px',
      height: size + 'px',
      borderRadius: '999px',
      background: '#e11d48',
      border: '2px solid #ffffff',
      boxShadow: '0 0 0 2px rgba(225, 29, 72, 0.35), 0 8px 18px rgba(0, 0, 0, 0.28)',
      pointerEvents: 'none',
      zIndex: '2147483647'
    });

    Object.assign(ring.style, {
      position: 'fixed',
      left: (x - ringSize / 2) + 'px',
      top: (y - ringSize / 2) + 'px',
      width: ringSize + 'px',
      height: ringSize + 'px',
      borderRadius: '999px',
      border: '3px solid rgba(225, 29, 72, 0.85)',
      pointerEvents: 'none',
      zIndex: '2147483646',
      transition: 'transform 520ms ease-out, opacity 520ms ease-out'
    });

    document.documentElement.appendChild(ring);
    document.documentElement.appendChild(dot);

    requestAnimationFrame(() => {
      ring.style.transform = 'scale(1.8)';
      ring.style.opacity = '0';
    });

    setTimeout(() => {
      dot.remove();
      ring.remove();
    }, 900);

    return true;
  })()`;
}

module.exports = {
  showClickPoint
};
