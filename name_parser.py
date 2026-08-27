"""
Parses source texture filenames of the form:
    0x########_basename_SUFFIX.ext
where SUFFIX is one of D, N, M, R, O, A, AO, S, REF.
Ambient occlusion may be written as either "_A" or "_AO" - both map to
the same "ao" role. "_S" is the raw specular source map. "_REF" is the
flat-reflective-surface mask (windows, mirrors) used to override
normal/roughness/metal generation on glass.

The basename is extracted as everything between the hash and the final _SUFFIX.
Examples:
    0x00E94310_IN_OBJ_CONCRETEBLOCK_01_D.dds -> basename=IN_OBJ_CONCRETEBLOCK_01, role=diffuse
    0x25B012B1_GL_OBJ_BRRICADEARROWR_01_N.dds -> basename=GL_OBJ_BRRICADEARROWR_01, role=normal
"""
import re

# Filenames look like 0xAB12CD34_basename_D.png or 0xAB12CD34_basename_AO.png
# The basename is everything after the hash_ up to the last _SUFFIX before extension.
# Greedy matching ensures we capture up to the LAST _SUFFIX occurrence.
# "AO" and "REF" (both multi-character) are tried alongside the single-letter
# set so "_AO"/"_REF" aren't mis-parsed as "_A"+orphan "O" or similar.
PATTERN = re.compile(r'^0x[0-9A-Fa-f]{8}_(?P<basename>.+)_(?P<suffix>AO|REF|[DNMROAS])(?:\.[^.]+)?$')

ROLE_NAMES = {
    'D': 'diffuse',
    'N': 'normal',
    'M': 'metal',
    'R': 'rough',
    'O': 'opacity',
    'A': 'ao',
    'AO': 'ao',
    'S': 'spec',
    'REF': 'reflection',
}

# All roles a fully PBR-ready material set could have. Listed explicitly
# (not derived from ROLE_NAMES.values()) since 'A'/'AO' both map to 'ao'
# and would otherwise duplicate it here. 'reflection' is deliberately
# excluded - it's an optional mask only some materials (windows, mirrors)
# have, not part of the standard PBR set, so it shouldn't show up as
# "missing" on every other material.
ALL_ROLES = ['diffuse', 'normal', 'metal', 'rough', 'opacity', 'ao', 'spec']


def parse_filename(filename: str):
    """
    Returns (material_name, role) if the filename matches the convention,
    else None.
    """
    match = PATTERN.match(filename)
    if not match:
        return None
    material_name = match.group('basename')
    role = ROLE_NAMES[match.group('suffix')]
    return material_name, role
