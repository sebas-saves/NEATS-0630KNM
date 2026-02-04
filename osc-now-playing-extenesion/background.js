const PLAYER_MATCH = [
  "*://open.spotify.com/*",
  "*://www.youtube.com/*",
  "*://music.youtube.com/*",
];

const OSC_MATCH = [
  "http://localhost:5173/*",
  "http://127.0.0.1:5173/*",
];

function log(...args) {
  console.log("[NP bg]", ...args);
}

async function injectPlayerIfNeeded(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-player.js"],
    });
    log("Injected content-player.js into tab", tabId);
  } catch (e) {
    log("Inject failed tab", tabId, e?.message || e);
  }
}

// Inject on install + when a matching tab finishes loading
chrome.runtime.onInstalled.addListener(() => log("installed"));
chrome.runtime.onStartup.addListener(() => log("startup"));

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const url = tab?.url || "";
  if (
    url.startsWith("https://open.spotify.com/") ||
    url.startsWith("https://www.youtube.com/") ||
    url.startsWith("https://music.youtube.com/")
  ) {
    injectPlayerIfNeeded(tabId);
  }
});

let last = { text: "", source: "" };

chrome.runtime.onMessage.addListener((msg, sender) => {
  log("got message", msg, "from", sender?.tab?.url);

  if (!msg || msg.type !== "OSC_NOW_PLAYING") return;

  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  const source = typeof msg.source === "string" ? msg.source : "";
  if (!text) return;

  if (text === last.text && source === last.source) return;
  last = { text, source };

  // forward to oscilloscope tabs
  chrome.tabs.query({}, (tabs) => {
    const targets = tabs.filter((t) => {
      const u = t.url || "";
      return u.startsWith("http://localhost:5173/") || u.startsWith("http://127.0.0.1:5173/");
    });

    log("forwarding to targets:", targets.map((t) => t.url));

    for (const t of targets) {
      chrome.tabs.sendMessage(t.id, { type: "OSC_NOW_PLAYING", text, source }, () => {
        const err = chrome.runtime.lastError;
        if (err) log("sendMessage error:", err.message);
        else log("sent to osc tab:", t.id);
      });
    }
  });
});
