console.log('[YTDBG] script.js loaded at', new Date().toISOString(), 'URL:', window.location.href);
window.addEventListener('error', (e) => {
  console.error('[YTDBG] window.onerror', e.message, e.filename, e.lineno, e.colno, e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[YTDBG] unhandledrejection', e.reason);
});

let isDraggingTimeline = false;
let isDraggingVolume = false;
let videoDuration = 0;
let earliestWatchedTime = 0;
let previousVolume = 100;
let isYouTubeMode = false;
let ytPlayer = null;
let ytPollInterval = null;

const myVideo = document.getElementById('myVideo');
const ytContainer = document.getElementById('ytContainer');
const loadingIndicator = document.getElementById('loadingIndicator');
const playPauseBtn = document.getElementById('playPauseBtn');
const rewindBtn = document.getElementById('rewindBtn');
const progressRed = document.getElementById('progressRed');
const progressLoaded = document.getElementById('progressLoaded');
const progressHandle = document.getElementById('progressHandle');
const timeCurrent = document.getElementById('timeCurrent');
const timeTotal = document.getElementById('timeTotal');
const timeBox = document.querySelector('.time-box');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const theaterBtn = document.getElementById('theaterBtn');
const progressSection = document.querySelector('.progress-section');
const volumeTrack = document.getElementById('volumeTrack');
const volumeHandle = document.getElementById('volumeHandle');
const volumeLevel = document.getElementById('volumeLevel');
const volumeBtn = document.getElementById('volumeBtn');
const endedButtons = document.getElementById('endedButtons');
const shareBtn = document.getElementById('shareBtn');
const watchAgainBtn = document.getElementById('watchAgainBtn');
const ytLoaderForm = document.getElementById('ytLoaderForm');
const ytUrlInput = document.getElementById('ytUrlInput');
const ytInputError = document.getElementById('ytInputError');
const playerContainers = Array.from(document.querySelectorAll('.player-container'));
let uiAssetsReady = false;
let pendingLoadingAnimation = false;
let fullscreenHoverEventsAttached = false;
let theaterHoverEventsAttached = false;
const WATCH_CLASSIC_PLAYER_WIDTH = 500;
const WATCH_CLASSIC_VIDEO_HEIGHT = 350;
const WATCH_CLASSIC_CONTROLS_HEIGHT = 31;
const WATCH_CLASSIC_SIDE_WIDTH = 315;
const WATCH_THEATER_GRID_GAP = 12;
const WATCH_THEATER_ASPECT_RATIO = 16 / 9;
const WATCH_THEATER_MIN_WIDTH = 500;
const WATCH_THEATER_MIN_HEIGHT = 260;
const DEFAULT_TIME_BOX_WIDTH = 70;
const DEFAULT_CLOCK_TEXT = '00:00 / 00:00';
const DEFAULT_CLOCK_TEXT_LENGTH = DEFAULT_CLOCK_TEXT.length;
const TIME_BOX_EXTRA_CHAR_WIDTH = 6;
let playerAspectRatioHint = null;
endedButtons.style.display = 'none';
loadingIndicator.style.zIndex = '99999999999999999999999999';
loadingIndicator.style.position = 'absolute';
loadingIndicator.style.top = '50%';
loadingIndicator.style.left = '50%';
loadingIndicator.style.transform = 'translate(-50%, -50%)';
loadingIndicator.style.backgroundRepeat = 'no-repeat';
loadingIndicator.style.backgroundPosition = 'center';
loadingIndicator.style.backgroundSize = 'contain';
loadingIndicator.style.pointerEvents = 'none';

function isWatchClassicLayout() {
  return !!document.querySelector('.watch-layout.watch-classic');
}

function isWatchTheaterModeActive() {
  const layout = document.querySelector('.watch-layout.watch-classic');
  return !!(layout && layout.classList.contains('theater-mode'));
}

function normalizeAspectRatio(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return null;
  if (ratio < 0.25 || ratio > 4) return null;
  return ratio;
}

function setPlayerAspectRatioHint(ratio) {
  const normalized = normalizeAspectRatio(ratio);
  const changed = normalized !== playerAspectRatioHint;
  playerAspectRatioHint = normalized;
  if (changed && isWatchTheaterModeActive()) {
    enforceWatchTheaterWindowedBox();
  }
}

window.setPlayerAspectRatioHint = setPlayerAspectRatioHint;

function getActiveYouTubeElement() {
  if (ytPlayer && typeof ytPlayer.getIframe === 'function') {
    try {
      const iframe = ytPlayer.getIframe();
      if (iframe) return iframe;
    } catch (_) {}
  }
  return document.getElementById('ytContainer');
}

function setActiveYouTubeDisplay(displayValue) {
  const liveYtEl = getActiveYouTubeElement();
  if (liveYtEl) {
    liveYtEl.style.display = displayValue;
  } else if (ytContainer) {
    ytContainer.style.display = displayValue;
  }
}

function syncYouTubePlayerBox(width, height) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const liveYtEl = getActiveYouTubeElement();

  if (liveYtEl) {
    liveYtEl.style.setProperty('width', `${w}px`, 'important');
    liveYtEl.style.setProperty('height', `${h}px`, 'important');
    liveYtEl.style.setProperty('min-width', `${w}px`, 'important');
    liveYtEl.style.setProperty('min-height', `${h}px`, 'important');
  }

  if (ytPlayer && typeof ytPlayer.setSize === 'function') {
    try {
      ytPlayer.setSize(w, h);
    } catch (_) {}
  }
}

function getActiveMediaAspectRatio() {
  if (isYouTubeMode) {
    if (playerAspectRatioHint) return playerAspectRatioHint;

    const ytEl = getActiveYouTubeElement();
    if (ytEl) {
      const attrW = Number(ytEl.getAttribute('width'));
      const attrH = Number(ytEl.getAttribute('height'));
      if (Number.isFinite(attrW) && Number.isFinite(attrH) && attrW > 0 && attrH > 0) {
        return attrW / attrH;
      }
    }
    // Most YouTube uploads are widescreen; use this instead of stale local-video dimensions.
    return WATCH_THEATER_ASPECT_RATIO;
  }

  if (myVideo && myVideo.videoWidth > 0 && myVideo.videoHeight > 0) {
    return myVideo.videoWidth / myVideo.videoHeight;
  }

  return WATCH_THEATER_ASPECT_RATIO;
}

function getTheaterVideoHeightForWidth(width) {
  const safeWidth = Math.max(WATCH_THEATER_MIN_WIDTH, Math.round(Number(width) || 0));
  const aspect = Math.max(0.25, Math.min(4, getActiveMediaAspectRatio() || WATCH_THEATER_ASPECT_RATIO));
  const computedHeight = Math.round(safeWidth / aspect);
  return Math.max(WATCH_THEATER_MIN_HEIGHT, computedHeight);
}

function enforceWatchClassicWindowedBox() {
  if (document.fullscreenElement || !isWatchClassicLayout() || isWatchTheaterModeActive()) return;

  const layout = document.querySelector('.watch-layout.watch-classic');
  const leftCol = document.querySelector('.watch-classic .watch-left');
  const midCol = document.querySelector('.watch-classic .watch-mid');
  const frame = document.querySelector('.watch-classic .watch-player-frame');
  const container = document.querySelector('.watch-classic .player-container');
  const videoArea = document.querySelector('.watch-classic .video-area');
  const bottomBar = document.querySelector('.watch-classic .bottom-bar');
  const actionsStats = document.getElementById('actionsAndStatsDiv');
  const actionsMatrix = document.querySelector('.watch-classic .actionsMatrix');

  if (layout) {
    layout.style.setProperty('grid-template-columns', `${WATCH_CLASSIC_PLAYER_WIDTH}px ${WATCH_CLASSIC_SIDE_WIDTH}px`, 'important');
    layout.style.setProperty('column-gap', '12px', 'important');
  }
  if (leftCol) leftCol.style.setProperty('width', `${WATCH_CLASSIC_PLAYER_WIDTH}px`, 'important');
  if (midCol) midCol.style.setProperty('width', `${WATCH_CLASSIC_SIDE_WIDTH}px`, 'important');
  if (frame) frame.style.setProperty('width', `${WATCH_CLASSIC_PLAYER_WIDTH}px`, 'important');
  if (container) {
    container.style.setProperty('width', `${WATCH_CLASSIC_PLAYER_WIDTH}px`, 'important');
    container.style.setProperty('max-width', `${WATCH_CLASSIC_PLAYER_WIDTH}px`, 'important');
  }
  if (videoArea) {
    videoArea.style.setProperty('width', `${WATCH_CLASSIC_PLAYER_WIDTH}px`, 'important');
    videoArea.style.setProperty('min-width', `${WATCH_CLASSIC_PLAYER_WIDTH}px`, 'important');
    videoArea.style.setProperty('height', `${WATCH_CLASSIC_VIDEO_HEIGHT}px`, 'important');
    videoArea.style.setProperty('min-height', `${WATCH_CLASSIC_VIDEO_HEIGHT}px`, 'important');
  }
  if (myVideo) {
    myVideo.style.setProperty('width', `${WATCH_CLASSIC_PLAYER_WIDTH}px`, 'important');
    myVideo.style.setProperty('height', `${WATCH_CLASSIC_VIDEO_HEIGHT}px`, 'important');
    myVideo.style.setProperty('object-fit', 'contain', 'important');
  }
  syncYouTubePlayerBox(WATCH_CLASSIC_PLAYER_WIDTH, WATCH_CLASSIC_VIDEO_HEIGHT);
  if (bottomBar) {
    bottomBar.style.setProperty('width', `${WATCH_CLASSIC_PLAYER_WIDTH}px`, 'important');
    bottomBar.style.setProperty('height', `${WATCH_CLASSIC_CONTROLS_HEIGHT}px`, 'important');
  }
  if (actionsStats) actionsStats.style.setProperty('width', `${WATCH_CLASSIC_PLAYER_WIDTH}px`, 'important');
  if (actionsMatrix) actionsMatrix.style.setProperty('width', `${WATCH_CLASSIC_PLAYER_WIDTH}px`, 'important');
}

function enforceWatchTheaterWindowedBox() {
  if (document.fullscreenElement || !isWatchClassicLayout() || !isWatchTheaterModeActive()) return;

  const layout = document.querySelector('.watch-layout.watch-classic');
  const leftCol = document.querySelector('.watch-classic .watch-left');
  const midCol = document.querySelector('.watch-classic .watch-mid');
  const frame = document.querySelector('.watch-classic .watch-player-frame');
  const container = document.querySelector('.watch-classic .player-container');
  const videoArea = document.querySelector('.watch-classic .video-area');
  const bottomBar = document.querySelector('.watch-classic .bottom-bar');
  const actionsStats = document.getElementById('actionsAndStatsDiv');
  const actionsMatrix = document.querySelector('.watch-classic .actionsMatrix');

  if (!layout) return;

  const layoutInnerWidth = Math.max(WATCH_THEATER_MIN_WIDTH, Math.floor(layout.clientWidth - 16));
  const theaterPlayerWidth = layoutInnerWidth;
  const theaterMainColumnWidth = Math.max(
    1,
    theaterPlayerWidth - WATCH_CLASSIC_SIDE_WIDTH - WATCH_THEATER_GRID_GAP
  );
  const theaterVideoHeight = getTheaterVideoHeightForWidth(theaterPlayerWidth);

  layout.style.setProperty('grid-template-columns', `${theaterMainColumnWidth}px ${WATCH_CLASSIC_SIDE_WIDTH}px`, 'important');
  layout.style.setProperty('column-gap', `${WATCH_THEATER_GRID_GAP}px`, 'important');
  layout.style.setProperty('row-gap', '8px', 'important');

  if (leftCol) leftCol.style.setProperty('width', 'auto', 'important');
  if (midCol) {
    midCol.style.setProperty('width', `${WATCH_CLASSIC_SIDE_WIDTH}px`, 'important');
    midCol.style.setProperty('margin-top', '0px', 'important');
  }
  if (frame) frame.style.setProperty('width', `${theaterPlayerWidth}px`, 'important');
  if (container) {
    container.style.setProperty('width', `${theaterPlayerWidth}px`, 'important');
    container.style.setProperty('max-width', `${theaterPlayerWidth}px`, 'important');
  }
  if (videoArea) {
    videoArea.style.setProperty('width', `${theaterPlayerWidth}px`, 'important');
    videoArea.style.setProperty('min-width', `${theaterPlayerWidth}px`, 'important');
    videoArea.style.setProperty('height', `${theaterVideoHeight}px`, 'important');
    videoArea.style.setProperty('min-height', `${theaterVideoHeight}px`, 'important');
  }
  if (myVideo) {
    myVideo.style.setProperty('width', `${theaterPlayerWidth}px`, 'important');
    myVideo.style.setProperty('height', `${theaterVideoHeight}px`, 'important');
    myVideo.style.setProperty('object-fit', 'contain', 'important');
  }
  syncYouTubePlayerBox(theaterPlayerWidth, theaterVideoHeight);
  if (bottomBar) {
    bottomBar.style.setProperty('width', `${theaterPlayerWidth}px`, 'important');
    bottomBar.style.setProperty('height', `${WATCH_CLASSIC_CONTROLS_HEIGHT}px`, 'important');
  }
  if (actionsStats) actionsStats.style.setProperty('width', `${WATCH_CLASSIC_PLAYER_WIDTH}px`, 'important');
  if (actionsMatrix) actionsMatrix.style.setProperty('width', `${WATCH_CLASSIC_PLAYER_WIDTH}px`, 'important');
}

function setWatchTheaterMode(enabled) {
  if (!isWatchClassicLayout()) return;
  const layout = document.querySelector('.watch-layout.watch-classic');
  const midCol = document.querySelector('.watch-classic .watch-mid');
  if (!layout) return;

  layout.classList.toggle('theater-mode', enabled);
  document.body.classList.toggle('watch-theater-mode', enabled);
  if (theaterBtn) theaterBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');

  if (enabled) {
    enforceWatchTheaterWindowedBox();
  } else {
    layout.style.removeProperty('grid-template-columns');
    layout.style.removeProperty('column-gap');
    layout.style.removeProperty('row-gap');
    if (midCol) midCol.style.removeProperty('margin-top');
    enforceWatchClassicWindowedBox();
  }
  scheduleUIUpdate();
}

function setFullscreenUiState(isFullscreen) {
  document.documentElement.classList.toggle('player-is-fullscreen', isFullscreen);

  if (theaterBtn) {
    if (isFullscreen) {
      theaterBtn.style.setProperty('display', 'none', 'important');
    } else {
      theaterBtn.style.removeProperty('display');
    }
  }
}

function setPlayerVisibility(isVisible) {
  const visibility = isVisible ? 'visible' : 'hidden';
  for (const container of playerContainers) {
    container.style.visibility = visibility;
  }
}

window.addEventListener('resize', () => {
  if (isWatchTheaterModeActive()) {
    enforceWatchTheaterWindowedBox();
  } else {
    enforceWatchClassicWindowedBox();
  }
});

if (ytContainer) {
  const ytContainerObserver = new MutationObserver(() => {
    if (isWatchTheaterModeActive()) {
      enforceWatchTheaterWindowedBox();
    } else {
      enforceWatchClassicWindowedBox();
    }
  });
  ytContainerObserver.observe(ytContainer, { childList: true, subtree: true });
}

// Hide player UI until assets are preloaded to prevent first-hover texture pops.
setPlayerVisibility(false);

// Decide playback provider based on URL (?yt=VIDEO_ID_OR_URL)
function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function getInitialYouTubeInput() {
  // Accept several common param names or a full YouTube URL anywhere in the query/hash
  const direct = getQueryParam('yt') || getQueryParam('v') || getQueryParam('url') || getQueryParam('u');
  if (direct) return direct;

  // Scan entire decoded query string for a YouTube URL
  const qs = window.location.search ? window.location.search.slice(1) : '';
  if (qs) {
    try {
      const decoded = decodeURIComponent(qs);
      const m1 = decoded.match(/https?:\/\/[^\s&]*youtube\.com[^\s]*/i);
      const m2 = decoded.match(/https?:\/\/youtu\.be\/[^\s&]*/i);
      if (m1 && m1[0]) return m1[0];
      if (m2 && m2[0]) return m2[0];
    } catch (_) {}
  }

  // Check hash for yt-like inputs, e.g. #yt=..., #v=..., or a raw URL
  const hash = window.location.hash ? window.location.hash.slice(1) : '';
  if (hash) {
    try {
      const hp = new URLSearchParams(hash);
      const hval = hp.get('yt') || hp.get('v') || hp.get('url') || hp.get('u');
      if (hval) return hval;
    } catch (_) {
      // Not a param list; fall through and try to match a URL directly
      const m1 = hash.match(/https?:\/\/[^\s&]*youtube\.com[^\s]*/i);
      const m2 = hash.match(/https?:\/\/youtu\.be\/[^\s&]*/i);
      if (m1 && m1[0]) return m1[0];
      if (m2 && m2[0]) return m2[0];
    }
  }

  return null;
}

function normalizeUrlMaybe(input) {
  if (!input) return '';
  // Trim whitespace and common surrounding punctuation or prefixes (e.g., '@', parentheses)
  let trimmed = input.trim();
  // If text contains a URL somewhere inside, extract the first http(s) URL substring
  const urlMatch = trimmed.match(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/i);
  if (urlMatch) {
    trimmed = urlMatch[0];
  }
  // Remove leading '@' or surrounding brackets/parentheses
  trimmed = trimmed.replace(/^[@\s]+/, '').replace(/^[(<\[]+/, '').replace(/[)\]>]+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return 'https://' + trimmed;
}

function extractYouTubeId(input) {
  if (!input) return null;
  const idLike = /^[a-zA-Z0-9_-]{11}$/;
  if (idLike.test(input)) return input;
  try {
    const url = new URL(normalizeUrlMaybe(input));
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      return url.pathname.slice(1);
    }
    if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (url.searchParams.get('v')) {
        return url.searchParams.get('v');
      }
    }
    const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shorts) return shorts[1];
    const embed = url.pathname.match(/\/(?:embed|live)\/([a-zA-Z0-9_-]{11})/);
    if (embed) return embed[1];
  } catch (_) {
    // not a URL, fallthrough
  }
  return null;
}

function extractStartSeconds(input) {
  try {
    const url = new URL(normalizeUrlMaybe(input));
    let t = url.searchParams.get('t') || url.searchParams.get('start');
    if (!t) return 0;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    let seconds = 0;
    const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
    if (m) {
      seconds += (parseInt(m[1] || '0', 10) * 3600);
      seconds += (parseInt(m[2] || '0', 10) * 60);
      seconds += (parseInt(m[3] || '0', 10));
    }
    return seconds;
  } catch (_) {
    return 0;
  }
}

const initialYtInput = getInitialYouTubeInput();
const ytVideoId = extractYouTubeId(initialYtInput);
const ytStartAt = extractStartSeconds(initialYtInput) || 0;
console.log('[YTDBG] Initial detection', { initialYtInput, ytVideoId, ytStartAt });
isYouTubeMode = !!ytVideoId;
console.log('[YTDBG] isYouTubeMode set to', isYouTubeMode);

if (!isYouTubeMode) {
  myVideo.addEventListener('loadstart', startLoadingAnimation);
  myVideo.addEventListener('loadeddata', stopLoadingAnimation);
}

if (!isYouTubeMode) {
  myVideo.addEventListener('loadedmetadata', () => {
    videoDuration = myVideo.duration;
    updateProgress();
    updateBuffered();
    let initialVolPercent = myVideo.volume * 100;
    setVolume(initialVolPercent);

    endedButtons.style.display = 'none';
    myVideo.play();

    if (isWatchTheaterModeActive()) {
      enforceWatchTheaterWindowedBox();
    }
  });
}

if (!isYouTubeMode) {
  myVideo.addEventListener('timeupdate', () => {
    scheduleUIUpdate();
  });
}

if (!isYouTubeMode) {
  myVideo.addEventListener('progress', () => {
    scheduleUIUpdate();
  });
}

if (!isYouTubeMode) {
  myVideo.addEventListener('ended', () => {
    myVideo.style.display = 'none';
    endedButtons.style.display = 'flex';
  });
}

if (!isYouTubeMode) {
  myVideo.addEventListener('play', () => {
    playPauseBtn.classList.add('playing');
    endedButtons.style.display = 'none';
    myVideo.style.display = 'block';
  });
  myVideo.addEventListener('pause', () => {
    playPauseBtn.classList.remove('playing');
  });
}


shareBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href).catch(err => {
    console.error('Failed to copy URL:', err);
  });
});

// Watch Again button: On click, rewind and play the video
watchAgainBtn.addEventListener('click', () => {
  // Hide the ended buttons and show the video again
  endedButtons.style.display = 'none';
  myVideo.style.display = 'block';

  // Reset earliestWatchedTime so the red bar clears
  earliestWatchedTime = 0;
  // Force a reload of the video to discard previously buffered data

// Also reset earliestWatchedTime to clear the red bar visually
earliestWatchedTime = 0;

  // Reset the video playback
  myVideo.currentTime = 0;
  myVideo.play();
  
  // Update the timeline after resetting earliestWatchedTime
  updateProgress();
  updateBuffered();
});

let loadingFrame = 1;
const loadingTotalFrames = 22;
let loadingInterval = null;
const loadingFps = 24; // Faster buffering cadence
const loadingFrameDelay = Math.round(1000 / loadingFps); // ~42ms per frame
const loadingLastFrameHoldTicks = 2; // Keep final frame visible for one extra tick
let loadingLastFrameHold = 0;

function updateLoadingFrame() {
    if (loadingFrame < loadingTotalFrames) {
      loadingFrame++;
      loadingLastFrameHold = 0;
    } else if (loadingLastFrameHold < (loadingLastFrameHoldTicks - 1)) {
      loadingLastFrameHold++;
    } else {
      // Loop back to frame 1 after briefly holding the final frame
      loadingFrame = 1;
      loadingLastFrameHold = 0;
    }

    loadingIndicator.style.backgroundImage = `url('assets/loading_frames/${loadingFrame}.svg')`;
  }
  
  function startLoadingAnimation() {
    if (!uiAssetsReady) {
      pendingLoadingAnimation = true;
      return;
    }
    if (!loadingInterval) {
      pendingLoadingAnimation = false;
      loadingFrame = 1;
      loadingLastFrameHold = 0;
      loadingIndicator.style.backgroundImage = `url('assets/loading_frames/1.svg')`;
      loadingIndicator.style.display = 'block'; // show the indicator
      loadingInterval = setInterval(updateLoadingFrame, loadingFrameDelay);
    }
  }
  
  function stopLoadingAnimation() {
    pendingLoadingAnimation = false;
    if (loadingInterval) {
      clearInterval(loadingInterval);
      loadingInterval = null;
      loadingIndicator.style.display = 'none'; // hide the indicator
      // reset to frame 1
      loadingFrame = 1;
      loadingLastFrameHold = 0;
      loadingIndicator.style.backgroundImage = `url('assets/loading_frames/1.svg')`;
    }
  }

// Video buffering events
// 'waiting' event fires when the video is buffering/waiting for data
if (!isYouTubeMode) {
  myVideo.addEventListener('waiting', startLoadingAnimation);
  myVideo.addEventListener('playing', stopLoadingAnimation);
  myVideo.addEventListener('canplay', stopLoadingAnimation);
  myVideo.addEventListener('canplaythrough', stopLoadingAnimation);
}

// Provider abstraction
function providerGetDuration() {
  if (isYouTubeMode) {
    return ytPlayer ? ytPlayer.getDuration() : 0;
  }
  return videoDuration || (myVideo ? myVideo.duration : 0) || 0;
}

function providerGetCurrentTime() {
  if (isYouTubeMode) {
    return ytPlayer ? ytPlayer.getCurrentTime() : 0;
  }
  return myVideo.currentTime;
}

function providerSeekTo(seconds) {
  if (isYouTubeMode) {
    if (ytPlayer) ytPlayer.seekTo(seconds, true);
  } else {
    myVideo.currentTime = seconds;
  }
}

function providerPlay() {
  if (isYouTubeMode) {
    if (ytPlayer) ytPlayer.playVideo();
  } else {
    myVideo.play();
  }
}

function providerPause() {
  if (isYouTubeMode) {
    if (ytPlayer) ytPlayer.pauseVideo();
  } else {
    myVideo.pause();
  }
}

function providerIsPaused() {
  if (isYouTubeMode) {
    if (!ytPlayer || typeof YT === 'undefined') return true;
    const s = ytPlayer.getPlayerState();
    return s !== YT.PlayerState.PLAYING;
  }
  return myVideo.paused || myVideo.ended;
}

function providerGetLoadedEnd() {
  const duration = providerGetDuration();
  if (duration <= 0) return 0;
  if (isYouTubeMode) {
    if (!ytPlayer) return 0;
    const fraction = ytPlayer.getVideoLoadedFraction();
    return fraction * duration;
  } else {
    if (!myVideo.buffered || myVideo.buffered.length === 0) return 0;
    return myVideo.buffered.end(myVideo.buffered.length - 1);
  }
}

function togglePlayPause() {
  if (providerIsPaused()) {
    providerPlay();
    playPauseBtn.classList.add('playing');
  } else {
    providerPause();
    playPauseBtn.classList.remove('playing');
  }
}

function rewindVideo() {
  providerSeekTo(0);
  earliestWatchedTime = 0;
  updateProgress();
  updateBuffered();
}



function updateProgress() {
  const duration = providerGetDuration();
  if (!duration) return;
  const currentTime = providerGetCurrentTime();
  const timelineWidth = progressSection.clientWidth;
  const earliestPixel = Math.round((earliestWatchedTime / duration) * timelineWidth);
  const currentPixel = Math.round((currentTime / duration) * timelineWidth);
  const watchedWidth = Math.max(0, currentPixel - earliestPixel);

  progressRed.style.left = earliestPixel + 'px';
  progressRed.style.width = watchedWidth + 'px';

  const handleX = currentPixel - Math.round(progressHandle.offsetWidth / 2);
  progressHandle.style.left = handleX + 'px';

  updateTimeDisplay(currentTime, duration);
}

// Removed duplicate percent-based updateBuffered; using pixel-precise version below
function updateTimeDisplay(currentTime, duration) {
  timeCurrent.textContent = formatTimeForDuration(currentTime, duration);
  timeTotal.textContent = duration ? formatTimeForDuration(duration, duration) : '00:00';

  if (adjustTimeBoxWidth()) {
    // Recalculate timeline geometry if the time-box width changed.
    scheduleUIUpdate();
  }
}

function adjustTimeBoxWidth() {
  if (!timeBox) return false;
  const clockText = `${timeCurrent.textContent} / ${timeTotal.textContent}`;
  const extraChars = Math.max(0, clockText.length - DEFAULT_CLOCK_TEXT_LENGTH);
  const desiredWidth = DEFAULT_TIME_BOX_WIDTH + (extraChars * TIME_BOX_EXTRA_CHAR_WIDTH);

  if (desiredWidth <= DEFAULT_TIME_BOX_WIDTH) {
    const hadInlineWidth = timeBox.style.width !== '';
    const hadExpandedClass = timeBox.classList.contains('expanded');
    if (hadInlineWidth) timeBox.style.removeProperty('width');
    if (hadExpandedClass) timeBox.classList.remove('expanded');
    return hadInlineWidth || hadExpandedClass;
  }

  const currentWidth = parseInt(timeBox.style.width || `${DEFAULT_TIME_BOX_WIDTH}`, 10);
  const hadExpandedClass = timeBox.classList.contains('expanded');

  timeBox.style.width = `${desiredWidth}px`;
  if (!hadExpandedClass) timeBox.classList.add('expanded');

  return currentWidth !== desiredWidth || !hadExpandedClass;
}

function formatTimeForDuration(seconds, referenceDuration) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const safeReference = Math.max(0, Math.floor(Number(referenceDuration) || 0));

  if (safeReference >= 3600) {
    const referenceHours = Math.floor(safeReference / 3600);
    const hourDigits = Math.max(2, String(referenceHours).length);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = safeSeconds % 60;
    return `${String(hours).padStart(hourDigits, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  const totalMinutes = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(totalMinutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updateBuffered() {
  const duration = providerGetDuration();
  if (!duration) return;
  const bufferEnd = providerGetLoadedEnd();
  const timelineWidth = progressSection.clientWidth;

  const loadedDuration = Math.max(0, bufferEnd - earliestWatchedTime);
  const earliestPixel = Math.round((earliestWatchedTime / duration) * timelineWidth);
  const loadedWidth = Math.round((loadedDuration / duration) * timelineWidth);

  progressLoaded.style.left = earliestPixel + 'px';
  progressLoaded.style.width = loadedWidth + 'px';
}

/* Timeline dragging */
function startTimelineDrag(e) {
  isDraggingTimeline = true;
  progressHandle.classList.add('active');
  document.addEventListener('mousemove', dragTimeline);
  document.addEventListener('mouseup', stopTimelineDrag);
  e.preventDefault();
}

function dragTimeline(e) {
  if (!isDraggingTimeline) return;
  e.preventDefault();
  const rect = progressSection.getBoundingClientRect();
  let x = e.clientX - rect.left;
  x = Math.max(0, Math.min(x, rect.width));
  const duration = providerGetDuration();
  const newTime = (x / rect.width) * duration;

  const watchedDuration = Math.max(0, newTime - earliestWatchedTime);
  const earliestPixel = (earliestWatchedTime / duration) * progressSection.clientWidth;
  const watchedWidth = (watchedDuration / duration) * progressSection.clientWidth;
  progressRed.style.left = earliestPixel + 'px';
  progressRed.style.width = watchedWidth + 'px';

  const handlePercent = (newTime / duration) * 100;
  const handleX = (handlePercent / 100) * progressSection.clientWidth;
  progressHandle.style.left = (handleX - (progressHandle.offsetWidth / 2)) + 'px';
  updateTimeDisplay(newTime, videoDuration);
}

function stopTimelineDrag(e) {
  if (!isDraggingTimeline) return;
  isDraggingTimeline = false;
  progressHandle.classList.remove('active');
  document.removeEventListener('mousemove', dragTimeline);
  document.removeEventListener('mouseup', stopTimelineDrag);

  const rect = progressSection.getBoundingClientRect();
  let x = e.clientX - rect.left;
  x = Math.max(0, Math.min(x, rect.width));
  const duration = providerGetDuration();
  const newTime = (x / rect.width) * duration;

  earliestWatchedTime = newTime;
  // Clear visually:
  progressRed.style.width = '0px';
  progressRed.style.left = ((earliestWatchedTime / duration) * progressSection.clientWidth) + 'px';
  progressLoaded.style.width = '0px';
  progressLoaded.style.left = ((earliestWatchedTime / duration) * progressSection.clientWidth) + 'px';
  
  updateProgress();
  updateBuffered();
  
}

progressHandle.addEventListener('mousedown', startTimelineDrag);

progressSection.addEventListener('click', (e) => {
  if (isDraggingTimeline) return;
  const rect = progressSection.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const duration = providerGetDuration();
  const newTime = (clickX / rect.width) * duration;
  earliestWatchedTime = newTime;
  providerSeekTo(newTime);
  updateProgress();
  updateBuffered();
});

/* Volume Logic */
function updateVolumeIcon(volPercent) {
  const volume = Math.max(0, Math.min(100, Number(volPercent) || 0));
  let volumeLevelClass = 'volume-level-0';
  if (volume === 0) {
    volumeLevelClass = 'volume-level-0';
  } else if (volume <= 25) {
    volumeLevelClass = 'volume-level-1';
  } else if (volume <= 50) {
    volumeLevelClass = 'volume-level-2';
  } else if (volume <= 75) {
    volumeLevelClass = 'volume-level-3';
  } else if (volume > 75) {
    volumeLevelClass = 'volume-level-4';
  }

  volumeBtn.classList.remove('volume-level-0', 'volume-level-1', 'volume-level-2', 'volume-level-3', 'volume-level-4');
  volumeBtn.classList.add(volumeLevelClass);
  volumeBtn.classList.toggle('muted', volume === 0);
}

function setVolume(volPercent) {
  volPercent = Math.max(0, Math.min(100, volPercent));
  if (isYouTubeMode) {
    if (ytPlayer) {
      ytPlayer.setVolume(volPercent);
      if (volPercent === 0) ytPlayer.mute(); else ytPlayer.unMute();
    }
  } else {
    myVideo.volume = volPercent / 100;
  }
  volumeLevel.style.width = volPercent + '%';

  const trackWidth = volumeTrack.clientWidth;
  const handleX = (volPercent / 100) * trackWidth;
  volumeHandle.style.left = (handleX - (volumeHandle.offsetWidth / 2)) + 'px';

  updateVolumeIcon(volPercent);
}

volumeBtn.addEventListener('click', () => {
  let currentVolPercent = isYouTubeMode ? (ytPlayer ? ytPlayer.getVolume() : 100) : (myVideo.volume * 100);
  if (currentVolPercent > 0) {
    previousVolume = currentVolPercent;
    setVolume(0);
  } else {
    setVolume(previousVolume);
  }
});

function startVolumeDrag(e) {
  isDraggingVolume = true;
  volumeHandle.classList.add('active');
  document.addEventListener('mousemove', dragVolume);
  document.addEventListener('mouseup', stopVolumeDrag);
  e.preventDefault(); 
}

function dragVolume(e) {
  if (!isDraggingVolume) return;
  e.preventDefault();
  const rect = volumeTrack.getBoundingClientRect();
  let x = e.clientX - rect.left;
  const width = rect.width;
  x = Math.max(0, Math.min(x, width));
  let volPercent = (x / width) * 100;
  setVolume(volPercent);
}

function stopVolumeDrag(e) {
  if (!isDraggingVolume) return;
  isDraggingVolume = false;
  volumeHandle.classList.remove('active');
  document.removeEventListener('mousemove', dragVolume);
  document.removeEventListener('mouseup', stopVolumeDrag);
}

volumeHandle.addEventListener('mousedown', startVolumeDrag);
// Clicking anywhere on the volume slider should set the volume to that point
volumeTrack.addEventListener('click', (e) => {
  const rect = volumeTrack.getBoundingClientRect();
  let x = e.clientX - rect.left;
  const width = rect.width;
  x = Math.max(0, Math.min(x, width));
  let volPercent = (x / width) * 100;
  setVolume(volPercent);
});

const controlBarHeight = 31; // Adjust if your control bar height differs

function adjustVideoSizeForFullscreen() {
  const container = document.querySelector('.player-container');
  const videoArea = document.querySelector('.video-area');
  const bottomBar = document.querySelector('.bottom-bar');
  if (!videoArea) return;

  if (document.fullscreenElement) {
    // In fullscreen mode, set .video-area to fill the screen except the control bar space
    const fullscreenWidth = Math.max(1, window.innerWidth);
    const fullscreenHeight = Math.max(1, window.innerHeight - controlBarHeight);
    if (container) {
      container.style.setProperty('width', '100vw', 'important');
      container.style.setProperty('max-width', '100vw', 'important');
      container.style.setProperty('height', '100vh', 'important');
      container.style.setProperty('min-height', '100vh', 'important');
    }
    videoArea.style.setProperty('width', `${fullscreenWidth}px`, 'important');
    videoArea.style.setProperty('min-width', `${fullscreenWidth}px`, 'important');
    videoArea.style.setProperty('height', `${fullscreenHeight}px`, 'important');
    videoArea.style.setProperty('min-height', `${fullscreenHeight}px`, 'important');
    videoArea.style.display = 'flex';
    videoArea.style.alignItems = 'center';
    videoArea.style.justifyContent = 'center';
    if (bottomBar) {
      // Override prior fixed inline widths from classic/theater windowed sizing.
      bottomBar.style.setProperty('width', '100vw', 'important');
      bottomBar.style.setProperty('max-width', '100vw', 'important');
      bottomBar.style.setProperty('left', '0px', 'important');
      bottomBar.style.setProperty('right', '0px', 'important');
    }

    if (isYouTubeMode) {
      syncYouTubePlayerBox(fullscreenWidth, fullscreenHeight);
    } else {
      // Override any previously inlined fixed classic/theater sizes.
      myVideo.style.setProperty('width', '100%', 'important');
      myVideo.style.setProperty('height', '100%', 'important');
      myVideo.style.setProperty('max-width', '100%', 'important');
      myVideo.style.setProperty('max-height', '100%', 'important');
      myVideo.style.setProperty('object-fit', 'contain', 'important');
    }
  } else {
    if (container) {
      container.style.removeProperty('width');
      container.style.removeProperty('max-width');
      container.style.removeProperty('height');
      container.style.removeProperty('min-height');
    }
    if (bottomBar) {
      bottomBar.style.removeProperty('left');
      bottomBar.style.removeProperty('right');
    }

    // In windowed mode on watch.html, keep the classic fixed box.
    if (isWatchClassicLayout()) {
      videoArea.style.display = '';
      videoArea.style.alignItems = '';
      videoArea.style.justifyContent = '';
      if (isWatchTheaterModeActive()) {
        enforceWatchTheaterWindowedBox();
      } else {
        enforceWatchClassicWindowedBox();
      }
      return;
    }

    // In windowed mode elsewhere, revert to original sizing
    videoArea.style.height = 'auto';
    videoArea.style.width = '100%';
    videoArea.style.removeProperty('min-width');
    videoArea.style.removeProperty('min-height');
    videoArea.style.display = '';
    videoArea.style.alignItems = '';
    videoArea.style.justifyContent = '';
    if (bottomBar) {
      bottomBar.style.removeProperty('width');
      bottomBar.style.removeProperty('max-width');
      bottomBar.style.removeProperty('left');
      bottomBar.style.removeProperty('right');
    }

    myVideo.style.removeProperty('width');
    myVideo.style.removeProperty('height');
    myVideo.style.removeProperty('max-width');
    myVideo.style.removeProperty('max-height');
    myVideo.style.removeProperty('object-fit');
  }
}


/* Fullscreen Toggle */
function toggleFullscreen() {
  const container = document.querySelector('.player-container');
  if (!document.fullscreenElement) {
    container.requestFullscreen().catch(err => {
      console.error("Error attempting to enter fullscreen:", err);
    });
  } else {
    document.exitFullscreen().catch(err => {
      console.error("Error attempting to exit fullscreen:", err);
    });
  }
}



playPauseBtn.addEventListener('click', togglePlayPause);
rewindBtn.addEventListener('click', rewindVideo);
fullscreenBtn.addEventListener('click', toggleFullscreen);

/* Animated Theater Button Frames */
let theaterFrame = 1;
const theaterLoopMaxFrame = 4; // loop frames 1-4 on hover
let theaterTimer = null;
let theaterHovering = false;
const theaterFrameDelay = 110; // ms per frame
const theaterReturnDelay = 40; // quicker return-to-1, like fullscreen feel

function setTheaterFrame(frame) {
  if (!theaterBtn) return;
  theaterFrame = Math.max(1, Math.min(theaterLoopMaxFrame, frame));
  theaterBtn.style.backgroundImage = `url('assets/theater_button/${theaterFrame}.svg')`;
}

function clearTheaterTimer() {
  if (!theaterTimer) return;
  clearTimeout(theaterTimer);
  theaterTimer = null;
}

function runTheaterHoverAnimation() {
  if (!theaterBtn || !theaterHovering) return;
  const next = theaterFrame >= theaterLoopMaxFrame ? 1 : theaterFrame + 1;
  setTheaterFrame(next);
  theaterTimer = setTimeout(runTheaterHoverAnimation, theaterFrameDelay);
}

function runTheaterReturnAnimation() {
  if (!theaterBtn) return;
  if (theaterFrame <= 1) {
    setTheaterFrame(1);
    clearTheaterTimer();
    return;
  }
  setTheaterFrame(theaterFrame - 1);
  theaterTimer = setTimeout(runTheaterReturnAnimation, theaterReturnDelay);
}

function startTheaterAnimation() {
  if (!uiAssetsReady || !theaterBtn) return;
  theaterHovering = true;
  clearTheaterTimer();
  // Always begin at frame 1 for a consistent loop.
  setTheaterFrame(1);
  theaterBtn.style.opacity = 1; // match fullscreen hover-start behavior
  theaterTimer = setTimeout(runTheaterHoverAnimation, theaterFrameDelay);
}

function stopTheaterAnimation() {
  if (!theaterBtn) return;
  theaterHovering = false;
  clearTheaterTimer();
  // Step back to frame 1 instead of snapping.
  runTheaterReturnAnimation();
}

function attachTheaterHoverEvents() {
  if (!theaterBtn || theaterHoverEventsAttached) return;
  theaterBtn.addEventListener('mouseenter', startTheaterAnimation);
  theaterBtn.addEventListener('mouseleave', stopTheaterAnimation);
  theaterHoverEventsAttached = true;
}

function detachTheaterHoverEvents() {
  if (!theaterBtn || !theaterHoverEventsAttached) return;
  theaterBtn.removeEventListener('mouseenter', startTheaterAnimation);
  theaterBtn.removeEventListener('mouseleave', stopTheaterAnimation);
  theaterHovering = false;
  clearTheaterTimer();
  setTheaterFrame(1);
  theaterHoverEventsAttached = false;
}

if (theaterBtn) {
  theaterBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!isWatchClassicLayout() || document.fullscreenElement) return;
    setWatchTheaterMode(!isWatchTheaterModeActive());
  });
}

/* Animated Fullscreen Button Frames */
let fullscreenFrame = 1;
const totalFrames = 24;
let fullscreenInterval = null;
const frameDelay = 40; // ms between frames


function updateFullscreenFrame() {
  if (fullscreenFrame < totalFrames) {
    fullscreenFrame++;
    fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/${fullscreenFrame}.png')`;
  } else {
    fullscreenFrame = 1;
    fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/1.png')`;
  }
}

function startFullscreenAnimation() {
  if (!uiAssetsReady) return;
  if (!fullscreenInterval) {
    fullscreenFrame = 1;
    fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/1.png')`;
    fullscreenBtn.style.opacity = 1; // Ensure fully visible
    fullscreenInterval = setInterval(updateFullscreenFrame, frameDelay);
  }
}

function stopFullscreenAnimation() {
  if (fullscreenInterval) {
    clearInterval(fullscreenInterval);
    fullscreenInterval = null;
    fullscreenFrame = 1;
    fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/1.png')`;
  }
}

function attachFullscreenHoverEvents() {
  if (fullscreenHoverEventsAttached) return;
  fullscreenBtn.addEventListener('mouseenter', startFullscreenAnimation);
  fullscreenBtn.addEventListener('mouseleave', stopFullscreenAnimation);
  fullscreenHoverEventsAttached = true;
}

function detachFullscreenHoverEvents() {
  if (!fullscreenHoverEventsAttached) return;
  fullscreenBtn.removeEventListener('mouseenter', startFullscreenAnimation);
  fullscreenBtn.removeEventListener('mouseleave', stopFullscreenAnimation);
  fullscreenHoverEventsAttached = false;
}
    
    // Toggle fullscreen function
    // Existing code above remains unchanged...

        // Handle fullscreen changes
        document.addEventListener('fullscreenchange', () => {
          setFullscreenUiState(!!document.fullscreenElement);
          if (document.fullscreenElement) {
            stopFullscreenAnimation();
            detachFullscreenHoverEvents();
            stopTheaterAnimation();
            detachTheaterHoverEvents();
            fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/exit_fullscreen.png')`;
            fullscreenBtn.style.backgroundSize = '45px 15px';
            fullscreenBtn.classList.add('exit-icon');
          } else {
            fullscreenBtn.classList.remove('exit-icon');
            fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/1.png')`;
            fullscreenBtn.style.backgroundSize = '25px 18px';
            attachFullscreenHoverEvents();
            attachTheaterHoverEvents();
          }
        
          // Adjust video size immediately for fullscreen/windowed
          adjustVideoSizeForFullscreen();
          if (!document.fullscreenElement) {
            setTimeout(() => {
              if (isWatchTheaterModeActive()) {
                enforceWatchTheaterWindowedBox();
              } else {
                enforceWatchClassicWindowedBox();
              }
            }, 0);
          }
          
          // ResizeObserver will handle updateProgress()/updateBuffered() instantly upon layout changes
        });


// Pressing Escape should exit fullscreen as if pressing the exit fullscreen button
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.fullscreenElement) {
    document.exitFullscreen().catch(err => console.error("Error attempting to exit fullscreen:", err));
  }
});

// Use a ResizeObserver to update timeline immediately whenever its width changes
const observer = new ResizeObserver(() => {
  // Called whenever progressSection size changes
  scheduleUIUpdate();
});

observer.observe(progressSection);

function handleFullscreenChange() {
  if (document.fullscreenElement) {
    // Entered fullscreen
    stopFullscreenAnimation();
    detachFullscreenHoverEvents();
    fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/exit_fullscreen.png')`;
    fullscreenBtn.style.backgroundSize = '45px 15px';
    fullscreenBtn.classList.add('exit-icon');
  } else {
    // Exited fullscreen
    fullscreenBtn.classList.remove('exit-icon');
    fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/1.png')`;
    fullscreenBtn.style.backgroundSize = '25px 18px';
    attachFullscreenHoverEvents();
  }

  // Adjust video size based on fullscreen state
  adjustVideoSizeForFullscreen();

  // If using ResizeObserver to instantly recalc timeline:
  // The ResizeObserver callback will call updateProgress() and updateBuffered()
  // as soon as the layout stabilizes. No extra delays needed.
}
    

function waitForStableLayout() {
  return new Promise((resolve) => {
    let lastWidth = null;
    let stableFrames = 0;

    function checkStability() {
      const currentWidth = progressSection.offsetWidth;
      if (lastWidth === currentWidth) {
        // Width hasn't changed since last frame
        stableFrames++;
      } else {
        // Width changed, reset counter
        stableFrames = 0;
      }

      lastWidth = currentWidth;

      // Consider stable if unchanged for at least 2 consecutive frames
      if (stableFrames >= 5) {
        resolve();
      } else {
        requestAnimationFrame(checkStability);
      }
    }

    // Start checking
    requestAnimationFrame(checkStability);
  });
}
    
function collectStylesheetAssetUrls() {
  const urls = new Set();
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

  function visitRule(rule) {
    if (!rule) return;
    if (rule.cssText) {
      urlPattern.lastIndex = 0;
      let match;
      while ((match = urlPattern.exec(rule.cssText)) !== null) {
        const path = match[2];
        if (!path) continue;
        if (/^(?:data:|https?:|blob:)/i.test(path)) continue;
        urls.add(path);
      }
    }
    if (rule.cssRules && rule.cssRules.length) {
      for (const child of Array.from(rule.cssRules)) {
        visitRule(child);
      }
    }
  }

  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (_) {
      continue;
    }
    for (const rule of Array.from(rules)) {
      visitRule(rule);
    }
  }

  return Array.from(urls);
}

// Preload UI image assets and wait for completion to avoid first-hover flashes.
function preloadImages(paths, timeoutMs = 8000) {
  const uniquePaths = Array.from(new Set((paths || []).filter(Boolean)));

  return Promise.all(uniquePaths.map((path) => new Promise((resolve) => {
    const img = new Image();
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      resolve(path);
    };

    const timer = setTimeout(finish, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      if (typeof img.decode === 'function') {
        img.decode().catch(() => {}).finally(finish);
      } else {
        finish();
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      finish();
    };
    img.src = path;
  })));
}

async function preloadUIAssets() {
  const stylesheetAssets = collectStylesheetAssetUrls();
  const fullscreenFrames = [];
  for (let i = 1; i <= 24; i++) {
    fullscreenFrames.push(`assets/fullscreen_button/${i}.png`);
  }
  fullscreenFrames.push('assets/fullscreen_button/exit_fullscreen.png');

  const theaterFrames = [];
  for (let i = 1; i <= 6; i++) {
    theaterFrames.push(`assets/theater_button/${i}.svg`);
  }

  const loadingFrames = [];
  for (let i = 1; i <= 22; i++) {
    loadingFrames.push(`assets/loading_frames/${i}.svg`);
  }

  const volumeIcons = [
    'assets/volume/volume_icon.svg',
    'assets/volume/volume_indicator.svg?v=4'
  ];

  // Force-preload hover textures so they render instantly on first hover.
  const hoverCriticalAssets = [
    'assets/playpausebuttons/play_icon_hover.svg',
    'assets/playpausebuttons/pause_icon_hover.svg',
    'assets/rewind/rewind_hover.svg',
    'assets/share_controls/2.png',
    'assets/share_controls/3.png',
    'assets/play_again_controls/2.png'
  ];

  const allUiAssets = [
    ...stylesheetAssets,
    ...fullscreenFrames,
    ...theaterFrames,
    ...loadingFrames,
    ...volumeIcons,
    ...hoverCriticalAssets
  ];

  console.log('[YTDBG] Preloading UI assets:', allUiAssets.length);
  await preloadImages(allUiAssets);
  console.log('[YTDBG] UI assets preloaded.');
}

// Coalesce UI updates to animation frames to avoid layout thrash/flicker
let rafId = null;
function scheduleUIUpdate() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    updateProgress();
    updateBuffered();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[YTDBG] DOMContentLoaded. URL:', window.location.href);
  if (isWatchTheaterModeActive()) {
    enforceWatchTheaterWindowedBox();
  } else {
    enforceWatchClassicWindowedBox();
  }
  await preloadUIAssets();
  uiAssetsReady = true;
  setPlayerVisibility(true);
  attachFullscreenHoverEvents();
  attachTheaterHoverEvents();
  if (pendingLoadingAnimation) {
    startLoadingAnimation();
  }

  if (isYouTubeMode) {
    console.log('[YTDBG] Entering YouTube mode with', { ytVideoId, ytStartAt });
    // Use unified flow to enter YouTube mode and honor start time
    startLoadingAnimation();
    enterYouTubeMode(ytVideoId, ytStartAt).catch((err) => {
      console.error('[YTDBG] enterYouTubeMode failed:', err);
      // If anything fails, revert gracefully to HTML5 video
      isYouTubeMode = false;
      setActiveYouTubeDisplay('none');
      myVideo.style.display = 'block';
      stopLoadingAnimation();
      myVideo.play().catch(e => console.warn('[YTDBG] HTML5 autoplay failed:', e));
    });
  } else {
    console.log('[YTDBG] Staying in HTML5 mode, autoplaying local video.');
    // HTML5 autoplay
    myVideo.play().catch(e => console.warn('[YTDBG] HTML5 autoplay failed:', e));
  }
  if (isWatchTheaterModeActive()) {
    enforceWatchTheaterWindowedBox();
  } else {
    enforceWatchClassicWindowedBox();
  }

  if (ytLoaderForm) {
    ytLoaderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const link = ytUrlInput.value.trim();
      const id = extractYouTubeId(link);
      const startAt = extractStartSeconds(link) || 0;
      if (!id) {
        if (ytInputError) ytInputError.textContent = 'Enter a valid YouTube URL (youtube.com or youtu.be).';
        ytUrlInput.focus();
        return;
      }
      if (ytInputError) ytInputError.textContent = '';
      startLoadingAnimation();
      await enterYouTubeMode(id, startAt);
    });
  }
});

function ensureYouTubeAPI() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      console.log('[YTDBG] YouTube Iframe API already present.');
      return resolve();
    }
    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      console.log('[YTDBG] Injecting YouTube Iframe API <script>.');
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    } else {
      console.log('[YTDBG] YouTube Iframe API script tag already in DOM.');
    }
    const t0 = Date.now();
    const checkReady = () => {
      if (window.YT && window.YT.Player) {
        console.log('[YTDBG] YouTube Iframe API ready after', (Date.now() - t0), 'ms');
        return resolve();
      }
      setTimeout(checkReady, 50);
    };
    checkReady();
  });
}

async function enterYouTubeMode(videoId, startAt = 0) {
  console.log('[YTDBG] enterYouTubeMode called', { videoId, startAt });
  isYouTubeMode = true;
  setActiveYouTubeDisplay('block');
  myVideo.pause();
  myVideo.style.display = 'none';
  if (isWatchTheaterModeActive()) {
    enforceWatchTheaterWindowedBox();
  } else {
    enforceWatchClassicWindowedBox();
  }
  await ensureYouTubeAPI();
  console.log('[YTDBG] ensureYouTubeAPI resolved. Creating/using player...');

  if (!ytPlayer) {
    console.log('[YTDBG] Creating new YT.Player');
    ytPlayer = new YT.Player('ytContainer', {
      width: '100%', height: '100%', videoId,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, autoplay: 1 },
      events: {
        onReady: () => {
          console.log('[YTDBG] onReady fired');
          videoDuration = ytPlayer.getDuration();
          console.log('[YTDBG] duration', videoDuration);
          if (isWatchTheaterModeActive()) {
            enforceWatchTheaterWindowedBox();
          } else {
            enforceWatchClassicWindowedBox();
          }
          if (!ytPollInterval) {
            ytPollInterval = setInterval(() => { scheduleUIUpdate(); }, 200);
          }
          // Start muted to satisfy autoplay policies; user can raise volume
          ytPlayer.mute();
          setVolume(0);
          if (startAt > 0) ytPlayer.seekTo(startAt, true);
          try { ytPlayer.playVideo(); } catch (e) { console.warn('[YTDBG] playVideo threw:', e); }
        },
        onStateChange: (e) => {
          console.log('[YTDBG] onStateChange', e.data, (window.YT && YT.PlayerState) ? Object.keys(YT.PlayerState).find(k => YT.PlayerState[k] === e.data) : '');
          const YTPS = YT.PlayerState;
          if (e.data === YTPS.PLAYING) {
            stopLoadingAnimation();
            playPauseBtn.classList.add('playing');
            endedButtons.style.display = 'none';
          } else if (e.data === YTPS.BUFFERING) {
            startLoadingAnimation();
          } else if (e.data === YTPS.ENDED) {
            endedButtons.style.display = 'flex';
          } else if (e.data === YTPS.PAUSED) {
            playPauseBtn.classList.remove('playing');
          }
          scheduleUIUpdate();
        }
      }
    });
    setTimeout(() => {
      if (isWatchTheaterModeActive()) {
        enforceWatchTheaterWindowedBox();
      } else {
        enforceWatchClassicWindowedBox();
      }
    }, 0);
  } else {
    console.log('[YTDBG] Reusing existing player. loadVideoById', { videoId, startAt });
    ytPlayer.loadVideoById({ videoId, startSeconds: startAt });
    ytPlayer.mute();
    setVolume(0);
    setTimeout(() => {
      if (isWatchTheaterModeActive()) {
        enforceWatchTheaterWindowedBox();
      } else {
        enforceWatchClassicWindowedBox();
      }
    }, 0);
  }
}
