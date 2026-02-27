(() => {
  const OVERLAY_ID = 'altq-tab-switcher-overlay';
  const STYLE_ID = 'altq-tab-switcher-style';
  const DEBOUNCE_MS = 90;
  const FALLBACK_ICON =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="%23334155"/><path d="M20 18h24a4 4 0 014 4v20a4 4 0 01-4 4H20a4 4 0 01-4-4V22a4 4 0 014-4zm0 6v18h24V24H20z" fill="%23cbd5e1"/></svg>';

  let overlayOpen = false;
  let tabs = [];
  let thumbnailsByTab = {};
  let selectedIndex = 0;
  let overlayRoot = null;
  let panel = null;
  let grid = null;
  let hintBar = null;
  let lastTriggerAt = 0;
  let savedBodyOverflow = '';
  let savedHtmlOverflow = '';

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
        background: rgba(3, 6, 18, 0.62);
        backdrop-filter: blur(4px);
        display: flex;
        flex-direction: column;
        padding: 20px;
        box-sizing: border-box;
        opacity: 0;
        pointer-events: none;
        transition: opacity 160ms ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif;
      }
      #${OVERLAY_ID}.altq-open {
        opacity: 1;
        pointer-events: auto;
      }
      #${OVERLAY_ID} .altq-hint {
        margin: 0 auto 12px;
        padding: 8px 12px;
        border-radius: 999px;
        color: rgba(248, 250, 252, 0.92);
        background: rgba(15, 23, 42, 0.75);
        border: 1px solid rgba(148, 163, 184, 0.28);
        font-size: 12px;
        line-height: 1;
        letter-spacing: 0.01em;
        user-select: none;
      }
      #${OVERLAY_ID} .altq-panel {
        width: min(1320px, calc(100vw - 40px));
        max-height: calc(100vh - 96px);
        margin: 0 auto;
        border-radius: 18px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        background: rgba(8, 12, 28, 0.78);
        box-shadow: 0 24px 68px rgba(2, 6, 23, 0.7);
        overflow: auto;
        transform: scale(0.975) translateY(6px);
        transition: transform 180ms ease, opacity 180ms ease;
        opacity: 0;
      }
      #${OVERLAY_ID}.altq-open .altq-panel {
        transform: scale(1) translateY(0);
        opacity: 1;
      }
      #${OVERLAY_ID} .altq-grid {
        display: grid;
        gap: 14px;
        padding: 16px;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }
      #${OVERLAY_ID} .altq-card {
        position: relative;
        min-height: 190px;
        border-radius: 14px;
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, 0.24);
        box-shadow: 0 8px 18px rgba(2, 6, 23, 0.35);
        background: linear-gradient(180deg, rgba(30, 41, 59, 0.65), rgba(15, 23, 42, 0.86));
        color: #f1f5f9;
        cursor: pointer;
        transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
      }
      #${OVERLAY_ID} .altq-card:hover {
        transform: translateY(-1px);
      }
      #${OVERLAY_ID} .altq-card.altq-selected {
        transform: scale(1.025);
        border-color: rgba(96, 165, 250, 0.95);
        box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.34), 0 20px 30px rgba(15, 23, 42, 0.68);
      }
      #${OVERLAY_ID} .altq-order {
        position: absolute;
        top: 8px;
        left: 8px;
        z-index: 3;
        min-width: 22px;
        height: 22px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.4);
        background: rgba(2, 6, 23, 0.7);
        font-size: 11px;
        line-height: 20px;
        text-align: center;
      }
      #${OVERLAY_ID} .altq-hero {
        position: relative;
        height: 138px;
        width: 100%;
      }
      #${OVERLAY_ID} .altq-hero img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      #${OVERLAY_ID} .altq-footer {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: linear-gradient(180deg, rgba(2, 6, 23, 0.08), rgba(2, 6, 23, 0.86));
      }
      #${OVERLAY_ID} .altq-meta,
      #${OVERLAY_ID} .altq-meta-stack {
        min-width: 0;
      }
      #${OVERLAY_ID} .altq-domain {
        font-size: 11px;
        color: rgba(226, 232, 240, 0.88);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${OVERLAY_ID} .altq-title {
        font-size: 12px;
        color: #f8fafc;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${OVERLAY_ID} .altq-favicon {
        width: 16px;
        height: 16px;
        border-radius: 4px;
        background: rgba(51, 65, 85, 0.9);
        flex: 0 0 16px;
      }
      #${OVERLAY_ID} .altq-placeholder {
        height: 100%;
        padding: 18px 14px 14px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 10px;
        background-image:
          radial-gradient(circle at 0 0, rgba(59, 130, 246, 0.23), transparent 58%),
          radial-gradient(circle at 100% 100%, rgba(16, 185, 129, 0.2), transparent 52%),
          linear-gradient(165deg, rgba(30, 41, 59, 0.88), rgba(15, 23, 42, 0.95));
      }
      #${OVERLAY_ID} .altq-placeholder-icon {
        width: 42px;
        height: 42px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.4);
        border: 1px solid rgba(148, 163, 184, 0.33);
      }
      #${OVERLAY_ID} .altq-placeholder-domain {
        font-size: 16px;
        font-weight: 600;
        color: rgba(241, 245, 249, 0.95);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${OVERLAY_ID} .altq-placeholder-title {
        font-size: 12px;
        color: rgba(203, 213, 225, 0.9);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        line-height: 1.35;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function parseDomain(url) {
    if (!url) return 'New Tab';
    try {
      return new URL(url).hostname || 'New Tab';
    } catch (_err) {
      return 'New Tab';
    }
  }

  function createOverlay() {
    if (overlayRoot) return overlayRoot;
    ensureStyles();

    overlayRoot = document.createElement('div');
    overlayRoot.id = OVERLAY_ID;
    overlayRoot.setAttribute('aria-hidden', 'true');

    hintBar = document.createElement('div');
    hintBar.className = 'altq-hint';
    hintBar.textContent = 'Alt+Q: next • Arrows: move • Enter: switch • Esc: close';

    panel = document.createElement('div');
    panel.className = 'altq-panel';

    grid = document.createElement('div');
    grid.className = 'altq-grid';

    panel.appendChild(grid);
    overlayRoot.appendChild(hintBar);
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
    savedBodyOverflow = document.body.style.overflow;
    savedHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }

  function unlockPageScroll() {
    document.body.style.overflow = savedBodyOverflow;
    document.documentElement.style.overflow = savedHtmlOverflow;
  }

  function createFavicon(src, className) {
    const img = document.createElement('img');
    img.className = className;
    img.src = src || FALLBACK_ICON;
    img.alt = '';
    img.addEventListener('error', () => {
      img.src = FALLBACK_ICON;
    });
    return img;
  }

  function buildThumbnailCard(tab, thumb, isSelected, index) {
    const card = document.createElement('div');
    card.className = `altq-card${isSelected ? ' altq-selected' : ''}`;

    const order = document.createElement('div');
    order.className = 'altq-order';
    order.textContent = String(index + 1);

    const hero = document.createElement('div');
    hero.className = 'altq-hero';

    const img = document.createElement('img');
    img.src = thumb;
    img.alt = '';
    hero.appendChild(img);

    const footer = document.createElement('div');
    footer.className = 'altq-footer';

    const icon = createFavicon(tab.favIconUrl, 'altq-favicon');
    const stack = document.createElement('div');
    stack.className = 'altq-meta-stack';

    const domain = document.createElement('div');
    domain.className = 'altq-domain';
    domain.textContent = parseDomain(tab.url);

    const title = document.createElement('div');
    title.className = 'altq-title';
    title.textContent = tab.title || 'Untitled tab';

    stack.appendChild(domain);
    stack.appendChild(title);
    footer.appendChild(icon);
    footer.appendChild(stack);

    card.appendChild(order);
    card.appendChild(hero);
    card.appendChild(footer);

    return card;
  }

  function buildPlaceholderCard(tab, isSelected, index) {
    const card = document.createElement('div');
    card.className = `altq-card${isSelected ? ' altq-selected' : ''}`;

    const order = document.createElement('div');
    order.className = 'altq-order';
    order.textContent = String(index + 1);

    const placeholder = document.createElement('div');
    placeholder.className = 'altq-placeholder';

    const icon = createFavicon(tab.favIconUrl, 'altq-placeholder-icon');

    const domain = document.createElement('div');
    domain.className = 'altq-placeholder-domain';
    domain.textContent = parseDomain(tab.url);

    const title = document.createElement('div');
    title.className = 'altq-placeholder-title';
    title.textContent = tab.title || 'Untitled tab';

    placeholder.appendChild(icon);
    placeholder.appendChild(domain);
    placeholder.appendChild(title);

    card.appendChild(order);
    card.appendChild(placeholder);

    return card;
  }

  function buildCard(tab, isSelected, index) {
    const thumb = thumbnailsByTab[String(tab.id)]?.dataUrl;
    const card = thumb
      ? buildThumbnailCard(tab, thumb, isSelected, index)
      : buildPlaceholderCard(tab, isSelected, index);

    card.dataset.index = String(index);
    card.addEventListener('click', () => {
      selectedIndex = index;
      activateSelectedTab();
    });

    return card;
  }

  function render() {
    if (!grid) return;
    grid.innerHTML = '';

    tabs.forEach((tab, idx) => {
      grid.appendChild(buildCard(tab, idx === selectedIndex, idx));
    });

    const selectedCard = grid.children[selectedIndex];
    if (selectedCard?.scrollIntoView) {
      selectedCard.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  function getGridColumns() {
    if (!grid) return 1;
    const style = window.getComputedStyle(grid);
    const cols = style.gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, cols || 1);
  }

  function closeOverlay() {
    if (!overlayOpen || !overlayRoot) return;
    overlayOpen = false;
    overlayRoot.classList.remove('altq-open');
    overlayRoot.setAttribute('aria-hidden', 'true');
    window.removeEventListener('keydown', handleOverlayKeydown, true);
    unlockPageScroll();
  }

  async function activateSelectedTab() {
    const selected = tabs[selectedIndex];
    if (!selected) {
      closeOverlay();
      return;
    }

    try {
      await chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB', tabId: selected.id });
    } catch (_err) {
      // Ignore when extension context is unavailable.
    }
    closeOverlay();
  }

  function moveSelectionBy(step) {
    if (!tabs.length) return;
    selectedIndex = (selectedIndex + step + tabs.length) % tabs.length;
    render();
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

  async function fetchData() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SWITCHER_DATA' });
      if (!response?.ok) {
        tabs = [];
        thumbnailsByTab = {};
        selectedIndex = 0;
        return;
      }

      tabs = response.tabs || [];
      thumbnailsByTab = response.thumbnailsByTab || {};

      if (!overlayOpen) {
        selectedIndex = tabs.length > 1 ? 1 : 0;
      } else if (tabs.length > 0) {
        selectedIndex = selectedIndex % tabs.length;
      } else {
        selectedIndex = 0;
      }
    } catch (_err) {
      tabs = [];
      thumbnailsByTab = {};
      selectedIndex = 0;
    }
  }

  async function triggerOverlay() {
    const now = Date.now();
    if (now - lastTriggerAt < DEBOUNCE_MS) return;
    lastTriggerAt = now;

    const wasOpen = overlayOpen;
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
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'ALTQ_TRIGGER') {
      triggerOverlay();
    }
  });
})();
