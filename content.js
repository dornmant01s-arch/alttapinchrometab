(() => {
  const OVERLAY_ID = 'altq-tab-switcher-overlay';
  const DEBOUNCE_MS = 90;

  let overlayOpen = false;
  let tabs = [];
  let thumbnailsByTab = {};
  let selectedIndex = 0;
  let overlayRoot = null;
  let lastTriggerAt = 0;

  function createOverlay() {
    if (overlayRoot) return overlayRoot;

    const root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0, 0, 0, 0.45);
      display: none;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      width: min(92vw, 1100px);
      max-height: 80vh;
      padding: 16px;
      border-radius: 16px;
      background: rgba(24, 24, 27, 0.96);
      box-shadow: 0 18px 55px rgba(0,0,0,0.55);
      overflow: auto;
      pointer-events: auto;
    `;

    const title = document.createElement('div');
    title.textContent = 'Tab Switcher';
    title.style.cssText = 'color:#fff;font-size:14px;font-weight:600;margin-bottom:12px;opacity:.9;';

    const cards = document.createElement('div');
    cards.className = 'altq-cards';
    cards.style.cssText = 'display:flex;gap:12px;overflow-x:auto;padding-bottom:6px;';

    panel.appendChild(title);
    panel.appendChild(cards);
    root.appendChild(panel);
    document.documentElement.appendChild(root);

    overlayRoot = root;
    return root;
  }

  function getCardsContainer() {
    return createOverlay().querySelector('.altq-cards');
  }

  function buildCard(tab, isSelected) {
    const card = document.createElement('div');
    card.style.cssText = `
      flex: 0 0 250px;
      border-radius: 12px;
      overflow: hidden;
      border: 2px solid ${isSelected ? '#60a5fa' : 'rgba(255,255,255,0.12)'};
      background: #111827;
      color: #e5e7eb;
    `;

    const thumbWrap = document.createElement('div');
    thumbWrap.style.cssText = 'height:140px;background:#1f2937;display:flex;align-items:center;justify-content:center;';

    const thumb = thumbnailsByTab[String(tab.id)]?.dataUrl;
    if (thumb) {
      const img = document.createElement('img');
      img.src = thumb;
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      thumbWrap.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.textContent = 'No thumbnail yet';
      placeholder.style.cssText = 'font-size:12px;color:#9ca3af;';
      thumbWrap.appendChild(placeholder);
    }

    const meta = document.createElement('div');
    meta.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px;';

    const icon = document.createElement('img');
    icon.src = tab.favIconUrl || '';
    icon.alt = '';
    icon.style.cssText = 'width:16px;height:16px;flex:0 0 16px;border-radius:3px;background:#374151;';
    icon.addEventListener('error', () => {
      icon.style.visibility = 'hidden';
    });

    const label = document.createElement('div');
    label.textContent = tab.title || 'Untitled tab';
    label.style.cssText = 'font-size:12px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    meta.appendChild(icon);
    meta.appendChild(label);

    card.appendChild(thumbWrap);
    card.appendChild(meta);

    return card;
  }

  function render() {
    const cards = getCardsContainer();
    if (!cards) return;
    cards.innerHTML = '';

    tabs.forEach((tab, idx) => {
      const card = buildCard(tab, idx === selectedIndex);
      cards.appendChild(card);
    });

    const selectedCard = cards.children[selectedIndex];
    if (selectedCard?.scrollIntoView) {
      selectedCard.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }

  function closeOverlay() {
    if (!overlayOpen || !overlayRoot) return;
    overlayOpen = false;
    overlayRoot.style.display = 'none';
    overlayRoot.setAttribute('aria-hidden', 'true');
    window.removeEventListener('keydown', handleOverlayKeydown, true);
  }

  async function activateSelectedTab() {
    const selected = tabs[selectedIndex];
    if (!selected) {
      closeOverlay();
      return;
    }

    await chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB', tabId: selected.id });
    closeOverlay();
  }

  function handleOverlayKeydown(event) {
    if (!overlayOpen) return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (tabs.length > 0) {
        selectedIndex = (selectedIndex + 1) % tabs.length;
        render();
      }
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (tabs.length > 0) {
        selectedIndex = (selectedIndex - 1 + tabs.length) % tabs.length;
        render();
      }
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

    const root = createOverlay();
    overlayOpen = true;
    root.style.display = 'flex';
    root.setAttribute('aria-hidden', 'false');

    if (wasOpen && tabs.length > 0) {
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
