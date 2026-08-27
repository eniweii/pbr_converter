"""
Diffuse-only PBR map derivation - the fallback path used when a material
has no scanned _S (spec) or _N (normal) source to work from.

This mirrors the general approach tools like AwesomeBump use when only a
base color/diffuse image is available: treat luma as a pseudo-heightmap,
then derive everything else from that height field. It is NOT a literal
port of AwesomeBump's source (which isn't available here) - it's a
from-scratch implementation of the same *idea*, so results will be in the
same family but won't be pixel-identical to AwesomeBump's output.

Chain:
    diffuse -> height              (diffuse_to_height)
    height  -> normal              (height_to_normal)
    height  -> ao                  (height_to_ao)
    diffuse -> roughness (approx)  (diffuse_to_roughness)
    diffuse -> metalness (approx)  (diffuse_to_metal_approx)

All functions take/return float arrays in [0, 1], same convention as
io_utils.load_gray / load_rgb, so callers can chain these directly with
the existing load_* / save_gray helpers.

Metalness in particular is a weak approximation - diffuse color alone
does not reliably encode metalness - and should always be labeled as
such wherever it's surfaced in the UI.
"""
import cv2
import numpy as np


def diffuse_to_height(diffuse_rgb, weights=(0.299, 0.587, 0.114), blur_radius=1, contrast=1.0):
    """
    Collapses a diffuse image to a pseudo-heightmap via a weighted
    grayscale mix (default weights are standard luma; AwesomeBump exposes
    these as adjustable per-channel sliders, hence the parameter).

    diffuse_rgb: float array in [0, 1], shape (H, W, 3), RGB order.
    weights: (r, g, b) mix weights, need not sum to 1 (normalized here).
    blur_radius: light Gaussian blur radius (pixels) to suppress
        compression-artifact noise before it propagates into the normal/AO
        derivation. 0 disables blurring.
    contrast: >1 exaggerates height variation around the midpoint, <1
        flattens it. 1.0 = no change.
    Returns a float array in [0, 1] (single channel).
    """
    w = np.asarray(weights, dtype=np.float32)
    w = w / w.sum()
    height = (
        diffuse_rgb[:, :, 0] * w[0]
        + diffuse_rgb[:, :, 1] * w[1]
        + diffuse_rgb[:, :, 2] * w[2]
    ).astype(np.float32)

    if blur_radius > 0:
        ksize = max(1, blur_radius) * 2 + 1
        height = cv2.GaussianBlur(height, (ksize, ksize), 0)

    if contrast != 1.0:
        height = np.clip(0.5 + (height - 0.5) * contrast, 0.0, 1.0)

    return height.astype(np.float32)


def height_to_normal(height, strength=2.0, blur_radius=0):
    """
    Converts a heightfield to a tangent-space normal map via Sobel
    gradients - the inverse operation of what cavity_ao.normal_to_ao does
    when reading an existing normal map.

    height: float array in [0, 1], shape (H, W).
    strength: gradient scale ("bumpiness" / conversion depth). Higher
        values produce more pronounced normals from the same height data.
    blur_radius: optional extra smoothing pass immediately before the
        Sobel filter, independent of any blur already applied when the
        height was generated. 0 disables it.
    Returns a float array in [0, 1], shape (H, W, 3), RGB order, ready to
    save as a standard tangent-space normal map.
    """
    h = height
    if blur_radius > 0:
        ksize = max(1, blur_radius) * 2 + 1
        h = cv2.GaussianBlur(h, (ksize, ksize), 0)

    dx = cv2.Sobel(h, cv2.CV_32F, 1, 0, ksize=3)
    dy = cv2.Sobel(h, cv2.CV_32F, 0, 1, ksize=3)

    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(h, dtype=np.float32)

    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    length = np.maximum(length, 1e-6)
    nx /= length
    ny /= length
    nz /= length

    normal = np.stack([nx, ny, nz], axis=-1)
    return (normal * 0.5 + 0.5).astype(np.float32)


def _shift_bilinear(field, shift_x, shift_y):
    """Sub-pixel shift of a 2D field via an affine warp, edge-replicated."""
    h, w = field.shape
    matrix = np.float32([[1, 0, shift_x], [0, 1, shift_y]])
    return cv2.warpAffine(
        field, matrix, (w, h),
        flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE,
    )


def height_to_ao(height, samples=8, radius=4.0, steps=4, strength=1.0):
    """
    Approximate ambient occlusion from a heightfield via horizon sampling:
    for several directions around each pixel, walks outward a few steps
    and measures how much higher the surrounding terrain gets relative to
    distance. Pixels surrounded by taller neighbors read as more occluded.

    This is closer to a real (if 2.5D) AO pass than a pure curvature
    trick, at the cost of being more expensive - cost scales with
    samples * steps full-image warps.

    height: float array in [0, 1], shape (H, W).
    samples: number of directions sampled around each pixel.
    radius: maximum sample distance in pixels.
    steps: number of distances sampled per direction, from radius/steps
        out to radius.
    strength: multiplier on the resulting occlusion before it's clamped.
    Returns a float array in [0, 1] (single channel AO map, 1 = fully lit).
    """
    occlusion = np.zeros_like(height, dtype=np.float32)
    angles = np.linspace(0, 2 * np.pi, samples, endpoint=False)
    step_radii = np.linspace(radius / steps, radius, steps)

    for angle in angles:
        dx = np.cos(angle)
        dy = np.sin(angle)
        direction_max = np.zeros_like(height, dtype=np.float32)
        for r in step_radii:
            shifted = _shift_bilinear(height, dx * r, dy * r)
            # Positive when the sampled neighbor is higher than this
            # pixel; normalized by distance so far/near samples are
            # comparable (a simple horizon-angle stand-in).
            rise = (shifted - height) / max(r, 1e-5)
            direction_max = np.maximum(direction_max, rise)
        occlusion += np.clip(direction_max, 0.0, None)

    occlusion /= samples
    ao = 1.0 - np.clip(occlusion * strength, 0.0, 1.0)
    return ao.astype(np.float32)


def diffuse_to_roughness(diffuse_rgb_or_height, sensitivity=1.0, kernel_size=5):
    """
    Approximates roughness from local contrast: busier/higher-frequency
    regions of the source (grain, edges, texture detail) are treated as
    rougher; flat, even regions read as smoother.

    diffuse_rgb_or_height: either a float RGB array in [0, 1] (H, W, 3)
        or an already-derived single-channel height/gray array (H, W).
    sensitivity: multiplier on the local-contrast signal before clamping.
    kernel_size: box filter size (pixels) used to measure local variance.
    Returns a float array in [0, 1] (single channel).
    """
    if diffuse_rgb_or_height.ndim == 3:
        gray = cv2.cvtColor(diffuse_rgb_or_height, cv2.COLOR_RGB2GRAY)
    else:
        gray = diffuse_rgb_or_height

    gray = gray.astype(np.float32)
    mean = cv2.boxFilter(gray, -1, (kernel_size, kernel_size))
    sq_mean = cv2.boxFilter(gray * gray, -1, (kernel_size, kernel_size))
    variance = np.clip(sq_mean - mean * mean, 0.0, None)
    local_contrast = np.sqrt(variance)

    roughness = np.clip(local_contrast * sensitivity * 4.0, 0.0, 1.0)
    return roughness.astype(np.float32)


def diffuse_to_metal_approx(diffuse_rgb, low=0.5, high=0.85):
    """
    Rough metalness approximation from diffuse color alone: low
    saturation combined with mid-to-high brightness scores as more
    "metal-like". This is a heuristic, not a reliable metalness signal -
    always label results from this function as an approximation in the UI.

    diffuse_rgb: float array in [0, 1], shape (H, W, 3), RGB order.
    low/high: smoothstep cutoffs in [0, 1], low < high - same shape as
        metalness.spec_to_metallic for UI/parameter consistency.
    Returns a float array in [0, 1].
    """
    if not (0.0 <= low < high <= 1.0):
        raise ValueError("Require 0 <= low < high <= 1")

    rgb_u8 = np.clip(diffuse_rgb * 255.0, 0, 255).astype(np.uint8)
    hsv = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2HSV)
    saturation = hsv[:, :, 1].astype(np.float32) / 255.0
    value = hsv[:, :, 2].astype(np.float32) / 255.0

    metal_score = value * (1.0 - saturation)
    t = np.clip((metal_score - low) / (high - low), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)  # smoothstep
