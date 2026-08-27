"""
Shared load/save helpers for the processing modules.
Keeps OpenCV's BGR-vs-RGB and 8/16-bit quirks in one place.
"""
import cv2
import numpy as np
from PIL import Image
import struct
import texture2ddecoder


_DDS_DECODERS = {
    b'DXT1': texture2ddecoder.decode_bc1,
    b'DXT3': texture2ddecoder.decode_bc3,
    b'DXT5': texture2ddecoder.decode_bc3,
    b'ATI1': texture2ddecoder.decode_bc4,
    b'BC4U': texture2ddecoder.decode_bc4,
    b'ATI2': texture2ddecoder.decode_bc5,
    b'BC5U': texture2ddecoder.decode_bc5,
}
_DXGI_DECODERS = {
    71: texture2ddecoder.decode_bc1, 72: texture2ddecoder.decode_bc1,
    74: texture2ddecoder.decode_bc3, 75: texture2ddecoder.decode_bc3,
    77: texture2ddecoder.decode_bc3, 78: texture2ddecoder.decode_bc3,
    80: texture2ddecoder.decode_bc4, 81: texture2ddecoder.decode_bc4,
    83: texture2ddecoder.decode_bc5, 84: texture2ddecoder.decode_bc5,
    95: texture2ddecoder.decode_bc6, 96: texture2ddecoder.decode_bc6,
    98: texture2ddecoder.decode_bc7, 99: texture2ddecoder.decode_bc7,
}
# Uncompressed DX10 formats: not block-compressed, so texture2ddecoder (a
# block-decompression-only library) never applies here - decoded by a
# direct reshape instead. Value is the on-disk channel order.
_DXGI_RAW = {
    28: 'rgba', 29: 'rgba',        # R8G8B8A8_UNORM(_SRGB)
    87: 'bgra', 91: 'bgra',        # B8G8R8A8_UNORM(_SRGB)
    88: 'bgra', 93: 'bgra',        # B8G8R8X8_UNORM(_SRGB) - X (unused) read as alpha, fine for preview
}
# DDS_PIXELFORMAT.dwFlags bits (legacy, no-FourCC header)
_DDPF_ALPHAPIXELS = 0x1
_DDPF_FOURCC = 0x4
_DDPF_RGB = 0x40
_DDPF_LUMINANCE = 0x20000


def _mask_shift_and_bits(mask):
    """For a bitmask like 0x00FF0000, returns (shift=16, bits=8)."""
    if mask == 0:
        return 0, 0
    shift = (mask & -mask).bit_length() - 1
    bits = bin(mask >> shift).count('1')
    return shift, bits


def _unpack_masked_rgba(payload, width, height, bit_count, r_mask, g_mask, b_mask, a_mask):
    """
    Decodes legacy uncompressed DDS pixel data (DDPF_RGB, no FourCC) using
    its own declared bit masks rather than assuming a fixed channel order -
    different exporters lay out 16/24/32-bit pixels differently.
    """
    bytes_per_pixel = max(1, bit_count // 8)
    needed = width * height * bytes_per_pixel
    raw = payload[:needed]

    if bytes_per_pixel == 4:
        values = np.frombuffer(raw, dtype='<u4').reshape((height, width)).astype(np.uint32)
    elif bytes_per_pixel == 3:
        as_bytes = np.frombuffer(raw, dtype=np.uint8).reshape((height, width, 3)).astype(np.uint32)
        values = as_bytes[:, :, 0] | (as_bytes[:, :, 1] << 8) | (as_bytes[:, :, 2] << 16)
    elif bytes_per_pixel == 2:
        values = np.frombuffer(raw, dtype='<u2').reshape((height, width)).astype(np.uint32)
    else:
        values = np.frombuffer(raw, dtype=np.uint8).reshape((height, width)).astype(np.uint32)

    def channel(mask):
        if mask == 0:
            return np.zeros((height, width), dtype=np.uint8)
        shift, bits = _mask_shift_and_bits(mask)
        max_val = (1 << bits) - 1 if bits else 1
        extracted = (values & mask) >> shift
        return (extracted.astype(np.float32) / max_val * 255.0).astype(np.uint8)

    r, g, b = channel(r_mask), channel(g_mask), channel(b_mask)
    a = channel(a_mask) if a_mask else np.full((height, width), 255, dtype=np.uint8)
    return np.stack([r, g, b, a], axis=-1)


def _decode_dds(path):
    with open(path, 'rb') as dds_file:
        data = dds_file.read()
    if data[:4] != b'DDS ' or len(data) < 128:
        raise ValueError(f'Invalid DDS file: {path}')

    height, width = struct.unpack_from('<II', data, 12)
    pf_flags = struct.unpack_from('<I', data, 80)[0]
    fourcc = data[84:88]
    payload_offset = 128
    dxgi_format = None

    if fourcc == b'DX10':
        if len(data) < 148:
            raise ValueError(f'Invalid DDS DX10 header: {path}')
        dxgi_format = struct.unpack_from('<I', data, 128)[0]
        payload_offset = 148

    payload = data[payload_offset:]

    # --- Uncompressed DX10 formats: direct reshape, no block decoding ---
    if dxgi_format in _DXGI_RAW:
        order = _DXGI_RAW[dxgi_format]
        needed = width * height * 4
        raw = np.frombuffer(payload[:needed], dtype=np.uint8).reshape((height, width, 4)).copy()
        if order == 'bgra':
            raw = raw[:, :, [2, 1, 0, 3]]
        return raw

    # --- Block-compressed formats (legacy FourCC or DX10 DXGI) ---
    decoder = _DXGI_DECODERS.get(dxgi_format) if dxgi_format is not None else _DDS_DECODERS.get(fourcc)
    if decoder is not None:
        decoded = decoder(payload, width, height)
        # texture2ddecoder returns BGRA regardless of source format - swap
        # to RGBA. Every previously-decoded compressed texture had its red
        # and blue channels swapped until this fix.
        rgba = np.frombuffer(decoded, dtype=np.uint8).reshape((height, width, 4)).copy()
        return rgba[:, :, [2, 1, 0, 3]]

    # --- Legacy uncompressed formats (no FourCC, no DX10 header) ---
    if dxgi_format is None and not (pf_flags & _DDPF_FOURCC):
        bit_count = struct.unpack_from('<I', data, 88)[0]
        if pf_flags & _DDPF_RGB:
            r_mask, g_mask, b_mask, a_mask = struct.unpack_from('<IIII', data, 92)
            if not (pf_flags & _DDPF_ALPHAPIXELS):
                a_mask = 0
            return _unpack_masked_rgba(payload, width, height, bit_count, r_mask, g_mask, b_mask, a_mask)
        if pf_flags & _DDPF_LUMINANCE:
            if bit_count == 8:
                gray = np.frombuffer(payload[:width * height], dtype=np.uint8).reshape((height, width))
            else:
                gray16 = np.frombuffer(payload[:width * height * 2], dtype='<u2').reshape((height, width))
                gray = (gray16 >> 8).astype(np.uint8)
            return np.stack([gray, gray, gray, np.full_like(gray, 255)], axis=-1)

    raise ValueError(f'Unsupported DDS pixel format (fourcc={fourcc!r}, dxgi={dxgi_format}): {path}')


def load_gray(path):
    """Loads any image as a single-channel float array in [0, 1]."""
    if path.lower().endswith('.dds'):
        try:
            rgba = _decode_dds(path)
            return _to_float(cv2.cvtColor(rgba, cv2.COLOR_RGBA2GRAY))
        except (ValueError, struct.error):
            with Image.open(path) as image:
                return _to_float(np.asarray(image.convert('L')))
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Could not read image: {path}")
    if img.ndim == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return _to_float(img)


def load_rgb(path):
    """Loads a color image as an (H, W, 3) float array in [0, 1], RGB order."""
    if path.lower().endswith('.dds'):
        try:
            return _to_float(_decode_dds(path)[:, :, :3])
        except (ValueError, struct.error):
            with Image.open(path) as image:
                return _to_float(np.asarray(image.convert('RGB')))
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Could not read image: {path}")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        img = img[:, :, :3]
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return _to_float(img)


def save_gray(path, array_0_1):
    """Saves a float [0, 1] single-channel array as an 8-bit grayscale image."""
    out = np.clip(array_0_1 * 255.0, 0, 255).astype(np.uint8)
    cv2.imwrite(path, out)


def save_rgb(path, array_0_1):
    """
    Saves a float [0, 1] (H, W, 3) RGB array as an 8-bit color image.
    Needed for derived normal maps, which are RGB rather than a single
    grayscale channel like the rough/metal/ao masks.
    """
    out = np.clip(array_0_1 * 255.0, 0, 255).astype(np.uint8)
    bgr = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
    cv2.imwrite(path, bgr)


def _to_float(img):
    if img.dtype == np.uint8:
        return img.astype(np.float32) / 255.0
    if img.dtype == np.uint16:
        return img.astype(np.float32) / 65535.0
    return img.astype(np.float32)
