/**
 * Simply Viewer Core Application Engine (app.js)
 * - True Light/Dark Mode Manager
 * - Race-Condition safe Video playback
 * - Canvas frame extraction for Video Thumbnails
 * - Native swipe gestures & dynamic ResizeObserver
 * - Integrated PDF Web Worker Support & PWA Lifecycle Handlers
 */

(function () {
  'use strict';

  const DB_NAME = 'OmniviewDB';
  const DB_VERSION = 1;
  const STORE_SHARED = 'shared_queue';
  const STORE_HISTORY = 'recent_history';
  const PLAYBACK_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

  const state = {
    db: null, currentFilter: 'all', historyItems: [], 
    queue: [], queueIndex: 0,
    activeRecord: null, activeObjectUrl: null,
    isViewerOpen: false, isRenameOpen: false, isConfirmOpen: false, suppressPopstate: false,
    deferredInstallPrompt: null, chromeHidden: false, isClosingViewer: false,
    img: { scale: 1, minScale: 1, maxScale: 6, tx: 0, ty: 0, pointers: new Map(), movedDuringTouch: false },
    video: { speedIndex: 2, showRemaining: false, inactivityTimer: null, isScrubbing: false, lastTapTime: 0, tapTimer: null, playPromise: null },
    audio: { speedIndex: 2, isLooping: false, isScrubbing: false, rafId: null, useFallbackVisualizer: false },
    pdf: { doc: null, loadingTask: null, numPages: 0, currentPage: 1, zoomScale: 1.0, renderedPages: new Set(), renderTasks: new Map() }
  };

  const dom = {
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    fileInput: document.getElementById('file-input'),
    btnDemoMedia: document.getElementById('btn-demo-media'),
    btnInstallPwa: document.getElementById('btn-install-pwa'), // DOM reference linked correctly
    btnEmptyOpen: document.getElementById('btn-empty-open'),
    fabOpenFile: document.getElementById('fab-open-file'),
    filterChips: document.getElementById('filter-chips'),
    historyCountLabel: document.getElementById('history-count-label'),
    btnClearAll: document.getElementById('btn-clear-all'),
    emptyState: document.getElementById('empty-state'),
    historyList: document.getElementById('history-list'),

    viewerView: document.getElementById('viewer-view'),
    viewerTopbar: document.getElementById('viewer-topbar'),
    btnViewerBack: document.getElementById('btn-viewer-back'),
    btnRenameTrigger: document.getElementById('btn-rename-trigger'),
    viewerFilename: document.getElementById('viewer-filename'),
    btnSaveFile: document.getElementById('btn-save-file'),

    stageImage: document.getElementById('stage-image'),
    stageVideo: document.getElementById('stage-video'),
    stageAudio: document.getElementById('stage-audio'),
    stagePdf: document.getElementById('stage-pdf'),
    thumbnailStrip: document.getElementById('thumbnail-strip'),

    imageTouchSurface: document.getElementById('image-touch-surface'),
    viewerImg: document.getElementById('viewer-img'),
    imageHud: document.getElementById('image-hud'),
    btnImgZoomOut: document.getElementById('btn-img-zoom-out'),
    imgZoomLabel: document.getElementById('img-zoom-label'),
    btnImgZoomIn: document.getElementById('btn-img-zoom-in'),
    btnImgZoomReset: document.getElementById('btn-img-zoom-reset'),

    videoContainer: document.getElementById('video-container'),
    viewerVideo: document.getElementById('viewer-video'),
    videoOverlay: document.getElementById('video-overlay'),
    videoDoubleTapIndicator: document.getElementById('video-double-tap-indicator'),
    videoSeekLabel: document.getElementById('video-seek-label'),
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

    viewerAudio: document.getElementById('viewer-audio'),
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

    pdfScrollContainer: document.getElementById('pdf-scroll-container'),
    pdfPagesList: document.getElementById('pdf-pages-list'),
    pdfHud: document.getElementById('pdf-hud'),
    pdfPageIndicator: document.getElementById('pdf-page-indicator'),
    btnPdfZoomOut: document.getElementById('btn-pdf-zoom-out'),
    pdfZoomLabel: document.getElementById('pdf-zoom-label'),
    btnPdfZoomIn: document.getElementById('btn-pdf-zoom-in'),

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

  /* THEME MANAGER */
  function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'system';
    applyTheme(savedTheme);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (localStorage.getItem('theme') === 'system' || !localStorage.getItem('theme')) applyTheme('system');
    });
    
    dom.btnThemeToggle.addEventListener('click', () => {
       const current = document.documentElement.getAttribute('data-theme');
       let nextTheme = current === 'dark' ? 'light' : 'dark';
       
       if (current === 'system') {
           const isSysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
           nextTheme = isSysDark ? 'light' : 'dark';
       }
       
       localStorage.setItem('theme', nextTheme);
       applyTheme(nextTheme);
    });
  }

  function applyTheme(theme) {
    if (theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  function showToast(message, duration = 2600) {
    if (!dom.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast'; toast.textContent = message;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 220); }, duration);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'], idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (idx === 0 ? (bytes / Math.pow(1024, idx)).toString() : (bytes / Math.pow(1024, idx)).toFixed(1)) + ' ' + units[idx];
  }

  function formatRelativeTime(timestamp) {
    const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diffSec < 45) return 'Just now';
    const diffMin = Math.floor(diffSec / 60); if (diffMin < 60) return diffMin + 'm ago';
    const diffHr = Math.floor(diffMin / 60); if (diffHr < 24) return diffHr + 'h ago';
    const diffDays = Math.floor(diffHr / 24); if (diffDays < 30) return diffDays + 'd ago';
    return new Date(timestamp).toLocaleDateString();
  }

  function formatMediaTime(seconds, isRemaining = false) {
    if (!Number.isFinite(seconds) || seconds < 0) return isRemaining ? '-00:00' : '00:00';
    const total = Math.floor(seconds), hrs = Math.floor(total / 3600), mins = Math.floor((total % 3600) / 60), secs = total % 60;
    const mm = String(mins).padStart(2, '0'), ss = String(secs).padStart(2, '0');
    const formatted = hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
    return isRemaining ? `-${formatted}` : formatted;
  }

  function splitFilenameAndExtension(fullName) {
    const trimmed = (fullName || 'untitled').trim(), lastDot = trimmed.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === trimmed.length - 1) return { base: trimmed, ext: '' };
    return { base: trimmed.slice(0, lastDot), ext: trimmed.slice(lastDot) };
  }

  function detectMediaCategory(file) {
    const mime = (file.type || '').toLowerCase(), name = (file.name || '').toLowerCase();
    if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg|bmp|avif)$/.test(name)) return 'image';
    if (mime.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi)$/.test(name)) return 'video';
    if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/.test(name)) return 'audio';
    if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    return null;
  }

  function updateScrubberFill(rangeInput) {
    if (!rangeInput) return;
    const min = parseFloat(rangeInput.min) || 0, max = parseFloat(rangeInput.max) || 1000, val = parseFloat(rangeInput.value) || 0;
    const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
    rangeInput.style.background = `linear-gradient(to right, var(--text-primary) 0%, var(--text-primary) ${pct}%, var(--border-subtle) ${pct}%)`;
  }

  function generateUniqueId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'ov-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* INDEXEDDB */
  function initDatabase() {
    return new Promise((resolve) => {
      if (!('indexedDB' in window)) { resolve(null); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_SHARED)) db.createObjectStore(STORE_SHARED, { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          const historyStore = db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
          historyStore.createIndex('timestamp', 'timestamp', { unique: false });
          historyStore.createIndex('category', 'category', { unique: false });
        }
      };
      request.onsuccess = () => { state.db = request.result; resolve(state.db); };
      request.onerror = () => { resolve(null); };
    });
  }

  async function saveHistoryRecord(record) {
    if (!state.db) {
      const existingIdx = state.historyItems.findIndex((i) => i.id === record.id);
      if (existingIdx >= 0) state.historyItems[existingIdx] = record; else state.historyItems.unshift(record);
      return record;
    }
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_HISTORY, 'readwrite');
      tx.objectStore(STORE_HISTORY).put(record);
      tx.oncomplete = () => resolve(record); tx.onerror = () => reject(tx.error);
    });
  }

  async function loadAllHistoryRecords() {
    if (!state.db) return state.historyItems.sort((a, b) => b.timestamp - a.timestamp);
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_HISTORY, 'readonly');
      const request = tx.objectStore(STORE_HISTORY).index('timestamp').getAll();
      request.onsuccess = () => { state.historyItems = (request.result || []).sort((a, b) => b.timestamp - a.timestamp); resolve(state.historyItems); };
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteHistoryRecord(id) {
    state.historyItems = state.historyItems.filter((item) => item.id !== id);
    if (!state.db) return;
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_HISTORY, 'readwrite');
      tx.objectStore(STORE_HISTORY).delete(id);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  }

  async function clearAllHistoryRecords() {
    state.historyItems = [];
    if (!state.db) return;
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_HISTORY, 'readwrite');
      tx.objectStore(STORE_HISTORY).clear();
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  }

  /* CONSUME QUEUE */
  async function consumeSharedQueue() {
    if (!state.db) return;
    return new Promise((resolve) => {
      const tx = state.db.transaction(STORE_SHARED, 'readwrite'), store = tx.objectStore(STORE_SHARED), getAllReq = store.getAll();
      getAllReq.onsuccess = async () => {
        const queued = getAllReq.result || [];
        if (queued.length === 0) { resolve(false); return; }
        store.clear();
        
        let files = [];
        for (const item of queued) {
          const rawBlob = item.file;
          if (rawBlob) {
            files.push(rawBlob instanceof File ? rawBlob : new File([rawBlob], item.name || 'shared', { type: item.type || rawBlob.type }));
          }
        }
        
        if (files.length > 0) {
            await ingestFilesArray(files, true);
        }
        resolve(true);
      };
      getAllReq.onerror = () => resolve(false);
    });
  }

  function getCategoryIconSvg(category) {
    switch (category) {
      case 'image': return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21"/></svg>`;
      case 'video': return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="3"/><polygon points="10 9 15 12 10 15 10 9" fill="currentColor" stroke="none"/></svg>`;
      case 'audio': return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
      case 'pdf': default: return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`;
    }
  }

  function renderHistoryList() {
    const allItems = state.historyItems || [], filtered = state.currentFilter === 'all' ? allItems : allItems.filter((item) => item.category === state.currentFilter);
    dom.historyCountLabel.textContent = `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`;
    dom.btnClearAll.classList.toggle('hidden', allItems.length === 0);
    
    if (filtered.length === 0) {
      dom.emptyState.classList.remove('hidden'); dom.historyList.classList.add('hidden'); dom.historyList.innerHTML = ''; return;
    }
    
    dom.emptyState.classList.add('hidden'); dom.historyList.classList.remove('hidden'); dom.historyList.innerHTML = '';
    filtered.forEach((item) => {
      const card = document.createElement('div'); card.className = 'history-card'; card.dataset.id = item.id;
      const left = document.createElement('div'); left.className = 'card-left';
      const badge = document.createElement('div'); badge.className = 'category-badge'; badge.innerHTML = getCategoryIconSvg(item.category);
      const meta = document.createElement('div'); meta.className = 'card-meta';
      const title = document.createElement('div'); title.className = 'card-filename'; title.textContent = item.name;
      const sub = document.createElement('div'); sub.className = 'card-subline'; sub.textContent = `${item.category.toUpperCase()} • ${formatBytes(item.size)}`;
      
      meta.appendChild(title); meta.appendChild(sub); left.appendChild(badge); left.appendChild(meta);
      const delBtn = document.createElement('button'); delBtn.className = 'card-delete-btn';
      delBtn.innerHTML = `<svg class="icon-sm" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m5 0V4a1 1 0 011-1h2a1 1 0 011 1v2"/></svg>`;
      
      delBtn.addEventListener('click', async (e) => { e.stopPropagation(); await deleteHistoryRecord(item.id); renderHistoryList(); showToast('Removed from history'); });
      card.addEventListener('click', () => { 
        state.queue = [item]; state.queueIndex = 0;
        buildThumbnailStrip(); loadQueueItem(0, false); 
      });
      card.appendChild(left); card.appendChild(delBtn); dom.historyList.appendChild(card);
    });
  }

  /* MEDIA QUEUE & THUMBNAILS (RAM Optimized) */
  async function ingestFilesArray(filesArray, fromShare = false) {
    if(!filesArray || filesArray.length === 0) return;
    let addedCount = 0; state.queue = [];
    
    for(const file of filesArray) {
        const category = detectMediaCategory(file);
        if(!category) continue;
        const record = { id: generateUniqueId(), name: file.name || 'media', type: file.type || 'application/octet-stream', category: category, size: file.size || 0, timestamp: Date.now(), blob: file };
        await saveHistoryRecord(record);
        state.queue.push(record);
        addedCount++;
    }
    
    await loadAllHistoryRecords(); renderHistoryList();
    if(addedCount > 1) showToast(`Added ${addedCount} items to queue`);
    else if (addedCount === 0) { showToast('Unsupported format.'); return; }
    
    buildThumbnailStrip();
    loadQueueItem(0, fromShare);
  }

  function extractVideoThumbnail(file) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.autoplay = false; video.muted = true; video.playsInline = true;
        video.src = URL.createObjectURL(file);
        video.onloadeddata = () => { video.currentTime = 1; }; 
        video.onseeked = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 160; canvas.height = 160;
            const ctx = canvas.getContext('2d');
            const ratio = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
            const w = video.videoWidth * ratio, h = video.videoHeight * ratio;
            ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
            canvas.toBlob((blob) => {
                URL.revokeObjectURL(video.src);
                resolve(URL.createObjectURL(blob));
            }, 'image/jpeg', 0.7);
        };
        video.onerror = () => { resolve(null); };
    });
  }

  function buildThumbnailStrip() {
    dom.thumbnailStrip.innerHTML = '';
    
    if(state.queue) {
       for(let item of state.queue) { if(item.thumbUrl) { URL.revokeObjectURL(item.thumbUrl); item.thumbUrl = null; } }
    }
    
    if (state.queue.length <= 1) { dom.thumbnailStrip.classList.add('hidden'); return; }
    
    dom.thumbnailStrip.classList.remove('hidden');
    state.queue.forEach((record, index) => {
       const box = document.createElement('div');
       box.className = 'thumb-box';
       
       if (record.category === 'image') {
          record.thumbUrl = URL.createObjectURL(record.blob);
          const img = document.createElement('img'); img.src = record.thumbUrl;
          box.appendChild(img);
       } else if (record.category === 'video') {
          box.innerHTML = getCategoryIconSvg('video');
          extractVideoThumbnail(record.blob).then(url => {
              if (url) {
                  record.thumbUrl = url;
                  box.innerHTML = `<img src="${url}" /><div class="thumb-video-badge"><svg class="icon-xs" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>`;
              }
          });
       } else if (record.category === 'audio') {
          box.innerHTML = `<div class="thumb-audio-visualizer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="4" height="8" rx="1"></rect><rect x="10" y="4" width="4" height="14" rx="1"></rect><rect x="16" y="8" width="4" height="10" rx="1"></rect></svg></div>`;
       } else {
          box.innerHTML = getCategoryIconSvg(record.category);
       }
       
       box.addEventListener('click', () => loadQueueItem(index, false));
       dom.thumbnailStrip.appendChild(box);
    });
  }

  async function loadQueueItem(index, fromShare = false) {
    if (index < 0 || index >= state.queue.length) return;
    
    releaseActiveMediaResources(); 
    
    state.queueIndex = index;
    const record = state.queue[index];
    record.timestamp = Date.now(); await saveHistoryRecord(record); await loadAllHistoryRecords(); renderHistoryList();

    state.activeRecord = record;
    state.activeObjectUrl = URL.createObjectURL(record.blob);
    dom.viewerFilename.textContent = record.name;
    setChromeVisibility(true);
    
    if(state.queue.length > 1) {
       Array.from(dom.thumbnailStrip.children).forEach((box, i) => {
           box.classList.toggle('active', i === index);
           if(i === index) box.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
       });
    }

    dom.stageImage.classList.add('hidden'); dom.stageVideo.classList.add('hidden'); dom.stageAudio.classList.add('hidden'); dom.stagePdf.classList.add('hidden');
    dom.viewerView.classList.remove('hidden'); dom.viewerView.setAttribute('aria-hidden', 'false'); 
    state.isViewerOpen = true;
    state.isClosingViewer = false;
    
    if (window.location.hash !== '#viewer' && window.location.hash !== '#rename') {
        if (fromShare) {
            history.replaceState({ view: 'viewer' }, '', '#viewer');
        } else {
            history.pushState({ view: 'viewer' }, '', '#viewer');
        }
    }

    switch (record.category) {
      case 'image': launchImageViewer(state.activeObjectUrl); break;
      case 'video': launchVideoPlayer(state.activeObjectUrl); break;
      case 'audio': launchAudioPlayer(state.activeObjectUrl, record); break;
      case 'pdf': await launchPdfViewer(state.activeObjectUrl); break;
    }
  }

  function setChromeVisibility(visible) {
    state.chromeHidden = !visible;
    const action = state.chromeHidden ? 'add' : 'remove';
    dom.viewerTopbar.classList[action]('chrome-hidden');
    dom.imageHud.classList[action]('chrome-hidden');
    dom.pdfHud.classList[action]('chrome-hidden');
    dom.thumbnailStrip.classList[action]('chrome-hidden');
  }
  function toggleChromeVisibility() { setChromeVisibility(state.chromeHidden); }

  function setupSwipeGestures() {
    const targets = document.querySelectorAll('.swipe-target');
    targets.forEach(target => {
       let startX = 0, startY = 0, isSwiping = false;
       target.addEventListener('touchstart', (e) => {
          if(e.target.closest('.video-overlay') || e.target.closest('.audio-card')) return; 
          if(state.activeRecord && state.activeRecord.category === 'image' && state.img.scale > 1) return;
          startX = e.touches[0].clientX; startY = e.touches[0].clientY;
          isSwiping = true;
       }, {passive: true});
       
       target.addEventListener('touchend', (e) => {
          if(!isSwiping || state.queue.length <= 1) return;
          const diffX = e.changedTouches[0].clientX - startX;
          const diffY = e.changedTouches[0].clientY - startY;
          if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60) {
             if (diffX > 0 && state.queueIndex > 0) loadQueueItem(state.queueIndex - 1, false);
             else if (diffX < 0 && state.queueIndex < state.queue.length - 1) loadQueueItem(state.queueIndex + 1, false);
          }
          isSwiping = false;
       });
    });
  }

  function releaseActiveMediaResources() {
    if (state.activeObjectUrl) { try { URL.revokeObjectURL(state.activeObjectUrl); } catch (err) {} state.activeObjectUrl = null; }
    if (dom.viewerImg) { dom.viewerImg.removeAttribute('src'); dom.viewerImg.style.transform = ''; }
    state.img.pointers.clear(); state.img.scale = 1; state.img.tx = 0; state.img.ty = 0;
    
    if (state.video.inactivityTimer) { clearTimeout(state.video.inactivityTimer); state.video.inactivityTimer = null; }
    if (dom.viewerVideo) { try { dom.viewerVideo.pause(); dom.viewerVideo.removeAttribute('src'); dom.viewerVideo.load(); } catch (e) {} }
    
    if (state.audio.rafId) { cancelAnimationFrame(state.audio.rafId); state.audio.rafId = null; }
    if (dom.viewerAudio) { try { dom.viewerAudio.pause(); dom.viewerAudio.removeAttribute('src'); dom.viewerAudio.load(); } catch (e) {} }
    if (dom.audioVisualizer) { const ctx = dom.audioVisualizer.getContext('2d'); if (ctx) ctx.clearRect(0, 0, dom.audioVisualizer.width, dom.audioVisualizer.height); }
    
    if (state.pdf.observer) { state.pdf.observer.disconnect(); state.pdf.observer = null; }
    for (const [, task] of state.pdf.renderTasks.entries()) { try { if (task && typeof task.cancel === 'function') task.cancel(); } catch (e) {} }
    state.pdf.renderTasks.clear(); state.pdf.renderedPages.clear();
    if (state.pdf.loadingTask) { try { state.pdf.loadingTask.destroy(); } catch (e) {} state.pdf.loadingTask = null; }
    if (state.pdf.doc && typeof state.pdf.doc.destroy === 'function') { try { state.pdf.doc.destroy(); } catch (e) {} }
    state.pdf.doc = null;
    if (dom.pdfPagesList) {
      dom.pdfPagesList.querySelectorAll('canvas').forEach((c) => { const cCtx = c.getContext('2d'); if (cCtx) cCtx.clearRect(0, 0, c.width, c.height); c.width = 0; c.height = 0; });
      dom.pdfPagesList.innerHTML = '';
    }
  }

  /* IMAGE VIEWER */
  function launchImageViewer(objectUrl) {
    dom.stageImage.classList.remove('hidden');
    state.img.scale = 1; state.img.tx = 0; state.img.ty = 0; applyImageTransform(true);
    dom.viewerImg.src = objectUrl;
  }
  function clampImagePan() {
    if (state.img.scale <= 1) { state.img.tx = 0; state.img.ty = 0; return; }
    const rect = dom.imageTouchSurface.getBoundingClientRect(), maxPanX = ((rect.width * state.img.scale) - rect.width) / 2, maxPanY = ((rect.height * state.img.scale) - rect.height) / 2;
    state.img.tx = Math.max(-maxPanX, Math.min(maxPanX, state.img.tx)); state.img.ty = Math.max(-maxPanY, Math.min(maxPanY, state.img.ty));
  }
  function applyImageTransform(smooth = false) {
    clampImagePan();
    dom.viewerImg.style.transition = smooth ? 'transform 0.22s var(--ease-out-expo)' : 'none';
    dom.viewerImg.style.transform = `translate3d(${state.img.tx}px, ${state.img.ty}px, 0) scale(${state.img.scale})`;
    dom.imgZoomLabel.textContent = `${Math.round(state.img.scale * 100)}%`;
  }
  function zoomImageTo(scale, smooth = true) {
    state.img.scale = Math.max(state.img.minScale, Math.min(state.img.maxScale, scale));
    if (state.img.scale <= 1.01) { state.img.scale = 1; state.img.tx = 0; state.img.ty = 0; }
    applyImageTransform(smooth);
  }
  function setupImageViewerGestures() {
    const surface = dom.imageTouchSurface;
    const getDistance = (p1, p2) => Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
    surface.addEventListener('pointerdown', (e) => {
      surface.setPointerCapture(e.pointerId); state.img.pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY }); state.img.movedDuringTouch = false;
      if (state.img.pointers.size === 1) { state.img.panStartX = e.clientX; state.img.panStartY = e.clientY; state.img.panOriginX = state.img.tx; state.img.panOriginY = state.img.ty; }
      else if (state.img.pointers.size === 2) { const pts = Array.from(state.img.pointers.values()); state.img.initialPinchDist = getDistance(pts[0], pts[1]); state.img.initialPinchScale = state.img.scale; }
    });
    surface.addEventListener('pointermove', (e) => {
      if (!state.img.pointers.has(e.pointerId)) return;
      state.img.pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      if (state.img.pointers.size === 2) {
        const pts = Array.from(state.img.pointers.values()), dist = getDistance(pts[0], pts[1]);
        if (state.img.initialPinchDist > 10) { state.img.movedDuringTouch = true; zoomImageTo(state.img.initialPinchScale * (dist / state.img.initialPinchDist), false); }
      } else if (state.img.pointers.size === 1) {
        const dx = e.clientX - state.img.panStartX, dy = e.clientY - state.img.panStartY;
        if (Math.hypot(dx, dy) > 6) state.img.movedDuringTouch = true;
        if (state.img.scale > 1) { state.img.tx = state.img.panOriginX + dx; state.img.ty = state.img.panOriginY + dy; applyImageTransform(false); }
      }
    });
    const handleUp = (e) => {
      state.img.pointers.delete(e.pointerId);
      if (state.img.pointers.size === 1) { const remaining = Array.from(state.img.pointers.values())[0]; state.img.panStartX = remaining.clientX; state.img.panStartY = remaining.clientY; state.img.panOriginX = state.img.tx; state.img.panOriginY = state.img.ty; }
      else if (state.img.pointers.size === 0 && e.type === 'pointerup' && !state.img.movedDuringTouch) {
        const now = Date.now(), dt = now - state.img.lastTapTime, tapDist = Math.hypot(e.clientX - state.img.lastTapX, e.clientY - state.img.lastTapY);
        if (dt < 280 && tapDist < 36) { state.img.lastTapTime = 0; zoomImageTo(state.img.scale > 1.15 ? 1 : 2.75, true); }
        else { state.img.lastTapTime = now; state.img.lastTapX = e.clientX; state.img.lastTapY = e.clientY; setTimeout(() => { if (Date.now() - state.img.lastTapTime >= 270 && state.img.lastTapTime !== 0) toggleChromeVisibility(); }, 280); }
      }
    };
    surface.addEventListener('pointerup', handleUp); surface.addEventListener('pointercancel', handleUp);
    surface.addEventListener('wheel', (e) => { e.preventDefault(); zoomImageTo(state.img.scale * (e.deltaY < 0 ? 1.18 : 0.85), false); }, { passive: false });
    dom.btnImgZoomIn.addEventListener('click', (e) => { e.stopPropagation(); zoomImageTo(state.img.scale + 0.5, true); });
    dom.btnImgZoomOut.addEventListener('click', (e) => { e.stopPropagation(); zoomImageTo(state.img.scale - 0.5, true); });
    dom.btnImgZoomReset.addEventListener('click', (e) => { e.stopPropagation(); zoomImageTo(1, true); });
  }

  /* VIDEO PLAYER */
  function launchVideoPlayer(objectUrl) {
    dom.stageVideo.classList.remove('hidden'); state.video.speedIndex = 2; dom.btnVideoSpeed.textContent = '1.0x';
    dom.videoScrubber.value = '0'; updateScrubberFill(dom.videoScrubber); dom.videoElapsed.textContent = '00:00'; dom.videoDuration.textContent = '00:00';
    dom.viewerVideo.src = objectUrl; dom.viewerVideo.playbackRate = 1.0; showVideoOverlayWithAutoHide();
    
    state.video.playPromise = dom.viewerVideo.play();
    if (state.video.playPromise !== undefined) {
        state.video.playPromise.then(() => {
            if (state.isClosingViewer) { dom.viewerVideo.pause(); } 
            else { syncVideoPlayButtons(); }
        }).catch(() => { syncVideoPlayButtons(); });
    }
  }
  function syncVideoPlayButtons() { const paused = dom.viewerVideo.paused; dom.iconVideoPlay.classList.toggle('hidden', !paused); dom.iconVideoPause.classList.toggle('hidden', paused); }
  function updateVideoTimeDisplay() {
    const cur = dom.viewerVideo.currentTime || 0, dur = dom.viewerVideo.duration || 0;
    dom.videoElapsed.textContent = formatMediaTime(cur, false); dom.videoDuration.textContent = formatMediaTime(state.video.showRemaining && dur > 0 ? Math.max(0, dur - cur) : dur, state.video.showRemaining);
  }
  function showVideoOverlayWithAutoHide() {
    dom.videoOverlay.classList.remove('controls-hidden'); setChromeVisibility(true);
    if (state.video.inactivityTimer) clearTimeout(state.video.inactivityTimer);
    if (!dom.viewerVideo.paused) state.video.inactivityTimer = setTimeout(() => { dom.videoOverlay.classList.add('controls-hidden'); setChromeVisibility(false); }, 3200);
  }
  function triggerVideoDoubleTapAnimation(isForward) {
    dom.videoSeekLabel.textContent = isForward ? '+10s' : '-10s';
    dom.videoDoubleTapIndicator.style.left = isForward ? 'auto' : '15%'; dom.videoDoubleTapIndicator.style.right = isForward ? '15%' : 'auto';
    dom.videoDoubleTapIndicator.classList.remove('hidden', 'fade');
    setTimeout(() => { dom.videoDoubleTapIndicator.classList.add('fade'); setTimeout(() => dom.videoDoubleTapIndicator.classList.add('hidden'), 300); }, 500);
  }
  function setupVideoPlayerControls() {
    const video = dom.viewerVideo;
    video.addEventListener('loadedmetadata', () => { updateVideoTimeDisplay(); updateScrubberFill(dom.videoScrubber); });
    video.addEventListener('play', () => { syncVideoPlayButtons(); showVideoOverlayWithAutoHide(); });
    video.addEventListener('pause', () => { syncVideoPlayButtons(); dom.videoOverlay.classList.remove('controls-hidden'); setChromeVisibility(true); if (state.video.inactivityTimer) clearTimeout(state.video.inactivityTimer); });
    video.addEventListener('ended', () => { syncVideoPlayButtons(); dom.videoOverlay.classList.remove('controls-hidden'); setChromeVisibility(true); });
    video.addEventListener('timeupdate', () => { if (!state.video.isScrubbing && video.duration > 0) { dom.videoScrubber.value = String(Math.round((video.currentTime / video.duration) * 1000)); updateScrubberFill(dom.videoScrubber); } updateVideoTimeDisplay(); });
    dom.videoContainer.addEventListener('pointerup', (e) => {
      if(e.target.closest('button') || e.target.closest('input')) return;
      const now = Date.now();
      if(now - state.video.lastTapTime < 300) {
        clearTimeout(state.video.tapTimer); state.video.lastTapTime = 0;
        const isForward = e.clientX > dom.videoContainer.getBoundingClientRect().left + (dom.videoContainer.getBoundingClientRect().width / 2);
        video.currentTime = isForward ? Math.min(video.duration || 0, video.currentTime + 10) : Math.max(0, video.currentTime - 10);
        triggerVideoDoubleTapAnimation(isForward); showVideoOverlayWithAutoHide();
      } else {
        state.video.lastTapTime = now;
        state.video.tapTimer = setTimeout(() => {
            if (e.target === dom.videoContainer || e.target === dom.viewerVideo || e.target === dom.videoOverlay) {
                if (dom.videoOverlay.classList.contains('controls-hidden')) showVideoOverlayWithAutoHide(); else { dom.videoOverlay.classList.add('controls-hidden'); setChromeVisibility(false); }
            }
        }, 300);
      }
    });
    dom.btnVideoPlay.addEventListener('click', (e) => { e.stopPropagation(); video.paused ? video.play().catch(()=>{}) : video.pause(); showVideoOverlayWithAutoHide(); });
    dom.btnVideoRw.addEventListener('click', (e) => { e.stopPropagation(); video.currentTime = Math.max(0, (video.currentTime || 0) - 10); showVideoOverlayWithAutoHide(); });
    dom.btnVideoFf.addEventListener('click', (e) => { e.stopPropagation(); video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); showVideoOverlayWithAutoHide(); });
    dom.videoScrubber.addEventListener('input', (e) => { e.stopPropagation(); state.video.isScrubbing = true; updateScrubberFill(dom.videoScrubber); if (video.duration > 0) dom.videoElapsed.textContent = formatMediaTime((parseFloat(dom.videoScrubber.value) / 1000) * video.duration, false); showVideoOverlayWithAutoHide(); });
    dom.videoScrubber.addEventListener('change', (e) => { e.stopPropagation(); if (video.duration > 0) video.currentTime = (parseFloat(dom.videoScrubber.value) / 1000) * video.duration; state.video.isScrubbing = false; showVideoOverlayWithAutoHide(); });
    dom.btnVideoTime.addEventListener('click', (e) => { e.stopPropagation(); state.video.showRemaining = !state.video.showRemaining; updateVideoTimeDisplay(); showVideoOverlayWithAutoHide(); });
    dom.btnVideoSpeed.addEventListener('click', (e) => { e.stopPropagation(); state.video.speedIndex = (state.video.speedIndex + 1) % PLAYBACK_SPEEDS.length; const r = PLAYBACK_SPEEDS[state.video.speedIndex]; video.playbackRate = r; dom.btnVideoSpeed.textContent = `${r.toFixed(r % 1 === 0 ? 1 : 2).replace(/0$/, '')}x`; showVideoOverlayWithAutoHide(); });
    dom.btnVideoFullscreen.addEventListener('click', async (e) => { e.stopPropagation(); try { if (!document.fullscreenElement) { dom.stageVideo.requestFullscreen ? await dom.stageVideo.requestFullscreen() : video.webkitEnterFullscreen(); } else await document.exitFullscreen(); } catch (err) {} showVideoOverlayWithAutoHide(); });
  }

  /* AUDIO PLAYER (Canvas ResizeObserver) */
  function launchAudioPlayer(objectUrl, record) {
    dom.stageAudio.classList.remove('hidden');
    state.audio.speedIndex = 2; state.audio.isLooping = false;
    dom.audioTitle.textContent = record.name;
    const { ext } = splitFilenameAndExtension(record.name);
    dom.audioSubtitle.textContent = `${(ext ? ext.slice(1) : record.type.split('/')[1] || 'AUDIO').toUpperCase()} • ${formatBytes(record.size)}`;
    dom.btnAudioSpeed.textContent = '1.0x'; dom.btnAudioLoop.style.opacity = '0.5';
    dom.audioScrubber.value = '0'; updateScrubberFill(dom.audioScrubber); dom.audioElapsed.textContent = '00:00'; dom.audioRemaining.textContent = '-00:00';
    
    const audio = dom.viewerAudio; audio.src = objectUrl; audio.loop = false; audio.playbackRate = 1.0;
    ensureWebAudioGraphConnected(); drawIdleAudioVisualizer();
    audio.play().catch(() => { syncAudioPlayState(); });
  }

  function setupAudioVisualizerResize() {
    const ro = new ResizeObserver(entries => {
      for (let entry of entries) {
         const canvas = dom.audioVisualizer;
         if(!canvas) return;
         canvas.width = entry.contentRect.width * (window.devicePixelRatio || 1);
         canvas.height = entry.contentRect.height * (window.devicePixelRatio || 1);
         if(dom.viewerAudio.paused || !state.isViewerOpen) drawIdleAudioVisualizer();
      }
    });
    ro.observe(dom.audioVisualizer.parentElement);
  }

  function ensureWebAudioGraphConnected() {
    if (state.audio.sourceNode) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) { state.audio.useFallbackVisualizer = true; return; }
      state.audio.audioCtx = new AudioCtx();
      state.audio.analyser = state.audio.audioCtx.createAnalyser();
      state.audio.analyser.fftSize = 128; state.audio.analyser.smoothingTimeConstant = 0.82;
      state.audio.sourceNode = state.audio.audioCtx.createMediaElementSource(dom.viewerAudio);
      state.audio.sourceNode.connect(state.audio.analyser);
      state.audio.analyser.connect(state.audio.audioCtx.destination);
      state.audio.freqData = new Uint8Array(state.audio.analyser.frequencyBinCount);
      state.audio.useFallbackVisualizer = false;
    } catch (err) { state.audio.useFallbackVisualizer = true; }
  }

  function drawIdleAudioVisualizer() {
    const canvas = dom.audioVisualizer, ctx = canvas.getContext('2d');
    if(!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const barCount = 36, gap = 4 * (window.devicePixelRatio || 1), barW = (w - gap*(barCount-1))/barCount;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-focus').trim();
    for (let i = 0; i < barCount; i++) {
        ctx.beginPath();
        if(ctx.roundRect) ctx.roundRect(i*(barW+gap), h/2 - 2, barW, 4, 2);
        else ctx.rect(i*(barW+gap), h/2 - 2, barW, 4);
        ctx.fill();
    }
  }

  function startAudioVisualizerLoop() {
    if (state.audio.rafId) cancelAnimationFrame(state.audio.rafId);
    const canvas = dom.audioVisualizer, ctx = canvas.getContext('2d'), barCount = 36;
    const renderFrame = (timestamp) => {
      if (dom.viewerAudio.paused || dom.viewerAudio.ended || !state.isViewerOpen) { state.audio.rafId = null; drawIdleAudioVisualizer(); return; }
      const w = canvas.width, h = canvas.height; ctx.clearRect(0, 0, w, h);
      
      let hasSignal = false;
      if (!state.audio.useFallbackVisualizer && state.audio.analyser && state.audio.freqData) {
        state.audio.analyser.getByteFrequencyData(state.audio.freqData);
        for (let i = 0; i < state.audio.freqData.length; i++) { if (state.audio.freqData[i] > 2) { hasSignal = true; break; } }
      }

      const gap = 4 * (window.devicePixelRatio || 1), barW = (w - gap*(barCount-1))/barCount;
      const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
      
      for (let i = 0; i < barCount; i++) {
        let norm = 0.05;
        if (hasSignal && state.audio.freqData) {
          const binIdx = Math.min(state.audio.freqData.length - 1, Math.floor((i / barCount) * 48));
          norm = Math.max(0.05, state.audio.freqData[binIdx] / 255);
        } else {
          norm = Math.max(0.05, Math.min(0.9, 0.4 + Math.sin(timestamp*0.005 + i*0.4)*0.3));
        }
        const barH = Math.max(4, norm * h), x = i * (barW + gap), y = (h - barH) / 2;
        ctx.fillStyle = primaryColor;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, barW, barH, barW/2); else ctx.rect(x, y, barW, barH);
        ctx.fill();
      }
      state.audio.rafId = requestAnimationFrame(renderFrame);
    };
    state.audio.rafId = requestAnimationFrame(renderFrame);
  }

  function syncAudioPlayState() {
    if (dom.viewerAudio.paused) { dom.iconAudioPlay.classList.remove('hidden'); dom.iconAudioPause.classList.add('hidden'); }
    else { dom.iconAudioPlay.classList.add('hidden'); dom.iconAudioPause.classList.remove('hidden'); }
  }

  function setupAudioPlayerControls() {
    const audio = dom.viewerAudio;
    setupAudioVisualizerResize();
    audio.addEventListener('play', () => { if (state.audio.audioCtx && state.audio.audioCtx.state === 'suspended') state.audio.audioCtx.resume().catch(()=>{}); syncAudioPlayState(); startAudioVisualizerLoop(); });
    audio.addEventListener('pause', () => { syncAudioPlayState(); drawIdleAudioVisualizer(); });
    audio.addEventListener('ended', () => { syncAudioPlayState(); drawIdleAudioVisualizer(); });
    audio.addEventListener('loadedmetadata', () => { dom.audioElapsed.textContent = formatMediaTime(0, false); dom.audioRemaining.textContent = formatMediaTime(audio.duration || 0, true); });
    audio.addEventListener('timeupdate', () => {
      const cur = audio.currentTime || 0, dur = audio.duration || 0;
      if (!state.audio.isScrubbing && dur > 0) { dom.audioScrubber.value = String(Math.round((cur / dur) * 1000)); updateScrubberFill(dom.audioScrubber); }
      dom.audioElapsed.textContent = formatMediaTime(cur, false); dom.audioRemaining.textContent = formatMediaTime(Math.max(0, dur - cur), true);
    });

    dom.btnAudioPlay.addEventListener('click', () => { if (state.audio.audioCtx && state.audio.audioCtx.state === 'suspended') state.audio.audioCtx.resume().catch(()=>{}); audio.paused ? audio.play().catch(()=>{}) : audio.pause(); });
    dom.btnAudioRw.addEventListener('click', () => { audio.currentTime = Math.max(0, (audio.currentTime || 0) - 10); });
    dom.btnAudioFf.addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });
    dom.audioScrubber.addEventListener('input', () => { state.audio.isScrubbing = true; updateScrubberFill(dom.audioScrubber); if (audio.duration > 0) { const pv = (parseFloat(dom.audioScrubber.value)/1000)*audio.duration; dom.audioElapsed.textContent = formatMediaTime(pv, false); dom.audioRemaining.textContent = formatMediaTime(Math.max(0, audio.duration - pv), true); } });
    dom.audioScrubber.addEventListener('change', () => { if (audio.duration > 0) audio.currentTime = (parseFloat(dom.audioScrubber.value)/1000)*audio.duration; state.audio.isScrubbing = false; });
    dom.btnAudioLoop.addEventListener('click', () => { state.audio.isLooping = !state.audio.isLooping; audio.loop = state.audio.isLooping; dom.btnAudioLoop.style.opacity = state.audio.isLooping ? '1' : '0.5'; showToast(state.audio.isLooping ? 'Loop Enabled' : 'Loop Disabled'); });
    dom.btnAudioSpeed.addEventListener('click', () => { state.audio.speedIndex = (state.audio.speedIndex + 1) % PLAYBACK_SPEEDS.length; const rate = PLAYBACK_SPEEDS[state.audio.speedIndex]; audio.playbackRate = rate; dom.btnAudioSpeed.textContent = `${rate.toFixed(rate % 1 === 0 ? 1 : 2).replace(/0$/, '')}x`; });
  }

  /* PDF VIEWER */
  async function launchPdfViewer(objectUrl) {
    dom.stagePdf.classList.remove('hidden'); state.pdf.zoomScale = 1.0; state.pdf.currentPage = 1;
    dom.pdfZoomLabel.textContent = '100%'; dom.pdfPageIndicator.textContent = 'Loading...'; dom.pdfPagesList.innerHTML = '';
    if (!window.pdfjsLib) { showToast('PDF engine unavailable'); return; }
    
    // EXTREMELY IMPORTANT OPTIMIZATION: Ensure Web Worker is configured correctly to prevent main-thread blocking[cite: 8]
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
    
    try {
      state.pdf.loadingTask = window.pdfjsLib.getDocument(objectUrl);
      state.pdf.doc = await state.pdf.loadingTask.promise;
      state.pdf.numPages = state.pdf.doc.numPages || 1;
      dom.pdfPageIndicator.textContent = `Page 1 / ${state.pdf.numPages}`;
      await buildPdfPageSlots();
    } catch (error) { showToast('Failed to render PDF'); }
  }

  async function buildPdfPageSlots() {
    if (!state.pdf.doc) return;
    if (state.pdf.observer) state.pdf.observer.disconnect();
    state.pdf.renderedPages.clear(); state.pdf.renderTasks.clear(); dom.pdfPagesList.innerHTML = '';
    const firstPage = await state.pdf.doc.getPage(1), unscaledVp = firstPage.getViewport({ scale: 1.0 });
    const baseFitScale = (Math.min(window.innerWidth - 28, 860) / unscaledVp.width) * state.pdf.zoomScale;
    const slotWidth = Math.round(unscaledVp.width * baseFitScale), slotHeight = Math.round(unscaledVp.height * baseFitScale);

    for (let pageNum = 1; pageNum <= state.pdf.numPages; pageNum++) {
      const slot = document.createElement('div'); slot.className = 'pdf-page-slot'; slot.dataset.pageNumber = String(pageNum);
      slot.style.width = `${slotWidth}px`; slot.style.height = `${slotHeight}px`;
      const placeholder = document.createElement('div'); placeholder.className = 'pdf-page-placeholder'; placeholder.textContent = `Page ${pageNum}`;
      slot.appendChild(placeholder); dom.pdfPagesList.appendChild(slot);
    }
    state.pdf.observer = new IntersectionObserver((entries) => { entries.forEach((entry) => { const pageNum = parseInt(entry.target.dataset.pageNumber, 10); if (entry.isIntersecting) renderPdfPageSlot(entry.target, pageNum, baseFitScale); }); }, { root: dom.pdfScrollContainer, rootMargin: '400px 0px', threshold: 0.01 });
    dom.pdfPagesList.querySelectorAll('.pdf-page-slot').forEach((slot) => state.pdf.observer.observe(slot));
  }

  async function renderPdfPageSlot(slotEl, pageNum, fitScale) {
    if (!state.pdf.doc || state.pdf.renderedPages.has(pageNum)) return;
    state.pdf.renderedPages.add(pageNum);
    try {
      const page = await state.pdf.doc.getPage(pageNum), viewport = page.getViewport({ scale: fitScale }), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      slotEl.style.width = `${Math.round(viewport.width)}px`; slotEl.style.height = `${Math.round(viewport.height)}px`;
      const canvas = document.createElement('canvas'); canvas.className = 'pdf-page-canvas';
      canvas.width = Math.floor(viewport.width * dpr); canvas.height = Math.floor(viewport.height * dpr);
      const ctx = canvas.getContext('2d', { alpha: false });
      slotEl.innerHTML = ''; slotEl.appendChild(canvas);
      const renderTask = page.render({ canvasContext: ctx, viewport: viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
      state.pdf.renderTasks.set(pageNum, renderTask); await renderTask.promise; state.pdf.renderTasks.delete(pageNum);
    } catch (err) { state.pdf.renderedPages.delete(pageNum); }
  }

  function setupPdfViewerControls() {
    dom.pdfScrollContainer.addEventListener('scroll', () => {
      if (!state.pdf.numPages) return;
      const rect = dom.pdfScrollContainer.getBoundingClientRect(), midY = rect.top + rect.height / 2;
      let closestPage = state.pdf.currentPage, minDistance = Infinity;
      dom.pdfPagesList.querySelectorAll('.pdf-page-slot').forEach((slot) => {
        const slotRect = slot.getBoundingClientRect(), dist = Math.abs((slotRect.top + slotRect.height / 2) - midY);
        if (dist < minDistance) { minDistance = dist; closestPage = parseInt(slot.dataset.pageNumber, 10); }
      });
      if (closestPage !== state.pdf.currentPage) { state.pdf.currentPage = closestPage; dom.pdfPageIndicator.textContent = `Page ${state.pdf.currentPage} / ${state.pdf.numPages}`; }
    });
    dom.btnPdfZoomIn.addEventListener('click', async () => { if (!state.pdf.doc) return; state.pdf.zoomScale = Math.min(2.5, +(state.pdf.zoomScale + 0.25).toFixed(2)); dom.pdfZoomLabel.textContent = `${Math.round(state.pdf.zoomScale * 100)}%`; await buildPdfPageSlots(); });
    dom.btnPdfZoomOut.addEventListener('click', async () => { if (!state.pdf.doc) return; state.pdf.zoomScale = Math.max(0.5, +(state.pdf.zoomScale - 0.25).toFixed(2)); dom.pdfZoomLabel.textContent = `${Math.round(state.pdf.zoomScale * 100)}%`; await buildPdfPageSlots(); });
  }

  /* MODALS & FILE UTILITIES */
  function openRenameModal() {
    if (!state.activeRecord) return;
    const { base, ext } = splitFilenameAndExtension(state.activeRecord.name);
    dom.renameInput.value = base; dom.renameExtBadge.textContent = ext || '';
    dom.renameModal.classList.remove('hidden'); state.isRenameOpen = true;
    if (window.location.hash !== '#rename') history.pushState({ view: 'rename' }, '', '#rename');
    setTimeout(() => { dom.renameInput.focus(); dom.renameInput.select(); }, 40);
  }
  function closeRenameModal(fromPopstate = false) {
    if (!state.isRenameOpen) return;
    dom.renameModal.classList.add('hidden'); state.isRenameOpen = false;
    if (!fromPopstate && window.location.hash === '#rename') { state.suppressPopstate = true; history.back(); }
  }
  async function handleRenameSubmit(e) {
    e.preventDefault(); if (!state.activeRecord) return;
    const newBase = dom.renameInput.value.trim(); if (!newBase) { showToast('Filename cannot be empty'); return; }
    const { ext } = splitFilenameAndExtension(state.activeRecord.name), updatedName = newBase + ext;
    state.activeRecord.name = updatedName;
    if (state.activeRecord.blob) state.activeRecord.blob = new File([state.activeRecord.blob], updatedName, { type: state.activeRecord.type });
    dom.viewerFilename.textContent = updatedName;
    if (state.activeRecord.category === 'audio') dom.audioTitle.textContent = updatedName;
    await saveHistoryRecord(state.activeRecord); await loadAllHistoryRecords(); renderHistoryList();
    closeRenameModal(false); showToast(`Renamed to ${updatedName}`);
  }
  async function saveActiveFileToDevice() {
    if (!state.activeRecord || !state.activeRecord.blob) { showToast('No active file to save'); return; }
    const filename = state.activeRecord.name || 'simply-media', { ext } = splitFilenameAndExtension(filename), mimeType = state.activeRecord.type || getDefaultMimeForCategory(state.activeRecord.category);
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const pickerOptions = { suggestedName: filename };
        if (ext) pickerOptions.types = [{ description: `${state.activeRecord.category.toUpperCase()} File`, accept: { [mimeType]: [ext] } }];
        const fileHandle = await window.showSaveFilePicker(pickerOptions), writable = await fileHandle.createWritable();
        await writable.write(state.activeRecord.blob); await writable.close(); showToast(`Saved ${filename}`); return;
      } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    const downloadUrl = state.activeObjectUrl || URL.createObjectURL(state.activeRecord.blob), anchor = document.createElement('a');
    anchor.href = downloadUrl; anchor.download = filename; anchor.style.display = 'none';
    document.body.appendChild(anchor); anchor.click();
    setTimeout(() => { anchor.remove(); if (!state.activeObjectUrl && downloadUrl) URL.revokeObjectURL(downloadUrl); }, 200);
    showToast(`Downloading ${filename}`);
  }

  function closeViewer(fromPopstate = false) {
    if (!state.isViewerOpen) return;
    
    state.isClosingViewer = true; 
    if(state.queue) { for(let item of state.queue) { if(item.thumbUrl) { URL.revokeObjectURL(item.thumbUrl); item.thumbUrl = null; } } }
    state.queue = [];
    
    releaseActiveMediaResources();
    dom.viewerView.classList.add('hidden'); dom.viewerView.setAttribute('aria-hidden', 'true');
    state.isViewerOpen = false; state.activeRecord = null;
    if (!fromPopstate && (window.location.hash === '#viewer' || window.location.hash === '#rename')) { state.suppressPopstate = true; history.back(); }
  }

  function openConfirmClearModal() { dom.confirmModal.classList.remove('hidden'); state.isConfirmOpen = true; if (window.location.hash !== '#confirm-clear') history.pushState({ view: 'confirm-clear' }, '', '#confirm-clear'); }
  function closeConfirmClearModal(fromPopstate = false) { if (!state.isConfirmOpen) return; dom.confirmModal.classList.add('hidden'); state.isConfirmOpen = false; if (!fromPopstate && window.location.hash === '#confirm-clear') { state.suppressPopstate = true; history.back(); } }

  function setupHistoryRouter() {
    if (!history.state) history.replaceState({ view: 'home' }, '', window.location.pathname);
    window.addEventListener('popstate', () => {
      if (state.suppressPopstate) { state.suppressPopstate = false; return; }
      if (state.isRenameOpen) { closeRenameModal(true); return; }
      if (state.isConfirmOpen) { closeConfirmClearModal(true); return; }
      if (state.isViewerOpen && window.location.hash !== '#viewer') closeViewer(true);
    });
  }

  async function generateDemoMediaSuite() {
    showToast('Generating sample files...');
    const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600"><rect width="800" height="600" fill="#F9FAFB"/><circle cx="400" cy="260" r="120" fill="#FFFFFF" stroke="#111827" stroke-width="8"/><polygon points="380,215 380,305 450,260" fill="#4B5563"/><text x="400" y="470" text-anchor="middle" fill="#111827" font-family="system-ui, sans-serif" font-size="24" font-weight="700">SIMPLY VIEWER TEST CHART</text></svg>`;
    const imgFile = new File([sampleSvg], 'Simply-TestChart.svg', { type: 'image/svg+xml' });
    const wavBlob = createSynthesizedWavBlob(6);
    const audioFile = new File([wavBlob], 'Synth-Demo.wav', { type: 'audio/wav' });
    const pdfBytes = new TextEncoder().encode(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n5 0 obj\n<< /Length 110 >>\nstream\nBT\n/F1 18 Tf\n50 720 Td\n(Simply Viewer PDF Testing Architecture) Tj\nET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000120 00000 n \n0000000244 00000 n \n0000000332 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n492\n%%EOF`);
    const pdfFile = new File([pdfBytes], 'Simply-Guide.pdf', { type: 'application/pdf' });
    await ingestFilesArray([pdfFile, audioFile, imgFile]);
  }

  function createSynthesizedWavBlob(dur) {
    const rate = 22050, samples = rate * dur, buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ws(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) {
      const t = i / rate, sig = (Math.sin(2 * Math.PI * 440 * t) * 0.5 + Math.sin(2 * Math.PI * 660 * t) * 0.25) * Math.sin(Math.PI * (t % 1));
      view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sig)) * 24000, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function registerServiceWorkerAndShareListener() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(() => {
          navigator.serviceWorker.addEventListener('message', (event) => { if (event.data && event.data.type === 'SHARED_FILE_READY') consumeSharedQueue(); });
        }).catch(()=>{});
      });
    }
    
    // Hide install button immediately if app is already a standalone PWA
    if (window.matchMedia('(display-mode: standalone)').matches) {
        dom.btnInstallPwa.classList.add('hidden');
    }

    // Capture install prompt if eligible
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        state.deferredInstallPrompt = e;
        dom.btnInstallPwa.classList.remove('hidden');
    });

    // Ensure it hides permanently upon successful install
    window.addEventListener('appinstalled', () => {
        dom.btnInstallPwa.classList.add('hidden');
        state.deferredInstallPrompt = null;
    });

    // Handle Manual PWA Installation
    dom.btnInstallPwa.addEventListener('click', async () => {
        if (!state.deferredInstallPrompt) return;
        state.deferredInstallPrompt.prompt();
        const { outcome } = await state.deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
            dom.btnInstallPwa.classList.add('hidden');
            showToast('App installed successfully!');
        }
        state.deferredInstallPrompt = null;
    });
  }

  function bindGlobalUiEvents() {
    const triggerFileInput = () => { dom.fileInput.value = ''; dom.fileInput.click(); };
    dom.btnEmptyOpen.addEventListener('click', triggerFileInput);
    dom.fabOpenFile.addEventListener('click', triggerFileInput);
    dom.btnDemoMedia.addEventListener('click', generateDemoMediaSuite);
    
    dom.fileInput.addEventListener('change', (e) => { if (e.target.files && e.target.files.length > 0) ingestFilesArray(Array.from(e.target.files)); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files) ingestFilesArray(Array.from(e.dataTransfer.files)); });
    
    dom.filterChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      state.currentFilter = chip.dataset.filter || 'all';
      dom.filterChips.querySelectorAll('.chip').forEach((c) => { const active = c === chip; c.classList.toggle('active', active); c.setAttribute('aria-selected', String(active)); });
      renderHistoryList();
    });

    dom.btnClearAll.addEventListener('click', openConfirmClearModal);
    dom.btnConfirmCancel.addEventListener('click', () => closeConfirmClearModal(false));
    dom.btnConfirmAccept.addEventListener('click', async () => { await clearAllHistoryRecords(); renderHistoryList(); closeConfirmClearModal(false); showToast('All history cleared'); });
    dom.btnViewerBack.addEventListener('click', () => closeViewer(false));
    dom.btnRenameTrigger.addEventListener('click', openRenameModal);
    dom.btnSaveFile.addEventListener('click', saveActiveFileToDevice);
    dom.btnRenameCancel.addEventListener('click', () => closeRenameModal(false));
    dom.renameForm.addEventListener('submit', handleRenameSubmit);
    dom.renameModal.addEventListener('click', (e) => { if (e.target === dom.renameModal) closeRenameModal(false); });
    dom.confirmModal.addEventListener('click', (e) => { if (e.target === dom.confirmModal) closeConfirmClearModal(false); });
  }

  async function bootstrapApp() {
    initTheme(); setupHistoryRouter(); bindGlobalUiEvents(); setupSwipeGestures(); setupImageViewerGestures(); setupVideoPlayerControls(); setupAudioPlayerControls(); setupPdfViewerControls(); registerServiceWorkerAndShareListener();
    await initDatabase(); await loadAllHistoryRecords(); renderHistoryList();
    
    if (window.location.search.includes('shared=')) {
        history.replaceState(history.state, '', window.location.pathname + window.location.hash);
    }
    
    await consumeSharedQueue();
    if (new URLSearchParams(window.location.search).get('action') === 'open') { history.replaceState({ view: 'home' }, '', window.location.pathname); setTimeout(() => dom.fileInput.click(), 150); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrapApp); else bootstrapApp();
})();