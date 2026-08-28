"""
Normal map -> Ambient Occlusion, via a curvature/cavity approximation.

This is NOT true ambient occlusion (that requires 3D geometry/height data
and ray/horizon sampling) - it's a fast, fully-vectorized local estimate:
concave creases (where the surface curves inward) read as slightly
occluded; convex edges and flat areas stay fully lit.

Steps:
  1. Decode the normal map's R/G channels to Nx/Ny in [-1, 1].
  2. Sobel-filter Nx horizontally and Ny vertically and sum them -
     this approximates local surface curvature (divergence of the
     normal field). Negative = concave, positive = convex.
  3. Gaussian-blur the curvature field to suppress per-pixel noise
     from texture compression artifacts.
  4. Darken only the concave (negative-curvature) regions.
"""
import cv2
import numpy as np
from .utils import blur_kernel_size, compute_sobel_gradients, clamp_0_1


def normal_to_ao(normal_rgb, blur_radius=3, strength=1.5):
    """
    normal_rgb: float array in [0, 1], shape (H, W, 3), RGB order.
    blur_radius: Gaussian blur kernel radius (pixels) applied to the
        curvature field before darkening. Larger = smoother, broader
        occlusion; smaller = tighter to fine detail.
    strength: multiplier on how dark concave regions get.
    Returns a float array in [0, 1] (single channel AO map, 1 = fully lit).
    """
    # Decode tangent-space normal: R,G -> X,Y in [-1, 1]. (Z/blue channel
    # isn't needed for this curvature estimate.)
    nx = normal_rgb[:, :, 0] * 2.0 - 1.0
    ny = normal_rgb[:, :, 1] * 2.0 - 1.0

    dnx_dx, _ = compute_sobel_gradients(nx)
    _, dny_dy = compute_sobel_gradients(ny)
    curvature = dnx_dx + dny_dy

    ksize = blur_kernel_size(blur_radius)  # must be odd
    curvature = cv2.GaussianBlur(curvature, (ksize, ksize), 0)

    occlusion = clamp_0_1(-curvature * strength)
    return 1.0 - occlusion
