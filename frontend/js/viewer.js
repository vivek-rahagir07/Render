/**
 * Three.js 3D Viewer module for GLTF / GLB pointclouds and meshes
 * 
 * MUSt3R outputs GLB files containing:
 *   - A point cloud (GLTF primitive mode=0) with POSITION + COLOR_0 attributes
 *   - Camera frustum wireframes as small triangle meshes
 * 
 * This viewer correctly renders point clouds with vertex colors and
 * hides the camera frustum geometry that would otherwise appear as "boxes".
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
    this.initialCameraState = null;
    this.isDarkTheme = true;
    this.pointSize = 3.0;
    this.showCameraFrustums = false;

    // Track point cloud objects for size updates
    this._pointObjects = [];

    this.init();
  }

  init() {
    if (!this.container) return;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050811);

    // Camera
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 1000);
    this.camera.position.set(0, 1.5, 3);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.1;
    this.controls.maxDistance = 500;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight1.position.set(5, 10, 7);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x88bbff, 0.6);
    dirLight2.position.set(-5, -5, -5);
    this.scene.add(dirLight2);

    // Reference Grid
    this.gridHelper = new THREE.GridHelper(10, 20, 0x6366f1, 0x223049);
    this.gridHelper.position.y = -0.5;
    this.scene.add(this.gridHelper);

    // Event listeners
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
   * Load a GLB model from URL
   * @param {string} url
   * @param {Function} onProgress
   */
  async loadModel(url, onProgress = null) {
    const loadingOverlay = document.getElementById('viewer-loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    // Remove old model if present
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.currentModel = null;
    }
    this._pointObjects = [];

    const loader = new THREE.GLTFLoader();

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          this.currentModel = gltf.scene;

          // Post-process the loaded scene to fix point cloud rendering
          this._postProcessScene(this.currentModel);

          this.scene.add(this.currentModel);

          // Center model and fit camera
          this.fitCameraToModel(this.currentModel);

          if (loadingOverlay) loadingOverlay.classList.add('hidden');
          resolve(gltf);
        },
        (xhr) => {
          if (xhr.lengthComputable && onProgress) {
            const percent = Math.round((xhr.loaded / xhr.total) * 100);
            onProgress(percent);
          }
        },
        (error) => {
          console.error('Error loading 3D GLB model:', error);
          if (loadingOverlay) loadingOverlay.classList.add('hidden');
          reject(error);
        }
      );
    });
  }

  /**
   * Post-process loaded GLTF scene to handle MUSt3R's output format:
   * - Point cloud primitives (mode=0): Apply proper PointsMaterial with vertex colors
   * - Camera frustum meshes: Hide by default (they appear as "boxes")
   * 
   * MUSt3R's GLB contains:
   *   geometry_0: PointCloud (POSITION + COLOR_0, mode=0) — the actual reconstruction
   *   geometry_1..N: Small triangle meshes (4-14 verts) — camera frustum wireframes
   */
  _postProcessScene(model) {
    const CAMERA_FRUSTUM_MAX_VERTICES = 50; // Camera frustums have very few vertices (4 or 14)

    model.traverse((child) => {
      // Handle Points objects (GLTF mode=0 primitives)
      if (child.isPoints) {
        this._fixPointCloud(child);
        this._pointObjects.push(child);
        return;
      }

      // Handle Mesh objects — detect and hide camera frustums
      if (child.isMesh && child.geometry) {
        const vertexCount = child.geometry.attributes.position
          ? child.geometry.attributes.position.count
          : 0;

        // Camera frustums from MUSt3R are tiny meshes (4 or 14 vertices)
        if (vertexCount > 0 && vertexCount <= CAMERA_FRUSTUM_MAX_VERTICES) {
          child.visible = this.showCameraFrustums;
          child.userData.isCameraFrustum = true;
        }
      }
    });
  }

  /**
   * Fix a THREE.Points object to render properly with vertex colors
   * and appropriate point size.
   */
  _fixPointCloud(pointsObj) {
    const geometry = pointsObj.geometry;
    if (!geometry) return;

    // Check if vertex colors exist (COLOR_0 attribute from GLTF)
    const hasVertexColors = geometry.attributes.color != null;

    // Replace the material with a proper PointsMaterial
    const newMaterial = new THREE.PointsMaterial({
      size: this.pointSize,
      sizeAttenuation: true,
      vertexColors: hasVertexColors,
      // If no vertex colors, use a neutral light gray
      color: hasVertexColors ? 0xffffff : 0xcccccc,
    });

    // Dispose old material
    if (pointsObj.material) {
      if (Array.isArray(pointsObj.material)) {
        pointsObj.material.forEach(m => m.dispose());
      } else {
        pointsObj.material.dispose();
      }
    }

    pointsObj.material = newMaterial;

    console.log(
      `[Viewer] Point cloud configured: ${geometry.attributes.position.count} points, ` +
      `vertex colors: ${hasVertexColors}, size: ${this.pointSize}`
    );
  }

  fitCameraToModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Place grid below the model
    if (this.gridHelper) {
      this.gridHelper.position.y = box.min.y;
      this.gridHelper.scale.set(maxDim * 0.5, 1, maxDim * 0.5);
    }

    const fov = this.camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
    cameraZ = Math.max(cameraZ, 1.0);

    this.camera.position.set(center.x, center.y + maxDim * 0.3, center.z + cameraZ);
    this.camera.lookAt(center);

    if (this.controls) {
      this.controls.target.copy(center);
      this.controls.update();
    }

    // Save initial state for reset
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

  toggleGrid() {
    if (!this.gridHelper) return false;
    this.gridHelper.visible = !this.gridHelper.visible;
    return this.gridHelper.visible;
  }

  toggleBackground() {
    this.isDarkTheme = !this.isDarkTheme;
    if (this.scene) {
      this.scene.background = new THREE.Color(this.isDarkTheme ? 0x050811 : 0xe2e8f0);
    }
    return this.isDarkTheme;
  }

  /**
   * Toggle visibility of camera frustum wireframes from MUSt3R
   */
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

    // Update all tracked point cloud objects
    this._pointObjects.forEach((pointsObj) => {
      if (pointsObj.material) {
        pointsObj.material.size = this.pointSize;
        pointsObj.material.needsUpdate = true;
      }
    });

    // Also traverse as a fallback in case anything was missed
    if (this.currentModel) {
      this.currentModel.traverse((child) => {
        if (child.isPoints && child.material) {
          child.material.size = this.pointSize;
          child.material.sizeAttenuation = true;
          child.material.needsUpdate = true;
        }
      });
    }
  }
}

window.ModelViewer = ModelViewer;
