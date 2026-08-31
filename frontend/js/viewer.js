/**
 * Advanced Three.js 3D Viewer module for GLTF/GLB and PLY point clouds & meshes
 * 
 * Features:
 *   - Soft Gaussian-style circular point splats (eliminating harsh square pixels)
 *   - Both GLB and PLY direct rendering
 *   - Turntable smooth auto-rotation
 *   - Studio environment & lighting modes
 *   - Camera frustum toggle (hidden by default)
 *   - Real-time point size and splat style tuning
 */
class ModelViewer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.gridHelper = null;
    this.groundDisc = null;
    this.currentModel = null;
    this.initialCameraState = null;
    
    // Config states
    this.pointSize = 3.0;
    this.pointStyle = 'smooth'; // 'smooth' (splats) or 'sharp' (raw points)
    this.showCameraFrustums = false;
    this.isAutoRotating = false;
    this.currentThemeIndex = 0;
    this.themes = [
      { name: 'Deep Space', bg: 0x050811, grid1: 0x6366f1, grid2: 0x223049 },
      { name: 'Dark Studio', bg: 0x0f172a, grid1: 0x38bdf8, grid2: 0x334155 },
      { name: 'Deep Charcoal', bg: 0x000000, grid1: 0x475569, grid2: 0x1e293b },
      { name: 'Clean Light', bg: 0xf1f5f9, grid1: 0x94a3b8, grid2: 0xcbd5e1 }
    ];

    // Texture cache for circular soft points
    this.circleTexture = this._createCircleTexture();

    // Track point cloud objects for real-time updates
    this._pointObjects = [];

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

    // Camera
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(48, width / height, 0.01, 1000);
    this.camera.position.set(0, 1.5, 3.5);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
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
    this.controls.autoRotateSpeed = 2.0;

    // Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(5, 12, 7);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x88bbff, 0.7);
    fillLight.position.set(-6, -4, -5);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x6366f1, 0.5);
    rimLight.position.set(0, -10, 0);
    this.scene.add(rimLight);

    // Ground Grid
    this.gridHelper = new THREE.GridHelper(10, 24, this.themes[0].grid1, this.themes[0].grid2);
    this.gridHelper.position.y = -0.5;
    this.scene.add(this.gridHelper);

    // Window resize handler
    window.addEventListener('resize', () => this.onResize());

    // Start animation loop
    this.animate();
  }

  animate() {
    requestAnimationFrame(() => this.animate());
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
   * Load either a GLB scene or a PLY point cloud model
   * @param {string} url
   * @param {Function} onProgress
   * @param {string} format 'glb' or 'ply'
   */
  async loadModel(url, onProgress = null, format = 'glb') {
    const loadingOverlay = document.getElementById('viewer-loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    // Remove previous model
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

  /**
   * Builds custom PointsMaterial with either smooth circular splats or crisp points
   */
  _createPointMaterial(hasVertexColors = true) {
    const isSmooth = this.pointStyle === 'smooth';
    const baseRadius = this.sceneBoundingRadius || 1.5;
    const computedSize = Math.max(0.002, baseRadius * 0.007 * (this.pointSize / 3.0));

    return new THREE.PointsMaterial({
      size: computedSize,
      sizeAttenuation: true,
      vertexColors: hasVertexColors,
      color: hasVertexColors ? 0xffffff : 0xdddddd,
      map: isSmooth ? this.circleTexture : null,
      transparent: isSmooth,
      alphaTest: isSmooth ? 0.02 : 0.0,
      opacity: 0.95,
      depthWrite: true
    });
  }

  /**
   * Post-processes loaded GLTF scene from MUSt3R
   */
  _postProcessScene(model) {
    const CAMERA_FRUSTUM_MAX_VERTICES = 50;

    model.traverse((child) => {
      // Handle Points primitives
      if (child.isPoints) {
        this._fixPointCloud(child);
        this._pointObjects.push(child);
        return;
      }

      // Handle camera frustum meshes (they appear as pyramids/boxes)
      if (child.isMesh && child.geometry) {
        const vertexCount = child.geometry.attributes.position
          ? child.geometry.attributes.position.count
          : 0;

        if (vertexCount > 0 && vertexCount <= CAMERA_FRUSTUM_MAX_VERTICES) {
          child.visible = this.showCameraFrustums;
          child.userData.isCameraFrustum = true;
          // Wireframe material for cleaner look when toggled on
          if (child.material) {
            child.material.wireframe = true;
            child.material.color = new THREE.Color(0x38bdf8);
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

    // Refresh point cloud material sizes with accurate scene bounding dimensions
    this._pointObjects.forEach((pointsObj) => {
      this._fixPointCloud(pointsObj);
    });

    // Place grid slightly beneath model base
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

  updatePointSize(size) {
    this.pointSize = parseFloat(size);
    const baseRadius = this.sceneBoundingRadius || 1.5;
    const computedSize = Math.max(0.002, baseRadius * 0.007 * (this.pointSize / 3.0));

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
