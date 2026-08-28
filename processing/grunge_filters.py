"""
Grunge and detail enhancement filters - ported from AwesomeBump.

These functions add procedural wear, dirt, and surface variation to PBR maps:
- Grunge overlay with randomization
- Small/medium detail enhancement
- Noise addition for breaking up uniformity
- Edge wear simulation

All functions work with float arrays in [0, 1].
"""
import cv2
import numpy as np
from .utils import clamp_0_1, apply_gaussian_blur


def generate_grunge(size=1024, seed=None, contrast=1.5, brightness=0.5):
    """
    Generates a procedural grunge map using layered noise and distortion.
    
    This creates a tileable grayscale texture suitable for overlaying on
    roughness, metalness, or height maps to add realistic wear patterns.
    
    size: output resolution (square)
    seed: random seed for reproducibility (None = random)
    contrast: grunge pattern contrast (>1 = sharper edges)
    brightness: overall brightness offset
    Returns single-channel float array in [0, 1].
    """
    if seed is not None:
        np.random.seed(seed)
    
    # Base noise layer
    grunge = np.random.rand(size, size).astype(np.float32)
    grunge = cv2.GaussianBlur(grunge, (0, 0), sigmaX=8)
    
    # Add mid-frequency details
    mid_freq = np.random.rand(size, size).astype(np.float32)
    mid_freq = cv2.GaussianBlur(mid_freq, (0, 0), sigmaX=4)
    grunge = cv2.addWeighted(grunge, 0.7, mid_freq, 0.3, 0)
    
    # Add high-frequency speckles
    speckles = np.random.rand(size, size).astype(np.float32)
    speckles = (speckles > 0.7).astype(np.float32)
    speckles = cv2.GaussianBlur(speckles, (0, 0), sigmaX=2)
    grunge = cv2.addWeighted(grunge, 0.8, speckles, 0.2, 0)
    
    # Apply contrast
    grunge = 0.5 + (grunge - 0.5) * contrast
    grunge = clamp_0_1(grunge + brightness - 0.5)
    
    return grunge.astype(np.float32)


def apply_grunge_overlay(base_map, grunge_map, mode='multiply', strength=0.5):
    """
    Overlays a grunge map onto any PBR channel using various blend modes.
    
    base_map: input map (height, roughness, metalness, etc.), single channel [0, 1]
    grunge_map: grunge texture, single channel [0, 1], same dimensions
    mode: 'multiply' (darkens), 'screen' (lightens), 'overlay' (contrast), 
          'add' (brightens), 'subtract' (darkens)
    strength: blend factor 0-1
    Returns modified map.
    """
    if base_map.shape != grunge_map.shape:
        grunge_map = cv2.resize(grunge_map, (base_map.shape[1], base_map.shape[0]))
    
    if mode == 'multiply':
        result = base_map * grunge_map
    elif mode == 'screen':
        result = 1.0 - (1.0 - base_map) * (1.0 - grunge_map)
    elif mode == 'overlay':
        result = np.where(base_map < 0.5,
                         2.0 * base_map * grunge_map,
                         1.0 - 2.0 * (1.0 - base_map) * (1.0 - grunge_map))
    elif mode == 'add':
        result = clamp_0_1(base_map + grunge_map)
    elif mode == 'subtract':
        result = clamp_0_1(base_map - grunge_map)
    else:
        raise ValueError(f"Unknown blend mode: {mode}")
    
    # Blend with original based on strength
    return clamp_0_1(base_map * (1.0 - strength) + result * strength)


def add_noise(input_map, amount=0.05, monochrome=True, seed=None):
    """
    Adds film grain or sensor noise to break up CG uniformity.
    
    Useful for roughness and height maps to simulate microscopic surface
    imperfections that aren't captured in scans.
    
    input_map: input array (single or multi-channel)
    amount: noise amplitude 0-1
    monochrome: if True, use same noise for all channels (more natural)
    seed: random seed for reproducibility
    Returns noisy map in [0, 1].
    """
    if seed is not None:
        np.random.seed(seed)
    
    shape = input_map.shape
    if monochrome and input_map.ndim == 3:
        # Generate single-channel noise, replicate across channels
        noise = np.random.randn(shape[0], shape[1]).astype(np.float32)
        noise = np.stack([noise] * shape[2], axis=-1)
    else:
        noise = np.random.randn(*shape).astype(np.float32)
    
    noisy = input_map + noise * amount
    return clamp_0_1(noisy)


def enhance_small_details(input_map, strength=0.3, radius=1):
    """
    Enhances fine surface details using unsharp masking.
    
    Similar to AwesomeBump's "Small Details" filter - boosts high-frequency
    content while preserving the overall tonal range.
    
    input_map: input array (height, normal components, roughness, etc.)
    strength: enhancement intensity 0-1
    radius: blur radius for creating the mask
    Returns enhanced map.
    """
    if strength <= 0:
        return input_map.copy()
    
    # Create blurred version (low-pass)
    blurred = apply_gaussian_blur(input_map, radius)
    
    # High-pass = original - blurred
    high_pass = input_map - blurred
    
    # Add scaled high-pass back to original
    enhanced = input_map + high_pass * strength
    
    return clamp_0_1(enhanced)


def enhance_medium_details(input_map, strength=0.5, radius_low=2, radius_high=6):
    """
    Enhances mid-frequency details using difference-of-Gaussians.
    
    Targets features larger than fine grain but smaller than major forms -
    perfect for enhancing weathering, scratches, and surface texture.
    
    input_map: input array
    strength: enhancement intensity
    radius_low: smaller Gaussian radius
    radius_high: larger Gaussian radius
    Returns enhanced map.
    """
    if strength <= 0:
        return input_map.copy()
    
    # Difference of Gaussians = band-pass filter
    blur1 = apply_gaussian_blur(input_map, radius_low)
    blur2 = apply_gaussian_blur(input_map, radius_high)
    band_pass = blur1 - blur2
    
    # Add to original
    enhanced = input_map + band_pass * strength
    return clamp_0_1(enhanced)


def simulate_edge_wear(height_or_normal, wear_amount=0.3, blur_radius=2):
    """
    Simulates paint wear and chipping at raised edges.
    
    Uses height/normal information to identify exposed edges where paint
    would naturally wear away first. Outputs a wear mask suitable for
    modifying roughness or metalness.
    
    height_or_normal: height map (single channel) OR normal map (RGB)
    wear_amount: intensity of wear effect 0-1
    blur_radius: softening radius for wear mask
    Returns wear mask in [0, 1] (higher = more worn/exposed).
    """
    # Detect edges using gradient magnitude
    if height_or_normal.ndim == 3:
        # Normal map - use XY component magnitude as edge indicator
        nx = height_or_normal[:, :, 0] * 2.0 - 1.0
        ny = height_or_normal[:, :, 1] * 2.0 - 1.0
        edge_strength = np.sqrt(nx * nx + ny * ny)
    else:
        # Height map - compute gradients
        dx = cv2.Sobel(height_or_normal, cv2.CV_32F, 1, 0, ksize=3)
        dy = cv2.Sobel(height_or_normal, cv2.CV_32F, 0, 1, ksize=3)
        edge_strength = np.sqrt(dx * dx + dy * dy)
        # Normalize
        edge_strength = edge_strength / max(edge_strength.max(), 1e-6)
    
    # Blur to soften wear edges
    wear_mask = apply_gaussian_blur(edge_strength, blur_radius)
    
    # Scale by wear amount
    wear_mask = clamp_0_1(wear_mask * wear_amount * 3.0)
    
    return wear_mask.astype(np.float32)


def remove_shading(diffuse_rgb, ao_map=None, light_direction=(0, 0, 1)):
    """
    Attempts to remove baked lighting/shadows from diffuse textures.
    
    This is a simplified version of AwesomeBump's "Remove Shading" filter.
    It uses AO and/or normal-based lighting estimation to flatten out
    uneven illumination.
    
    diffuse_rgb: diffuse/albedo map, RGB float array in [0, 1]
    ao_map: optional ambient occlusion map (if None, estimated from diffuse)
    light_direction: assumed primary light direction (x, y, z)
    Returns de-lit diffuse map.
    """
    if ao_map is None:
        # Estimate AO from diffuse luminance variance
        gray = cv2.cvtColor(diffuse_rgb, cv2.COLOR_RGB2GRAY)
        ao_map = cv2.GaussianBlur(gray, (0, 0), sigmaX=10)
        ao_map = 1.0 - clamp_0_1((gray - ao_map) * 2.0)
    
    # Normalize AO to avoid overcorrection
    ao_mean = ao_map.mean()
    ao_normalized = ao_map / max(ao_mean, 0.1)
    ao_normalized = clamp_0_1(ao_normalized)
    
    # Divide out lighting (inverse of multiplicative shading)
    # Add small epsilon to avoid division by zero
    corrected = diffuse_rgb / np.maximum(ao_normalized[:, :, np.newaxis], 0.1)
    
    return clamp_0_1(corrected)


def warp_normals_with_grunge(normal_rgb, grunge_map, warp_strength=0.1):
    """
    Distorts normal map directions using a grunge texture.
    
    Creates organic variation in surface normals, useful for weathered
    surfaces where dirt and wear affect micro-geometry.
    
    normal_rgb: tangent-space normal map, RGB in [0, 1]
    grunge_map: grayscale distortion map in [0, 1]
    warp_strength: maximum distortion angle (as fraction of 90 degrees)
    Returns warped normal map.
    """
    # Decode normals
    nx = normal_rgb[:, :, 0] * 2.0 - 1.0
    ny = normal_rgb[:, :, 1] * 2.0 - 1.0
    nz = normal_rgb[:, :, 2] * 2.0 - 1.0
    
    # Compute gradient of grunge for perturbation direction
    gx = cv2.Sobel(grunge_map, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(grunge_map, cv2.CV_32F, 0, 1, ksize=3)
    
    # Scale perturbation
    scale = warp_strength * 0.5
    nx_perturbed = nx + gx * scale
    ny_perturbed = ny + gy * scale
    nz_perturbed = nz
    
    # Renormalize
    length = np.sqrt(nx_perturbed**2 + ny_perturbed**2 + nz_perturbed**2)
    length = np.maximum(length, 1e-6)
    nx_perturbed /= length
    ny_perturbed /= length
    nz_perturbed /= length
    
    # Encode back
    return np.stack([nx_perturbed, ny_perturbed, nz_perturbed], axis=-1) * 0.5 + 0.5
