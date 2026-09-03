
import os
import sys
import argparse
import pickle
import traceback

import numpy as np
import torch
from scipy.spatial import cKDTree
import trimesh
from scipy.spatial.transform import Rotation

import matplotlib
matplotlib.use('Agg')

torch.backends.cuda.matmul.allow_tf32 = True

def get_args_parser():
    parser = argparse.ArgumentParser(description="MUSt3R High-Precision 3D Scene Reconstruction Executable")
    parser.add_argument("--image_size", type=int, default=512, choices=[512, 224], help="image size")
    parser.add_argument("--image_dir", required=True, type=str, help="input image directory")
    parser.add_argument("--output", required=True, type=str, help="output directory")
    parser.add_argument("--weights", type=str, required=True, help="path to the model weights")
    parser.add_argument("--encoder", type=str, default=None, help="encoder class instantiation")
    parser.add_argument("--decoder", type=str, default=None, help="decoder class instantiation")
    parser.add_argument("--memory_mode", type=str, default=None, help="decoder memory_mode override")
    parser.add_argument("--retrieval", type=str, help="path to the retrieval weights", default=None)
    parser.add_argument("--device", type=str, default="mps", help="pytorch device (mps, cuda, cpu)")
    parser.add_argument("--amp", type=str, default=False)
    parser.add_argument("--execution_mode", type=str, default="linseq", choices=["linseq", "retrieval", "vidseq", "vidslam"])
    parser.add_argument("--max_bs", type=int, default=1)
    parser.add_argument("--num_refinements_iterations", type=int, default=6)
    parser.add_argument("--render_once", action="store_true", default=False, help="skip the final rendering step")
    parser.add_argument("--num_mem_imgs", type=int, default=24)
    parser.add_argument("--local_context_size", type=int, default=0)
    parser.add_argument("--keyframe_interval", type=int, default=3)
    parser.add_argument("--subsample", type=int, default=2)
    parser.add_argument("--min_conf_keyframe", type=float, default=2.0)
    parser.add_argument("--keyframe_overlap_thr", type=float, default=0.05)
    parser.add_argument("--overlap_percentile", type=float, default=85)
    parser.add_argument("--cam_size", type=float, default=0.05)
    parser.add_argument("--camera_conf_thr", type=float, default=0.0)
    parser.add_argument("--file_type", type=str, default="glb", choices=["glb", "ply"])
    parser.add_argument("--min_conf_thr", type=float, default=3.0, help="Clean confidence threshold (default: 3.0)")
    parser.add_argument("--flying_edges_thr", type=float, default=0.06, help="Depth discontinuity step threshold")
    return parser

def apply_fast_sor(pts, colors=None, k=16, std_ratio=1.15):
    """
    Applies Statistical Outlier Removal (SOR) to purge stray noise dots and detached floaters.
    """
    if len(pts) < 80:
        return pts, colors

    try:
        tree = cKDTree(pts)
        dists, _ = tree.query(pts, k=min(k, len(pts)), workers=-1)
        mean_dists = np.mean(dists[:, 1:], axis=1)
        mu = np.mean(mean_dists)
        sigma = np.std(mean_dists)
        valid = mean_dists <= (mu + std_ratio * sigma)
        
        filtered_pts = pts[valid]
        filtered_colors = colors[valid] if colors is not None else None
        return filtered_pts, filtered_colors
    except Exception as e:
        print(f"[Notice] SOR filter bypass: {e}")
        return pts, colors

def filter_flying_edges(pts3d_np, conf_np, step_thr=0.06):
    """
    Filters out flying edge / slicing plane boundary tears where depth gradients jump abruptly.
    """
    H, W, _ = pts3d_np.shape
    
    diff_x = np.linalg.norm(pts3d_np[:, 1:, :] - pts3d_np[:, :-1, :], axis=-1)
    diff_y = np.linalg.norm(pts3d_np[1:, :, :] - pts3d_np[:-1, :, :], axis=-1)
    
    edge_x = np.zeros((H, W), dtype=bool)
    edge_y = np.zeros((H, W), dtype=bool)
    
    depth = np.abs(pts3d_np[:, :, 2])
    thr_map_x = np.maximum(depth[:, :-1] * step_thr, 0.02)
    thr_map_y = np.maximum(depth[:-1, :] * step_thr, 0.02)
    
    edge_x[:, :-1] = diff_x > thr_map_x
    edge_y[:-1, :] = diff_y > thr_map_y
    
    return edge_x | edge_y

def to_numpy(x):
    """Safely converts tensors, lists, and dicts to numpy arrays."""
    if isinstance(x, torch.Tensor):
        return x.detach().cpu().numpy()
    elif isinstance(x, (list, tuple)):
        return [to_numpy(v) for v in x]
    elif isinstance(x, dict):
        return {k: to_numpy(v) for k, v in x.items()}
    elif isinstance(x, np.ndarray):
        return x
    return np.array(x)

def export_clean_scene_glb(outdir, scene, min_conf_thr=3.0, filename="scene.glb",
                           flying_edges_thr=0.06, cam_size=0.05, verbose=True):
    """
    Exports a high-precision, clean 3D scene GLB/PLY free of background slices, floaters, and noise dots.
    """
    from dust3r.viz import OPENGL, add_scene_cam, CAM_COLORS

    x_out, imgs = scene.x_out, scene.imgs
    focals, cams2world = scene.focals, scene.cams2world
    nimgs = len(imgs)

    pts3d_list = [x_out[i]['pts3d'].cpu().numpy() for i in range(nimgs)]
    conf_list = [x_out[i]['conf'].cpu().numpy() for i in range(nimgs)]
    imgs_np = to_numpy(imgs)
    focals_np = to_numpy(focals)
    cams2world_np = to_numpy(cams2world)

    all_pts = []
    all_cols = []

    for i in range(nimgs):
        pts = pts3d_list[i]
        conf = conf_list[i]
        img = imgs_np[i]

        mask = conf >= min_conf_thr

        if img.shape[-1] == 4:
            alpha_mask = img[:, :, 3] > 0.3
            mask = mask & alpha_mask

        if flying_edges_thr > 0.0:
            edge_mask = filter_flying_edges(pts, conf, step_thr=flying_edges_thr)
            mask = mask & (~edge_mask)

        valid_pts = pts[mask]
        valid_cols = img[mask][:, :3]

        if len(valid_pts) > 0:
            all_pts.append(valid_pts)
            all_cols.append(valid_cols)

    if not all_pts:
        print(f"[Warning] No points met threshold {min_conf_thr}, trying fallback with min_conf_thr=1.8")
        return None

    cat_pts = np.concatenate(all_pts, axis=0)
    cat_cols = np.concatenate(all_cols, axis=0)

    clean_pts, clean_cols = apply_fast_sor(cat_pts, cat_cols, k=16, std_ratio=1.15)

    scene_3d = trimesh.Scene()
    pct = trimesh.PointCloud(clean_pts.reshape(-1, 3), colors=clean_cols.reshape(-1, 3))
    scene_3d.add_geometry(pct)

    for i, pose_c2w in enumerate(cams2world_np):
        try:
            camera_edge_color = CAM_COLORS[i % len(CAM_COLORS)]
            focal_val = np.atleast_1d(focals_np[i])
            add_scene_cam(
                scene_3d,
                pose_c2w,
                camera_edge_color,
                imgs_np[i][:, :, :3],
                focal_val,
                imsize=imgs_np[i].shape[1::-1],
                screen_width=cam_size
            )
        except Exception:
            pass

    rot = np.eye(4)
    rot[:3, :3] = Rotation.from_euler('y', np.deg2rad(180)).as_matrix()
    transform_mat = np.linalg.inv(cams2world_np[0] @ OPENGL @ rot)
    scene_3d.apply_transform(transform_mat)

    outfile = os.path.join(outdir, filename)
    if verbose:
        print(f"Exporting clean 3D scene ({len(clean_pts)} points) -> {outfile}")

    if filename.endswith(".ply"):
        pct.export(file_obj=outfile, file_type="ply")
    else:
        scene_3d.export(file_obj=outfile)

    if filename == "scene.glb":
        try:
            export_surface_mesh(clean_pts, clean_cols, transform_mat, outdir, verbose=verbose)
        except Exception as e:
            if verbose:
                print(f"[Notice] Surface mesh generation bypassed: {e}")

    return outfile

def export_surface_mesh(clean_pts, clean_cols, transform_mat, outdir, verbose=True):
    if len(clean_pts) < 10:
        return False

    def fallback_trimesh_hull():
        try:
            pts_homo = np.hstack([clean_pts, np.ones((len(clean_pts), 1))])
            pts_aligned = (pts_homo @ transform_mat.T)[:, :3]
            pct = trimesh.PointCloud(pts_aligned, colors=clean_cols)
            hull = pct.convex_hull
            hull.export(os.path.join(outdir, "scene_mesh.obj"))
            hull.export(os.path.join(outdir, "scene_mesh.stl"))
            hull.export(os.path.join(outdir, "scene_mesh.glb"))
            if verbose:
                print("[Surface Meshing] Convex hull fallback exported successfully.")
            return True
        except Exception as ex:
            if verbose:
                print(f"[Surface Meshing Warning] Convex hull failed: {ex}")
            return False

    try:
        import open3d as o3d
    except ImportError:
        return fallback_trimesh_hull()

    try:
        pts_homo = np.hstack([clean_pts, np.ones((len(clean_pts), 1))])
        pts_aligned = (pts_homo @ transform_mat.T)[:, :3]

        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(pts_aligned)
        has_color = clean_cols is not None and len(clean_cols) == len(clean_pts)
        if has_color:
            c = clean_cols.astype(np.float64)
            if c.max() > 1.0:
                c = c / 255.0
            pcd.colors = o3d.utility.Vector3dVector(c)

        bbox = pcd.get_axis_aligned_bounding_box()
        diag = np.linalg.norm(bbox.get_extent())
        if diag <= 1e-6:
            return fallback_trimesh_hull()

        # Downsample to a safe, fast point count (max ~35k points)
        # Prevents Open3D Poisson memory explosion and IsoSurface non-manifold loop bugs
        if len(pcd.points) > 35000:
            v_size = max(0.012, diag / 200.0)
            pcd = pcd.voxel_down_sample(voxel_size=v_size)

        pcd.estimate_normals(search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=max(0.05, diag / 75.0), max_nn=25))
        pcd.orient_normals_consistent_tangent_plane(k=15)

        # IMPORTANT FIX: linear_fit=False fixes Kazhdan's PoissonRecon 'Failed to close loop' bug!
        # depth=8 produces a clean watertight manifold mesh fast without freezing or aborting.
        mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
            pcd, depth=8, linear_fit=False, n_threads=2
        )

        densities = np.asarray(densities)
        if len(densities) > 0 and len(mesh.vertices) > 0:
            trim_mask = densities < np.quantile(densities, 0.02)
            mesh.remove_vertices_by_mask(trim_mask)

        if len(mesh.triangles) < 10:
            return fallback_trimesh_hull()

        if pcd.has_colors() and len(mesh.vertices) > 0:
            pcd_tree = o3d.geometry.KDTreeFlann(pcd)
            mesh_verts = np.asarray(mesh.vertices)
            pcd_cols = np.asarray(pcd.colors)
            k_indices = []
            for v in mesh_verts:
                _, idx, _ = pcd_tree.search_knn_vector_3d(v, 1)
                k_indices.append(idx[0])
            mesh.vertex_colors = o3d.utility.Vector3dVector(pcd_cols[k_indices])

        mesh.compute_vertex_normals()
        mesh.compute_triangle_normals()

        stl_path = os.path.join(outdir, "scene_mesh.stl")
        obj_path = os.path.join(outdir, "scene_mesh.obj")
        glb_path = os.path.join(outdir, "scene_mesh.glb")

        o3d.io.write_triangle_mesh(stl_path, mesh)
        o3d.io.write_triangle_mesh(obj_path, mesh)
        o3d.io.write_triangle_mesh(glb_path, mesh)

        if verbose:
            print(f"Exported dense solid mesh ({len(mesh.triangles)} triangles, {len(mesh.vertices)} vertices) -> {stl_path}, {obj_path}, {glb_path}")
        return True
    except Exception as e:
        if verbose:
            print(f"[Warning] Open3D Poisson meshing failed ({e}), falling back to hull")
        return fallback_trimesh_hull()

def main():
    parser = get_args_parser()
    args = parser.parse_args()

    candidate_roots = [
        os.environ.get("MUST3R_ROOT"),
        os.path.expanduser("~/must3r"),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../must3r")),
    ]
    for cp in candidate_roots:
        if cp and os.path.isdir(cp):
            if cp not in sys.path:
                sys.path.insert(0, cp)
            dust3r_path = os.path.join(cp, "dust3r")
            if os.path.isdir(dust3r_path) and dust3r_path not in sys.path:
                sys.path.insert(0, dust3r_path)
            croco_path = os.path.join(dust3r_path, "croco")
            if os.path.isdir(croco_path) and croco_path not in sys.path:
                sys.path.insert(0, croco_path)

    try:
        from must3r.model import load_model
        from must3r.model.blocks.attention import toggle_memory_efficient_attention, has_xformers
        from must3r.demo.gradio import get_reconstructed_scene
    except ImportError as e:
        print(f"[MUSt3R Engine Error] Could not import must3r: {e}", file=sys.stderr)
        print("Ensure MUST3R_ROOT is in PYTHONPATH and submodules are initialized.", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)

    toggle_memory_efficient_attention(enabled=has_xformers)

    valid_exts = (".jpg", ".jpeg", ".png", ".webp")
    images = sorted([
        os.path.join(args.image_dir, f)
        for f in os.listdir(args.image_dir)
        if os.path.isfile(os.path.join(args.image_dir, f)) and f.lower().endswith(valid_exts)
    ])

    if len(images) < 2:
        print(f"[Error] At least 2 images required, found {len(images)} in {args.image_dir}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.output, exist_ok=True)

    device = args.device
    if device == "mps" and not torch.backends.mps.is_available():
        print("[Device Notice] MPS not available on this system, falling back to CPU")
        device = "cpu"
    elif device == "cuda" and not torch.cuda.is_available():
        print("[Device Notice] CUDA not available on this system, falling back to CPU")
        device = "cpu"

    print(f"[MUSt3R Engine] Loading model weights from: {args.weights} on {device}...")
    model = load_model(
        args.weights,
        encoder=args.encoder,
        decoder=args.decoder,
        device=device,
        img_size=args.image_size,
        memory_mode=args.memory_mode
    )

    num_mem_imgs = min(args.num_mem_imgs, len(images))
    cam_size = args.cam_size
    execution_mode = args.execution_mode

    if execution_mode == "retrieval" and (not args.retrieval or not os.path.isfile(args.retrieval)):
        print("[Notice] Retrieval weights not found. Falling back to sequential mode (linseq).")
        execution_mode = "linseq"

    print(f"[MUSt3R Engine] Reconstructing {len(images)} views (mode: {execution_mode}, size: {args.image_size}px, bs: {args.max_bs})...")

    scene, _ = get_reconstructed_scene(
        outdir=args.output,
        viser_server=None,
        should_save_glb=False,
        model=model,
        retrieval=args.retrieval if execution_mode == "retrieval" else None,
        device=device,
        verbose=True,
        image_size=args.image_size,
        amp=args.amp,
        filelist=images,
        min_conf_thr=1.05,
        as_pointcloud=True,
        transparent_cams=False,
        local_pointmaps=False,
        cam_size=cam_size,
        num_mem_images=num_mem_imgs,
        max_bs=args.max_bs,
        render_once=args.render_once,
        camera_conf_thr=args.camera_conf_thr,
        num_refinements_iterations=args.num_refinements_iterations,
        execution_mode=execution_mode,
        vidseq_local_context_size=args.local_context_size,
        keyframe_interval=args.keyframe_interval,
        slam_local_context_size=args.local_context_size,
        subsample=args.subsample,
        min_conf_keyframe=args.min_conf_keyframe,
        keyframe_overlap_thr=args.keyframe_overlap_thr,
        overlap_percentile=args.overlap_percentile
    )

    target_clean_conf = max(2.5, args.min_conf_thr)
    print(f"[Clean Exporter] Generating pristine primary model (Confidence: {target_clean_conf}, SOR: ON, Edge Filter: ON)...")
    
    primary_glb = export_clean_scene_glb(
        args.output,
        scene,
        min_conf_thr=target_clean_conf,
        filename="scene.glb",
        flying_edges_thr=args.flying_edges_thr,
        cam_size=cam_size,
        verbose=True
    )
    
    export_clean_scene_glb(
        args.output,
        scene,
        min_conf_thr=target_clean_conf,
        filename="scene.ply",
        flying_edges_thr=args.flying_edges_thr,
        cam_size=cam_size,
        verbose=True
    )

    precision_tiers = [
        (4.5, "scene_ultra.glb"),
        (3.5, "scene_clean.glb"),
        (2.5, "scene_balanced.glb"),
        (1.8, "scene_dense.glb"),
        (5.0, "scene_5.0.glb"),
        (3.0, "scene_3.0.glb"),
        (2.0, "scene_2.0.glb"),
        (1.5, "scene_1.5.glb"),
    ]

    for conf_val, fname in precision_tiers:
        try:
            export_clean_scene_glb(
                args.output,
                scene,
                min_conf_thr=conf_val,
                filename=fname,
                flying_edges_thr=args.flying_edges_thr,
                cam_size=cam_size,
                verbose=False
            )
        except Exception:
            continue

    with open(os.path.join(args.output, "scene.pkl"), "wb") as f:
        pickle.dump(scene, f)

    if primary_glb and os.path.isfile(primary_glb):
        print(f"SUCCESS: High-precision clean 3D scene saved to {primary_glb}")
        sys.exit(0)
    else:
        fallback_glb = export_clean_scene_glb(
            args.output,
            scene,
            min_conf_thr=2.0,
            filename="scene.glb",
            flying_edges_thr=0.08,
            cam_size=cam_size,
            verbose=True
        )
        if fallback_glb and os.path.isfile(fallback_glb):
            print(f"SUCCESS: Clean 3D scene exported with fallback threshold to {fallback_glb}")
            sys.exit(0)
        print("[Error] Could not export 3D model from scene.", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
