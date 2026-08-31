/**
 * API client for 3D Reconstruction Backend
 */
const API = {
  baseUrl: '',

  /**
   * Check system health and MUSt3R readiness
   */
  async checkHealth() {
    const response = await fetch(`${this.baseUrl}/api/health`);
    if (!response.ok) {
      throw new Error(`Health check failed with status: ${response.status}`);
    }
    return await response.json();
  },

  /**
   * Create a new 3D reconstruction job by uploading image files
   * @param {File[]} files
   * @param {Object} config
   */
  async createJob(files, config = {}) {
    const formData = new FormData();
    
    files.forEach(file => {
      formData.append('files', file);
    });

    if (config.image_size) formData.append('image_size', config.image_size);
    if (config.device) formData.append('device', config.device);
    if (config.max_bs) formData.append('max_bs', config.max_bs);
    if (config.num_refinements_iterations !== undefined) {
      formData.append('num_refinements_iterations', config.num_refinements_iterations);
    }
    if (config.execution_mode) formData.append('execution_mode', config.execution_mode);
    if (config.cam_size) formData.append('cam_size', config.cam_size);

    const response = await fetch(`${this.baseUrl}/api/reconstruction/jobs`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Upload error' }));
      throw new Error(errorData.detail || `Upload failed (${response.status})`);
    }

    return await response.json();
  },

  /**
   * Retrieve current progress, stage, logs, and output models for a job
   * @param {string} jobId
   */
  async getJobStatus(jobId) {
    const response = await fetch(`${this.baseUrl}/api/reconstruction/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch status for job ${jobId}`);
    }
    return await response.json();
  },

  /**
   * Cancel an active reconstruction job
   * @param {string} jobId
   */
  async cancelJob(jobId) {
    const response = await fetch(`${this.baseUrl}/api/reconstruction/jobs/${jobId}/cancel`, {
      method: 'POST'
    });
    if (!response.ok) {
      throw new Error(`Failed to cancel job ${jobId}`);
    }
    return await response.json();
  },

  /**
   * Get direct download link for GLB or PLY
   * @param {string} jobId
   * @param {'glb'|'ply'} format
   */
  getDownloadUrl(jobId, format) {
    return `${this.baseUrl}/api/reconstruction/jobs/${jobId}/download/${format}`;
  }
};

window.API = API;
