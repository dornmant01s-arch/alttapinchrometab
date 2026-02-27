const STORAGE_KEY = 'switcherState';
const MAX_THUMBNAILS_PER_WINDOW = 12;

async function getState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || { mruByWindow: {}, thumbnailsByTab: {} };
}

async function setState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function touchMruList(mruList, tabId) {
  const next = mruList.filter((id) => id !== tabId);
  next.unshift(tabId);
  return next;
}

async function updateMru(windowId, tabId) {
  if (!windowId || windowId < 0 || !tabId) return;
  const state = await getState();
  const key = String(windowId);
  const current = Array.isArray(state.mruByWindow[key]) ? state.mruByWindow[key] : [];
  state.mruByWindow[key] = touchMruList(current, tabId);
  await pruneState(state, windowId);
}

async function pruneState(state, focusWindowId = null) {
  const allTabs = await chrome.tabs.query({});
  const existingTabIds = new Set(allTabs.map((t) => t.id));

  for (const [windowId, mru] of Object.entries(state.mruByWindow)) {
    const filtered = (Array.isArray(mru) ? mru : []).filter((tabId) => existingTabIds.has(tabId));
    state.mruByWindow[windowId] = filtered;
  }

  for (const tabId of Object.keys(state.thumbnailsByTab)) {
    if (!existingTabIds.has(Number(tabId))) {
      delete state.thumbnailsByTab[tabId];
    }
  }

  const windowIdsToTrim = new Set(Object.keys(state.mruByWindow));
  if (focusWindowId !== null && focusWindowId >= 0) {
    windowIdsToTrim.add(String(focusWindowId));
  }

  for (const windowId of windowIdsToTrim) {
    const mru = state.mruByWindow[windowId] || [];
    const keepTabIds = new Set(mru.slice(0, MAX_THUMBNAILS_PER_WINDOW));

    for (const [tabId, thumb] of Object.entries(state.thumbnailsByTab)) {
      if (String(thumb.windowId) === String(windowId) && !keepTabIds.has(Number(tabId))) {
        delete state.thumbnailsByTab[tabId];
      }
    }
  }

  await setState(state);
}

async function captureAndStoreThumbnail(windowId, tabId) {
  try {
    if (!windowId || windowId < 0 || !tabId) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 });
    const state = await getState();
    state.thumbnailsByTab[String(tabId)] = {
      dataUrl,
      updatedAt: Date.now(),
      windowId
    };
    await pruneState(state, windowId);
  } catch (_err) {
    // Ignore restricted pages / capture failures silently.
  }
}

async function getOrderedTabsForWindow(windowId) {
  const [tabs, state] = await Promise.all([
    chrome.tabs.query({ windowId }),
    getState()
  ]);

  const mru = state.mruByWindow[String(windowId)] || [];
  const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));

  const ordered = [];
  for (const tabId of mru) {
    if (tabMap.has(tabId)) {
      ordered.push(tabMap.get(tabId));
      tabMap.delete(tabId);
    }
  }

  for (const tab of tabs) {
    if (tabMap.has(tab.id)) {
      ordered.push(tab);
      tabMap.delete(tab.id);
    }
  }

  return {
    tabs: ordered,
    thumbnailsByTab: state.thumbnailsByTab
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  await setState(state);
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await updateMru(windowId, tabId);
  await captureAndStoreThumbnail(windowId, tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  for (const key of Object.keys(state.mruByWindow)) {
    state.mruByWindow[key] = (state.mruByWindow[key] || []).filter((id) => id !== tabId);
  }
  delete state.thumbnailsByTab[String(tabId)];
  await setState(state);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE || windowId < 0) return;
  try {
    const tabs = await chrome.tabs.query({ windowId, active: true });
    if (tabs[0]?.id) {
      await updateMru(windowId, tabs[0].id);
    }
  } catch (_err) {
    // Ignore.
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-switcher') return;

  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const activeTab = tabs[0];
    if (!activeTab?.id) return;

    await chrome.tabs.sendMessage(activeTab.id, { type: 'ALTQ_TRIGGER' });
  } catch (_err) {
    // Likely restricted page or content script unavailable.
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'GET_SWITCHER_DATA') {
      const windowId = sender.tab?.windowId;
      if (!windowId || windowId < 0) {
        sendResponse({ ok: false, tabs: [], thumbnailsByTab: {} });
        return;
      }

      const { tabs, thumbnailsByTab } = await getOrderedTabsForWindow(windowId);
      sendResponse({
        ok: true,
        tabs: tabs.map((tab) => ({
          id: tab.id,
          title: tab.title || 'Untitled tab',
          favIconUrl: tab.favIconUrl || '',
          url: tab.url || '',
          active: Boolean(tab.active)
        })),
        thumbnailsByTab
      });
      return;
    }

    if (message?.type === 'ACTIVATE_TAB' && Number.isInteger(message.tabId)) {
      try {
        await chrome.tabs.update(message.tabId, { active: true });
        sendResponse({ ok: true });
      } catch (_err) {
        sendResponse({ ok: false });
      }
      return;
    }

    sendResponse({ ok: false });
  })();

  return true;
});
