"""
Shared utility functions for PBR map processing.

This module consolidates common operations used across multiple
processing modules to reduce duplication and improve maintainability.
"""
import cv2
import numpy as np


def smoothstep(value, low, high):
    """
    Apply smoothstep interpolation to a value or array.
    
    value: input value(s) to interpolate
    low: lower bound (values <= low return 0)
    high: upper bound (values >= high return 1)
    Returns smoothly interpolated values in [0, 1].
    """
    if not (0.0 <= low < high <= 1.0):
        raise ValueError("Require 0 <= low < high <= 1")
    t = np.clip((value - low) / (high - low), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def clamp_0_1(array):
    """Clip an array to the range [0, 1]."""
    return np.clip(array, 0.0, 1.0)


def blur_kernel_size(radius):
    """
    Calculate an odd kernel size for Gaussian blur from a radius.
    
    radius: blur radius in pixels
    Returns an odd integer kernel size suitable for cv2.GaussianBlur.
    """
    return max(1, radius) * 2 + 1


def apply_gaussian_blur(array, radius):
    """
    Apply Gaussian blur to a 2D array.
    
    array: 2D float array to blur
    radius: blur radius in pixels
    Returns the blurred array.
    """
    if radius <= 0:
        return array
    ksize = blur_kernel_size(radius)
    return cv2.GaussianBlur(array, (ksize, ksize), 0)


def compute_sobel_gradients(field):
    """
    Compute Sobel gradients in X and Y directions.
    
    field: 2D float array (heightfield or normal component)
    Returns (dx, dy) gradient arrays.
    """
    dx = cv2.Sobel(field, cv2.CV_32F, 1, 0, ksize=3)
    dy = cv2.Sobel(field, cv2.CV_32F, 0, 1, ksize=3)
    return dx, dy
