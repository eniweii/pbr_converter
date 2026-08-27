"""
Specular (grayscale) -> Metalness.

No color information means the dielectric/metal reflectance heuristic
isn't available - this is a two-cutoff threshold instead of a hard cut,
so pixels near the boundary don't get a harsh binary edge.

metalness = smoothstep(low, high, spec_gray)
  spec_gray <= low  -> 0.0 (dielectric)
  spec_gray >= high -> 1.0 (metal)
  in between        -> smooth cubic ramp
"""
import numpy as np


def spec_to_metallic(spec_gray, low=0.5, high=0.85):
    """
    spec_gray: float array in [0, 1] (single channel).
    low/high: cutoffs in [0, 1], low < high.
    Returns a float array in [0, 1].
    """
    if not (0.0 <= low < high <= 1.0):
        raise ValueError("Require 0 <= low < high <= 1")
    t = np.clip((spec_gray - low) / (high - low), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)  # smoothstep
