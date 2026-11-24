// Background Service Worker — MVP-релей и буфер (этап 1)
// Хранит состояние записи и шаги по вкладкам (в памяти; IndexedDB — этап 4).

const stateByTab = new Map(); // tabId -> { recording: bool, steps: [] }

function tabState(tabId) {
  if (!stateByTab.has(tabId)) {
    stateByTab.set(tabId, { recording: false, steps: [] });
  }
  return stateByTab.get(tabId);
}

// Открытие Side Panel по клику на иконку расширения
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[qa-bg] setPanelBehavior:', err));

// Очистка состояния закрытой вкладки
chrome.tabs.onRemoved.addListener((tabId) => stateByTab.delete(tabId));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // --- от content script ---
  if (msg.type === 'qa:step' && sender.tab) {
    const st = tabState(sender.tab.id);
    if (st.recording) {
      st.steps.push(msg.step);
      // Переслать в панель (если открыта)
      chrome.runtime.sendMessage({ type: 'qa:panel-step-added', step: msg.step }).catch(() => {});
      sendResponse({ ok: true, buffered: st.steps.length });
    } else {
      sendResponse({ ok: false, reason: 'not recording' });
    }
    return true;
  }

  if (msg.type === 'qa:content-ready' && sender.tab) {
    // content script при загрузке страницы спрашивает состояние
    sendResponse({ recording: tabState(sender.tab.id).recording });
    return true;
  }

  // --- от панели ---
  if (msg.type === 'qa:panel-get-state') {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tabId = tabs[0] && tabs[0].id;
      const st = tabId != null ? tabState(tabId) : { recording: false, steps: [] };
      sendResponse({ recording: st.recording, steps: st.steps });
    });
    return true;
  }

  if (msg.type === 'qa:panel-set-recording') {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tab = tabs[0];
      if (!tab) return sendResponse({ ok: false, reason: 'no active tab' });
      const st = tabState(tab.id);
      st.recording = !!msg.recording;
      chrome.tabs.sendMessage(tab.id, { type: 'qa:set-recording', recording: st.recording }).catch(() => {});
      sendResponse({ ok: true, recording: st.recording });
    });
    return true;
  }

  if (msg.type === 'qa:panel-clear-steps') {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tab = tabs[0];
      if (tab) tabState(tab.id).steps = [];
      sendResponse({ ok: true });
    });
    return true;
  }
});
