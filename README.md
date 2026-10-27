# Omniview — Universal Media Viewer, Editor & Saver PWA

**Omniview** is a native-grade, zero-dependency Progressive Web Application (PWA) built with **Vanilla HTML5, CSS3, and ES6+ JavaScript**. Engineered for true AMOLED mobile displays (`#000000`) and deep integration with Android via the **Web Share Target API**, Omniview provides four specialized media engines—an Immersive Multi-Touch Image Viewer, a YouTube-Style Video Player, an Interactive Web Audio Visualizer, and a Google Drive-Style Continuous-Scroll PDF Reader—backed by zero-bloat `ObjectURL` streaming and local IndexedDB storage.

---

## Repository File Structure

```text
omniview-pwa/
├── index.html                 # Semantic app shell, viewer stages, modals, and HUD overlays
├── styles.css                 # True AMOLED (#000000) theme, safe-area layout, custom media controls
├── app.js                     # Core engine: IndexedDB, multi-touch gestures, Web Audio, PDF.js, History API
├── manifest.json              # PWA standalone config, App Shortcuts, and Web Share Target API
├── sw.js                      # Offline App Shell caching + /share-target POST interception
├── assets/
│   ├── logo.svg               # Maskable-safe vector application icon (512x512 viewBox)
│   ├── shortcut-open.svg      # PWA App Shortcut icon for "Open Local File"
│   └── shortcut-recent.svg    # PWA App Shortcut icon for "Recent History"
├── vendor/
│   ├── pdf.min.js             # Local-first PDF.js engine with automatic CDN upgrade & offline fallback
│   └── pdf.worker.min.js      # Companion PDF.js Web Worker script
├── setup-and-zip.mjs          # Node.js build/packager script that provisions files & builds omniview-pwa.zip
└── README.md                  # Technical architecture, Web Share Target lifecycle, and deployment guide
```

---

## Architectural Highlights

### 1. Android Web Share Target API Lifecycle (`manifest.json` -> `sw.js` -> `app.js`)
1. **OS Registration (`manifest.json`)**: When Omniview is installed on an Android device (via Chrome/Edge WebAPK), Android registers the `share_target` entry (`action: "./share-target"`, `method: "POST"`, `enctype: "multipart/form-data"`) for `image/*`, `video/*`, `audio/*`, and `application/pdf`.
2. **Service Worker Interception (`sw.js`)**: When a user shares media from any Android app to Omniview, `sw.js` intercepts the `POST /share-target` request, parses `await event.request.formData()`, and extracts the raw `File` instance without converting it to Base64.
3. **Direct IndexedDB Queueing (`OmniviewDB -> shared_queue`)**: The Service Worker stores the raw `File` object directly into the `shared_queue` object store in `OmniviewDB`, broadcasts `{ type: "SHARED_FILE_READY" }` to active window clients via `self.clients.matchAll()`, and returns an HTTP `303 See Other` redirect to `./?shared=1`.
4. **Immediate Consumption (`app.js`)**: On launch or message receipt, `app.js` reads and clears `shared_queue`, logs the file in `recent_history`, creates a zero-copy stream via `URL.createObjectURL(file)`, and opens the matching media viewer immediately.

### 2. Zero-Bloat Memory Management
- Large files (such as 4K `.mp4` videos or multi-megabyte `.pdf` documents) are **never** read into JavaScript `ArrayBuffer` or Base64 strings in memory all at once.
- Media elements (`<img>`, `<video>`, `<audio>`) and the PDF reader stream directly from browser blob storage using `URL.createObjectURL(file)`.
- Whenever the user closes the viewer, switches files, or presses the hardware back button, `releaseActiveMediaResources()` immediately calls `URL.revokeObjectURL(activeUrl)`, pauses media decoders, cancels active `requestAnimationFrame` loops, disconnects the `IntersectionObserver`, and clears `<canvas>` buffers.

### 3. Specialized Media Viewers
- **Immersive Image Viewer**: Hardware-accelerated `translate3d` and `scale` transformations supporting two-finger pinch-to-zoom (`1x` to `6x`), single-finger pan with viewport boundary clamping, double-tap quick zoom (`1x` <-> `2.75x`), desktop mouse wheel zoom, and a floating zoom HUD.
- **YouTube-Style Video Player**: Custom overlay over native HTML5 `<video>` with a centered Play/Pause hero button, `-10s` / `+10s` quick seek buttons, dynamic gradient timeline scrubber, tap-to-toggle remaining time (`-MM:SS`), playback speed cycler (`0.5x` to `2.0x`), Fullscreen API integration, and 3.2-second inactivity auto-hide.
- **Interactive Audio Player & Visualizer**: Rotating vinyl disc animation (`animation-play-state`), track metadata readout, real-time 60fps frequency bar visualizer powered by Web Audio API (`AudioContext`, `MediaElementAudioSourceNode`, `AnalyserNode` with `fftSize = 128`) plus an autonomous wave fallback if audio context policies restrict analysis, loop toggle, and speed selector.
- **Google Drive-Style Continuous-Scroll PDF Viewer**: Dynamically allocates page slots for all pages in the document and uses `IntersectionObserver` (`rootMargin: "350px 0px"`) so only visible pages are rasterized onto `<canvas>` elements scaled by `window.devicePixelRatio` for crisp Retina text.

### 4. Rename & Native Device Saving
- **Extension-Safe Rename Modal**: Tapping the filename in the viewer top bar opens `#rename`, automatically highlighting the base filename while locking the original file extension badge. Saving updates the active viewer, the `File` instance, and the `recent_history` record in IndexedDB.
- **Native File System Access API (`Save To...`)**: Uses `window.showSaveFilePicker` so users can choose the exact folder and filename on supported browsers, seamlessly falling back to a programmatic `<a download>` anchor trigger when unavailable.

### 5. Hardware Back Button & History API State Machine
- Navigation pushes `#viewer`, `#rename`, and `#confirm-clear` onto the browser history stack via `history.pushState`.
- Listening to `window.addEventListener('popstate', ...)` ensures that pressing the Android hardware back button or swiping back from the screen edge closes open modals first, then dismisses the viewer back to the Home Screen without accidentally exiting the PWA.

---

## Local Testing & Deployment

### Option 1: Direct Static Serving
Because Omniview uses zero bundlers or build steps, you can serve the repository root with any static HTTP server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080` in Chrome, Edge, or Firefox.

### Option 2: Rebuild & Package via `setup-and-zip.mjs`
Run the included Node.js packager script to provision the directory structure, fetch the latest official Mozilla `pdf.min.js` and `pdf.worker.min.js` bundles (with automatic local fallback), and generate `omniview-pwa.zip`:

```bash
node setup-and-zip.mjs
```

### Deploying to GitHub Pages
1. Push all files in this repository to your GitHub repository's `main` branch.
2. In your GitHub repository, navigate to **Settings -> Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**, choose `main` and `/ (root)`, and click **Save**.
4. Once deployed over HTTPS, open the GitHub Pages URL on your Android device in Chrome and tap **Install App** in the Omniview header (or **Add to Home screen** in the browser menu) to activate native Android **Web Share Target** integration.
