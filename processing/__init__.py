"""
Processing module for PBR map generation and manipulation.

This module provides a complete suite of PBR texture processing tools,
organized by function:

Core Conversions:
- metalness: Specular-to-metallic conversion
- roughness: Specular-to-roughness conversion  
- cavity_ao: Normal-to-AO via curvature approximation
- diffuse_derive: Height/normal/AO/roughness/metal from diffuse only

AwesomeBump-style Filters (NEW):
- normal_filters: Normal map enhancement, mixing, and conversion
  - normal_expand, normal_angle_correction, normal_sharpen_blur
  - normal_mix_levels, normal_to_height, height_to_normal_detailed
  - normal_invert_components
  
- grunge_filters: Procedural wear, noise, and detail enhancement
  - generate_grunge, apply_grunge_overlay, add_noise
  - enhance_small_details, enhance_medium_details
  - simulate_edge_wear, remove_shading, warp_normals_with_grunge

Utilities:
- utils: Shared helper functions (smoothstep, blur, gradients, etc.)
- io_utils: Image loading and saving helpers
"""
from .utils import smoothstep, clamp_0_1, blur_kernel_size, apply_gaussian_blur, compute_sobel_gradients
from .metalness import spec_to_metallic
from .roughness import spec_to_roughness
from .cavity_ao import normal_to_ao
from .diffuse_derive import (
    diffuse_to_height,
    height_to_normal,
    height_to_ao,
    diffuse_to_roughness,
    diffuse_to_metal_approx,
)
from .normal_filters import (
    normal_expand,
    normal_angle_correction,
    normal_sharpen_blur,
    normal_mix_levels,
    normal_to_height,
    height_to_normal_detailed,
    normal_invert_components,
)
from .grunge_filters import (
    generate_grunge,
    apply_grunge_overlay,
    add_noise,
    enhance_small_details,
    enhance_medium_details,
    simulate_edge_wear,
    remove_shading,
    warp_normals_with_grunge,
)

__all__ = [
    # Core conversions
    'spec_to_metallic',
    'spec_to_roughness',
    'normal_to_ao',
    'diffuse_to_height',
    'height_to_normal',
    'height_to_ao',
    'diffuse_to_roughness',
    'diffuse_to_metal_approx',
    
    # Normal filters (AwesomeBump-style)
    'normal_expand',
    'normal_angle_correction',
    'normal_sharpen_blur',
    'normal_mix_levels',
    'normal_to_height',
    'height_to_normal_detailed',
    'normal_invert_components',
    
    # Grunge and detail filters (AwesomeBump-style)
    'generate_grunge',
    'apply_grunge_overlay',
    'add_noise',
    'enhance_small_details',
    'enhance_medium_details',
    'simulate_edge_wear',
    'remove_shading',
    'warp_normals_with_grunge',
    
    # Utilities
    'smoothstep',
    'clamp_0_1',
    'blur_kernel_size',
    'apply_gaussian_blur',
    'compute_sobel_gradients',
]