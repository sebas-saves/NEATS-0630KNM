(() => {
  const host = location.hostname;
  const SOURCE = host.includes("open.spotify.com")
    ? "spotify"
    : host.includes("music.youtube.com")
    ? "ytm"
    : "yt";

  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

  // 1) prove we are running
  try {
    chrome.runtime.sendMessage({
      type: "OSC_NOW_PLAYING",
      text: `[connected] ${SOURCE}`,
      source: SOURCE,
    });
  } catch {}

  let lastText = "";

  function fromMediaSession() {
    const md = navigator.mediaSession && navigator.mediaSession.metadata;
    if (!md) return "";
    const title = clean(md.title);
    const artist = clean(md.artist);
    if (title && artist) return `${title} — ${artist}`;
    if (title) return title;
    return "";
  }

  function fromYouTubeMusicDOM() {
    const titleEl =
      document.querySelector("ytmusic-player-bar .title") ||
      document.querySelector("ytmusic-player-bar .content-info-wrapper .title");

    const artistEl =
      document.querySelector("ytmusic-player-bar .subtitle") ||
      document.querySelector("ytmusic-player-bar .content-info-wrapper .subtitle");

    const title = clean(titleEl && titleEl.textContent);
    let artist = clean(artistEl && artistEl.textContent);
    if (artist.includes("•")) artist = clean(artist.split("•")[0]);

    if (title && artist) return `${title} — ${artist}`;
    if (title) return title;
    return "";
  }

  function fromYouTubeDOM() {
    const titleEl =
      document.querySelector("h1.title yt-formatted-string") ||
      document.querySelector("h1.ytd-watch-metadata yt-formatted-string");

    const bylineEl =
      document.querySelector("#text.ytd-channel-name") ||
      document.querySelector("ytd-channel-name a") ||
      document.querySelector("#owner #text a");

    const title = clean(titleEl && titleEl.textContent);
    const artist = clean(bylineEl && bylineEl.textContent);

    if (title && artist) return `${title} — ${artist}`;
    if (title) return title;
    return "";
  }

  function fromTitle() {
    const t = clean(document.title);
    if (SOURCE === "ytm" && t.endsWith(" - YouTube Music")) return clean(t.replace(" - YouTube Music", ""));
    if (SOURCE === "yt" && t.endsWith(" - YouTube")) return clean(t.replace(" - YouTube", ""));
    if (SOURCE === "spotify" && t.endsWith(" - Spotify")) return clean(t.replace(" - Spotify", ""));
    return t;
  }

  function readNowPlaying() {
    const ms = fromMediaSession();
    if (ms) return ms;

    if (SOURCE === "ytm") {
      const dom = fromYouTubeMusicDOM();
      if (dom) return dom;
    }

    if (SOURCE === "yt") {
      const dom = fromYouTubeDOM();
      if (dom) return dom;
    }

    return fromTitle();
  }

  function tick() {
    const text = readNowPlaying();
    if (!text) return;

    if (text !== lastText) {
      lastText = text;
      chrome.runtime.sendMessage({ type: "OSC_NOW_PLAYING", text, source: SOURCE });
    }
  }

  tick();
  setInterval(tick, 1000);
})();
