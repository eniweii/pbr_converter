import os
from .name_parser import parse_filename, ALL_ROLES

# Roles that constitute a "complete" PBR set for display purposes.
# reflection is intentionally excluded — it is an internal mask consumed
# only by normal generation / preview shading, not a general source role.
CORE_ROLES = ['diffuse', 'normal', 'metal', 'rough', 'opacity', 'ao', 'spec']


def scan_folder(folder_path: str):
    """
    Walks the complete folder_path tree and groups files into materials.

    Returns:
        {
            "materials": {
                "<material_name>": {
                    "roles": {"diffuse": "<full path>", "normal": "<full path>", ...},
                    "missing": ["metal", "rough", ...]
                },
                ...
            },
            "unmatched": ["<filename>", ...]
        }
    """
    materials = {}
    unmatched = []

    if not os.path.isdir(folder_path):
        return {"materials": {}, "unmatched": [], "error": "Folder not found"}

    for current_root, _, filenames in os.walk(folder_path):
        for filename in sorted(filenames):
            full_path = os.path.join(current_root, filename)
            parsed = parse_filename(filename)
            if parsed is None:
                unmatched.append(os.path.relpath(full_path, folder_path))
                continue

            material_name, role = parsed
            materials.setdefault(material_name, {})[role] = full_path

    result_materials = {}
    for material_name, roles in materials.items():
        missing = [r for r in CORE_ROLES if r not in roles]
        result_materials[material_name] = {
            "roles": roles,
            "missing": missing,
        }

    return {"materials": result_materials, "unmatched": unmatched}


def merge_scans(scan_list):
    """
    Combines several scan_folder() results into one. The same material name
    can have different roles supplied by different folders (e.g. diffuse in
    one folder, normal in another) - roles are merged per material rather
    than one folder's result overwriting another's.

    If two folders provide the SAME role for the SAME material, the later
    folder in scan_list wins (folders are scanned in the order they were
    added, so this matches "last added takes priority").
    """
    merged_materials = {}
    merged_unmatched = []

    for scan in scan_list:
        for material_name, info in scan.get("materials", {}).items():
            entry = merged_materials.setdefault(material_name, {})
            entry.update(info.get("roles", {}))
        merged_unmatched.extend(scan.get("unmatched", []))

    result_materials = {}
    for material_name, roles in merged_materials.items():
        missing = [r for r in CORE_ROLES if r not in roles]
        result_materials[material_name] = {"roles": roles, "missing": missing}

    return {"materials": result_materials, "unmatched": merged_unmatched}
