chrome.runtime.onMessage.addListener((msg) => {
  console.log("[NP osc content] received", msg);

  if (!msg || msg.type !== "OSC_NOW_PLAYING") return;

  window.postMessage(
    { type: "OSC_NOW_PLAYING", text: msg.text, source: msg.source },
    "*"
  );
});
