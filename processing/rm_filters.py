"""
Roughness/Metalness filters based on AwesomeBump's RMFilterProp.

Implements two main filter types:
1. Noise Filter - adds procedural noise/detail using Gaussian blur + threshold
2. Color Filter - color-based masking and adjustment with picker, bias, offset, amplifier

These match AwesomeBump's glimageeditor.cpp implementation:
- applyRoughnessFilter() uses NoiseFilter (Depth, Treshold, Amplifier)
- applyRoughnessColorFilter() uses ColorFilter (PickColor, Method, Bias, Offset, InvertColors, Amplifier)
"""
import numpy as np
from .utils import smoothstep, apply_gaussian_blur, clamp_0_1


def apply_roughness_noise_filter(roughness, depth=3, threshold=0.5, amplifier=1.0):
    """
    AwesomeBump's applyRoughnessFilter - adds noise/detail to roughness map.
    
    Algorithm:
    1. Apply Gaussian blur with radius = depth
    2. Compare original vs blurred to detect edges/details
    3. Apply threshold to create noise mask
    4. Amplify and blend back
    
    Parameters:
        roughness: float array in [0, 1]
        depth: Gaussian blur radius (RMFilterProp.NoiseFilter.Depth)
        threshold: edge detection threshold (RMFilterProp.NoiseFilter.Treshold)
        amplifier: noise amplification factor (RMFilterProp.NoiseFilter.Amplifier)
    
    Returns:
        Enhanced roughness map with added noise/detail
    """
    # Apply Gaussian blur
    blurred = apply_gaussian_blur(roughness, radius=int(depth))
    
    # Detect details by comparing original vs blurred
    detail_mask = np.abs(roughness - blurred)
    
    # Apply threshold
    noise_mask = smoothstep(detail_mask, threshold * 0.5, threshold)
    
    # Generate noise pattern from detail differences
    noise = (detail_mask - threshold) * amplifier
    
    # Blend noise back into roughness
    result = roughness + noise * noise_mask
    return clamp_0_1(result)


def apply_roughness_color_filter(roughness, picked_color='#808080', method=0,
                                  bias=0.0, offset=0.0, invert=False, amplifier=1.0):
    """
    AwesomeBump's applyRoughnessColorFilter - color-based adjustment.
    
    Parameters:
        roughness: float array in [0, 1]
        picked_color: hex color string for comparison (RMFilterProp.ColorFilter.PickColor)
        method: 0=off, 1=add, 2=subtract, 3=multiply, 4=overlay (RMFilterProp.ColorFilter.Method)
        bias: color offset/bias (RMFilterProp.ColorFilter.Bias)
        offset: global offset (RMFilterProp.ColorFilter.Offset)
        invert: invert the mask (RMFilterProp.ColorFilter.InvertColors)
        amplifier: amplification factor (RMFilterProp.ColorFilter.Amplifier)
    
    Returns:
        Adjusted roughness map
    """
    # Parse picked color to grayscale
    color_hex = picked_color.lstrip('#')
    r = int(color_hex[0:2], 16) / 255.0
    g = int(color_hex[2:4], 16) / 255.0
    b = int(color_hex[4:6], 16) / 255.0
    picked_gray = 0.299 * r + 0.587 * g + 0.114 * b  # Luminance formula
    
    # Create mask based on distance from picked color
    if method == 0:  # Off - no change
        return roughness.copy()
    
    # Calculate similarity to picked color
    color_diff = np.abs(roughness - picked_gray)
    mask = 1.0 - smoothstep(color_diff, 0.0, 0.5)  # High where similar to picked color
    
    if invert:
        mask = 1.0 - mask
    
    result = roughness.copy()
    
    if method == 1:  # Add
        result = roughness + (bias + offset) * mask * amplifier
    elif method == 2:  # Subtract
        result = roughness - (bias + offset) * mask * amplifier
    elif method == 3:  # Multiply
        multiplier = 1.0 + (bias + offset) * amplifier
        result = roughness * (mask * multiplier + (1.0 - mask))
    elif method == 4:  # Overlay
        base = roughness * (1.0 + bias * amplifier)
        overlay = 1.0 - (1.0 - roughness) * (1.0 - offset * amplifier)
        result = np.where(roughness < 0.5, base, overlay)
        result = roughness + (result - roughness) * mask
    
    return clamp_0_1(result)


def apply_metallic_noise_filter(metallic, depth=3, threshold=0.5, amplifier=1.0):
    """
    Same as apply_roughness_noise_filter but for metallic maps.
    """
    return apply_roughness_noise_filter(metallic, depth, threshold, amplifier)


def apply_metallic_color_filter(metallic, picked_color='#808080', method=0,
                                 bias=0.0, offset=0.0, invert=False, amplifier=1.0):
    """
    Same as apply_roughness_color_filter but for metallic maps.
    """
    return apply_roughness_color_filter(metallic, picked_color, method, bias, offset, invert, amplifier)


def apply_contrast_filter(image, contrast=1.0, brightness=0.0):
    """
    AwesomeBump's applyContrastFilter - adjusts contrast and brightness.
    Used for surface detail enhancement on roughness/metallic maps.
    
    Parameters:
        image: float array in [0, 1]
        contrast: contrast multiplier (SurfaceDetailsProp.Contrast)
        brightness: brightness offset
    
    Returns:
        Contrast-adjusted image
    """
    result = (image - 0.5) * contrast + 0.5 + brightness
    return clamp_0_1(result)


def apply_double_gaussians_filter(image, radius=5, weight_a=1.0, weight_b=2.0, amplifier=1.0, contrast=1.0):
    """
    AwesomeBump's applyDGaussiansFilter - dual Gaussian blur for surface details.
    Creates detail enhancement by comparing two different blur passes.
    
    Parameters:
        image: float array in [0, 1]
        radius: base Gaussian radius (SurfaceDetailsProp.Radius)
        weight_a: first pass weight (SurfaceDetailsProp.WeightA)
        weight_b: second pass weight (SurfaceDetailsProp.WeightB)
        amplifier: detail amplification (SurfaceDetailsProp.Amplifier)
        contrast: final contrast adjustment (SurfaceDetailsProp.Contrast)
    
    Returns:
        Detail-enhanced image
    """
    # First Gaussian pass
    blur1 = apply_gaussian_blur(image, radius=int(radius))
    
    # Second Gaussian pass with different weight
    blur2 = apply_gaussian_blur(image, radius=int(radius * weight_b / weight_a))
    
    # Extract details by subtracting blurs
    details = (blur1 - blur2) * amplifier
    
    # Add details back to original
    result = image + details
    
    # Apply contrast
    result = apply_contrast_filter(result, contrast=contrast)
    
    return clamp_0_1(result)
