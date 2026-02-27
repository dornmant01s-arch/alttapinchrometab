(() => {
  const OVERLAY_ID = 'altq-tab-switcher-overlay';
  const STYLE_ID = 'altq-tab-switcher-style';
  const DEBOUNCE_MS = 90;
  const FALLBACK_ICON =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="28" fill="%231e293b" stroke="%2394a3b8" stroke-width="2"/><path d="M8 32h48M32 8c8 7 12 15 12 24s-4 17-12 24c-8-7-12-15-12-24s4-17 12-24zM13 20h38M13 44h38" stroke="%23e2e8f0" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';

  let overlayOpen = false;
  let tabs = [];
  let selectedIndex = 0;
  let overlayRoot = null;
  let panel = null;
  let grid = null;
  let lastTriggerAt = 0;
  let savedBodyOverflow = '';
  let savedHtmlOverflow = '';
  let scrollLockActive = false;
  let gridCols = 1;
  let gridRows = 1;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        z-index: 2147483647;
        background: rgba(2, 6, 23, 0.62);
        backdrop-filter: blur(2px);
        display: flex;
        opacity: 0;
        pointer-events: none;
        transition: opacity 140ms ease;
      }
      #${OVERLAY_ID}.altq-open {
        opacity: 1;
        pointer-events: auto;
      }
      #${OVERLAY_ID} .altq-panel {
        width: 100%;
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 20px;
        box-sizing: border-box;
      }
      #${OVERLAY_ID} .altq-grid {
        display: grid;
        gap: 12px;
        width: 100%;
        min-height: calc(100vh - 40px);
        align-content: stretch;
      }
      #${OVERLAY_ID} .altq-cell {
        width: 100%;
        min-height: 64px;
        border-radius: 14px;
        background: rgba(15, 23, 42, 0.46);
        border: 1px solid rgba(148, 163, 184, 0.18);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
        cursor: pointer;
        padding: 0;
      }
      #${OVERLAY_ID} .altq-cell:hover {
        transform: translateY(-1px);
      }
      #${OVERLAY_ID} .altq-cell.altq-selected {
        border-color: rgba(96, 165, 250, 0.95);
        box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.5), 0 10px 22px rgba(15, 23, 42, 0.55);
        transform: scale(1.02);
      }
      #${OVERLAY_ID} .altq-icon {
        width: var(--altq-icon-size, 36px);
        height: var(--altq-icon-size, 36px);
        border-radius: 8px;
        pointer-events: none;
        user-select: none;
      }
      @media (max-width: 640px) {
        #${OVERLAY_ID} .altq-panel {
          padding: 12px;
        }
        #${OVERLAY_ID} .altq-grid {
          min-height: calc(100vh - 24px);
          gap: 10px;
        }
      }
    `;

    document.documentElement.appendChild(style);
  }

  function createOverlay() {
    if (overlayRoot) return overlayRoot;
    ensureStyles();

    overlayRoot = document.createElement('div');
    overlayRoot.id = OVERLAY_ID;
    overlayRoot.setAttribute('aria-hidden', 'true');

    panel = document.createElement('div');
    panel.className = 'altq-panel';

    grid = document.createElement('div');
    grid.className = 'altq-grid';

    panel.appendChild(grid);
    overlayRoot.appendChild(panel);

    overlayRoot.addEventListener('click', (event) => {
      if (event.target === overlayRoot) {
        closeOverlay();
      }
    });

    document.documentElement.appendChild(overlayRoot);
    return overlayRoot;
  }

  function lockPageScroll() {
    if (scrollLockActive) return;
    savedBodyOverflow = document.body.style.overflow;
    savedHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    scrollLockActive = true;
  }

  function unlockPageScroll() {
    if (!scrollLockActive) return;
    document.body.style.overflow = savedBodyOverflow;
    document.documentElement.style.overflow = savedHtmlOverflow;
    scrollLockActive = false;
  }

  function createIcon(src) {
    const img = document.createElement('img');
    img.className = 'altq-icon';
    img.alt = '';
    img.src = src || FALLBACK_ICON;
    img.addEventListener('error', () => {
      img.src = FALLBACK_ICON;
    });
    return img;
  }

  function computeGridLayout(tabCount) {
    const viewportW = Math.max(320, window.innerWidth - 40);
    const viewportH = Math.max(220, window.innerHeight - 40);

    if (tabCount <= 1) {
      return { cols: 1, rows: 1 };
    }
    if (tabCount === 2) {
      return viewportW >= viewportH ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
    }

    let best = { cols: 1, rows: tabCount, score: Number.POSITIVE_INFINITY };

    for (let cols = 1; cols <= tabCount; cols += 1) {
      const rows = Math.ceil(tabCount / cols);
      const cellW = viewportW / cols;
      const cellH = viewportH / rows;
      const aspectPenalty = Math.abs(cellW - cellH) / Math.max(cellW, cellH);
      const emptyPenalty = (cols * rows - tabCount) * 0.08;
      const shapePenalty = Math.abs(cols - rows) * 0.06;
      const score = aspectPenalty + emptyPenalty + shapePenalty;

      if (score < best.score) {
        best = { cols, rows, score };
      }
    }

    return { cols: best.cols, rows: best.rows };
  }

  function applyGridLayout() {
    if (!grid) return;
    const count = tabs.length;
    const layout = computeGridLayout(count);
    gridCols = Math.max(1, layout.cols);
    gridRows = Math.max(1, layout.rows);

    grid.style.gridTemplateColumns = `repeat(${gridCols}, minmax(64px, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${gridRows}, minmax(64px, 1fr))`;

    const gridWidth = Math.max(1, grid.clientWidth || panel?.clientWidth || window.innerWidth);
    const gridHeight = Math.max(1, grid.clientHeight || panel?.clientHeight || window.innerHeight);
    const cellSize = Math.min(gridWidth / gridCols, gridHeight / gridRows);
    const iconSize = Math.max(24, Math.min(96, Math.round(cellSize * 0.4)));
    grid.style.setProperty('--altq-icon-size', `${iconSize}px`);

    console.debug('[AltQ] overlay open', {
      tabCount: count,
      computedCols: gridCols,
      computedRows: gridRows
    });
  }

  function buildCell(tab, isSelected, index) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `altq-cell${isSelected ? ' altq-selected' : ''}`;
    cell.dataset.index = String(index);
    cell.setAttribute('aria-label', `Tab ${index + 1}`);

    const icon = createIcon(tab.favIconUrl);
    cell.appendChild(icon);

    cell.addEventListener('click', () => {
      selectedIndex = index;
      activateSelectedTab();
    });

    return cell;
  }

  function render() {
    if (!grid) return;
    grid.innerHTML = '';

    tabs.forEach((tab, idx) => {
      grid.appendChild(buildCell(tab, idx === selectedIndex, idx));
    });

    applyGridLayout();

    const selected = grid.children[selectedIndex];
    if (selected?.scrollIntoView) {
      selected.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  function getGridColumns() {
    return Math.max(1, gridCols || 1);
  }

  function moveSelectionBy(step) {
    if (!tabs.length) return;
    selectedIndex = (selectedIndex + step + tabs.length) % tabs.length;
    render();
  }

  function closeOverlay() {
    try {
      overlayOpen = false;
      if (overlayRoot) {
        overlayRoot.classList.remove('altq-open');
        overlayRoot.setAttribute('aria-hidden', 'true');
      }
      window.removeEventListener('keydown', handleOverlayKeydown, true);
      window.removeEventListener('resize', handleResize, true);
    } finally {
      unlockPageScroll();
    }
  }

  async function activateSelectedTab() {
    const selected = tabs[selectedIndex];
    try {
      if (selected) {
        await chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB', tabId: selected.id });
      }
    } catch (_err) {
      // Ignore.
    } finally {
      closeOverlay();
    }
  }

  function handleOverlayKeydown(event) {
    if (!overlayOpen) return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveSelectionBy(1);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveSelectionBy(-1);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelectionBy(getGridColumns());
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelectionBy(-getGridColumns());
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      activateSelectedTab();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeOverlay();
    }
  }

  function handleResize() {
    if (!overlayOpen) return;
    applyGridLayout();
  }

  async function fetchData() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SWITCHER_DATA' });
      if (!response?.ok) {
        tabs = [];
        selectedIndex = 0;
        return;
      }

      tabs = response.tabs || [];

      if (!overlayOpen) {
        selectedIndex = tabs.length > 1 ? 1 : 0;
      } else if (tabs.length > 0) {
        selectedIndex = selectedIndex % tabs.length;
      } else {
        selectedIndex = 0;
      }
    } catch (_err) {
      tabs = [];
      selectedIndex = 0;
    }
  }

  async function triggerOverlay() {
    const now = Date.now();
    if (now - lastTriggerAt < DEBOUNCE_MS) return;
    lastTriggerAt = now;

    const wasOpen = overlayOpen;

    try {
      await fetchData();

      if (!tabs.length) {
        closeOverlay();
        return;
      }

      createOverlay();
      overlayOpen = true;
      overlayRoot.classList.add('altq-open');
      overlayRoot.setAttribute('aria-hidden', 'false');
      lockPageScroll();

      if (wasOpen) {
        selectedIndex = (selectedIndex + 1) % tabs.length;
      }

      render();
      window.removeEventListener('keydown', handleOverlayKeydown, true);
      window.addEventListener('keydown', handleOverlayKeydown, true);
      window.removeEventListener('resize', handleResize, true);
      window.addEventListener('resize', handleResize, true);
    } catch (_err) {
      closeOverlay();
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'ALTQ_TRIGGER') {
      triggerOverlay();
    }
  });
})();
