

document.addEventListener('DOMContentLoaded', () => {

  const state = {
    files: [],
    currentJobId: null,
    pollTimer: null,
    elapsedTimer: null,
    startTime: null,
    viewer: null,
    activeMode: 'video'
  };

  const statusPill     = document.getElementById('system-status-pill');
  const statusPillText = document.getElementById('status-pill-text');

  const homeSection   = document.getElementById('home-section');
  const uploadSection = document.getElementById('upload-section');
  const viewerSection = document.getElementById('viewer-section');

  const navBtnHome   = document.getElementById('nav-btn-home');
  const navBtnCreate = document.getElementById('nav-btn-create');
  const navBtnViewer = document.getElementById('nav-btn-viewer');
  const brandHomeLink = document.getElementById('brand-home-link');

  const heroBtnExplore  = document.getElementById('hero-btn-explore');
  const heroBtnUpload   = document.getElementById('hero-btn-upload');
  const bottomBtnUpload = document.getElementById('bottom-btn-upload');
  const bottomBtnExplore = document.getElementById('bottom-btn-explore');
  const backToHomeBtn   = document.getElementById('back-to-home-btn');
  const demoModelSelect = document.getElementById('demo-model-select');

  const themeToggleBtn   = document.getElementById('theme-toggle-btn');
  const themeToggleLabel = document.getElementById('theme-toggle-label');

  const tabDroneVideo  = document.getElementById('tab-drone-video');
  const tabPhotos      = document.getElementById('tab-photos');
  const dropzoneTitle    = document.getElementById('dropzone-title');
  const dropzoneSubtitle = document.getElementById('dropzone-subtitle');

  const dropzone          = document.getElementById('dropzone');
  const fileInput         = document.getElementById('file-input');
  // NOTE: browse-btn reference is read lazily via querySelector so tab switches don't stale it
  const videoExtractBar   = document.getElementById('video-extract-bar');
  const extractStatusText = document.getElementById('extract-status-text');
  const extractPercentText = document.getElementById('extract-percent-text');
  const extractProgressFill = document.getElementById('extract-progress-fill');
  const galleryContainer  = document.getElementById('gallery-container');
  const imageGrid         = document.getElementById('image-grid');
  const imageCountNum     = document.getElementById('image-count-num');
  const clearAllBtn       = document.getElementById('clear-all-btn');
  const generateBtn       = document.getElementById('generate-btn');

  const settingsToggle  = document.getElementById('settings-toggle');
  const settingsContent = document.getElementById('settings-content');
  const cfgImageSize    = document.getElementById('cfg-image-size');
  const cfgIterations   = document.getElementById('cfg-iterations');
  const iterVal         = document.getElementById('iter-val');
  const cfgMode         = document.getElementById('cfg-mode');
  const cfgDevice       = document.getElementById('cfg-device');

  const livePipelineHud  = document.getElementById('live-pipeline-hud');
  const hudStageTitle    = document.getElementById('hud-stage-title');
  const hudStageDesc     = document.getElementById('hud-stage-desc');
  const hudTimer         = document.getElementById('hud-timer');
  const hudProgressFill  = document.getElementById('hud-progress-fill');
  const hudToggleLogsBtn = document.getElementById('hud-toggle-logs-btn');
  const hudLogsDrawer    = document.getElementById('hud-logs-drawer');
  const hudCloseLogsBtn  = document.getElementById('hud-close-logs-btn');
  const hudTerminalBody  = document.getElementById('hud-terminal-body');
  const hudCancelBtn     = document.getElementById('hud-cancel-btn');
  const viewerHeaderTitle = document.getElementById('viewer-header-title');

  const downloadGlbBtn = document.getElementById('download-glb-btn');
  const downloadStlBtn = document.getElementById('download-stl-btn');
  const downloadObjBtn = document.getElementById('download-obj-btn');
  const downloadPlyBtn = document.getElementById('download-ply-btn');
  const viewGlbBtn     = document.getElementById('view-glb-btn');
  const viewPlyBtn     = document.getElementById('view-ply-btn');
  const measureToolBtn = document.getElementById('measure-tool-btn');
  const snapshotBtn    = document.getElementById('snapshot-btn');
  const newReconBtn    = document.getElementById('new-recon-btn');
  const btnResetCam    = document.getElementById('btn-reset-cam');
  const btnAutoRotate  = document.getElementById('btn-auto-rotate');
  const btnToggleGrid  = document.getElementById('btn-toggle-grid');
  const btnPointStyle  = document.getElementById('btn-point-style');
  const pointStyleLabel = document.getElementById('point-style-label');
  const btnToggleMesh  = document.getElementById('btn-toggle-mesh');
  const meshStyleLabel = document.getElementById('mesh-style-label');
  const btnToggleBg    = document.getElementById('btn-toggle-bg');
  const btnToggleCams  = document.getElementById('btn-toggle-cams');
  const btnFullscreen  = document.getElementById('btn-fullscreen');
  // point-size-slider does not exist in base HTML — accessed via ctrl-point-size instead
  const pointSizeSlider = document.getElementById('point-size-slider');
  const pointSizeVal    = document.getElementById('point-size-val');

  state.viewer = new ModelViewer('three-canvas-container');

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('aerovox_theme', theme);
    if (themeToggleLabel) {
      themeToggleLabel.textContent = theme === 'dark' ? 'Noir Gold' : 'Ivory Gold';
    }
  }

  const savedTheme = localStorage.getItem('aerovox_theme') || 'dark';
  applyTheme(savedTheme);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const current = document.body.getAttribute('data-theme') || 'dark';
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
    });
  }

  async function checkSystemHealth() {
    try {
      const data = await API.checkHealth();
      const env = data.environment;
      if (env.is_ready) {
        statusPill.className = 'status-pill status-ready';
        statusPillText.textContent = `${env.device.toUpperCase()} • Engine Ready`;
      } else {
        statusPill.className = 'status-pill status-error';
        statusPillText.textContent = 'MUSt3R Initializing';
      }
    } catch (err) {
      statusPill.className = 'status-pill status-error';
      statusPillText.textContent = 'Engine Offline';
      console.error('System health check error:', err);
    }
  }
  checkSystemHealth();

  // ── Tab switching ────────────────────────────────────────────────────────
  // IMPORTANT: Do NOT rewrite dropzoneTitle.innerHTML on tab switch — that destroys
  // the #browse-btn DOM node the click listener is already attached to.
  // Instead just update fileInput.accept and the subtitle text.
  if (tabDroneVideo && tabPhotos) {
    tabDroneVideo.addEventListener('click', () => {
      tabDroneVideo.classList.add('active');
      tabPhotos.classList.remove('active');
      state.activeMode = 'video';
      if (fileInput) fileInput.accept = '.mp4,.mov,.m4v,.ts,video/*';
      const browseLink = dropzoneTitle && dropzoneTitle.querySelector('.text-link');
      if (browseLink) browseLink.textContent = 'browse video';
      if (dropzoneSubtitle) dropzoneSubtitle.textContent = 'AI automatically filters motion blur and extracts sharp parallax keyframes for single-pass 3D reconstruction.';
    });

    tabPhotos.addEventListener('click', () => {
      tabPhotos.classList.add('active');
      tabDroneVideo.classList.remove('active');
      state.activeMode = 'photos';
      if (fileInput) fileInput.accept = '.jpg,.jpeg,.png,.webp,image/*';
      const browseLink = dropzoneTitle && dropzoneTitle.querySelector('.text-link');
      if (browseLink) browseLink.textContent = 'browse images';
      if (dropzoneSubtitle) dropzoneSubtitle.textContent = 'Supports JPG, PNG, and WEBP formats • Recommended: 15–40 images per flight pass';
    });
  }

  // ── Browse button & dropzone click ───────────────────────────────────────
  // Use event delegation on the dropzoneTitle so the .text-link button always works
  // even if the DOM is ever updated.
  if (dropzoneTitle) {
    dropzoneTitle.addEventListener('click', (e) => {
      if (e.target.classList.contains('text-link') || e.target.closest('.text-link')) {
        e.stopPropagation();
        if (fileInput) fileInput.click();
      }
    });
  }

  // Clicking anywhere on the dropzone (outside the title's text-link) also opens picker
  if (dropzone) {
    dropzone.addEventListener('click', (e) => {
      // Don't trigger if the click was on a button or .text-link inside the dropzone
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      if (fileInput) fileInput.click();
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      handleFilesAdded(Array.from(e.target.files));
      fileInput.value = '';
    });
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const droppedFiles = Array.from(e.dataTransfer.files);
    handleFilesAdded(droppedFiles);
  });

  clearAllBtn.addEventListener('click', () => {
    state.files = [];
    updateGalleryUI();
  });

  async function handleFilesAdded(newFiles) {
    const videoFiles = newFiles.filter(f => f.type.startsWith('video/') || /\.(mp4|mov|m4v|ts)$/i.test(f.name));
    const imageFiles = newFiles.filter(f => f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(f.name));

    if (videoFiles.length > 0) {
      await processDroneVideo(videoFiles[0]);
    } else if (imageFiles.length > 0) {
      const existingNames = new Set(state.files.map(f => f.name));
      const filtered = imageFiles.filter(f => !existingNames.has(f.name));
      state.files = [...state.files, ...filtered];
      updateGalleryUI();
    }
  }

  async function processDroneVideo(videoFile) {
    videoExtractBar.classList.remove('hidden');
    extractStatusText.textContent = `Analyzing drone video: ${videoFile.name}...`;
    extractProgressFill.style.width = '10%';
    extractPercentText.textContent = '10%';

    const videoUrl = URL.createObjectURL(videoFile);
    const video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    // Wait for metadata with a 10-second timeout guard
    await Promise.race([
      new Promise((resolve) => { video.onloadedmetadata = () => resolve(); }),
      new Promise((resolve) => setTimeout(resolve, 10000))
    ]);

    const duration = video.duration || 10;
    const targetKeyframeCount = Math.min(30, Math.max(16, Math.floor(duration * 1.5)));
    const interval = duration / targetKeyframeCount;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const extractedBlobs = [];

    canvas.width = Math.min(video.videoWidth || 1920, 1600);
    canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth || 0.5625));

    for (let i = 0; i < targetKeyframeCount; i++) {
      const targetTime = i * interval;

      // Seek and wait — race against 3 s timeout so a missed event never stalls the loop
      video.currentTime = targetTime;
      await Promise.race([
        new Promise((resolve) => { video.onseeked = () => resolve(); }),
        new Promise((resolve) => setTimeout(resolve, 3000))
      ]);
      video.onseeked = null;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // toBlob with a 5-second fallback (guard against rare browser stalls)
      const blob = await Promise.race([
        new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92)),
        new Promise((resolve) => setTimeout(() => resolve(null), 5000))
      ]);

      if (blob) {
        const frameFile = new File([blob], `drone_frame_${String(i + 1).padStart(3, '0')}.jpg`, { type: 'image/jpeg' });
        extractedBlobs.push(frameFile);
      }

      const pct = Math.round(((i + 1) / targetKeyframeCount) * 100);
      extractProgressFill.style.width = `${pct}%`;
      extractPercentText.textContent = `${pct}%`;
      extractStatusText.textContent = `Extracting keyframe ${i + 1} of ${targetKeyframeCount} (Optimal Parallax)...`;
    }

    URL.revokeObjectURL(videoUrl);
    videoExtractBar.classList.add('hidden');

    state.files = extractedBlobs;
    updateGalleryUI();
  }

  function updateGalleryUI() {
    imageCountNum.textContent = state.files.length;

    if (state.files.length > 0) {
      galleryContainer.classList.remove('hidden');
      generateBtn.disabled = state.files.length < 2;

      imageGrid.innerHTML = '';
      state.files.forEach((file, idx) => {
        const card = document.createElement('div');
        card.className = 'image-card';

        const img = document.createElement('img');
        const url = URL.createObjectURL(file);
        img.src = url;
        img.onload = () => URL.revokeObjectURL(url);

        const overlay = document.createElement('div');
        overlay.className = 'card-overlay';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.innerHTML = '✕';
        removeBtn.title = 'Remove Frame';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          state.files.splice(idx, 1);
          updateGalleryUI();
        });
        overlay.appendChild(removeBtn);

        card.appendChild(img);
        card.appendChild(overlay);
        imageGrid.appendChild(card);
      });
    } else {
      galleryContainer.classList.add('hidden');
      generateBtn.disabled = true;
      imageGrid.innerHTML = '';
    }
  }

  settingsToggle.addEventListener('click', () => {
    const isCollapsed = settingsContent.classList.toggle('collapsed');
    settingsToggle.setAttribute('aria-expanded', !isCollapsed);
    const arrow = settingsToggle.querySelector('.toggle-arrow');
    if (arrow) arrow.textContent = isCollapsed ? '▾' : '▴';
  });

  cfgIterations.addEventListener('input', (e) => {
    iterVal.textContent = e.target.value;
  });

  const presetButtons = document.querySelectorAll('.preset-btn');
  let selectedPreset = 'balanced';

  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      presetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPreset = btn.dataset.preset;

      if (selectedPreset === 'balanced') {
        cfgImageSize.value = '512';
        cfgIterations.value = '6';
        iterVal.textContent = '6';
      } else if (selectedPreset === 'ultra') {
        cfgImageSize.value = '512';
        cfgIterations.value = '10';
        iterVal.textContent = '10';
      } else if (selectedPreset === 'fast') {
        cfgImageSize.value = '224';
        cfgIterations.value = '4';
        iterVal.textContent = '4';
      }
    });
  });

  const cfgRemoveBg = document.getElementById('cfg-remove-bg');

  generateBtn.addEventListener('click', async () => {
    if (state.files.length < 2) return;

    const bs = selectedPreset === 'ultra' ? 1 : 2;
    const config = {
      image_size: parseInt(cfgImageSize.value, 10),
      device: cfgDevice.value,
      max_bs: bs,
      num_refinements_iterations: parseInt(cfgIterations.value, 10),
      execution_mode: cfgMode.value,
      cam_size: 0.05,
      remove_background: cfgRemoveBg ? cfgRemoveBg.checked : true
    };

    showView('viewer-section');
    state.viewer.onResize();
    state.viewer.setupLiveFraming(state.files);

    if (livePipelineHud) {
      livePipelineHud.classList.remove('hidden');
      hudStageTitle.textContent = 'Mapping Flight Trajectory & Features...';
      hudStageDesc.textContent = `Analyzing ${state.files.length} aerial viewpoints in real time...`;
      hudProgressFill.style.width = '8%';
      if (hudTerminalBody) {
        hudTerminalBody.innerHTML = '<div class="log-line info">[System] Aerial flight stream initialized. Starting neural regressors...</div>';
      }
    }
    if (viewerHeaderTitle) {
      viewerHeaderTitle.textContent = 'Live Aerial Analysis & Trajectory';
    }

    startElapsedTimer();

    try {
      const res = await API.createJob(state.files, config);
      state.currentJobId = res.job_id;
      appendTerminalLog(`[Job] Created mission ID: ${res.job_id}`);
      startPolling(res.job_id);
    } catch (err) {
      stopElapsedTimer();
      alert(`Error starting reconstruction: ${err.message}`);
      if (livePipelineHud) livePipelineHud.classList.add('hidden');
      showView('upload-section');
    }
  });

  function startPolling(jobId) {
    if (state.pollTimer) clearInterval(state.pollTimer);

    state.pollTimer = setInterval(async () => {
      try {
        const job = await API.getJobStatus(jobId);
        updateJobProgressUI(job);

        if (job.status === 'completed') {
          clearInterval(state.pollTimer);
          stopElapsedTimer();
          setTimeout(() => onJobCompleted(job), 600);
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          clearInterval(state.pollTimer);
          stopElapsedTimer();
          if (livePipelineHud) livePipelineHud.classList.add('hidden');
          alert(`Reconstruction ${job.status}: ${job.error || job.message}`);
          showView('upload-section');
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1200);
  }

  function updateJobProgressUI(job) {
    if (hudProgressFill) hudProgressFill.style.width = `${job.progress}%`;
    if (hudStageTitle) hudStageTitle.textContent = `${job.stage || 'Reconstructing'} (${job.progress}%)`;
    if (hudStageDesc) hudStageDesc.textContent = job.message || '';

    if (state.viewer) {
      state.viewer.updateLiveFramingStage(job.stage, job.progress);
    }

    if (job.logs && job.logs.length > 0 && hudTerminalBody) {
      hudTerminalBody.innerHTML = '';
      job.logs.forEach(line => {
        const div = document.createElement('div');
        div.className = 'log-line';
        div.textContent = line;
        hudTerminalBody.appendChild(div);
      });
      hudTerminalBody.scrollTop = hudTerminalBody.scrollHeight;
    }
  }

  function appendTerminalLog(msg) {
    if (hudTerminalBody) {
      const div = document.createElement('div');
      div.className = 'log-line';
      div.textContent = msg;
      hudTerminalBody.appendChild(div);
      hudTerminalBody.scrollTop = hudTerminalBody.scrollHeight;
    }
  }

  function startElapsedTimer() {
    state.startTime = Date.now();
    if (hudTimer) hudTimer.textContent = '00:00';
    if (state.elapsedTimer) clearInterval(state.elapsedTimer);
    state.elapsedTimer = setInterval(() => {
      const diffSec = Math.floor((Date.now() - state.startTime) / 1000);
      const mins = String(Math.floor(diffSec / 60)).padStart(2, '0');
      const secs = String(diffSec % 60).padStart(2, '0');
      if (hudTimer) hudTimer.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function stopElapsedTimer() {
    if (state.elapsedTimer) {
      clearInterval(state.elapsedTimer);
      state.elapsedTimer = null;
    }
  }

  async function handleCancelJob() {
    if (!state.currentJobId) return;
    if (confirm('Cancel the active 3D reconstruction mission?')) {
      try {
        await API.cancelJob(state.currentJobId);
        clearInterval(state.pollTimer);
        stopElapsedTimer();
        if (livePipelineHud) livePipelineHud.classList.add('hidden');
        state.viewer.clearLiveFraming();
        showView('upload-section');
      } catch (err) {
        alert(`Error cancelling mission: ${err.message}`);
      }
    }
  }

  if (hudCancelBtn) hudCancelBtn.addEventListener('click', handleCancelJob);

  if (hudToggleLogsBtn && hudLogsDrawer) {
    hudToggleLogsBtn.addEventListener('click', () => {
      hudLogsDrawer.classList.toggle('hidden');
    });
  }
  if (hudCloseLogsBtn && hudLogsDrawer) {
    hudCloseLogsBtn.addEventListener('click', () => {
      hudLogsDrawer.classList.add('hidden');
    });
  }

  function showView(viewId) {
    [homeSection, uploadSection, viewerSection].forEach(section => {
      if (section) section.classList.remove('active');
    });
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');

    if (navBtnHome) navBtnHome.classList.toggle('active', viewId === 'home-section');
    if (navBtnCreate) navBtnCreate.classList.toggle('active', viewId === 'upload-section');
    if (navBtnViewer) navBtnViewer.classList.toggle('active', viewId === 'viewer-section');

    if (viewId === 'viewer-section' && state.viewer) {
      setTimeout(() => state.viewer.onResize(), 60);
    }
  }

  const DEFAULT_DEMO_MODEL = '/storage/jobs/7114097e-963c-4074-b651-5a626794aac2/outputs/scene.glb';

  async function loadDemoModel(modelUrl, title = 'Tactical UAV Survey Alpha', badgeText = 'UAV Flight Stream • 16 Keyframes') {
    showView('viewer-section');
    if (viewerHeaderTitle) viewerHeaderTitle.textContent = title;
    const statsBadge = document.getElementById('viewer-stats-badge');
    if (statsBadge && badgeText) statsBadge.textContent = badgeText;
    if (demoModelSelect) demoModelSelect.value = modelUrl;

    try {
      await state.viewer.loadModel(modelUrl, null, 'glb');
    } catch (err) {
      console.warn('Failed to load demo model:', err);
    }
  }

  if (navBtnHome) {
    navBtnHome.addEventListener('click', () => showView('home-section'));
  }
  if (navBtnCreate) {
    navBtnCreate.addEventListener('click', () => showView('upload-section'));
  }
  if (navBtnViewer) {
    navBtnViewer.addEventListener('click', () => {
      showView('viewer-section');
      if (!state.viewer.currentModel) {
        loadDemoModel(DEFAULT_DEMO_MODEL, 'Tactical UAV Survey Alpha', 'UAV Flight Stream • 16 Keyframes');
      }
    });
  }
  if (brandHomeLink) {
    brandHomeLink.addEventListener('click', (e) => {
      e.preventDefault();
      showView('home-section');
    });
  }
  if (backToHomeBtn) {
    backToHomeBtn.addEventListener('click', () => showView('home-section'));
  }

  if (heroBtnExplore) {
    heroBtnExplore.addEventListener('click', () => {
      loadDemoModel(DEFAULT_DEMO_MODEL, 'Tactical UAV Survey Alpha', 'UAV Flight Stream • 16 Keyframes');
    });
  }
  if (heroBtnUpload) {
    heroBtnUpload.addEventListener('click', () => showView('upload-section'));
  }
  if (bottomBtnUpload) {
    bottomBtnUpload.addEventListener('click', () => showView('upload-section'));
  }
  if (bottomBtnExplore) {
    bottomBtnExplore.addEventListener('click', () => {
      loadDemoModel(DEFAULT_DEMO_MODEL, 'Tactical UAV Survey Alpha', 'UAV Flight Stream • 16 Keyframes');
    });
  }

  document.querySelectorAll('.showcase-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const modelUrl = card.dataset.model;
      const title = card.dataset.title || 'Geospatial 3D Model';
      const badge = card.dataset.badge || 'Calibrated UAV Stream';
      if (modelUrl) {
        loadDemoModel(modelUrl, title, badge);
      }
    });
  });

  document.querySelectorAll('.photo-frame').forEach((frame, idx) => {
    frame.addEventListener('click', () => {
      const label = frame.getAttribute('data-label') || 'Neural 3D Reconstruction';

      const demoModels = [
        { url: '/storage/jobs/7114097e-963c-4074-b651-5a626794aac2/outputs/scene.glb', title: 'Tactical UAV Survey Alpha' },
        { url: '/storage/jobs/1871f0ea-0247-4629-9670-d794e8b28980/outputs/scene.glb', title: 'Infrastructure & Facade Mapping' },
        { url: '/storage/jobs/897771e6-d3e4-41f8-a064-798a974e470c/outputs/scene.glb', title: 'Aerial Terrain & Topography' },
        { url: '/storage/jobs/7114097e-963c-4074-b651-5a626794aac2/outputs/scene.glb', title: 'Spatial Digital Twin' }
      ];
      const target = demoModels[idx % demoModels.length];
      loadDemoModel(target.url, target.title, `${label} • Calibrated 3D`);
    });
  });

  if (demoModelSelect) {
    demoModelSelect.addEventListener('change', (e) => {
      const selectedUrl = e.target.value;
      const selectedOption = e.target.options[e.target.selectedIndex];
      const title = selectedOption ? selectedOption.text : '3D Reconstruction';
      if (selectedUrl) {
        loadDemoModel(selectedUrl, title, 'Calibrated UAV Stream');
      }
    });
  }

  const precisionFilterSelect = document.getElementById('precision-filter-select');

  async function onJobCompleted(job) {
    if (livePipelineHud) livePipelineHud.classList.add('hidden');
    if (viewerHeaderTitle) viewerHeaderTitle.textContent = '3D Scene Reconstructed';

    showView('viewer-section');
    state.viewer.onResize();

    const glbUrl = job.output_files && job.output_files.glb
      ? job.output_files.glb
      : `/storage/jobs/${job.job_id}/outputs/scene.glb`;

    if (precisionFilterSelect) {
      precisionFilterSelect.value = 'scene.glb';
    }

    try {
      await state.viewer.loadModel(glbUrl);
    } catch (err) {
      alert(`Error loading GLB into 3D viewer: ${err.message}`);
    }
  }

  if (precisionFilterSelect) {
    precisionFilterSelect.addEventListener('change', async (e) => {
      if (!state.currentJobId) return;
      const targetFilename = e.target.value || 'scene.glb';
      const targetUrl = `/storage/jobs/${state.currentJobId}/outputs/${targetFilename}`;

      try {
        await state.viewer.loadModel(targetUrl, null, 'glb');
        if (viewGlbBtn && viewPlyBtn) {
          viewGlbBtn.classList.add('active');
          viewPlyBtn.classList.remove('active');
        }
      } catch (err) {
        console.error('Failed to load precision model:', err);
      }
    });
  }

  if (btnResetCam) btnResetCam.addEventListener('click', () => { if (state.viewer) state.viewer.resetCamera(); });

  if (btnAutoRotate) btnAutoRotate.addEventListener('click', () => {
    if (!state.viewer) return;
    const isRotating = state.viewer.toggleAutoRotate();
    btnAutoRotate.classList.toggle('active', isRotating);
  });

  if (document.getElementById('btn-toggle-grid')) {
    document.getElementById('btn-toggle-grid').addEventListener('click', () => {
      const isVisible = state.viewer.toggleGrid();
      document.getElementById('btn-toggle-grid').classList.toggle('active', isVisible);
    });
  }

  if (document.getElementById('btn-point-style')) {
    document.getElementById('btn-point-style').addEventListener('click', () => {
      const newStyle = state.viewer.togglePointStyle();
      const lbl = document.getElementById('point-style-label');
      if (lbl) lbl.textContent = newStyle === 'smooth' ? 'Splats' : 'Points';
      document.getElementById('btn-point-style').classList.toggle('active', newStyle === 'smooth');
    });
  }

  if (document.getElementById('btn-toggle-bg')) {
    document.getElementById('btn-toggle-bg').addEventListener('click', () => {
      state.viewer.toggleBackground();
    });
  }

  if (document.getElementById('btn-toggle-cams')) {
    document.getElementById('btn-toggle-cams').addEventListener('click', () => {
      const isVisible = state.viewer.toggleCameraFrustums();
      document.getElementById('btn-toggle-cams').classList.toggle('active', isVisible);
    });
  }

  const downloadMenuBtn = document.getElementById('download-menu-btn');
  const downloadMenuWrap = downloadMenuBtn ? downloadMenuBtn.closest('.download-menu-wrap') : null;
  if (downloadMenuBtn && downloadMenuWrap) {
    downloadMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadMenuWrap.classList.toggle('open');
    });
    document.addEventListener('click', () => downloadMenuWrap.classList.remove('open'));
  }

  if (measureToolBtn) {
    measureToolBtn.addEventListener('click', () => {
      state.viewer.toggleMeasurementTool();
    });
  }

  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => state.viewer.toggleFullscreen());
  }

  if (snapshotBtn) {
    snapshotBtn.addEventListener('click', () => state.viewer.captureScreenshot());
  }

  // pointSizeSlider may not exist in the HTML (controls are in ctrl-point-size instead)
  if (pointSizeSlider) {
    pointSizeSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value).toFixed(1);
      if (pointSizeVal) pointSizeVal.textContent = `${val}x`;
      if (state.viewer) state.viewer.updatePointSize(val);
    });
  }

  if (viewGlbBtn && viewPlyBtn) {
    viewGlbBtn.addEventListener('click', async () => {
      if (!state.currentJobId) return;
      viewGlbBtn.classList.add('active');
      viewPlyBtn.classList.remove('active');
      const glbUrl = API.getDownloadUrl(state.currentJobId, 'glb');
      try {
        await state.viewer.loadModel(glbUrl, null, 'glb');
      } catch (err) {
        console.error('Failed to load GLB:', err);
      }
    });

    viewPlyBtn.addEventListener('click', async () => {
      if (!state.currentJobId) return;
      viewPlyBtn.classList.add('active');
      viewGlbBtn.classList.remove('active');
      const plyUrl = API.getDownloadUrl(state.currentJobId, 'ply');
      try {
        await state.viewer.loadModel(plyUrl, null, 'ply');
      } catch (err) {
        console.error('Failed to load PLY:', err);
      }
    });
  }

  if (downloadGlbBtn) {
    downloadGlbBtn.addEventListener('click', () => {
      if (state.currentJobId) {
        window.location.href = API.getDownloadUrl(state.currentJobId, 'glb');
      }
    });
  }

  if (downloadStlBtn) {
    downloadStlBtn.addEventListener('click', () => {
      if (state.currentJobId) {
        window.location.href = API.getDownloadUrl(state.currentJobId, 'stl');
      }
    });
  }

  if (downloadObjBtn) {
    downloadObjBtn.addEventListener('click', () => {
      if (state.currentJobId) {
        window.location.href = API.getDownloadUrl(state.currentJobId, 'obj');
      }
    });
  }

  if (downloadPlyBtn) {
    downloadPlyBtn.addEventListener('click', () => {
      if (state.currentJobId) {
        window.location.href = API.getDownloadUrl(state.currentJobId, 'ply');
      }
    });
  }

  if (btnToggleMesh) {
    btnToggleMesh.addEventListener('click', async () => {
      if (!state.viewer) return;
      const isPoints = await state.viewer.toggleMeshMode(state.currentJobId);
      btnToggleMesh.classList.toggle('active', isPoints);
      if (meshStyleLabel) {
        meshStyleLabel.textContent = isPoints ? 'Points' : 'Solid';
      }
    });
  }

  if (newReconBtn) {
    newReconBtn.addEventListener('click', () => {
      state.files = [];
      state.currentJobId = null;
      updateGalleryUI();
      showView('upload-section');
    });
  }

  /* ── Scene Controls Panel ──────────────────────────────────── */
  const sceneCtrlToggle  = document.getElementById('scene-controls-toggle');
  const sceneCtrlBody    = document.getElementById('scene-controls-body');
  const sceneCtrlArrow   = document.getElementById('scene-ctrl-arrow');
  const ctrlPointSize    = document.getElementById('ctrl-point-size');
  const ctrlPointSizeVal = document.getElementById('ctrl-point-size-val');
  const ctrlBrightness   = document.getElementById('ctrl-brightness');
  const ctrlBrightnessVal= document.getElementById('ctrl-brightness-val');
  const ctrlWireframeBtn = document.getElementById('ctrl-wireframe-btn');
  const ctrlWireframeLbl = document.getElementById('ctrl-wireframe-label');

  // Collapse / expand toggle
  let sceneCtrlOpen = true;
  if (sceneCtrlToggle && sceneCtrlBody) {
    sceneCtrlToggle.addEventListener('click', () => {
      sceneCtrlOpen = !sceneCtrlOpen;
      sceneCtrlBody.classList.toggle('collapsed', !sceneCtrlOpen);
      if (sceneCtrlArrow) {
        sceneCtrlArrow.style.transform = sceneCtrlOpen ? '' : 'rotate(180deg)';
      }
    });
  }

  // Point size slider
  if (ctrlPointSize) {
    ctrlPointSize.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value).toFixed(1);
      if (ctrlPointSizeVal) ctrlPointSizeVal.textContent = `${val}×`;
      if (state.viewer) state.viewer.updatePointSize(val);
    });
  }

  // Brightness slider
  if (ctrlBrightness) {
    ctrlBrightness.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value).toFixed(1);
      if (ctrlBrightnessVal) {
        ctrlBrightnessVal.textContent = `${val}×`;
        ctrlBrightnessVal.classList.toggle('amber', true);
      }
      if (state.viewer) state.viewer.setBrightness(parseFloat(val));
    });
  }

  // Wireframe toggle
  let wireframeOn = false;
  if (ctrlWireframeBtn) {
    ctrlWireframeBtn.addEventListener('click', () => {
      wireframeOn = !wireframeOn;
      if (state.viewer) state.viewer.setWireframe(wireframeOn);
      ctrlWireframeBtn.classList.toggle('active', wireframeOn);
      if (ctrlWireframeLbl) ctrlWireframeLbl.textContent = wireframeOn ? 'Wireframe: On' : 'Wireframe: Off';
    });
  }
  /* ─────────────────────────────────────────────────────────── */
});
