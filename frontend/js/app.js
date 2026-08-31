/**
 * Main Frontend Application Orchestrator
 */
document.addEventListener('DOMContentLoaded', () => {
  // State
  const state = {
    files: [], // Array of File objects
    currentJobId: null,
    pollTimer: null,
    elapsedTimer: null,
    startTime: null,
    viewer: null
  };

  // DOM Elements
  const statusPill = document.getElementById('system-status-pill');
  const statusPillText = document.getElementById('status-pill-text');

  // Views
  const uploadSection = document.getElementById('upload-section');
  const processingSection = document.getElementById('processing-section');
  const viewerSection = document.getElementById('viewer-section');

  // Upload Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const browseBtn = document.getElementById('browse-btn');
  const galleryContainer = document.getElementById('gallery-container');
  const imageGrid = document.getElementById('image-grid');
  const imageCountNum = document.getElementById('image-count-num');
  const imageCountAdvice = document.getElementById('image-count-advice');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const generateBtn = document.getElementById('generate-btn');

  // Settings Elements
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsContent = document.getElementById('settings-content');
  const cfgImageSize = document.getElementById('cfg-image-size');
  const cfgIterations = document.getElementById('cfg-iterations');
  const iterVal = document.getElementById('iter-val');
  const cfgMode = document.getElementById('cfg-mode');
  const cfgDevice = document.getElementById('cfg-device');

  // Processing Elements
  const processingStageText = document.getElementById('processing-stage-text');
  const processingMsgText = document.getElementById('processing-msg-text');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressPercent = document.getElementById('progress-percent');
  const processingTimer = document.getElementById('processing-timer');
  const terminalLogs = document.getElementById('terminal-logs');
  const cancelJobBtn = document.getElementById('cancel-job-btn');

  // Nav & Header Elements
  const navBtnCreate = document.getElementById('nav-btn-create');
  const navBtnViewer = document.getElementById('nav-btn-viewer');
  const brandHomeLink = document.getElementById('brand-home-link');

  // Viewer Elements
  const downloadGlbBtn = document.getElementById('download-glb-btn');
  const downloadPlyBtn = document.getElementById('download-ply-btn');
  const viewGlbBtn = document.getElementById('view-glb-btn');
  const viewPlyBtn = document.getElementById('view-ply-btn');
  const snapshotBtn = document.getElementById('snapshot-btn');
  const newReconBtn = document.getElementById('new-recon-btn');
  const btnResetCam = document.getElementById('btn-reset-cam');
  const btnAutoRotate = document.getElementById('btn-auto-rotate');
  const btnToggleGrid = document.getElementById('btn-toggle-grid');
  const btnPointStyle = document.getElementById('btn-point-style');
  const pointStyleLabel = document.getElementById('point-style-label');
  const btnToggleBg = document.getElementById('btn-toggle-bg');
  const btnToggleCams = document.getElementById('btn-toggle-cams');
  const btnFullscreen = document.getElementById('btn-fullscreen');
  const pointSizeSlider = document.getElementById('point-size-slider');
  const pointSizeVal = document.getElementById('point-size-val');

  // Initialize Viewer
  state.viewer = new ModelViewer('three-canvas-container');

  // --- Initial System Health Check ---
  async function checkSystemHealth() {
    try {
      const data = await API.checkHealth();
      const env = data.environment;
      if (env.is_ready) {
        statusPill.className = 'status-pill status-ready';
        statusPillText.textContent = `${env.device} • MUSt3R 512`;
      } else {
        statusPill.className = 'status-pill status-error';
        statusPillText.textContent = 'MUSt3R Warning (Check Logs)';
      }
    } catch (err) {
      statusPill.className = 'status-pill status-error';
      statusPillText.textContent = 'Backend Offline';
      console.error('System health check error:', err);
    }
  }
  checkSystemHealth();

  // --- Event Listeners: Upload & Drag-Drop ---
  browseBtn.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', (e) => {
    if (e.target !== browseBtn) fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    handleFilesAdded(Array.from(e.target.files));
    fileInput.value = ''; // Reset input to allow selecting same files
  });

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
    const dt = e.dataTransfer;
    if (dt && dt.files) {
      handleFilesAdded(Array.from(dt.files));
    }
  });

  function handleFilesAdded(newFiles) {
    const validExts = ['.jpg', '.jpeg', '.png', '.webp'];
    const filtered = newFiles.filter(file => {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const isImg = file.type.startsWith('image/') || validExts.includes(ext);
      // Avoid duplicate file names with same size
      const isDuplicate = state.files.some(f => f.name === file.name && f.size === file.size);
      return isImg && !isDuplicate;
    });

    if (filtered.length === 0) return;

    state.files.push(...filtered);
    updateGalleryUI();
  }

  function removeFile(index) {
    state.files.splice(index, 1);
    updateGalleryUI();
  }

  clearAllBtn.addEventListener('click', () => {
    state.files = [];
    updateGalleryUI();
  });

  function updateGalleryUI() {
    const count = state.files.length;
    imageCountNum.textContent = count;

    if (count > 0) {
      galleryContainer.classList.remove('hidden');
      generateBtn.disabled = count < 2;

      // Update advice indicator
      if (count < 10) {
        imageCountAdvice.textContent = `(Recommend 20–40 for best 3D detail • Need at least 2)`;
        imageCountAdvice.style.color = 'var(--accent-amber)';
      } else if (count >= 20 && count <= 50) {
        imageCountAdvice.textContent = `(Optimal photograph count)`;
        imageCountAdvice.style.color = 'var(--accent-green)';
      } else {
        imageCountAdvice.textContent = `(Recommend 20–40)`;
        imageCountAdvice.style.color = 'var(--text-muted)';
      }

      // Render thumbnails
      imageGrid.innerHTML = '';
      state.files.forEach((file, idx) => {
        const card = document.createElement('div');
        card.className = 'thumbnail-card';

        const img = document.createElement('img');
        img.className = 'thumbnail-img';
        img.src = URL.createObjectURL(file);
        img.alt = file.name;

        const overlay = document.createElement('div');
        overlay.className = 'thumbnail-overlay';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'thumb-delete-btn';
        delBtn.title = 'Remove photo';
        delBtn.innerHTML = '&times;';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeFile(idx);
        });

        overlay.appendChild(delBtn);

        const meta = document.createElement('div');
        meta.className = 'thumb-meta';
        const kbSize = Math.round(file.size / 1024);
        meta.textContent = `${file.name} (${kbSize} KB)`;

        card.appendChild(img);
        card.appendChild(overlay);
        card.appendChild(meta);
        imageGrid.appendChild(card);
      });
    } else {
      galleryContainer.classList.add('hidden');
      generateBtn.disabled = true;
      imageGrid.innerHTML = '';
    }
  }

  // --- Settings Panel ---
  settingsToggle.addEventListener('click', () => {
    const isCollapsed = settingsContent.classList.toggle('collapsed');
    settingsToggle.setAttribute('aria-expanded', !isCollapsed);
    const arrow = settingsToggle.querySelector('.toggle-arrow');
    if (arrow) arrow.textContent = isCollapsed ? '▾' : '▴';
  });

  cfgIterations.addEventListener('input', (e) => {
    iterVal.textContent = e.target.value;
  });



  // --- Generation / Reconstruction Trigger ---
  generateBtn.addEventListener('click', async () => {
    if (state.files.length < 2) return;

    const config = {
      image_size: parseInt(cfgImageSize.value, 10),
      device: cfgDevice.value,
      max_bs: 1,
      num_refinements_iterations: parseInt(cfgIterations.value, 10),
      execution_mode: cfgMode.value,
      cam_size: 0.05
    };

    // Reset processing view UI
    progressBarFill.style.width = '5%';
    progressPercent.textContent = '5%';
    processingStageText.textContent = 'Uploading Images...';
    processingMsgText.textContent = `Transmitting ${state.files.length} images to local server...`;
    terminalLogs.innerHTML = '<div class="log-line info">[System] Starting upload sequence...</div>';
    resetSteppers();
    setStepperActive(1);

    showView('processing-section');
    startElapsedTimer();

    try {
      const res = await API.createJob(state.files, config);
      state.currentJobId = res.job_id;
      appendTerminalLog(`[Job] Created job ID: ${res.job_id}`);
      startPolling(res.job_id);
    } catch (err) {
      stopElapsedTimer();
      alert(`Error starting reconstruction: ${err.message}`);
      showView('upload-section');
    }
  });

  // --- Polling & Progress Updates ---
  function startPolling(jobId) {
    if (state.pollTimer) clearInterval(state.pollTimer);

    state.pollTimer = setInterval(async () => {
      try {
        const job = await API.getJobStatus(jobId);
        updateJobProgressUI(job);

        if (job.status === 'completed') {
          clearInterval(state.pollTimer);
          stopElapsedTimer();
          setTimeout(() => onJobCompleted(job), 800);
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          clearInterval(state.pollTimer);
          stopElapsedTimer();
          alert(`Reconstruction ${job.status}: ${job.error || job.message}`);
          showView('upload-section');
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1200);
  }

  function updateJobProgressUI(job) {
    progressBarFill.style.width = `${job.progress}%`;
    progressPercent.textContent = `${job.progress}%`;
    processingStageText.textContent = job.stage || 'Processing...';
    processingMsgText.textContent = job.message || '';

    // Update steppers
    if (job.progress < 25) {
      setStepperActive(1);
    } else if (job.progress < 60) {
      setStepperActive(2);
    } else if (job.progress < 90) {
      setStepperActive(3);
    } else {
      setStepperActive(4);
    }

    // Update terminal logs
    if (job.logs && job.logs.length > 0) {
      terminalLogs.innerHTML = '';
      job.logs.forEach(line => {
        const div = document.createElement('div');
        div.className = 'log-line';
        div.textContent = line;
        terminalLogs.appendChild(div);
      });
      terminalLogs.scrollTop = terminalLogs.scrollHeight;
    }
  }

  function appendTerminalLog(msg) {
    const div = document.createElement('div');
    div.className = 'log-line';
    div.textContent = msg;
    terminalLogs.appendChild(div);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  function resetSteppers() {
    for (let i = 1; i <= 4; i++) {
      const step = document.getElementById(`step-${i}`);
      if (step) step.className = 'step-item';
    }
  }

  function setStepperActive(activeNum) {
    for (let i = 1; i <= 4; i++) {
      const step = document.getElementById(`step-${i}`);
      if (!step) continue;
      if (i < activeNum) {
        step.className = 'step-item completed';
      } else if (i === activeNum) {
        step.className = 'step-item active';
      } else {
        step.className = 'step-item';
      }
    }
  }

  // --- Timer ---
  function startElapsedTimer() {
    state.startTime = Date.now();
    processingTimer.textContent = 'Elapsed: 00:00';
    if (state.elapsedTimer) clearInterval(state.elapsedTimer);
    state.elapsedTimer = setInterval(() => {
      const diffSec = Math.floor((Date.now() - state.startTime) / 1000);
      const mins = String(Math.floor(diffSec / 60)).padStart(2, '0');
      const secs = String(diffSec % 60).padStart(2, '0');
      processingTimer.textContent = `Elapsed: ${mins}:${secs}`;
    }, 1000);
  }

  function stopElapsedTimer() {
    if (state.elapsedTimer) {
      clearInterval(state.elapsedTimer);
      state.elapsedTimer = null;
    }
  }

  // --- Cancel Job ---
  cancelJobBtn.addEventListener('click', async () => {
    if (!state.currentJobId) return;
    if (confirm('Are you sure you want to cancel the reconstruction?')) {
      try {
        await API.cancelJob(state.currentJobId);
        clearInterval(state.pollTimer);
        stopElapsedTimer();
        showView('upload-section');
      } catch (err) {
        alert(`Error cancelling job: ${err.message}`);
      }
    }
  });

  function showView(viewId) {
    [uploadSection, processingSection, viewerSection].forEach(section => {
      if (section) section.classList.remove('active');
    });
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');

    if (navBtnCreate && navBtnViewer) {
      if (viewId === 'viewer-section') {
        navBtnCreate.classList.remove('active');
        navBtnViewer.classList.add('active');
        navBtnViewer.disabled = false;
      } else {
        navBtnCreate.classList.add('active');
        navBtnViewer.classList.remove('active');
      }
    }
  }

  if (navBtnCreate) {
    navBtnCreate.addEventListener('click', () => showView('upload-section'));
  }
  if (navBtnViewer) {
    navBtnViewer.addEventListener('click', () => {
      if (!navBtnViewer.disabled) {
        showView('viewer-section');
        state.viewer.onResize();
      }
    });
  }
  if (brandHomeLink) {
    brandHomeLink.addEventListener('click', (e) => {
      e.preventDefault();
      showView('upload-section');
    });
  }

  // --- On Job Completed ---
  async function onJobCompleted(job) {
    showView('viewer-section');
    state.viewer.onResize();

    // Load GLB model
    const glbUrl = job.output_files && job.output_files.glb 
      ? job.output_files.glb 
      : `/storage/jobs/${job.job_id}/outputs/scene.glb`;

    try {
      await state.viewer.loadModel(glbUrl);
    } catch (err) {
      alert(`Error loading GLB into 3D viewer: ${err.message}`);
    }
  }

  // --- 3D Viewer Toolbar Handlers ---
  btnResetCam.addEventListener('click', () => state.viewer.resetCamera());

  btnAutoRotate.addEventListener('click', () => {
    const isRotating = state.viewer.toggleAutoRotate();
    btnAutoRotate.classList.toggle('active', isRotating);
  });

  btnToggleGrid.addEventListener('click', () => {
    const isVisible = state.viewer.toggleGrid();
    btnToggleGrid.classList.toggle('active', isVisible);
  });

  btnPointStyle.addEventListener('click', () => {
    const newStyle = state.viewer.togglePointStyle();
    pointStyleLabel.textContent = newStyle === 'smooth' ? 'Splats' : 'Points';
    btnPointStyle.classList.toggle('active', newStyle === 'smooth');
  });

  btnToggleBg.addEventListener('click', () => {
    state.viewer.toggleBackground();
  });

  btnToggleCams.addEventListener('click', () => {
    const isVisible = state.viewer.toggleCameraFrustums();
    btnToggleCams.classList.toggle('active', isVisible);
  });

  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => state.viewer.toggleFullscreen());
  }

  if (snapshotBtn) {
    snapshotBtn.addEventListener('click', () => state.viewer.captureScreenshot());
  }

  pointSizeSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value).toFixed(1);
    if (pointSizeVal) pointSizeVal.textContent = `${val}x`;
    state.viewer.updatePointSize(val);
  });

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

  downloadGlbBtn.addEventListener('click', () => {
    if (state.currentJobId) {
      window.location.href = API.getDownloadUrl(state.currentJobId, 'glb');
    }
  });

  downloadPlyBtn.addEventListener('click', () => {
    if (state.currentJobId) {
      window.location.href = API.getDownloadUrl(state.currentJobId, 'ply');
    }
  });

  newReconBtn.addEventListener('click', () => {
    state.files = [];
    state.currentJobId = null;
    updateGalleryUI();
    showView('upload-section');
  });
});
