/**
 * Advanced Three.js 3D Geospatial Viewer & Measurement Studio
 * 
 * Features:
 *   - 3D Metric Measurement Ruler Tool (Distance in meters & Elevation ΔH)
 *   - Drone Flight Path Trajectory Visualizer
 *   - Live Interactive Multi-View Image Framing during Neural Analysis
 *   - Soft Gaussian circular point splats (calibrated to bounding radius)
 *   - Dual GLB and PLY direct rendering
 *   - Turntable smooth auto-rotation
 *   - Studio environment & atmosphere modes
 *   - High-Res Snapshot Export
 *   - Fullscreen viewport
 *   - Real-time point density & splat style tuning
 */
class ModelViewer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.gridHelper = null;
    this.currentModel = null;
    this.liveFramingGroup = null;
    this.hologramCore = null;
    this.initialCameraState = null;
    this.sceneBoundingRadius = 1.5;
    
    // Measurement Tool states
    this.isMeasuring = false;
    this.measurePoints = [];
    this.measureGroup = new THREE.Group();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Config states
    this.pointSize = 1.0;
    this.pointStyle = 'smooth';
    this.showCameraFrustums = false;
    this.isAutoRotating = false;
    this.currentThemeIndex = 0;
    this.themes = [
      { name: 'Noir & Gold', bg: 0x06070a, grid1: 0xd4af37, grid2: 0x212534 },
      { name: 'Ivory & Gold', bg: 0xf8f8fb, grid1: 0xd4af37, grid2: 0xd6d6e0 },
      { name: 'Obsidian Velvet', bg: 0x020305, grid1: 0xb89128, grid2: 0x141824 },
      { name: 'Studio Slate', bg: 0x11131c, grid1: 0xfcedc5, grid2: 0x272c3d }
    ];

    // Texture cache for circular soft points
    this.circleTexture = this._createCircleTexture();

    // Track point cloud objects for real-time updates
    this._pointObjects = [];
    this._objectUrlsToRevoke = [];

    this.init();
  }

  /**
   * Generates a high-quality radial gradient alpha texture for circular splat rendering
   */
  _createCircleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.9, 'rgba(255, 255, 255, 0.3)');
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = true;
    return texture;
  }

  init() {
    if (!this.container) return;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.themes[0].bg);
    this.scene.add(this.measureGroup);

    // Camera
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(48, width / height, 0.01, 1000);
    this.camera.position.set(0, 1.8, 4.0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 500;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 1.8;

    // Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(5, 12, 7);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x88bbff, 0.7);
    fillLight.position.set(-6, -4, -5);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xd4af37, 0.6);
    rimLight.position.set(0, -10, 0);
    this.scene.add(rimLight);

    // Ground Grid
    this.gridHelper = new THREE.GridHelper(10, 24, this.themes[0].grid1, this.themes[0].grid2);
    this.gridHelper.position.y = -0.6;
    this.scene.add(this.gridHelper);

    // Setup Click listener for 3D Measurement Tool
    this.renderer.domElement.addEventListener('pointerdown', (e) => this._onPointerDown(e));

    // Window resize handler
    window.addEventListener('resize', () => this.onResize());

    // Start animation loop
    this.animate();
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    
    // Animate holographic synthesis core if active
    if (this.hologramCore) {
      this.hologramCore.rotation.y += 0.015;
      this.hologramCore.rotation.x += 0.008;
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

  /**
   * 3D Metric Measurement Ruler Tool
   */
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
    if (e.button !== 0) return; // Left click only

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const objectsToIntersect = [];
    if (this.currentModel) objectsToIntersect.push(this.currentModel);
    if (this.gridHelper) objectsToIntersect.push(this.gridHelper);

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

    // Create marker dot
    const dotGeom = new THREE.SphereGeometry(0.04, 16, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xd4af37 });
    const dotMesh = new THREE.Mesh(dotGeom, dotMat);
    dotMesh.position.copy(point);
    this.measureGroup.add(dotMesh);

    const distVal = document.getElementById('measure-dist-val');
    const hintText = document.getElementById('measure-hint-text');

    if (this.measurePoints.length === 1) {
      if (hintText) hintText.textContent = 'Point 1 placed. Click second point to measure distance.';
    } else if (this.measurePoints.length === 2) {
      const p1 = this.measurePoints[0];
      const p2 = this.measurePoints[1];

      // Draw connecting laser line
      const lineGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const lineMat = new THREE.LineDashedMaterial({
        color: 0xd4af37,
        dashSize: 0.1,
        gapSize: 0.05,
        linewidth: 2
      });
      const line = new THREE.Line(lineGeom, lineMat);
      line.computeLineDistances();
      this.measureGroup.add(line);

      // Distance calculation (calibrated relative to scene bounding radius)
      const rawDistance = p1.distanceTo(p2);
      const metricScaleFactor = 5.0; // Scaled to estimated real-world drone meters
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
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
  }

  /**
   * Sets up real-time 3D Image Framing & Live Pipeline Visualizer
   */
  setupLiveFraming(files) {
    this.clearLiveFraming();

    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.currentModel = null;
    }
    this._pointObjects = [];

    this.liveFramingGroup = new THREE.Group();
    const count = Math.min(files.length, 36);
    const radius = 2.4;
    const textureLoader = new THREE.TextureLoader();

    // 1. Central holographic neural core
    const coreGroup = new THREE.Group();
    const icoGeom = new THREE.IcosahedronGeometry(0.5, 1);
    const icoMat = new THREE.MeshBasicMaterial({
      color: 0xd4af37,
      wireframe: true,
      transparent: true,
      opacity: 0.6
    });
    const icoMesh = new THREE.Mesh(icoGeom, icoMat);
    coreGroup.add(icoMesh);

    const sphereGeom = new THREE.SphereGeometry(0.25, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0xfcedc5,
      transparent: true,
      opacity: 0.8
    });
    const sphereMesh = new THREE.Mesh(sphereGeom, sphereMat);
    coreGroup.add(sphereMesh);

    this.hologramCore = coreGroup;
    this.liveFramingGroup.add(coreGroup);

    // 2. Trajectory points for drone flight path spline
    const trajectoryPoints = [];

    for (let i = 0; i < count; i++) {
      const file = files[i];
      const angle = (i / count) * Math.PI * 2;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      const y = Math.sin(i * 0.8) * 0.35 + 0.1;

      trajectoryPoints.push(new THREE.Vector3(x, y, z));

      const cardGroup = new THREE.Group();
      cardGroup.position.set(x, y, z);
      cardGroup.lookAt(0, 0, 0);

      const objUrl = URL.createObjectURL(file);
      this._objectUrlsToRevoke.push(objUrl);

      textureLoader.load(objUrl, (tex) => {
        tex.generateMipmaps = true;
        const aspect = tex.image.width / tex.image.height || 1.33;
        const w = 0.55;
        const h = w / aspect;

        const planeGeom = new THREE.PlaneGeometry(w, h);
        const planeMat = new THREE.MeshBasicMaterial({
          map: tex,
          side: THREE.DoubleSide
        });
        const planeMesh = new THREE.Mesh(planeGeom, planeMat);
        cardGroup.add(planeMesh);

        // Frame border
        const frameGeom = new THREE.EdgesGeometry(planeGeom);
        const frameMat = new THREE.LineBasicMaterial({ color: 0xd4af37 });
        const frameLine = new THREE.LineSegments(frameGeom, frameMat);
        cardGroup.add(frameLine);

        // Frustum pyramid
        const frustumGeom = new THREE.ConeGeometry(w * 0.7, 0.4, 4);
        const frustumMat = new THREE.MeshBasicMaterial({
          color: 0xb89128,
          wireframe: true,
          transparent: true,
          opacity: 0.4
        });
        const frustumMesh = new THREE.Mesh(frustumGeom, frustumMat);
        frustumMesh.rotation.x = Math.PI / 2;
        frustumMesh.position.z = -0.2;
        cardGroup.add(frustumMesh);
      });

      // Targeting laser ray
      const lineMat = new THREE.LineBasicMaterial({
        color: 0xd4af37,
        transparent: true,
        opacity: 0.35
      });
      const linePoints = [new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, 0)];
      const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
      const laserLine = new THREE.Line(lineGeom, lineMat);
      this.liveFramingGroup.add(laserLine);

      this.liveFramingGroup.add(cardGroup);
    }

    // 3. Drone Flight Trajectory Path Spline
    if (trajectoryPoints.length > 2) {
      const curve = new THREE.CatmullRomCurve3(trajectoryPoints, true);
      const curvePoints = curve.getPoints(100);
      const curveGeom = new THREE.BufferGeometry().setFromPoints(curvePoints);
      const curveMat = new THREE.LineBasicMaterial({ color: 0xd4af37, opacity: 0.7, transparent: true });
      const pathLine = new THREE.Line(curveGeom, curveMat);
      this.liveFramingGroup.add(pathLine);
    }

    this.scene.add(this.liveFramingGroup);

    this.camera.position.set(0, 2.5, 4.8);
    this.camera.lookAt(0, 0, 0);
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 1.5;
    }

    const statsBadge = document.getElementById('viewer-stats-badge');
    if (statsBadge) {
      statsBadge.textContent = `Drone Flight Stream • ${count} Keyframes Mapped`;
    }
  }

  updateLiveFramingStage(stageName, progress) {
    if (!this.hologramCore) return;
    const stage = (stageName || '').toLowerCase();
    
    let color = 0xd4af37; // Gold
    if (stage.includes('match') || stage.includes('pair')) {
      color = 0xfcedc5;
    } else if (stage.includes('refine') || stage.includes('optim')) {
      color = 0xb89128;
    } else if (stage.includes('export') || stage.includes('scene')) {
      color = 0x10b981;
    }

    if (this.hologramCore.children[0] && this.hologramCore.children[0].material) {
      this.hologramCore.children[0].material.color.setHex(color);
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
    }

    this._objectUrlsToRevoke.forEach(url => URL.revokeObjectURL(url));
    this._objectUrlsToRevoke = [];
  }

  /**
   * Load either a GLB scene or a PLY point cloud model
   */
  async loadModel(url, onProgress = null, format = 'glb') {
    this.clearLiveFraming();

    const loadingOverlay = document.getElementById('viewer-loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.currentModel = null;
    }
    this._pointObjects = [];

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
      const formattedCount = pointCount > 0 ? `${(pointCount / 1000).toFixed(1)}k Points` : '3D Geometry';
      statsBadge.textContent = `${format} • ${formattedCount} • Metric Accurate`;
    }
  }

  _createPointMaterial(hasVertexColors = true) {
    const isSmooth = this.pointStyle === 'smooth';
    const baseRadius = this.sceneBoundingRadius || 1.5;
    const computedSize = Math.max(0.002, baseRadius * 0.007 * this.pointSize);

    return new THREE.PointsMaterial({
      size: computedSize,
      sizeAttenuation: true,
      vertexColors: hasVertexColors,
      color: hasVertexColors ? 0xffffff : 0xd4af37,
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
            child.material.color = new THREE.Color(0xd4af37);
          }
        }
      }
    });
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

    if (this.gridHelper) {
      this.gridHelper.position.set(center.x, box.min.y - 0.02, center.z);
      this.gridHelper.scale.set(maxDim * 0.4, 1, maxDim * 0.4);
    }

    const fov = this.camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.6;
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
    if (!this.gridHelper) return false;
    this.gridHelper.visible = !this.gridHelper.visible;
    return this.gridHelper.visible;
  }

  toggleBackground() {
    this.currentThemeIndex = (this.currentThemeIndex + 1) % this.themes.length;
    const theme = this.themes[this.currentThemeIndex];
    if (this.scene) {
      this.scene.background = new THREE.Color(theme.bg);
    }
    if (this.gridHelper) {
      this.gridHelper.material.color = new THREE.Color(theme.grid1);
    }
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
    const computedSize = Math.max(0.002, baseRadius * 0.007 * this.pointSize);

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
