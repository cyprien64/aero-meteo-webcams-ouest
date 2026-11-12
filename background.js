// Un clic sur l'icône ouvre (ou réactive) l'onglet de la carte.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('map.html');
  const [tab] = await chrome.tabs.query({ url });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});
