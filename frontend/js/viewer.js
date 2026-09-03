

class ModelViewer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.gridGroup = null;
    this.currentModel = null;
    this.liveFramingGroup = null;
    this.hologramCore = null;
    this.ambientParticles = null;
    this.flightSplineCurve = null;
    this.flightTracerMesh = null;
    this.groundRadarRing = null;
    this.initialCameraState = null;
    this.sceneBoundingRadius = 1.5;
    this.clock = new THREE.Clock();

    this.isMeasuring = false;
    this.measurePoints = [];
    this.measureGroup = new THREE.Group();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.pointSize = 1.0;
    this.pointStyle = 'smooth';
    this.showCameraFrustums = false;
    this.isAutoRotating = false;
    this.currentThemeIndex = 0;
    this.themes = [
      { name: 'Tactical Cyan', bg: 0x06080D, grid1: 0x00E5FF, grid2: 0x151D29, ring: 0x00E5FF },
      { name: 'Deep Blue', bg: 0x06080D, grid1: 0x4D7CFE, grid2: 0x0D1119, ring: 0x4D7CFE },
      { name: 'Amber Ops', bg: 0x06080D, grid1: 0xF6C453, grid2: 0x151D29, ring: 0xF6C453 },
      { name: 'Matrix Green', bg: 0x06080D, grid1: 0x20D3A2, grid2: 0x0D1119, ring: 0x20D3A2 }
    ];

    this.circleTexture = this._createCircleTexture();
    this.cardBorderTexture = this._createCardBorderTexture();

    this._pointObjects = [];
    this._objectUrlsToRevoke = [];

    this.init();
  }

  _createCircleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.85, 'rgba(255, 255, 255, 0.35)');
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = true;
    return texture;
  }

  _createCardBorderTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.strokeStyle = 'rgba(0, 229, 255, 0.9)';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 120, 120);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;

    ctx.beginPath();
    ctx.moveTo(4, 20); ctx.lineTo(4, 4); ctx.lineTo(20, 4);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(108, 4); ctx.lineTo(124, 4); ctx.lineTo(124, 20);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(4, 108); ctx.lineTo(4, 124); ctx.lineTo(20, 124);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(108, 124); ctx.lineTo(124, 124); ctx.lineTo(124, 108);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  init() {
    if (!this.container) return;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.themes[0].bg);
    this.scene.fog = new THREE.FogExp2(this.themes[0].bg, 0.025);
    this.scene.add(this.measureGroup);

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
    this.camera.position.set(0, 2.2, 4.6);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 500;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 1.4;

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.3);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff3db, 1.4);
    keyLight.position.set(6, 14, 8);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x7dd3fc, 0.8);
    fillLight.position.set(-8, 6, -6);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x00E5FF, 0.7);
    rimLight.position.set(0, -10, 2);
    this.scene.add(rimLight);

    this._buildGeospatialGrid();

    this._buildAmbientParticles();

    this.renderer.domElement.addEventListener('pointerdown', (e) => this._onPointerDown(e));

    window.addEventListener('resize', () => this.onResize());

    this.animate();
  }

  _buildGeospatialGrid() {
    if (this.gridGroup) {
      this.scene.remove(this.gridGroup);
    }

    this.gridGroup = new THREE.Group();
    this.gridGroup.position.y = -0.65;

    const gridHelper = new THREE.GridHelper(12, 32, this.themes[0].grid1, this.themes[0].grid2);
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.55;
    this.gridGroup.add(gridHelper);

    const ringRadii = [1.2, 2.4, 3.8, 5.2];
    ringRadii.forEach((r, idx) => {
      const ringGeom = new THREE.RingGeometry(r - 0.008, r + 0.008, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: this.themes[0].grid1,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: idx === 1 ? 0.45 : 0.2
      });
      const ringMesh = new THREE.Mesh(ringGeom, ringMat);
      ringMesh.rotation.x = Math.PI / 2;
      this.gridGroup.add(ringMesh);
    });

    const sweepGeom = new THREE.CircleGeometry(4.0, 32, 0, Math.PI / 3);
    const sweepMat = new THREE.MeshBasicMaterial({
      color: this.themes[0].ring,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.08
    });
    this.groundRadarRing = new THREE.Mesh(sweepGeom, sweepMat);
    this.groundRadarRing.rotation.x = Math.PI / 2;
    this.gridGroup.add(this.groundRadarRing);

    this.scene.add(this.gridGroup);
  }

  _buildAmbientParticles() {
    const particleCount = 140;
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 12;
      positions[i + 1] = Math.random() * 4 - 0.5;
      positions[i + 2] = (Math.random() - 0.5) * 12;
    }

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.035,
      map: this.circleTexture,
      transparent: true,
      opacity: 0.4,
      color: 0x00E5FF,
      depthWrite: false
    });

    this.ambientParticles = new THREE.Points(geom, mat);
    this.scene.add(this.ambientParticles);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const elapsedTime = this.clock.getElapsedTime();

    if (this.hologramCore) {
      if (this.hologramCore.ring1) this.hologramCore.ring1.rotation.y = elapsedTime * 0.8;
      if (this.hologramCore.ring2) this.hologramCore.ring2.rotation.x = elapsedTime * 0.6;
      if (this.hologramCore.ring3) this.hologramCore.ring3.rotation.z = elapsedTime * 0.5;
      if (this.hologramCore.core) {
        this.hologramCore.core.rotation.y = elapsedTime * 1.2;
        this.hologramCore.core.rotation.x = elapsedTime * 0.7;
        const scale = 1.0 + Math.sin(elapsedTime * 3.0) * 0.08;
        this.hologramCore.core.scale.set(scale, scale, scale);
      }
    }

    if (this.groundRadarRing) {
      this.groundRadarRing.rotation.z = elapsedTime * 0.6;
    }

    if (this.flightSplineCurve && this.flightTracerMesh) {
      const t = (elapsedTime * 0.12) % 1.0;
      const pt = this.flightSplineCurve.getPointAt(t);
      if (pt) {
        this.flightTracerMesh.position.copy(pt);
      }
    }

    if (this.ambientParticles) {
      this.ambientParticles.rotation.y = elapsedTime * 0.02;
    }

    if (this.controls) {
      this.controls.update();
    }
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  onResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  toggleMeasurementTool() {
    this.isMeasuring = !this.isMeasuring;
    this.measurePoints = [];
    this._clearMeasurement();

    const readoutHud = document.getElementById('measure-readout-hud');
    const measureBtn = document.getElementById('measure-tool-btn');
    const measureBtnText = document.getElementById('measure-btn-text');

    if (this.isMeasuring) {
      if (readoutHud) readoutHud.classList.remove('hidden');
      if (measureBtn) measureBtn.classList.add('active');
      if (measureBtnText) measureBtnText.textContent = 'Measuring...';
      this.renderer.domElement.style.cursor = 'crosshair';
    } else {
      if (readoutHud) readoutHud.classList.add('hidden');
      if (measureBtn) measureBtn.classList.remove('active');
      if (measureBtnText) measureBtnText.textContent = 'Ruler (Measure)';
      this.renderer.domElement.style.cursor = 'default';
    }

    return this.isMeasuring;
  }

  _onPointerDown(e) {
    if (!this.isMeasuring) return;
    if (e.button !== 0) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const objectsToIntersect = [];
    if (this.currentModel) objectsToIntersect.push(this.currentModel);
    if (this.gridGroup) objectsToIntersect.push(this.gridGroup);

    const intersects = this.raycaster.intersectObjects(objectsToIntersect, true);

    if (intersects.length > 0) {
      const hitPoint = intersects[0].point;
      this._addMeasurementPoint(hitPoint);
    }
  }

  _addMeasurementPoint(point) {
    if (this.measurePoints.length >= 2) {
      this._clearMeasurement();
      this.measurePoints = [];
    }

    this.measurePoints.push(point);

    const markerGroup = new THREE.Group();
    markerGroup.position.copy(point);

    const dotGeom = new THREE.SphereGeometry(0.04, 16, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x00E5FF });
    const dotMesh = new THREE.Mesh(dotGeom, dotMat);
    markerGroup.add(dotMesh);

    const ringGeom = new THREE.RingGeometry(0.07, 0.085, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide });
    const ringMesh = new THREE.Mesh(ringGeom, ringMat);
    markerGroup.add(ringMesh);

    this.measureGroup.add(markerGroup);

    const distVal = document.getElementById('measure-dist-val');
    const hintText = document.getElementById('measure-hint-text');

    if (this.measurePoints.length === 1) {
      if (hintText) hintText.textContent = 'Point 1 placed. Click target surface to measure 3D span.';
    } else if (this.measurePoints.length === 2) {
      const p1 = this.measurePoints[0];
      const p2 = this.measurePoints[1];

      const lineGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const lineMat = new THREE.LineDashedMaterial({
        color: 0xfacc15,
        dashSize: 0.08,
        gapSize: 0.04,
        linewidth: 3
      });
      const line = new THREE.Line(lineGeom, lineMat);
      line.computeLineDistances();
      this.measureGroup.add(line);

      const rawDistance = p1.distanceTo(p2);
      const metricScaleFactor = 5.0;
      const metricDistance = (rawDistance * metricScaleFactor).toFixed(2);
      const deltaHeight = (Math.abs(p2.y - p1.y) * metricScaleFactor).toFixed(2);

      if (distVal) distVal.textContent = `${metricDistance} m`;
      if (hintText) hintText.textContent = `ΔElevation (Height): ${deltaHeight} m • 3D Span: ${metricDistance} m`;
    }
  }

  _clearMeasurement() {
    while (this.measureGroup.children.length > 0) {
      const obj = this.measureGroup.children[0];
      this.measureGroup.remove(obj);
      if (obj.traverse) {
        obj.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }
    }
  }

  setupLiveFraming(files) {
    this.clearLiveFraming();

    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.currentModel = null;
    }
    this._pointObjects = [];

    this.liveFramingGroup = new THREE.Group();
    const count = Math.min(files.length, 36);
    const radius = 2.5;
    const textureLoader = new THREE.TextureLoader();

    const coreGroup = new THREE.Group();

    const tGeom1 = new THREE.TorusGeometry(0.55, 0.012, 16, 64);
    const tMat1 = new THREE.MeshBasicMaterial({ color: 0x00E5FF, transparent: true, opacity: 0.75 });
    const ring1 = new THREE.Mesh(tGeom1, tMat1);
    coreGroup.add(ring1);

    const tGeom2 = new THREE.TorusGeometry(0.42, 0.01, 16, 64);
    const tMat2 = new THREE.MeshBasicMaterial({ color: 0x4D7CFE, transparent: true, opacity: 0.65 });
    const ring2 = new THREE.Mesh(tGeom2, tMat2);
    ring2.rotation.x = Math.PI / 4;
    coreGroup.add(ring2);

    const octGeom = new THREE.OctahedronGeometry(0.24, 0);
    const octMat = new THREE.MeshStandardMaterial({
      color: 0x00E5FF,
      emissive: 0x4D7CFE,
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.85
    });
    const coreMesh = new THREE.Mesh(octGeom, octMat);
    coreGroup.add(coreMesh);

    const crossMat = new THREE.LineBasicMaterial({ color: 0x00E5FF, transparent: true, opacity: 0.35 });
    const crossPoints = [
      new THREE.Vector3(-0.8, 0, 0), new THREE.Vector3(0.8, 0, 0),
      new THREE.Vector3(0, -0.8, 0), new THREE.Vector3(0, 0.8, 0),
      new THREE.Vector3(0, 0, -0.8), new THREE.Vector3(0, 0, 0.8)
    ];
    const crossGeom = new THREE.BufferGeometry().setFromPoints(crossPoints);
    const crossLines = new THREE.LineSegments(crossGeom, crossMat);
    coreGroup.add(crossLines);

    this.hologramCore = {
      group: coreGroup,
      ring1: ring1,
      ring2: ring2,
      core: coreMesh
    };
    this.liveFramingGroup.add(coreGroup);

    const trajectoryPoints = [];

    for (let i = 0; i < count; i++) {
      const file = files[i];
      const angle = (i / count) * Math.PI * 2;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      const y = Math.sin(i * 0.9) * 0.38 + 0.15;

      const pos = new THREE.Vector3(x, y, z);
      trajectoryPoints.push(pos);

      const cardGroup = new THREE.Group();
      cardGroup.position.set(x, y, z);
      cardGroup.lookAt(0, 0, 0);

      const objUrl = URL.createObjectURL(file);
      this._objectUrlsToRevoke.push(objUrl);

      textureLoader.load(objUrl, (tex) => {
        tex.generateMipmaps = true;
        const aspect = tex.image.width / tex.image.height || 1.33;
        const w = 0.46;
        const h = w / aspect;

        const planeGeom = new THREE.PlaneGeometry(w, h);
        const planeMat = new THREE.MeshBasicMaterial({
          map: tex,
          side: THREE.DoubleSide
        });
        const planeMesh = new THREE.Mesh(planeGeom, planeMat);
        cardGroup.add(planeMesh);

        const borderGeom = new THREE.PlaneGeometry(w * 1.04, h * 1.04);
        const borderMat = new THREE.MeshBasicMaterial({
          color: 0x00E5FF,
          wireframe: true,
          transparent: true,
          opacity: 0.6
        });
        const borderMesh = new THREE.Mesh(borderGeom, borderMat);
        borderMesh.position.z = -0.001;
        cardGroup.add(borderMesh);

        const lensApex = new THREE.Vector3(0, 0, -0.25);
        const halfW = w / 2;
        const halfH = h / 2;
        const frustumPoints = [

          new THREE.Vector3(-halfW, -halfH, 0), lensApex,
          new THREE.Vector3(halfW, -halfH, 0), lensApex,
          new THREE.Vector3(halfW, halfH, 0), lensApex,
          new THREE.Vector3(-halfW, halfH, 0), lensApex
        ];
        const frustumGeom = new THREE.BufferGeometry().setFromPoints(frustumPoints);
        const frustumMat = new THREE.LineBasicMaterial({
          color: 0x00E5FF,
          transparent: true,
          opacity: 0.45
        });
        const frustumLines = new THREE.LineSegments(frustumGeom, frustumMat);
        cardGroup.add(frustumLines);

        const lensGeom = new THREE.SphereGeometry(0.02, 12, 12);
        const lensMat = new THREE.MeshBasicMaterial({ color: 0x4D7CFE });
        const lensMesh = new THREE.Mesh(lensGeom, lensMat);
        lensMesh.position.copy(lensApex);
        cardGroup.add(lensMesh);
      });

      const groundY = -0.65;
      const tetherPoints = [new THREE.Vector3(x, y, z), new THREE.Vector3(x, groundY, z)];
      const tetherGeom = new THREE.BufferGeometry().setFromPoints(tetherPoints);
      const tetherMat = new THREE.LineDashedMaterial({
        color: 0x00E5FF,
        dashSize: 0.05,
        gapSize: 0.04,
        transparent: true,
        opacity: 0.3
      });
      const tetherLine = new THREE.Line(tetherGeom, tetherMat);
      tetherLine.computeLineDistances();
      this.liveFramingGroup.add(tetherLine);

      const groundRingGeom = new THREE.RingGeometry(0.04, 0.06, 16);
      const groundRingMat = new THREE.MeshBasicMaterial({
        color: 0x00E5FF,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.4
      });
      const groundRing = new THREE.Mesh(groundRingGeom, groundRingMat);
      groundRing.position.set(x, groundY + 0.002, z);
      groundRing.rotation.x = Math.PI / 2;
      this.liveFramingGroup.add(groundRing);

      const centerRayPoints = [new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, 0)];
      const centerRayGeom = new THREE.BufferGeometry().setFromPoints(centerRayPoints);
      const centerRayMat = new THREE.LineBasicMaterial({
        color: 0x4D7CFE,
        transparent: true,
        opacity: 0.18
      });
      const centerRay = new THREE.Line(centerRayGeom, centerRayMat);
      this.liveFramingGroup.add(centerRay);

      this.liveFramingGroup.add(cardGroup);
    }

    if (trajectoryPoints.length > 2) {
      this.flightSplineCurve = new THREE.CatmullRomCurve3(trajectoryPoints, true);
      const splinePoints = this.flightSplineCurve.getPoints(120);
      const splineGeom = new THREE.BufferGeometry().setFromPoints(splinePoints);
      const splineMat = new THREE.LineBasicMaterial({
        color: 0x00E5FF,
        opacity: 0.85,
        transparent: true
      });
      const pathLine = new THREE.Line(splineGeom, splineMat);
      this.liveFramingGroup.add(pathLine);

      const tracerGeom = new THREE.SphereGeometry(0.05, 16, 16);
      const tracerMat = new THREE.MeshBasicMaterial({ color: 0x4D7CFE });
      this.flightTracerMesh = new THREE.Mesh(tracerGeom, tracerMat);
      this.liveFramingGroup.add(this.flightTracerMesh);
    }

    this.scene.add(this.liveFramingGroup);

    this.camera.position.set(0, 2.4, 4.8);
    this.camera.lookAt(0, 0, 0);
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 1.2;
    }

    const statsBadge = document.getElementById('viewer-stats-badge');
    if (statsBadge) {
      statsBadge.textContent = `UAV Flight Stream • ${count} Keyframes Calibrated`;
    }
  }

  updateLiveFramingStage(stageName, progress) {
    if (!this.hologramCore || !this.hologramCore.core) return;
    const stage = (stageName || '').toLowerCase();

    let color = 0x00E5FF;
    if (stage.includes('match') || stage.includes('pair')) {
      color = 0x4D7CFE;
    } else if (stage.includes('refine') || stage.includes('optim') || stage.includes('converge')) {
      color = 0xF6C453;
    } else if (stage.includes('export') || stage.includes('scene') || stage.includes('complete')) {
      color = 0x20D3A2;
    }

    if (this.hologramCore.core.material) {
      this.hologramCore.core.material.color.setHex(color);
      this.hologramCore.core.material.emissive.setHex(color);
    }
  }

  clearLiveFraming() {
    if (this.liveFramingGroup) {
      this.scene.remove(this.liveFramingGroup);
      this.liveFramingGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
      this.liveFramingGroup = null;
      this.hologramCore = null;
      this.flightSplineCurve = null;
      this.flightTracerMesh = null;
    }

    this._objectUrlsToRevoke.forEach(url => URL.revokeObjectURL(url));
    this._objectUrlsToRevoke = [];
  }

  async loadModel(url, onProgress = null, format = 'glb') {
    this.clearLiveFraming();

    const loadingOverlay = document.getElementById('viewer-loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.currentModel = null;
    }
    this._pointObjects = [];

    this._currentUrl = url;
    if (url.includes('scene_mesh.glb')) {
      this.meshMode = true;
    } else {
      this.meshMode = false;
    }

    const isPly = format.toLowerCase() === 'ply' || url.toLowerCase().endsWith('.ply');

    return new Promise((resolve, reject) => {
      if (isPly && typeof THREE.PLYLoader !== 'undefined') {
        const plyLoader = new THREE.PLYLoader();
        plyLoader.load(
          url,
          (geometry) => {
            geometry.computeVertexNormals();
            const hasColors = geometry.attributes.color != null;

            const material = this._createPointMaterial(hasColors);
            const points = new THREE.Points(geometry, material);
            points.userData.isPointCloud = true;

            this.currentModel = new THREE.Group();
            this.currentModel.add(points);
            this._pointObjects.push(points);

            this.scene.add(this.currentModel);
            this.fitCameraToModel(this.currentModel);

            this._updateStatsBadge(geometry.attributes.position.count, 'PLY Point Cloud');

            if (loadingOverlay) loadingOverlay.classList.add('hidden');
            resolve({ scene: this.currentModel, type: 'ply' });
          },
          (xhr) => {
            if (xhr.lengthComputable && onProgress) {
              onProgress(Math.round((xhr.loaded / xhr.total) * 100));
            }
          },
          (err) => {
            console.error('Error loading PLY:', err);
            if (loadingOverlay) loadingOverlay.classList.add('hidden');
            reject(err);
          }
        );
      } else {
        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load(
          url,
          (gltf) => {
            this.currentModel = gltf.scene;
            this._postProcessScene(this.currentModel);
            this.scene.add(this.currentModel);
            this.fitCameraToModel(this.currentModel);

            let totalPoints = 0;
            this._pointObjects.forEach(p => {
              if (p.geometry && p.geometry.attributes.position) {
                totalPoints += p.geometry.attributes.position.count;
              }
            });
            this._updateStatsBadge(totalPoints, '3D Mesh & Points');

            if (loadingOverlay) loadingOverlay.classList.add('hidden');
            resolve(gltf);
          },
          (xhr) => {
            if (xhr.lengthComputable && onProgress) {
              onProgress(Math.round((xhr.loaded / xhr.total) * 100));
            }
          },
          (err) => {
            console.error('Error loading GLB:', err);
            if (loadingOverlay) loadingOverlay.classList.add('hidden');
            reject(err);
          }
        );
      }
    });
  }

  _updateStatsBadge(pointCount, format) {
    const statsBadge = document.getElementById('viewer-stats-badge');
    if (statsBadge) {
      const formattedCount = pointCount > 0 ? `${(pointCount / 1000).toFixed(1)}k Splats` : '3D Geometry';
      statsBadge.textContent = `${format} • ${formattedCount} • Metric Accurate`;
    }
  }

  _createPointMaterial(hasVertexColors = true) {
    const isSmooth = this.pointStyle === 'smooth';
    const baseRadius = this.sceneBoundingRadius || 1.5;
    const computedSize = Math.max(0.003, baseRadius * 0.0075 * this.pointSize);

    return new THREE.PointsMaterial({
      size: computedSize,
      sizeAttenuation: true,
      vertexColors: hasVertexColors,
      color: hasVertexColors ? 0xffffff : 0x00E5FF,
      map: isSmooth ? this.circleTexture : null,
      transparent: isSmooth,
      alphaTest: isSmooth ? 0.02 : 0.0,
      opacity: 0.95,
      depthWrite: true
    });
  }

  _postProcessScene(model) {
    const CAMERA_FRUSTUM_MAX_VERTICES = 50;

    model.traverse((child) => {
      if (child.isPoints) {
        this._fixPointCloud(child);
        this._pointObjects.push(child);
        return;
      }

      if (child.isMesh && child.geometry) {
        const vertexCount = child.geometry.attributes.position
          ? child.geometry.attributes.position.count
          : 0;

        if (vertexCount > 0 && vertexCount <= CAMERA_FRUSTUM_MAX_VERTICES) {
          child.visible = this.showCameraFrustums;
          child.userData.isCameraFrustum = true;
          if (child.material) {
            child.material.wireframe = true;
            child.material.color = new THREE.Color(0x00E5FF);
          }
        } else if (vertexCount > CAMERA_FRUSTUM_MAX_VERTICES) {
          child.userData.isSurfaceMesh = true;
          const hasColors = child.geometry.attributes.color != null;
          child.material = new THREE.MeshStandardMaterial({
            vertexColors: hasColors,
            roughness: 0.45,
            metalness: 0.15,
            side: THREE.DoubleSide
          });
        }
      }
    });
  }

  async toggleMeshMode(jobId) {
    if (!this.meshMode) {
      this._previousModelUrl = this._currentUrl;
      const meshUrl = jobId ? `/storage/jobs/${jobId}/outputs/scene_mesh.glb` : null;
      if (meshUrl) {
        try {
          await this.loadModel(meshUrl, null, 'glb');
          this.meshMode = true;
          this._updateStatsBadge(0, 'Watertight Solid Mesh');
          return true;
        } catch (err) {
          console.warn('Surface mesh not yet generated:', err);
        }
      }
    } else {
      if (this._previousModelUrl) {
        try {
          await this.loadModel(this._previousModelUrl, null, 'glb');
          this.meshMode = false;
          return false;
        } catch (err) {
          console.warn('Failed to revert to point cloud:', err);
        }
      }
      this.meshMode = false;
      return false;
    }
    return this.meshMode || false;
  }

  _fixPointCloud(pointsObj) {
    const geometry = pointsObj.geometry;
    if (!geometry) return;

    const hasVertexColors = geometry.attributes.color != null;
    const newMaterial = this._createPointMaterial(hasVertexColors);

    if (pointsObj.material) {
      if (Array.isArray(pointsObj.material)) {
        pointsObj.material.forEach(m => m.dispose());
      } else {
        pointsObj.material.dispose();
      }
    }

    pointsObj.material = newMaterial;
  }

  fitCameraToModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    this.sceneBoundingRadius = maxDim || 1.5;

    this._pointObjects.forEach((pointsObj) => {
      this._fixPointCloud(pointsObj);
    });

    if (this.gridGroup) {
      this.gridGroup.position.set(center.x, box.min.y - 0.03, center.z);
      this.gridGroup.scale.set(maxDim * 0.45, 1, maxDim * 0.45);
    }

    const fov = this.camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.55;
    cameraZ = Math.max(cameraZ, 0.5);

    this.camera.position.set(center.x, center.y + maxDim * 0.35, center.z + cameraZ);
    this.camera.lookAt(center);

    if (this.controls) {
      this.controls.target.copy(center);
      this.controls.update();
    }

    this.initialCameraState = {
      position: this.camera.position.clone(),
      target: center.clone()
    };
  }

  resetCamera() {
    if (!this.initialCameraState || !this.camera || !this.controls) return;
    this.camera.position.copy(this.initialCameraState.position);
    this.controls.target.copy(this.initialCameraState.target);
    this.controls.update();
  }

  toggleAutoRotate() {
    if (!this.controls) return false;
    this.isAutoRotating = !this.isAutoRotating;
    this.controls.autoRotate = this.isAutoRotating;
    return this.isAutoRotating;
  }

  toggleGrid() {
    if (!this.gridGroup) return false;
    this.gridGroup.visible = !this.gridGroup.visible;
    return this.gridGroup.visible;
  }

  toggleBackground() {
    this.currentThemeIndex = (this.currentThemeIndex + 1) % this.themes.length;
    const theme = this.themes[this.currentThemeIndex];
    if (this.scene) {
      this.scene.background = new THREE.Color(theme.bg);
      if (this.scene.fog) {
        this.scene.fog.color.setHex(theme.bg);
      }
    }
    this._buildGeospatialGrid();
    return theme.name;
  }

  togglePointStyle() {
    this.pointStyle = this.pointStyle === 'smooth' ? 'sharp' : 'smooth';
    this._pointObjects.forEach((pointsObj) => {
      this._fixPointCloud(pointsObj);
    });
    return this.pointStyle;
  }

  toggleCameraFrustums() {
    this.showCameraFrustums = !this.showCameraFrustums;
    if (this.currentModel) {
      this.currentModel.traverse((child) => {
        if (child.userData.isCameraFrustum) {
          child.visible = this.showCameraFrustums;
        }
      });
    }
    return this.showCameraFrustums;
  }

  toggleFullscreen() {
    const viewerElem = document.getElementById('viewer-section');
    if (!document.fullscreenElement) {
      if (viewerElem && viewerElem.requestFullscreen) {
        viewerElem.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
    setTimeout(() => this.onResize(), 150);
  }

  captureScreenshot() {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.renderer.render(this.scene, this.camera);
    const dataUrl = this.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `aerial_recon3d_${Date.now()}.png`;
    a.click();
  }

  updatePointSize(size) {
    this.pointSize = parseFloat(size);
    const baseRadius = this.sceneBoundingRadius || 1.5;
    const computedSize = Math.max(0.003, baseRadius * 0.0075 * this.pointSize);

    this._pointObjects.forEach((pointsObj) => {
      if (pointsObj.material) {
        pointsObj.material.size = computedSize;
        pointsObj.material.needsUpdate = true;
      }
    });

    if (this.currentModel) {
      this.currentModel.traverse((child) => {
        if (child.isPoints && child.material) {
          child.material.size = computedSize;
          child.material.sizeAttenuation = true;
          child.material.needsUpdate = true;
        }
      });
    }
  }
}

window.ModelViewer = ModelViewer;
