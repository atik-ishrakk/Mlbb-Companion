/**
 * MLBB Companion — Background Service Worker (Manifest V3)
 * Orchestrates custom URL protocol launches, background health checks, and tab routing.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log("[MLBB SW] Extension installed successfully.");
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. One-Click System & Game Launch
  if (request.action === "TRIGGER_LAUNCH") {
    const bluestacksUri = "bluestacks://launch?instance=Nougat32&package=com.mobile.legends";

    // Launch via backend if available
    fetch("http://127.0.0.1:5000/launch")
      .then((res) => res.json())
      .then((data) => console.log("[MLBB SW] Backend launch dispatched:", data))
      .catch(() => {});

    fetch("http://127.0.0.1:5000/cv/initialize").catch(() => {});

    // Try custom protocol URI navigation
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.update(tabs[0].id, { url: bluestacksUri }).catch(() => {});
      }
    });

    sendResponse({ status: "Launching BlueStacks & Mobile Legends..." });
    return true;
  }

  // 2. Open Extension Hub Pages in Full Tabs
  if (request.action === "OPEN_PAGE") {
    const targetPath = request.page || "src/html/draft_pick.html";
    const fullUrl = chrome.runtime.getURL(targetPath);

    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const existingTab = tabs.find((t) => t.url && t.url.includes(targetPath));
      if (existingTab && existingTab.id) {
        chrome.tabs.update(existingTab.id, { active: true });
      } else {
        chrome.tabs.create({ url: fullUrl });
      }
    });

    sendResponse({ status: "Page opened." });
    return true;
  }

  // 3. Status Query Pass-Through
  if (request.action === "GET_STATUS") {
    fetch("http://127.0.0.1:5000/status")
      .then((res) => res.json())
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return true;
});
