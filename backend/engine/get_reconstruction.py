#!/usr/bin/env python3
# Copyright (C) 2025-present Naver Corporation. All rights reserved.
#
# --------------------------------------------------------
# MUSt3R demo executable for exporting reconstructions
# --------------------------------------------------------
import os
import sys
import argparse
import pickle
import traceback

import torch
import matplotlib.pyplot as pl
pl.ion()

torch.backends.cuda.matmul.allow_tf32 = True  # for gpu >= Ampere and pytorch >= 1.12


def get_args_parser():
    parser = argparse.ArgumentParser(description="MUSt3R 3D Scene Reconstruction Executable")
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
    parser.add_argument("--min_conf_keyframe", type=float, default=1.5)
    parser.add_argument("--keyframe_overlap_thr", type=float, default=0.05)
    parser.add_argument("--overlap_percentile", type=float, default=85)
    parser.add_argument("--cam_size", type=float, default=0.05)
    parser.add_argument("--camera_conf_thr", type=float, default=0.0)
    parser.add_argument("--file_type", type=str, default="glb", choices=["glb", "ply"])
    return parser


def main():
    parser = get_args_parser()
    args = parser.parse_args()

    # Import must3r modules dynamically
    try:
        from must3r.model import load_model
        from must3r.model.blocks.attention import toggle_memory_efficient_attention, has_xformers
        from must3r.demo.gradio import get_reconstructed_scene, get_3D_model_from_scene
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

    # Device fallback check
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
    min_conf_thr = 1.05
    cam_size = args.cam_size
    execution_mode = args.execution_mode

    # If retrieval mode requested but retrieval weights missing, fallback to linseq
    if execution_mode == "retrieval" and (not args.retrieval or not os.path.isfile(args.retrieval)):
        print("[Notice] Retrieval weights not found. Falling back to sequential mode (linseq).")
        execution_mode = "linseq"

    print(f"[MUSt3R Engine] Reconstructing {len(images)} views (mode: {execution_mode}, size: {args.image_size}px, bs: {args.max_bs})...")

    scene, outfile = get_reconstructed_scene(
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
        min_conf_thr=min_conf_thr,
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

    # Export multi-confidence thresholds
    threshold_list = [6.0, 5.0, 4.0, 3.0, 2.5, 2.0, 1.5, min_conf_thr]
    saved_any = False
    for thr in threshold_list:
        try:
            outfile = get_3D_model_from_scene(
                outdir=args.output,
                verbose=True,
                scene=scene,
                min_conf_thr=thr,
                as_pointcloud=True,
                transparent_cams=False,
                cam_size=cam_size,
                filename=f"scene_{thr}.{args.file_type}"
            )
            saved_any = True
        except Exception as e:
            continue

    # Also save the primary scene.glb / scene.ply
    try:
        get_3D_model_from_scene(
            outdir=args.output,
            verbose=True,
            scene=scene,
            min_conf_thr=min_conf_thr,
            as_pointcloud=True,
            transparent_cams=False,
            cam_size=cam_size,
            filename=f"scene.{args.file_type}"
        )
        saved_any = True
    except Exception as e:
        print(f"[Warning] Could not export standard scene.{args.file_type}: {e}")

    with open(os.path.join(args.output, "scene.pkl"), "wb") as f:
        pickle.dump(scene, f)

    if saved_any:
        print(f"SUCCESS: 3D scene reconstructed and saved to {args.output}")
        sys.exit(0)
    else:
        print("[Error] No 3D model could be exported from scene.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
