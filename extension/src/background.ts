/**
 * Minimal by design. Everything that takes time runs in the content script,
 * because an MV3 service worker is torn down after roughly thirty seconds idle
 * and a scan runs for minutes.
 */
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId })
})
