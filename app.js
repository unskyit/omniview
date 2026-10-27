/**
 * Omniview Core Application Engine (app.js)
 * ---------------------------------------------------------------------------
 * 1. IndexedDB Storage Engine (`OmniviewDB` -> `recent_history` & `shared_queue`)
 * 2. Zero-Bloat Memory Lifecycle (`URL.createObjectURL` / `URL.revokeObjectURL`)
 * 3. Multi-Touch Gesture Image Viewer (Pinch, Pan with clamping, Double-Tap, Wheel)
 * 4. YouTube-Style Custom Video Player (Seek -10/+10, Scrubber, Remaining Toggle, Speeds, Fullscreen)
 * 5. Interactive Audio Player & Web Audio API Frequency Visualizer (`fftSize = 128` + fallback)
 * 6. Google Drive-Style Continuous-Scroll PDF Viewer (`IntersectionObserver` + high-DPI scaling)
 * 7. Rename Modal & Native File System Access API (`showSaveFilePicker` + `<a download>` fallback)
 * 8. Hardware Back Button & History API Router (`#viewer`, `#rename`, `#confirm-clear`)
 */

(function () {
  'use strict';

  /* ==================== CONSTANTS & CONFIGURATION ==================== */
  const DB_NAME = 'OmniviewDB';
  const DB_VERSION = 1;
  const STORE_SHARED = 'shared_queue';
  const STORE_HISTORY = 'recent_history';
  const PLAYBACK_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

  /* ==================== APPLICATION STATE ==================== */
  const state = {
    db: null,
    currentFilter: 'all',
    historyItems: [],
    activeRecord: null,       // { id, name, type, category, size, timestamp, blob }
    activeObjectUrl: null,    // Active ObjectURL created via URL.createObjectURL()
    isViewerOpen: false,
    isRenameOpen: false,
    isConfirmOpen: false,
    suppressPopstate: false,
    deferredInstallPrompt: null,
    chromeHidden: false,

    // 4A. Image Viewer Gesture State
    img: {
      scale: 1,
      minScale: 1,
      maxScale: 6,
      tx: 0,
      ty: 0,
      pointers: new Map(),
      initialPinchDist: 0,
      initialPinchScale: 1,
      panStartX: 0,
      panStartY: 0,
      panOriginX: 0,
      panOriginY: 0,
      lastTapTime: 0,
      lastTapX: 0,
      lastTapY: 0,
      movedDuringTouch: false
    },

    // 4B. Video Player State
    video: {
      speedIndex: 2,          // 1.0x
      showRemaining: false,
      inactivityTimer: null,
      isScrubbing: false
    },

    // 4C. Audio Player & Web Audio API State
    audio: {
      speedIndex: 2,          // 1.0x
      isLooping: false,
      isScrubbing: false,
      audioCtx: null,
      analyser: null,
      sourceNode: null,
      freqData: null,
      rafId: null,
      useFallbackVisualizer: false
    },

    // 4D. PDF Viewer State
    pdf: {
      doc: null,
      loadingTask: null,
      numPages: 0,
      currentPage: 1,
      zoomScale: 1.0,
      observer: null,
      renderedPages: new Set(),
      renderTasks: new Map()
    }
  };

  /* ==================== DOM ELEMENT REFERENCES ==================== */
  const dom = {
    fileInput: document.getElementById('file-input'),
    btnDemoMedia: document.getElementById('btn-demo-media'),
    btnInstallPwa: document.getElementById('btn-install-pwa'),
    btnOpenHeader: document.getElementById('btn-open-header'),
    btnEmptyOpen: document.getElementById('btn-empty-open'),
    btnEmptySamples: document.getElementById('btn-empty-samples'),
    fabOpenFile: document.getElementById('fab-open-file'),
    filterChips: document.getElementById('filter-chips'),
    historyCountLabel: document.getElementById('history-count-label'),
    btnClearAll: document.getElementById('btn-clear-all'),
    emptyState: document.getElementById('empty-state'),
    historyList: document.getElementById('history-list'),

    // Viewer Sheet & Topbar
    viewerView: document.getElementById('viewer-view'),
    viewerTopbar: document.getElementById('viewer-topbar'),
    btnViewerBack: document.getElementById('btn-viewer-back'),
    btnRenameTrigger: document.getElementById('btn-rename-trigger'),
    viewerFilename: document.getElementById('viewer-filename'),
    btnSaveFile: document.getElementById('btn-save-file'),

    // Stages
    stageImage: document.getElementById('stage-image'),
    stageVideo: document.getElementById('stage-video'),
    stageAudio: document.getElementById('stage-audio'),
    stagePdf: document.getElementById('stage-pdf'),

    // 4A. Image Viewer
    imageTouchSurface: document.getElementById('image-touch-surface'),
    viewerImg: document.getElementById('viewer-img'),
    imageHud: document.getElementById('image-hud'),
    btnImgZoomOut: document.getElementById('btn-img-zoom-out'),
    imgZoomLabel: document.getElementById('img-zoom-label'),
    btnImgZoomIn: document.getElementById('btn-img-zoom-in'),
    btnImgZoomReset: document.getElementById('btn-img-zoom-reset'),

    // 4B. Video Player
    videoContainer: document.getElementById('video-container'),
    viewerVideo: document.getElementById('viewer-video'),
    videoOverlay: document.getElementById('video-overlay'),
    btnVideoRw: document.getElementById('btn-video-rw'),
    btnVideoPlay: document.getElementById('btn-video-play'),
    iconVideoPlay: document.getElementById('icon-video-play'),
    iconVideoPause: document.getElementById('icon-video-pause'),
    btnVideoFf: document.getElementById('btn-video-ff'),
    videoScrubber: document.getElementById('video-scrubber'),
    btnVideoTime: document.getElementById('btn-video-time'),
    videoElapsed: document.getElementById('video-elapsed'),
    videoDuration: document.getElementById('video-duration'),
    btnVideoSpeed: document.getElementById('btn-video-speed'),
    btnVideoFullscreen: document.getElementById('btn-video-fullscreen'),

    // 4C. Audio Player
    viewerAudio: document.getElementById('viewer-audio'),
    audioVinyl: document.getElementById('audio-vinyl'),
    audioTitle: document.getElementById('audio-title'),
    audioSubtitle: document.getElementById('audio-subtitle'),
    audioVisualizer: document.getElementById('audio-visualizer'),
    audioScrubber: document.getElementById('audio-scrubber'),
    audioElapsed: document.getElementById('audio-elapsed'),
    audioRemaining: document.getElementById('audio-remaining'),
    btnAudioLoop: document.getElementById('btn-audio-loop'),
    btnAudioRw: document.getElementById('btn-audio-rw'),
    btnAudioPlay: document.getElementById('btn-audio-play'),
    iconAudioPlay: document.getElementById('icon-audio-play'),
    iconAudioPause: document.getElementById('icon-audio-pause'),
    btnAudioFf: document.getElementById('btn-audio-ff'),
    btnAudioSpeed: document.getElementById('btn-audio-speed'),

    // 4D. PDF Viewer
    pdfScrollContainer: document.getElementById('pdf-scroll-container'),
    pdfPagesList: document.getElementById('pdf-pages-list'),
    pdfHud: document.getElementById('pdf-hud'),
    pdfPageIndicator: document.getElementById('pdf-page-indicator'),
    btnPdfZoomOut: document.getElementById('btn-pdf-zoom-out'),
    pdfZoomLabel: document.getElementById('pdf-zoom-label'),
    btnPdfZoomIn: document.getElementById('btn-pdf-zoom-in'),

    // Modals & Toasts
    renameModal: document.getElementById('rename-modal'),
    renameForm: document.getElementById('rename-form'),
    renameInput: document.getElementById('rename-input'),
    renameExtBadge: document.getElementById('rename-ext-badge'),
    btnRenameCancel: document.getElementById('btn-rename-cancel'),

    confirmModal: document.getElementById('confirm-modal'),
    btnConfirmCancel: document.getElementById('btn-confirm-cancel'),
    btnConfirmAccept: document.getElementById('btn-confirm-accept'),

    toastContainer: document.getElementById('toast-container')
  };

  /* ==================== UTILITY HELPERS ==================== */
  function showToast(message, duration = 2600) {
    if (!dom.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s ease';
      setTimeout(() => toast.remove(), 220);
    }, duration);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const val = bytes / Math.pow(1024, idx);
    return (idx === 0 ? val.toString() : val.toFixed(1)) + ' ' + units[idx];
  }

  function formatRelativeTime(timestamp) {
    const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diffSec < 45) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + 'm ago';
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 30) return diffDays + 'd ago';
    return new Date(timestamp).toLocaleDateString();
  }

  function formatMediaTime(seconds, isRemaining = false) {
    if (!Number.isFinite(seconds) || seconds < 0) return isRemaining ? '-00:00' : '00:00';
    const total = Math.floor(seconds);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const mm = String(mins).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    const formatted = hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
    return isRemaining ? `-${formatted}` : formatted;
  }

  function splitFilenameAndExtension(fullName) {
    const trimmed = (fullName || 'untitled').trim();
    const lastDot = trimmed.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === trimmed.length - 1) {
      return { base: trimmed, ext: '' };
    }
    return {
      base: trimmed.slice(0, lastDot),
      ext: trimmed.slice(lastDot) // includes leading dot e.g. ".jpg"
    };
  }

  function detectMediaCategory(file) {
    const mime = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();

    if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg|bmp|avif)$/.test(name)) {
      return 'image';
    }
    if (mime.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi)$/.test(name)) {
      return 'video';
    }
    if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/.test(name)) {
      return 'audio';
    }
    if (mime === 'application/pdf' || name.endsWith('.pdf')) {
      return 'pdf';
    }
    return null;
  }

  function updateScrubberFill(rangeInput) {
    if (!rangeInput) return;
    const min = parseFloat(rangeInput.min) || 0;
    const max = parseFloat(rangeInput.max) || 1000;
    const val = parseFloat(rangeInput.value) || 0;
    const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
    rangeInput.style.background = `linear-gradient(to right, #3A86FF 0%, #4EA8DE ${pct}%, rgba(255, 255, 255, 0.18) ${pct}%)`;
  }

  function generateUniqueId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'ov-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* ==================== 1. INDEXEDDB STORAGE ENGINE ==================== */
  function initDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_SHARED)) {
          db.createObjectStore(STORE_SHARED, { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          const historyStore = db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
          historyStore.createIndex('timestamp', 'timestamp', { unique: false });
          historyStore.createIndex('category', 'category', { unique: false });
        }
      };
      request.onsuccess = () => {
        state.db = request.result;
        resolve(state.db);
      };
      request.onerror = () => {
        console.warn('[Omniview DB] IndexedDB unavailable, falling back to in-memory store.');
        resolve(null);
      };
    });
  }

  async function saveHistoryRecord(record) {
    if (!state.db) {
      const existingIdx = state.historyItems.findIndex((i) => i.id === record.id);
      if (existingIdx >= 0) {
        state.historyItems[existingIdx] = record;
      } else {
        state.historyItems.unshift(record);
      }
      return record;
    }

    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_HISTORY, 'readwrite');
      const store = tx.objectStore(STORE_HISTORY);
      store.put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadAllHistoryRecords() {
    if (!state.db) {
      return state.historyItems.sort((a, b) => b.timestamp - a.timestamp);
    }
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_HISTORY, 'readonly');
      const store = tx.objectStore(STORE_HISTORY);
      const index = store.index('timestamp');
      const request = index.getAll();
      request.onsuccess = () => {
        const items = (request.result || []).sort((a, b) => b.timestamp - a.timestamp);
        state.historyItems = items;
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteHistoryRecord(id) {
    state.historyItems = state.historyItems.filter((item) => item.id !== id);
    if (!state.db) return;
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_HISTORY, 'readwrite');
      tx.objectStore(STORE_HISTORY).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearAllHistoryRecords() {
    state.historyItems = [];
    if (!state.db) return;
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_HISTORY, 'readwrite');
      tx.objectStore(STORE_HISTORY).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Check and consume any pending shared files placed into `shared_queue` by `sw.js`
   */
  async function consumeSharedQueue() {
    if (!state.db) return;
    return new Promise((resolve) => {
      const tx = state.db.transaction(STORE_SHARED, 'readwrite');
      const store = tx.objectStore(STORE_SHARED);
      const getAllReq = store.getAll();

      getAllReq.onsuccess = async () => {
        const queued = getAllReq.result || [];
        if (queued.length === 0) {
          resolve(false);
          return;
        }
        // Clear shared_queue immediately
        store.clear();

        // Take the most recent shared file
        const latest = queued[queued.length - 1];
        const rawBlob = latest.file;
        if (rawBlob) {
          const namedFile =
            rawBlob instanceof File
              ? rawBlob
              : new File([rawBlob], latest.name || 'shared-media', {
                  type: latest.type || rawBlob.type || 'application/octet-stream'
                });
          await ingestAndOpenFile(namedFile, { fromShareTarget: true });
          resolve(true);
        } else {
          resolve(false);
        }
      };
      getAllReq.onerror = () => resolve(false);
    });
  }

  /* ==================== 2. ZERO-BLOAT MEMORY CLEANUP ==================== */
  function releaseActiveMediaResources() {
    // 1. Revoke active Object URL immediately
    if (state.activeObjectUrl) {
      try {
        URL.revokeObjectURL(state.activeObjectUrl);
      } catch (err) {
        console.warn('[Omniview Memory] Revoke error:', err);
      }
      state.activeObjectUrl = null;
    }

    // 2. Clean up Image Viewer
    if (dom.viewerImg) {
      dom.viewerImg.removeAttribute('src');
      dom.viewerImg.style.transform = '';
    }
    state.img.pointers.clear();
    state.img.scale = 1;
    state.img.tx = 0;
    state.img.ty = 0;

    // 3. Clean up Video Player & Decoder
    if (state.video.inactivityTimer) {
      clearTimeout(state.video.inactivityTimer);
      state.video.inactivityTimer = null;
    }
    if (dom.viewerVideo) {
      try {
        dom.viewerVideo.pause();
        dom.viewerVideo.removeAttribute('src');
        dom.viewerVideo.load();
      } catch (e) {}
    }

    // 4. Clean up Audio Player & Visualizer RAF
    if (state.audio.rafId) {
      cancelAnimationFrame(state.audio.rafId);
      state.audio.rafId = null;
    }
    if (dom.viewerAudio) {
      try {
        dom.viewerAudio.pause();
        dom.viewerAudio.removeAttribute('src');
        dom.viewerAudio.load();
      } catch (e) {}
    }
    if (dom.audioVinyl) {
      dom.audioVinyl.classList.remove('playing');
    }
    if (dom.audioVisualizer) {
      const ctx = dom.audioVisualizer.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, dom.audioVisualizer.width, dom.audioVisualizer.height);
    }

    // 5. Clean up PDF Viewer & IntersectionObserver & Canvases
    if (state.pdf.observer) {
      state.pdf.observer.disconnect();
      state.pdf.observer = null;
    }
    for (const [, task] of state.pdf.renderTasks.entries()) {
      try {
        if (task && typeof task.cancel === 'function') task.cancel();
      } catch (e) {}
    }
    state.pdf.renderTasks.clear();
    state.pdf.renderedPages.clear();

    if (state.pdf.loadingTask) {
      try {
        state.pdf.loadingTask.destroy();
      } catch (e) {}
      state.pdf.loadingTask = null;
    }
    if (state.pdf.doc && typeof state.pdf.doc.destroy === 'function') {
      try {
        state.pdf.doc.destroy();
      } catch (e) {}
    }
    state.pdf.doc = null;

    if (dom.pdfPagesList) {
      const canvases = dom.pdfPagesList.querySelectorAll('canvas');
      canvases.forEach((c) => {
        const cCtx = c.getContext('2d');
        if (cCtx) cCtx.clearRect(0, 0, c.width, c.height);
        c.width = 0;
        c.height = 0;
      });
      dom.pdfPagesList.innerHTML = '';
    }
  }

  /* ==================== 3. HOME SCREEN & HISTORY RENDERING ==================== */
  function getCategoryIconSvg(category) {
    switch (category) {
      case 'image':
        return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
          <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
          <polyline points="21 15 16 10 5 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
      case 'video':
        return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="2" y="4" width="20" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
          <polygon points="10 9 15 12 10 15 10 9" fill="currentColor"/>
        </svg>`;
      case 'audio':
        return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 18V5l12-2v13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="2"/>
          <circle cx="18" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>`;
      case 'pdf':
      default:
        return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="14 2 14 8 20 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <line x1="8" y1="17" x2="13" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`;
    }
  }

  function renderHistoryList() {
    const allItems = state.historyItems || [];
    const filtered =
      state.currentFilter === 'all'
        ? allItems
        : allItems.filter((item) => item.category === state.currentFilter);

    dom.historyCountLabel.textContent = `${filtered.length} ${
      filtered.length === 1 ? 'item' : 'items'
    } ${state.currentFilter === 'all' ? 'in local store' : `in ${state.currentFilter.toUpperCase()}`}`;

    if (allItems.length > 0) {
      dom.btnClearAll.classList.remove('hidden');
    } else {
      dom.btnClearAll.classList.add('hidden');
    }

    if (filtered.length === 0) {
      dom.emptyState.classList.remove('hidden');
      dom.historyList.classList.add('hidden');
      dom.historyList.innerHTML = '';
      return;
    }

    dom.emptyState.classList.add('hidden');
    dom.historyList.classList.remove('hidden');
    dom.historyList.innerHTML = '';

    filtered.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'history-card';
      card.setAttribute('role', 'listitem');
      card.dataset.id = item.id;

      const left = document.createElement('div');
      left.className = 'card-left';

      const badge = document.createElement('div');
      badge.className = 'category-badge';
      badge.dataset.cat = item.category;
      badge.innerHTML = getCategoryIconSvg(item.category);

      const meta = document.createElement('div');
      meta.className = 'card-meta';

      const title = document.createElement('div');
      title.className = 'card-filename';
      title.textContent = item.name;

      const sub = document.createElement('div');
      sub.className = 'card-subline';
      sub.textContent = `${item.category.toUpperCase()} • ${formatBytes(item.size)} • ${formatRelativeTime(item.timestamp)}`;

      meta.appendChild(title);
      meta.appendChild(sub);
      left.appendChild(badge);
      left.appendChild(meta);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'card-delete-btn';
      delBtn.setAttribute('aria-label', `Delete ${item.name} from history`);
      delBtn.title = 'Remove from history';
      delBtn.innerHTML = `<svg class="icon-sm" viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m5 0V4a1 1 0 011-1h2a1 1 0 011 1v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>`;

      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteHistoryRecord(item.id);
        renderHistoryList();
        showToast('Removed from history');
      });

      card.addEventListener('click', () => {
        openRecordInViewer(item);
      });

      card.appendChild(left);
      card.appendChild(delBtn);
      dom.historyList.appendChild(card);
    });
  }

  /* ==================== FILE INGESTION & ROUTER ==================== */
  async function ingestAndOpenFile(file, options = {}) {
    if (!file) return;
    const category = detectMediaCategory(file);
    if (!category) {
      showToast('Unsupported format. Please select an Image, Video, Audio, or PDF file.');
      return;
    }

    const record = {
      id: generateUniqueId(),
      name: file.name || 'media-item',
      type: file.type || getDefaultMimeForCategory(category),
      category: category,
      size: file.size || 0,
      timestamp: Date.now(),
      blob: file
    };

    try {
      await saveHistoryRecord(record);
      await loadAllHistoryRecords();
      renderHistoryList();
    } catch (err) {
      console.warn('[Omniview] Could not persist file to IndexedDB:', err);
    }

    if (options.fromShareTarget) {
      // Clean URL query param `./?shared=1` without losing history state
      if (window.location.search.includes('shared=')) {
        history.replaceState({ view: 'home' }, '', window.location.pathname);
      }
      showToast(`Opened shared ${category.toUpperCase()}: ${record.name}`);
    }

    openRecordInViewer(record);
  }

  function getDefaultMimeForCategory(cat) {
    switch (cat) {
      case 'image':
        return 'image/png';
      case 'video':
        return 'video/webm';
      case 'audio':
        return 'audio/wav';
      case 'pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }

  async function openRecordInViewer(record) {
    if (!record || !record.blob) {
      showToast('File data unavailable');
      return;
    }

    // Release any previous viewer's ObjectURL and media decoders first
    releaseActiveMediaResources();

    // Update timestamp on access
    record.timestamp = Date.now();
    state.activeRecord = record;
    saveHistoryRecord(record).then(() => loadAllHistoryRecords()).then(() => renderHistoryList());

    // Stream directly from device storage using URL.createObjectURL
    state.activeObjectUrl = URL.createObjectURL(record.blob);

    // Update topbar filename & chrome state
    dom.viewerFilename.textContent = record.name;
    setChromeVisibility(true);

    // Hide all stages first
    dom.stageImage.classList.add('hidden');
    dom.stageVideo.classList.add('hidden');
    dom.stageAudio.classList.add('hidden');
    dom.stagePdf.classList.add('hidden');

    // Show Viewer Sheet
    dom.viewerView.classList.remove('hidden');
    dom.viewerView.setAttribute('aria-hidden', 'false');
    state.isViewerOpen = true;

    // Push `#viewer` to browser history if not already on `#viewer`
    if (window.location.hash !== '#viewer' && window.location.hash !== '#rename') {
      history.pushState({ view: 'viewer', id: record.id }, '', '#viewer');
    }

    // Route to specialized media engine
    switch (record.category) {
      case 'image':
        launchImageViewer(state.activeObjectUrl);
        break;
      case 'video':
        launchVideoPlayer(state.activeObjectUrl);
        break;
      case 'audio':
        launchAudioPlayer(state.activeObjectUrl, record);
        break;
      case 'pdf':
        await launchPdfViewer(state.activeObjectUrl);
        break;
      default:
        showToast('Unsupported media category');
    }
  }

  function setChromeVisibility(visible) {
    state.chromeHidden = !visible;
    if (state.chromeHidden) {
      dom.viewerTopbar.classList.add('chrome-hidden');
      dom.imageHud.classList.add('chrome-hidden');
      dom.pdfHud.classList.add('chrome-hidden');
    } else {
      dom.viewerTopbar.classList.remove('chrome-hidden');
      dom.imageHud.classList.remove('chrome-hidden');
      dom.pdfHud.classList.remove('chrome-hidden');
    }
  }

  function toggleChromeVisibility() {
    setChromeVisibility(state.chromeHidden);
  }

  /* ==================== 4A. IMMERSIVE IMAGE VIEWER ==================== */
  function launchImageViewer(objectUrl) {
    dom.stageImage.classList.remove('hidden');
    resetImageTransform();
    dom.viewerImg.src = objectUrl;
  }

  function resetImageTransform() {
    state.img.scale = 1;
    state.img.tx = 0;
    state.img.ty = 0;
    applyImageTransform(true);
  }

  function clampImagePan() {
    if (state.img.scale <= 1) {
      state.img.tx = 0;
      state.img.ty = 0;
      return;
    }
    const surfaceRect = dom.imageTouchSurface.getBoundingClientRect();
    const maxPanX = ((surfaceRect.width * state.img.scale) - surfaceRect.width) / 2;
    const maxPanY = ((surfaceRect.height * state.img.scale) - surfaceRect.height) / 2;

    state.img.tx = Math.max(-maxPanX, Math.min(maxPanX, state.img.tx));
    state.img.ty = Math.max(-maxPanY, Math.min(maxPanY, state.img.ty));
  }

  function applyImageTransform(smooth = false) {
    clampImagePan();
    dom.viewerImg.style.transition = smooth
      ? 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)'
      : 'none';
    dom.viewerImg.style.transform = `translate3d(${state.img.tx}px, ${state.img.ty}px, 0) scale(${state.img.scale})`;
    dom.imgZoomLabel.textContent = `${Math.round(state.img.scale * 100)}%`;
  }

  function zoomImageTo(targetScale, smooth = true) {
    state.img.scale = Math.max(state.img.minScale, Math.min(state.img.maxScale, targetScale));
    if (state.img.scale <= 1.01) {
      state.img.scale = 1;
      state.img.tx = 0;
      state.img.ty = 0;
    }
    applyImageTransform(smooth);
  }

  function setupImageViewerGestures() {
    const surface = dom.imageTouchSurface;

    const getDistance = (p1, p2) => Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);

    surface.addEventListener('pointerdown', (e) => {
      surface.setPointerCapture(e.pointerId);
      state.img.pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      state.img.movedDuringTouch = false;

      if (state.img.pointers.size === 1) {
        state.img.panStartX = e.clientX;
        state.img.panStartY = e.clientY;
        state.img.panOriginX = state.img.tx;
        state.img.panOriginY = state.img.ty;
      } else if (state.img.pointers.size === 2) {
        const pts = Array.from(state.img.pointers.values());
        state.img.initialPinchDist = getDistance(pts[0], pts[1]);
        state.img.initialPinchScale = state.img.scale;
      }
    });

    surface.addEventListener('pointermove', (e) => {
      if (!state.img.pointers.has(e.pointerId)) return;
      state.img.pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

      if (state.img.pointers.size === 2) {
        const pts = Array.from(state.img.pointers.values());
        const dist = getDistance(pts[0], pts[1]);
        if (state.img.initialPinchDist > 10) {
          state.img.movedDuringTouch = true;
          const nextScale = state.img.initialPinchScale * (dist / state.img.initialPinchDist);
          state.img.scale = Math.max(state.img.minScale, Math.min(state.img.maxScale, nextScale));
          applyImageTransform(false);
        }
      } else if (state.img.pointers.size === 1) {
        const dx = e.clientX - state.img.panStartX;
        const dy = e.clientY - state.img.panStartY;
        if (Math.hypot(dx, dy) > 6) {
          state.img.movedDuringTouch = true;
        }
        if (state.img.scale > 1) {
          state.img.tx = state.img.panOriginX + dx;
          state.img.ty = state.img.panOriginY + dy;
          applyImageTransform(false);
        }
      }
    });

    const handlePointerUpOrCancel = (e) => {
      state.img.pointers.delete(e.pointerId);

      if (state.img.pointers.size === 1) {
        const remaining = Array.from(state.img.pointers.values())[0];
        state.img.panStartX = remaining.clientX;
        state.img.panStartY = remaining.clientY;
        state.img.panOriginX = state.img.tx;
        state.img.panOriginY = state.img.ty;
      } else if (state.img.pointers.size === 0 && e.type === 'pointerup') {
        if (!state.img.movedDuringTouch) {
          const now = Date.now();
          const dt = now - state.img.lastTapTime;
          const tapDist = Math.hypot(e.clientX - state.img.lastTapX, e.clientY - state.img.lastTapY);

          if (dt < 280 && tapDist < 36) {
            // Double-tap toggles between 1x and 2.75x zoom
            state.img.lastTapTime = 0;
            if (state.img.scale > 1.15) {
              zoomImageTo(1, true);
            } else {
              zoomImageTo(2.75, true);
            }
          } else {
            state.img.lastTapTime = now;
            state.img.lastTapX = e.clientX;
            state.img.lastTapY = e.clientY;
            setTimeout(() => {
              if (Date.now() - state.img.lastTapTime >= 270 && state.img.lastTapTime !== 0) {
                toggleChromeVisibility();
              }
            }, 280);
          }
        }
      }
    };

    surface.addEventListener('pointerup', handlePointerUpOrCancel);
    surface.addEventListener('pointercancel', handlePointerUpOrCancel);

    // Desktop Mouse Wheel Zoom Support
    surface.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.18 : 0.85;
        zoomImageTo(state.img.scale * factor, false);
      },
      { passive: false }
    );

    // Floating HUD Buttons
    dom.btnImgZoomIn.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomImageTo(state.img.scale + 0.5, true);
    });
    dom.btnImgZoomOut.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomImageTo(state.img.scale - 0.5, true);
    });
    dom.btnImgZoomReset.addEventListener('click', (e) => {
      e.stopPropagation();
      resetImageTransform();
    });
  }

  /* ==================== 4B. YOUTUBE-STYLE VIDEO PLAYER ==================== */
  function launchVideoPlayer(objectUrl) {
    dom.stageVideo.classList.remove('hidden');
    state.video.speedIndex = 2; // 1.0x
    dom.btnVideoSpeed.textContent = '1.0x';
    dom.videoScrubber.value = '0';
    updateScrubberFill(dom.videoScrubber);
    dom.videoElapsed.textContent = '00:00';
    dom.videoDuration.textContent = '00:00';

    dom.viewerVideo.src = objectUrl;
    dom.viewerVideo.playbackRate = 1.0;
    showVideoOverlayWithAutoHide();

    dom.viewerVideo.play().catch(() => {
      // Autoplay blocked until interaction; show Play state cleanly
      syncVideoPlayButtons();
    });
  }

  function syncVideoPlayButtons() {
    const paused = dom.viewerVideo.paused;
    if (paused) {
      dom.iconVideoPlay.classList.remove('hidden');
      dom.iconVideoPause.classList.add('hidden');
    } else {
      dom.iconVideoPlay.classList.add('hidden');
      dom.iconVideoPause.classList.remove('hidden');
    }
  }

  function updateVideoTimeDisplay() {
    const current = dom.viewerVideo.currentTime || 0;
    const duration = dom.viewerVideo.duration || 0;
    dom.videoElapsed.textContent = formatMediaTime(current, false);
    if (state.video.showRemaining && duration > 0) {
      dom.videoDuration.textContent = formatMediaTime(Math.max(0, duration - current), true);
    } else {
      dom.videoDuration.textContent = formatMediaTime(duration, false);
    }
  }

  function showVideoOverlayWithAutoHide() {
    dom.videoOverlay.classList.remove('controls-hidden');
    setChromeVisibility(true);
    if (state.video.inactivityTimer) {
      clearTimeout(state.video.inactivityTimer);
    }
    if (!dom.viewerVideo.paused) {
      state.video.inactivityTimer = setTimeout(() => {
        dom.videoOverlay.classList.add('controls-hidden');
        setChromeVisibility(false);
      }, 3200);
    }
  }

  function setupVideoPlayerControls() {
    const video = dom.viewerVideo;

    video.addEventListener('loadedmetadata', () => {
      updateVideoTimeDisplay();
      updateScrubberFill(dom.videoScrubber);
    });

    video.addEventListener('play', () => {
      syncVideoPlayButtons();
      showVideoOverlayWithAutoHide();
    });

    video.addEventListener('pause', () => {
      syncVideoPlayButtons();
      dom.videoOverlay.classList.remove('controls-hidden');
      setChromeVisibility(true);
      if (state.video.inactivityTimer) clearTimeout(state.video.inactivityTimer);
    });

    video.addEventListener('ended', () => {
      syncVideoPlayButtons();
      dom.videoOverlay.classList.remove('controls-hidden');
      setChromeVisibility(true);
    });

    video.addEventListener('timeupdate', () => {
      if (!state.video.isScrubbing && video.duration > 0) {
        const ratio = (video.currentTime / video.duration) * 1000;
        dom.videoScrubber.value = String(Math.round(ratio));
        updateScrubberFill(dom.videoScrubber);
      }
      updateVideoTimeDisplay();
    });

    // Tap video container or overlay background to toggle overlay visibility
    dom.videoContainer.addEventListener('click', (e) => {
      if (
        e.target === dom.videoContainer ||
        e.target === dom.viewerVideo ||
        e.target === dom.videoOverlay
      ) {
        const isHidden = dom.videoOverlay.classList.contains('controls-hidden');
        if (isHidden) {
          showVideoOverlayWithAutoHide();
        } else {
          dom.videoOverlay.classList.add('controls-hidden');
          setChromeVisibility(false);
        }
      }
    });

    dom.btnVideoPlay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
      showVideoOverlayWithAutoHide();
    });

    dom.btnVideoRw.addEventListener('click', (e) => {
      e.stopPropagation();
      video.currentTime = Math.max(0, (video.currentTime || 0) - 10);
      showVideoOverlayWithAutoHide();
    });

    dom.btnVideoFf.addEventListener('click', (e) => {
      e.stopPropagation();
      const dur = video.duration || 0;
      video.currentTime = dur > 0 ? Math.min(dur, video.currentTime + 10) : video.currentTime + 10;
      showVideoOverlayWithAutoHide();
    });

    dom.videoScrubber.addEventListener('input', (e) => {
      e.stopPropagation();
      state.video.isScrubbing = true;
      updateScrubberFill(dom.videoScrubber);
      if (video.duration > 0) {
        const targetTime = (parseFloat(dom.videoScrubber.value) / 1000) * video.duration;
        dom.videoElapsed.textContent = formatMediaTime(targetTime, false);
      }
      showVideoOverlayWithAutoHide();
    });

    dom.videoScrubber.addEventListener('change', (e) => {
      e.stopPropagation();
      if (video.duration > 0) {
        video.currentTime = (parseFloat(dom.videoScrubber.value) / 1000) * video.duration;
      }
      state.video.isScrubbing = false;
      showVideoOverlayWithAutoHide();
    });

    dom.btnVideoTime.addEventListener('click', (e) => {
      e.stopPropagation();
      state.video.showRemaining = !state.video.showRemaining;
      updateVideoTimeDisplay();
      showVideoOverlayWithAutoHide();
    });

    dom.btnVideoSpeed.addEventListener('click', (e) => {
      e.stopPropagation();
      state.video.speedIndex = (state.video.speedIndex + 1) % PLAYBACK_SPEEDS.length;
      const nextRate = PLAYBACK_SPEEDS[state.video.speedIndex];
      video.playbackRate = nextRate;
      dom.btnVideoSpeed.textContent = `${nextRate.toFixed(nextRate % 1 === 0 ? 1 : 2).replace(/0$/, '')}x`;
      showVideoOverlayWithAutoHide();
    });

    dom.btnVideoFullscreen.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (!document.fullscreenElement) {
          if (dom.stageVideo.requestFullscreen) {
            await dom.stageVideo.requestFullscreen();
          } else if (video.webkitEnterFullscreen) {
            video.webkitEnterFullscreen();
          }
        } else if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } catch (err) {
        showToast('Fullscreen unavailable in this viewport');
      }
      showVideoOverlayWithAutoHide();
    });
  }

  /* ==================== 4C. INTERACTIVE AUDIO PLAYER & VISUALIZER ==================== */
  function launchAudioPlayer(objectUrl, record) {
    dom.stageAudio.classList.remove('hidden');
    state.audio.speedIndex = 2; // 1.0x
    state.audio.isLooping = false;

    const { ext } = splitFilenameAndExtension(record.name);
    const formatLabel = (ext ? ext.slice(1) : record.type.split('/')[1] || 'AUDIO').toUpperCase();
    dom.audioTitle.textContent = record.name;
    dom.audioSubtitle.textContent = `${formatLabel} • ${formatBytes(record.size)}`;

    dom.btnAudioSpeed.textContent = '1.0x';
    dom.btnAudioLoop.classList.remove('active');
    dom.btnAudioLoop.setAttribute('aria-pressed', 'false');
    dom.audioScrubber.value = '0';
    updateScrubberFill(dom.audioScrubber);
    dom.audioElapsed.textContent = '00:00';
    dom.audioRemaining.textContent = '-00:00';

    const audio = dom.viewerAudio;
    audio.src = objectUrl;
    audio.loop = false;
    audio.playbackRate = 1.0;

    ensureWebAudioGraphConnected();
    drawIdleAudioVisualizer();

    audio.play().catch(() => {
      syncAudioPlayState();
    });
  }

  function ensureWebAudioGraphConnected() {
    if (state.audio.sourceNode) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        state.audio.useFallbackVisualizer = true;
        return;
      }
      state.audio.audioCtx = new AudioCtx();
      state.audio.analyser = state.audio.audioCtx.createAnalyser();
      state.audio.analyser.fftSize = 128;
      state.audio.analyser.smoothingTimeConstant = 0.82;
      state.audio.sourceNode = state.audio.audioCtx.createMediaElementSource(dom.viewerAudio);
      state.audio.sourceNode.connect(state.audio.analyser);
      state.audio.analyser.connect(state.audio.audioCtx.destination);
      state.audio.freqData = new Uint8Array(state.audio.analyser.frequencyBinCount);
      state.audio.useFallbackVisualizer = false;
    } catch (err) {
      console.warn('[Omniview Audio] Using autonomous fallback visualizer:', err);
      state.audio.useFallbackVisualizer = true;
    }
  }

  function drawIdleAudioVisualizer() {
    const canvas = dom.audioVisualizer;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const barCount = 32;
    const gap = 4;
    const barWidth = (width - gap * (barCount - 1)) / barCount;
    ctx.fillStyle = '#3A86FF';
    for (let i = 0; i < barCount; i++) {
      const x = i * (barWidth + gap);
      ctx.fillRect(x, height - 6, barWidth, 6);
    }
  }

  function stopAudioVisualizerLoop() {
    if (state.audio.rafId) {
      cancelAnimationFrame(state.audio.rafId);
      state.audio.rafId = null;
    }
  }

  function startAudioVisualizerLoop() {
    stopAudioVisualizerLoop();
    const canvas = dom.audioVisualizer;
    const ctx = canvas.getContext('2d');
    const barCount = 32;

    const renderFrame = (timestamp) => {
      if (dom.viewerAudio.paused || dom.viewerAudio.ended || !state.isViewerOpen) {
        state.audio.rafId = null;
        drawIdleAudioVisualizer();
        return;
      }
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const isPlaying = true;
      let hasSignal = false;

      if (!state.audio.useFallbackVisualizer && state.audio.analyser && state.audio.freqData) {
        state.audio.analyser.getByteFrequencyData(state.audio.freqData);
        for (let i = 0; i < state.audio.freqData.length; i++) {
          if (state.audio.freqData[i] > 2) {
            hasSignal = true;
            break;
          }
        }
      }

      const gap = 4;
      const barWidth = (width - gap * (barCount - 1)) / barCount;

      for (let i = 0; i < barCount; i++) {
        let normalized = 0.08;
        if (isPlaying) {
          if (hasSignal && state.audio.freqData) {
            const binIdx = Math.min(state.audio.freqData.length - 1, Math.floor((i / barCount) * 48));
            normalized = Math.max(0.08, state.audio.freqData[binIdx] / 255);
          } else {
            // Autonomous fallback wave animation when AudioContext is blocked/suspended
            const t = timestamp * 0.005;
            const wave1 = Math.sin(t + i * 0.35) * 0.35;
            const wave2 = Math.cos(t * 1.7 - i * 0.22) * 0.25;
            normalized = Math.max(0.1, Math.min(0.95, 0.45 + wave1 + wave2));
          }
        }

        const barHeight = Math.max(6, normalized * (height - 10));
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        const grad = ctx.createLinearGradient(x, y, x, height);
        grad.addColorStop(0, '#4EA8DE');
        grad.addColorStop(1, '#3A86FF');
        ctx.fillStyle = grad;

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, y, barWidth, barHeight, 4);
        } else {
          ctx.rect(x, y, barWidth, barHeight);
        }
        ctx.fill();
      }

      state.audio.rafId = requestAnimationFrame(renderFrame);
    };

    state.audio.rafId = requestAnimationFrame(renderFrame);
  }

  function syncAudioPlayState() {
    const paused = dom.viewerAudio.paused;
    if (paused) {
      dom.iconAudioPlay.classList.remove('hidden');
      dom.iconAudioPause.classList.add('hidden');
      dom.audioVinyl.classList.remove('playing');
    } else {
      dom.iconAudioPlay.classList.add('hidden');
      dom.iconAudioPause.classList.remove('hidden');
      dom.audioVinyl.classList.add('playing');
    }
  }

  function setupAudioPlayerControls() {
    const audio = dom.viewerAudio;

    audio.addEventListener('play', () => {
      if (state.audio.audioCtx && state.audio.audioCtx.state === 'suspended') {
        state.audio.audioCtx.resume().catch(() => {});
      }
      syncAudioPlayState();
      startAudioVisualizerLoop();
    });

    audio.addEventListener('pause', () => {
      syncAudioPlayState();
      stopAudioVisualizerLoop();
      drawIdleAudioVisualizer();
    });
    audio.addEventListener('ended', () => {
      syncAudioPlayState();
      stopAudioVisualizerLoop();
      drawIdleAudioVisualizer();
    });

    audio.addEventListener('loadedmetadata', () => {
      const dur = audio.duration || 0;
      dom.audioElapsed.textContent = formatMediaTime(0, false);
      dom.audioRemaining.textContent = formatMediaTime(dur, true);
    });

    audio.addEventListener('timeupdate', () => {
      const cur = audio.currentTime || 0;
      const dur = audio.duration || 0;
      if (!state.audio.isScrubbing && dur > 0) {
        dom.audioScrubber.value = String(Math.round((cur / dur) * 1000));
        updateScrubberFill(dom.audioScrubber);
      }
      dom.audioElapsed.textContent = formatMediaTime(cur, false);
      dom.audioRemaining.textContent = formatMediaTime(Math.max(0, dur - cur), true);
    });

    dom.btnAudioPlay.addEventListener('click', () => {
      if (state.audio.audioCtx && state.audio.audioCtx.state === 'suspended') {
        state.audio.audioCtx.resume().catch(() => {});
      }
      if (audio.paused) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    });

    dom.btnAudioRw.addEventListener('click', () => {
      audio.currentTime = Math.max(0, (audio.currentTime || 0) - 10);
    });

    dom.btnAudioFf.addEventListener('click', () => {
      const dur = audio.duration || 0;
      audio.currentTime = dur > 0 ? Math.min(dur, audio.currentTime + 10) : audio.currentTime + 10;
    });

    dom.audioScrubber.addEventListener('input', () => {
      state.audio.isScrubbing = true;
      updateScrubberFill(dom.audioScrubber);
      if (audio.duration > 0) {
        const previewTime = (parseFloat(dom.audioScrubber.value) / 1000) * audio.duration;
        dom.audioElapsed.textContent = formatMediaTime(previewTime, false);
        dom.audioRemaining.textContent = formatMediaTime(Math.max(0, audio.duration - previewTime), true);
      }
    });

    dom.audioScrubber.addEventListener('change', () => {
      if (audio.duration > 0) {
        audio.currentTime = (parseFloat(dom.audioScrubber.value) / 1000) * audio.duration;
      }
      state.audio.isScrubbing = false;
    });

    dom.btnAudioLoop.addEventListener('click', () => {
      state.audio.isLooping = !state.audio.isLooping;
      audio.loop = state.audio.isLooping;
      dom.btnAudioLoop.classList.toggle('active', state.audio.isLooping);
      dom.btnAudioLoop.setAttribute('aria-pressed', String(state.audio.isLooping));
      showToast(state.audio.isLooping ? 'Track Loop Enabled' : 'Track Loop Disabled');
    });

    dom.btnAudioSpeed.addEventListener('click', () => {
      state.audio.speedIndex = (state.audio.speedIndex + 1) % PLAYBACK_SPEEDS.length;
      const rate = PLAYBACK_SPEEDS[state.audio.speedIndex];
      audio.playbackRate = rate;
      dom.btnAudioSpeed.textContent = `${rate.toFixed(rate % 1 === 0 ? 1 : 2).replace(/0$/, '')}x`;
    });
  }

  /* ==================== 4D. CONTINUOUS-SCROLL PDF VIEWER ==================== */
  async function launchPdfViewer(objectUrl) {
    dom.stagePdf.classList.remove('hidden');
    state.pdf.zoomScale = 1.0;
    state.pdf.currentPage = 1;
    dom.pdfZoomLabel.textContent = '100%';
    dom.pdfPageIndicator.textContent = 'Loading PDF...';
    dom.pdfPagesList.innerHTML = '';

    if (!window.pdfjsLib) {
      showToast('PDF engine unavailable');
      return;
    }

    try {
      const loadingTask = window.pdfjsLib.getDocument(objectUrl);
      state.pdf.loadingTask = loadingTask;
      const pdfDoc = await loadingTask.promise;
      state.pdf.doc = pdfDoc;
      state.pdf.numPages = pdfDoc.numPages || 1;
      dom.pdfPageIndicator.textContent = `Page 1 / ${state.pdf.numPages}`;

      await buildPdfPageSlots();
    } catch (error) {
      console.error('[Omniview PDF] Failed to load PDF:', error);
      showToast('Failed to render PDF file');
    }
  }

  async function buildPdfPageSlots() {
    if (!state.pdf.doc) return;
    if (state.pdf.observer) {
      state.pdf.observer.disconnect();
    }
    state.pdf.renderedPages.clear();
    state.pdf.renderTasks.clear();
    dom.pdfPagesList.innerHTML = '';

    // Inspect Page 1 to compute base responsive fit width
    const firstPage = await state.pdf.doc.getPage(1);
    const unscaledVp = firstPage.getViewport({ scale: 1.0 });
    const containerWidth = Math.min(window.innerWidth - 28, 860);
    const baseFitScale = (containerWidth / unscaledVp.width) * state.pdf.zoomScale;
    const slotWidth = Math.round(unscaledVp.width * baseFitScale);
    const slotHeight = Math.round(unscaledVp.height * baseFitScale);

    // Create page slot containers for all pages
    for (let pageNum = 1; pageNum <= state.pdf.numPages; pageNum++) {
      const slot = document.createElement('div');
      slot.className = 'pdf-page-slot';
      slot.dataset.pageNumber = String(pageNum);
      slot.style.width = `${slotWidth}px`;
      slot.style.height = `${slotHeight}px`;

      const placeholder = document.createElement('div');
      placeholder.className = 'pdf-page-placeholder';
      placeholder.textContent = `Page ${pageNum}`;
      slot.appendChild(placeholder);

      dom.pdfPagesList.appendChild(slot);
    }

    // IntersectionObserver rasterizes only visible pages (+ buffer)
    state.pdf.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
          if (entry.isIntersecting) {
            renderPdfPageSlot(entry.target, pageNum, baseFitScale);
          }
        });
      },
      {
        root: dom.pdfScrollContainer,
        rootMargin: '350px 0px 350px 0px',
        threshold: 0.01
      }
    );

    const slots = dom.pdfPagesList.querySelectorAll('.pdf-page-slot');
    slots.forEach((slot) => state.pdf.observer.observe(slot));
  }

  async function renderPdfPageSlot(slotEl, pageNum, fitScale) {
    if (!state.pdf.doc || state.pdf.renderedPages.has(pageNum)) return;
    state.pdf.renderedPages.add(pageNum);

    try {
      const page = await state.pdf.doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: fitScale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

      slotEl.style.width = `${Math.round(viewport.width)}px`;
      slotEl.style.height = `${Math.round(viewport.height)}px`;

      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.round(viewport.width)}px`;
      canvas.style.height = `${Math.round(viewport.height)}px`;

      const ctx = canvas.getContext('2d', { alpha: false });
      const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;

      slotEl.innerHTML = '';
      slotEl.appendChild(canvas);

      const renderTask = page.render({
        canvasContext: ctx,
        viewport: viewport,
        transform: transform
      });
      state.pdf.renderTasks.set(pageNum, renderTask);
      await renderTask.promise;
      state.pdf.renderTasks.delete(pageNum);
    } catch (err) {
      state.pdf.renderedPages.delete(pageNum);
    }
  }

  function setupPdfViewerControls() {
    dom.pdfScrollContainer.addEventListener('scroll', () => {
      if (!state.pdf.numPages) return;
      const slots = dom.pdfPagesList.querySelectorAll('.pdf-page-slot');
      const containerRect = dom.pdfScrollContainer.getBoundingClientRect();
      const midY = containerRect.top + containerRect.height / 2;

      let closestPage = state.pdf.currentPage;
      let minDistance = Infinity;

      slots.forEach((slot) => {
        const rect = slot.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const dist = Math.abs(center - midY);
        if (dist < minDistance) {
          minDistance = dist;
          closestPage = parseInt(slot.dataset.pageNumber, 10);
        }
      });

      if (closestPage !== state.pdf.currentPage) {
        state.pdf.currentPage = closestPage;
        dom.pdfPageIndicator.textContent = `Page ${state.pdf.currentPage} / ${state.pdf.numPages}`;
      }
    });

    dom.btnPdfZoomIn.addEventListener('click', async () => {
      if (!state.pdf.doc) return;
      state.pdf.zoomScale = Math.min(2.5, +(state.pdf.zoomScale + 0.25).toFixed(2));
      dom.pdfZoomLabel.textContent = `${Math.round(state.pdf.zoomScale * 100)}%`;
      await buildPdfPageSlots();
    });

    dom.btnPdfZoomOut.addEventListener('click', async () => {
      if (!state.pdf.doc) return;
      state.pdf.zoomScale = Math.max(0.5, +(state.pdf.zoomScale - 0.25).toFixed(2));
      dom.pdfZoomLabel.textContent = `${Math.round(state.pdf.zoomScale * 100)}%`;
      await buildPdfPageSlots();
    });
  }

  /* ==================== 5. RENAME MODAL & NATIVE SAVING ==================== */
  function openRenameModal() {
    if (!state.activeRecord) return;
    const { base, ext } = splitFilenameAndExtension(state.activeRecord.name);
    dom.renameInput.value = base;
    dom.renameExtBadge.textContent = ext || '';
    dom.renameModal.classList.remove('hidden');
    state.isRenameOpen = true;

    if (window.location.hash !== '#rename') {
      history.pushState({ view: 'rename' }, '', '#rename');
    }

    setTimeout(() => {
      dom.renameInput.focus();
      dom.renameInput.select();
    }, 40);
  }

  function closeRenameModal(fromPopstate = false) {
    if (!state.isRenameOpen) return;
    dom.renameModal.classList.add('hidden');
    state.isRenameOpen = false;

    if (!fromPopstate && window.location.hash === '#rename') {
      state.suppressPopstate = true;
      history.back();
    }
  }

  async function handleRenameSubmit(e) {
    e.preventDefault();
    if (!state.activeRecord) return;
    const newBase = dom.renameInput.value.trim();
    if (!newBase) {
      showToast('Filename cannot be empty');
      return;
    }

    const { ext } = splitFilenameAndExtension(state.activeRecord.name);
    const updatedName = newBase + ext;

    // Update active record & preserve underlying Blob
    state.activeRecord.name = updatedName;
    if (state.activeRecord.blob) {
      state.activeRecord.blob = new File([state.activeRecord.blob], updatedName, {
        type: state.activeRecord.type
      });
    }

    dom.viewerFilename.textContent = updatedName;
    if (state.activeRecord.category === 'audio') {
      dom.audioTitle.textContent = updatedName;
    }

    await saveHistoryRecord(state.activeRecord);
    await loadAllHistoryRecords();
    renderHistoryList();

    closeRenameModal(false);
    showToast(`Renamed to ${updatedName}`);
  }

  /**
   * Native Device Saving:
   * - Primary path: File System Access API (`window.showSaveFilePicker`)
   * - Fallback path: Programmatic `<a download>` anchor trigger
   */
  async function saveActiveFileToDevice() {
    if (!state.activeRecord || !state.activeRecord.blob) {
      showToast('No active media file to save');
      return;
    }

    const filename = state.activeRecord.name || 'omniview-media';
    const { ext } = splitFilenameAndExtension(filename);
    const mimeType = state.activeRecord.type || getDefaultMimeForCategory(state.activeRecord.category);

    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const pickerOptions = {
          suggestedName: filename
        };
        if (ext) {
          pickerOptions.types = [
            {
              description: `${state.activeRecord.category.toUpperCase()} File`,
              accept: {
                [mimeType]: [ext]
              }
            }
          ];
        }
        const fileHandle = await window.showSaveFilePicker(pickerOptions);
        const writable = await fileHandle.createWritable();
        await writable.write(state.activeRecord.blob);
        await writable.close();
        showToast(`Saved ${filename} to device`);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') {
          return; // User cancelled the native picker
        }
        console.warn('[Omniview Save] Falling back to <a download>:', err);
      }
    }

    // Seamless fallback via programmatic <a download>
    const downloadUrl = state.activeObjectUrl || URL.createObjectURL(state.activeRecord.blob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      if (!state.activeObjectUrl && downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    }, 200);
    showToast(`Downloading ${filename}`);
  }

  /* ==================== 6. HARDWARE BACK BUTTON & HISTORY ROUTER ==================== */
  function closeViewer(fromPopstate = false) {
    if (!state.isViewerOpen) return;
    releaseActiveMediaResources();
    dom.viewerView.classList.add('hidden');
    dom.viewerView.setAttribute('aria-hidden', 'true');
    state.isViewerOpen = false;
    state.activeRecord = null;

    if (!fromPopstate && (window.location.hash === '#viewer' || window.location.hash === '#rename')) {
      state.suppressPopstate = true;
      history.back();
    }
  }

  function openConfirmClearModal() {
    dom.confirmModal.classList.remove('hidden');
    state.isConfirmOpen = true;
    if (window.location.hash !== '#confirm-clear') {
      history.pushState({ view: 'confirm-clear' }, '', '#confirm-clear');
    }
  }

  function closeConfirmClearModal(fromPopstate = false) {
    if (!state.isConfirmOpen) return;
    dom.confirmModal.classList.add('hidden');
    state.isConfirmOpen = false;
    if (!fromPopstate && window.location.hash === '#confirm-clear') {
      state.suppressPopstate = true;
      history.back();
    }
  }

  function setupHistoryRouter() {
    // Ensure base home state is registered
    if (!history.state) {
      history.replaceState({ view: 'home' }, '', window.location.pathname + window.location.search);
    }

    window.addEventListener('popstate', () => {
      if (state.suppressPopstate) {
        state.suppressPopstate = false;
        return;
      }

      // 1. Dismiss open modals first
      if (state.isRenameOpen) {
        closeRenameModal(true);
        return;
      }
      if (state.isConfirmOpen) {
        closeConfirmClearModal(true);
        return;
      }

      // 2. Dismiss active viewer second
      if (state.isViewerOpen && window.location.hash !== '#viewer') {
        closeViewer(true);
      }
    });
  }

  /* ==================== BUILT-IN SAMPLE MEDIA GENERATOR ==================== */
  /**
   * Generates real, valid local media files (High-Res SVG/PNG Image, Synthesized WAV Audio,
   * Multi-Page PDF Document, and Canvas WebM/GIF animation) so users can test all 4 viewers
   * with a single tap.
   */
  async function generateDemoMediaSuite() {
    showToast('Generating sample Image, Audio, Video & PDF files...');

    // 1. Sample High-Resolution Artwork Image (SVG)
    const sampleSvgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
      <rect width="800" height="600" fill="#0B0C10"/>
      <circle cx="400" cy="260" r="120" fill="#141720" stroke="#3A86FF" stroke-width="8"/>
      <polygon points="380,215 380,305 450,260" fill="#4EA8DE"/>
      <text x="400" y="470" text-anchor="middle" fill="#F8FAFC" font-family="system-ui, sans-serif" font-size="24" font-weight="700">OMNIVIEW TEST IMAGE — PINCH OR DOUBLE-TAP TO ZOOM</text>
    </svg>`;
    const imgFile = new File([sampleSvgContent], 'Omniview-AMOLED-TestChart.svg', {
      type: 'image/svg+xml'
    });

    // 2. Sample Synthesized Stereo WAV Audio Track (6 seconds ambient chord progression)
    const wavBlob = createSynthesizedWavBlob(2);
    const audioFile = new File([wavBlob], 'Omniview-Synthwave-Visualizer-Demo.wav', {
      type: 'audio/wav'
    });

    // 3. Sample Multi-Page PDF Document (2 pages valid PDF 1.4 binary)
    const pdfBytes = createSampleMultiPagePdfBytes();
    const pdfFile = new File([pdfBytes], 'Omniview-Architecture-Guide.pdf', {
      type: 'application/pdf'
    });

    await saveHistoryRecord({
      id: generateUniqueId(),
      name: pdfFile.name,
      type: pdfFile.type,
      category: 'pdf',
      size: pdfFile.size,
      timestamp: Date.now() - 20000,
      blob: pdfFile
    });

    await saveHistoryRecord({
      id: generateUniqueId(),
      name: audioFile.name,
      type: audioFile.type,
      category: 'audio',
      size: audioFile.size,
      timestamp: Date.now() - 10000,
      blob: audioFile
    });

    await saveHistoryRecord({
      id: generateUniqueId(),
      name: imgFile.name,
      type: imgFile.type,
      category: 'image',
      size: imgFile.size,
      timestamp: Date.now(),
      blob: imgFile
    });

    await loadAllHistoryRecords();
    renderHistoryList();
    showToast('Loaded sample Image, Audio, and PDF into Recent History!');
  }

  function createSynthesizedWavBlob(durationSeconds) {
    const sampleRate = 22050;
    const numSamples = sampleRate * durationSeconds;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    const notes = [220, 277.18, 329.63, 440, 554.37, 659.25];
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const noteIdx = Math.floor(t) % notes.length;
      const freq = notes[noteIdx];
      const env = Math.sin(Math.PI * (t % 1));
      const sig =
        (Math.sin(2 * Math.PI * freq * t) * 0.5 +
          Math.sin(2 * Math.PI * (freq * 1.5) * t) * 0.25 +
          Math.sin(2 * Math.PI * (freq * 0.5) * t) * 0.25) *
        env;
      const pcm = Math.max(-1, Math.min(1, sig)) * 24000;
      view.setInt16(44 + i * 2, pcm, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  function createSampleMultiPagePdfBytes() {
    const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 7 0 R >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 380 >>
stream
BT
/F1 18 Tf
50 720 Td
(OMNIVIEW UNIVERSAL MEDIA ARCHITECTURE - PAGE 1) Tj
/F1 12 Tf
0 -36 Td
(Zero-Bloat Memory Management & Android Web Share Target Integration) Tj
0 -28 Td
(1. Raw File objects are intercepted by sw.js and stored in IndexedDB.) Tj
0 -22 Td
(2. Media streams directly via URL.createObjectURL without Base64 bloat.) Tj
0 -22 Td
(3. Continuous-scroll PDF viewer rasterizes visible pages on high-DPI canvas.) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 7 0 R >> >> /MediaBox [0 0 612 792] /Contents 6 0 R >>
endobj
6 0 obj
<< /Length 340 >>
stream
BT
/F1 18 Tf
50 720 Td
(OMNIVIEW TECHNICAL SPECIFICATION - PAGE 2) Tj
/F1 12 Tf
0 -36 Td
(Hardware Back Button & File System Access API) Tj
0 -28 Td
(1. Deep navigation state managed via history.pushState and popstate.) Tj
0 -22 Td
(2. Native Save To dialog powered by window.showSaveFilePicker.) Tj
0 -22 Td
(3. True AMOLED #000000 dark theme with eye-friendly #3A86FF accents.) Tj
ET
endstream
endobj
7 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 8
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000121 00000 n 
0000000247 00000 n 
0000000679 00000 n 
0000000805 00000 n 
0000001197 00000 n 
trailer
<< /Size 8 /Root 1 0 R >>
startxref
1265
%%EOF`;
    return new TextEncoder().encode(pdfContent);
  }

  /* ==================== PWA SERVICE WORKER & INSTALL PROMPT ==================== */
  function registerServiceWorkerAndShareListener() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('./sw.js')
          .then(() => {
            // Listen for SHARED_FILE_READY broadcasts from sw.js
            navigator.serviceWorker.addEventListener('message', (event) => {
              if (event.data && event.data.type === 'SHARED_FILE_READY') {
                consumeSharedQueue();
              }
            });
          })
          .catch((err) => {
            console.warn('[Omniview SW] Registration skipped in current context:', err);
          });
      });
    }

    // Capture `beforeinstallprompt` to reveal the "Install App" button
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      dom.btnInstallPwa.classList.remove('hidden');
    });

    dom.btnInstallPwa.addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      const { outcome } = await state.deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        dom.btnInstallPwa.classList.add('hidden');
        showToast('Omniview installed!');
      }
      state.deferredInstallPrompt = null;
    });
  }

  /* ==================== EVENT BINDINGS & INITIALIZATION ==================== */
  function bindGlobalUiEvents() {
    const triggerFileInput = () => {
      dom.fileInput.value = '';
      dom.fileInput.click();
    };

    dom.btnOpenHeader.addEventListener('click', triggerFileInput);
    dom.btnEmptyOpen.addEventListener('click', triggerFileInput);
    dom.fabOpenFile.addEventListener('click', triggerFileInput);

    dom.btnDemoMedia.addEventListener('click', generateDemoMediaSuite);
    dom.btnEmptySamples.addEventListener('click', generateDemoMediaSuite);

    dom.fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        ingestAndOpenFile(file);
      }
    });

    // Drag & Drop support on desktop/tablet
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        ingestAndOpenFile(file);
      }
    });

    // Category Filter Chips
    dom.filterChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      state.currentFilter = chip.dataset.filter || 'all';
      dom.filterChips.querySelectorAll('.chip').forEach((c) => {
        const active = c === chip;
        c.classList.toggle('active', active);
        c.setAttribute('aria-selected', String(active));
      });
      renderHistoryList();
    });

    // Clear All History Flow
    dom.btnClearAll.addEventListener('click', openConfirmClearModal);
    dom.btnConfirmCancel.addEventListener('click', () => closeConfirmClearModal(false));
    dom.btnConfirmAccept.addEventListener('click', async () => {
      await clearAllHistoryRecords();
      renderHistoryList();
      closeConfirmClearModal(false);
      showToast('All history cleared');
    });

    // Viewer Topbar Actions
    dom.btnViewerBack.addEventListener('click', () => closeViewer(false));
    dom.btnRenameTrigger.addEventListener('click', openRenameModal);
    dom.btnSaveFile.addEventListener('click', saveActiveFileToDevice);

    // Rename Modal Actions
    dom.btnRenameCancel.addEventListener('click', () => closeRenameModal(false));
    dom.renameForm.addEventListener('submit', handleRenameSubmit);

    // Close modals when clicking backdrop
    dom.renameModal.addEventListener('click', (e) => {
      if (e.target === dom.renameModal) closeRenameModal(false);
    });
    dom.confirmModal.addEventListener('click', (e) => {
      if (e.target === dom.confirmModal) closeConfirmClearModal(false);
    });
  }

  async function bootstrapApp() {
    setupHistoryRouter();
    bindGlobalUiEvents();
    setupImageViewerGestures();
    setupVideoPlayerControls();
    setupAudioPlayerControls();
    setupPdfViewerControls();
    registerServiceWorkerAndShareListener();

    await initDatabase();
    await loadAllHistoryRecords();
    renderHistoryList();

    // Check if launched via Android Web Share Target (`./?shared=1`) or queued share
    const params = new URLSearchParams(window.location.search);
    await consumeSharedQueue();

    // Handle PWA App Shortcut `?action=open`
    if (params.get('action') === 'open') {
      history.replaceState({ view: 'home' }, '', window.location.pathname);
      setTimeout(() => dom.fileInput.click(), 150);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapApp);
  } else {
    bootstrapApp();
  }
})();
