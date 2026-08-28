"""
Normal map enhancement filters - ported from AwesomeBump's GLSL shaders.

These filters operate on tangent-space normal maps (RGB, [0, 1]) to:
- Expand or contract the apparent bump height
- Correct normal angles for better lighting response
- Mix multiple detail levels together
- Apply edge-preserving smoothing or sharpening
- Convert between normal map representations

All functions take/return float arrays in [0, 1], RGB order.
"""
import cv2
import numpy as np
from .utils import compute_sobel_gradients, clamp_0_1, apply_gaussian_blur


def normal_expand(normal_rgb, strength=1.0):
    """
    Expands or contracts the Z component of normals to exaggerate or reduce
    the apparent bump height without changing the XY directions.
    
    This is useful for making subtle normal maps more pronounced, or for
    toning down overly aggressive baking results.
    
    normal_rgb: tangent-space normal map, float array in [0, 1], RGB order
    strength: >1 expands (more bumpy), <1 contracts (flatter), 1 = no change
    Returns expanded/contracted normal map in same format.
    """
    # Decode normals to [-1, 1]
    nx = normal_rgb[:, :, 0] * 2.0 - 1.0
    ny = normal_rgb[:, :, 1] * 2.0 - 1.0
    nz = normal_rgb[:, :, 2] * 2.0 - 1.0
    
    # Scale Z component
    nz = np.sign(nz) * np.power(np.abs(nz), 1.0 / max(strength, 0.01))
    
    # Renormalize
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    length = np.maximum(length, 1e-6)
    nx /= length
    ny /= length
    nz /= length
    
    # Encode back to [0, 1]
    return np.stack([nx, ny, nz], axis=-1) * 0.5 + 0.5


def normal_angle_correction(normal_rgb, angle_degrees=5.0):
    """
    Rotates normals toward the surface normal (0, 0, 1) by a fixed angle.
    
    This corrects for common baking artifacts where normals point too far
    sideways, causing harsh silhouette edges or incorrect lighting at
    grazing angles.
    
    normal_rgb: tangent-space normal map, float array in [0, 1], RGB order
    angle_degrees: maximum rotation angle toward Z+ (typical: 3-10 degrees)
    Returns corrected normal map.
    """
    # Decode to [-1, 1]
    nx = normal_rgb[:, :, 0] * 2.0 - 1.0
    ny = normal_rgb[:, :, 1] * 2.0 - 1.0
    nz = normal_rgb[:, :, 2] * 2.0 - 1.0
    
    # Convert angle to radians and compute rotation factor
    angle_rad = np.deg2rad(angle_degrees)
    cos_a = np.cos(angle_rad)
    sin_a = np.sin(angle_rad)
    
    # Compute current angle from Z axis for each pixel
    xy_length = np.sqrt(nx * nx + ny * ny)
    current_angle = np.arctan2(xy_length, nz)
    
    # Reduce angle toward zero, but don't flip direction
    with np.errstate(divide='ignore', invalid='ignore'):
        scale = np.where(current_angle > 0, 
                         np.maximum(0, current_angle - angle_rad) / current_angle,
                         1.0)
    scale = np.nan_to_num(scale, nan=1.0)
    
    # Apply scaling to XY components, recompute Z
    nx_new = nx * scale
    ny_new = ny * scale
    nz_new = np.sqrt(np.maximum(0, 1.0 - nx_new * nx_new - ny_new * ny_new))
    
    # Preserve original Z sign (should always be positive for tangent space)
    nz_new = nz_new * np.sign(nz)
    
    # Encode back to [0, 1]
    return np.stack([nx_new, ny_new, nz_new], axis=-1) * 0.5 + 0.5


def normal_sharpen_blur(normal_rgb, sigma=1.0, strength=0.5):
    """
    Applies either sharpening or blurring to a normal map while preserving
    the unit-length constraint. Uses difference-of-Gaussians approach.
    
    Positive strength sharpens (enhances high-frequency detail).
    Negative strength blurs (smooths out noise or compression artifacts).
    
    normal_rgb: tangent-space normal map, float array in [0, 1], RGB order
    sigma: Gaussian kernel standard deviation in pixels
    strength: -1 to +1, negative=blur, positive=sharpen, 0=no effect
    Returns filtered normal map.
    """
    if abs(strength) < 0.01:
        return normal_rgb.copy()
    
    # Decode to [-1, 1]
    n = normal_rgb * 2.0 - 1.0
    
    # Apply Gaussian blur
    blurred = np.zeros_like(n)
    for c in range(3):
        blurred[:, :, c] = cv2.GaussianBlur(n[:, :, c], (0, 0), sigma)
    
    if strength > 0:
        # Sharpen: original + strength * (original - blurred)
        result = n + strength * (n - blurred)
    else:
        # Blur: original + strength * (blurred - original) = lerp(original, blurred, -strength)
        result = n + strength * (blurred - n)
    
    # Renormalize to unit length
    length = np.sqrt(np.sum(result * result, axis=-1, keepdims=True))
    length = np.maximum(length, 1e-6)
    result /= length
    
    # Encode back to [0, 1]
    return result * 0.5 + 0.5


def normal_mix_levels(level0, level1=None, level2=None, level3=None,
                      weights=(1.0, 0.5, 0.25, 0.125)):
    """
    Combines multiple normal maps at different scales (detail levels) into
    a single output. This is how AAA games layer micro-detail normals over
    medium-scale surface structure.
    
    Each level should be progressively lower-frequency (blurrier) versions
    of the same base normal map, or entirely different detail scales.
    
    level0: finest detail level (required), RGB float array in [0, 1]
    level1-3: progressively coarser levels (optional), same format
    weights: relative influence of each level (will be normalized)
    Returns combined normal map.
    """
    levels = [level0, level1, level2, level3]
    active_levels = [(lvl, w) for lvl, w in zip(levels, weights[:len(levels)]) 
                     if lvl is not None and w > 0]
    
    if len(active_levels) == 1:
        return active_levels[0][0].copy()
    
    # Decode all to [-1, 1]
    decoded = []
    total_weight = 0.0
    for lvl, w in active_levels:
        n = lvl * 2.0 - 1.0
        decoded.append((n, w))
        total_weight += w
    
    # Normalize weights
    decoded = [(n, w / total_weight) for n, w in decoded]
    
    # Accumulate XY components linearly (standard practice for normal blending)
    nx_acc = np.zeros_like(decoded[0][0][:, :, 0])
    ny_acc = np.zeros_like(nx_acc)
    nz_acc = np.ones_like(nx_acc)  # Start with Z pointing up
    
    for n, w in decoded:
        nx_acc += n[:, :, 0] * w
        ny_acc += n[:, :, 1] * w
        # Z is recomputed after normalization
    
    # Reconstruct Z and normalize
    nz_acc = np.sqrt(np.maximum(0, 1.0 - nx_acc * nx_acc - ny_acc * ny_acc))
    
    # Encode back to [0, 1]
    return np.stack([nx_acc, ny_acc, nz_acc], axis=-1) * 0.5 + 0.5


def normal_to_height(normal_rgb, method='sobel', strength=1.0):
    """
    Extracts a pseudo-heightfield from a normal map. This is the inverse
    operation of height_to_normal, useful for creating displacement maps
    from existing normal maps.
    
    NOTE: This is an approximation - true height recovery requires
    integration and boundary conditions that aren't available from local
    normals alone. Results work well for visual purposes but won't match
    the original height exactly.
    
    normal_rgb: tangent-space normal map, float array in [0, 1], RGB order
    method: 'sobel' (fast, local) or 'poisson' (slower, global integration)
    strength: multiplier on resulting height values
    Returns single-channel float array in [0, 1].
    """
    # Decode normals
    nx = normal_rgb[:, :, 0] * 2.0 - 1.0
    ny = normal_rgb[:, :, 1] * 2.0 - 1.0
    
    if method == 'sobel':
        # Use Sobel gradients inversely - integrate X/Y normals
        # This is fast but accumulates error over distance
        dx = nx  # Normal X approximates dZ/dx
        dy = ny  # Normal Y approximates dZ/dy
        
        # Simple integration via cumulative sum (crude but fast)
        height = np.cumsum(np.cumsum(dx, axis=1), axis=0) * 0.01
        height += np.cumsum(np.cumsum(dy, axis=0), axis=1) * 0.01
        height *= strength
        
    elif method == 'poisson':
        # Better: solve Poisson equation div(grad h) = div(n_xy)
        # This gives globally consistent heights
        div_n = np.zeros_like(nx)
        div_n[:-1, :] += nx[1:, :] - nx[:-1, :]
        div_n[:, :-1] += ny[:, 1:] - ny[:, :-1]
        
        # Simple iterative solver (Jacobi method)
        height = np.zeros_like(nx)
        for _ in range(50):  # Iterations for convergence
            new_height = np.zeros_like(height)
            new_height[1:-1, 1:-1] = 0.25 * (
                height[:-2, 1:-1] + height[2:, 1:-1] +
                height[1:-1, :-2] + height[1:-1, 2:] -
                div_n[1:-1, 1:-1]
            )
            height = new_height
        
        height = np.clip(height * strength, 0, 1)
    else:
        raise ValueError(f"Unknown method: {method}. Use 'sobel' or 'poisson'.")
    
    # Normalize to [0, 1]
    h_min, h_max = height.min(), height.max()
    if h_max - h_min > 1e-6:
        height = (height - h_min) / (h_max - h_min)
    
    return height.astype(np.float32)


def height_to_normal_detailed(height, method='central', strength=2.0):
    """
    Alternative height-to-normal conversion with multiple derivative methods.
    More control than the basic version in diffuse_derive.py.
    
    height: single-channel float array in [0, 1]
    method: 'central' (accurate), 'forward', 'backward', or 'sobel' (smoothed)
    strength: gradient scale factor
    Returns RGB normal map in [0, 1].
    """
    h = height.astype(np.float32)
    
    if method == 'central':
        # Central differences: most accurate for smooth heightfields
        dx = 0.5 * (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1))
        dy = 0.5 * (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0))
        # Fix edges
        dx[:, 0] = h[:, 1] - h[:, 0]
        dx[:, -1] = h[:, -1] - h[:, -2]
        dy[0, :] = h[1, :] - h[0, :]
        dy[-1, :] = h[-1, :] - h[-2, :]
        
    elif method == 'forward':
        dx = np.diff(h, axis=1, append=h[:, -1:])
        dy = np.diff(h, axis=0, append=h[-1:, :])
        
    elif method == 'backward':
        dx = np.diff(h, axis=1, prepend=h[:, :1])
        dy = np.diff(h, axis=0, prepend=h[:1, :])
        
    elif method == 'sobel':
        dx, dy = compute_sobel_gradients(h)
        
    else:
        raise ValueError(f"Unknown method: {method}")
    
    # Construct normal
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(h)
    
    # Normalize
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    length = np.maximum(length, 1e-6)
    nx /= length
    ny /= length
    nz /= length
    
    return np.stack([nx, ny, nz], axis=-1) * 0.5 + 0.5


def normal_invert_components(normal_rgb, invert_x=False, invert_y=False, invert_z=False):
    """
    Flips selected components of a normal map. Useful for converting between
    coordinate systems (DirectX vs OpenGL normals differ in Y axis) or for
    creative effects.
    
    normal_rgb: tangent-space normal map, float array in [0, 1], RGB order
    invert_x/y/z: whether to flip each component
    Returns modified normal map.
    """
    result = normal_rgb.copy()
    
    if invert_x:
        result[:, :, 0] = 1.0 - result[:, :, 0]
    if invert_y:
        result[:, :, 1] = 1.0 - result[:, :, 1]
    if invert_z:
        result[:, :, 2] = 1.0 - result[:, :, 2]
    
    return result
