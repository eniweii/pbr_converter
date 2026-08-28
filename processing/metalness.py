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
from .utils import smoothstep


def spec_to_metallic(spec_gray, low=0.5, high=0.85):
    """
    spec_gray: float array in [0, 1] (single channel).
    low/high: cutoffs in [0, 1], low < high.
    Returns a float array in [0, 1].
    """
    return smoothstep(spec_gray, low, high)
