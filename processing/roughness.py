"""
Specular (grayscale) -> Roughness.

roughness = 1 - spec_gray ** gamma

gamma == 1.0 is a plain invert. gamma > 1 makes only the brightest
highlights read as smooth (most of the map trends rougher); gamma < 1
does the opposite, biasing mid-tones toward smooth.
"""
import numpy as np


def spec_to_roughness(spec_gray, gamma=1.0):
    """
    spec_gray: float array in [0, 1] (single channel).
    Returns a float array in [0, 1].
    """
    spec_gray = np.clip(spec_gray, 0.0, 1.0)
    return 1.0 - np.power(spec_gray, gamma)
