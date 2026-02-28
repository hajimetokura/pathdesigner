"""Align Node — rotate assembled solids so largest face becomes bottom for CNC."""

from __future__ import annotations

import math

from build123d import Axis, GeomType, Solid, Vector, Location


def align_solids(solids: list[Solid]) -> list[Solid]:
    """Rotate each solid so its largest face is the bottom, then place at Z=0."""
    return [_align_single(s) for s in solids]


def _align_single(solid: Solid) -> Solid:
    """Align a single solid: largest face → bottom (Z-), sit on Z=0."""
    normal = _find_largest_face_normal(solid)

    # Target: normal should point -Z (largest face on bottom)
    target = Vector(0, 0, -1)

    rotated = _rotate_solid_to_target(solid, normal, target)

    # Translate so bottom sits at Z=0
    bb = rotated.bounding_box()
    shifted = rotated.move(Location((0, 0, -bb.min.Z)))

    return shifted


def _find_largest_face_normal(solid: Solid) -> Vector:
    """Return the outward normal of the face with the largest area."""
    faces = solid.faces()
    if not faces:
        return Vector(0, 0, -1)

    largest = max(faces, key=lambda f: f.area)
    return Vector(tuple(largest.normal_at()))


def _rotate_solid_to_target(solid: Solid, current: Vector, target: Vector) -> Solid:
    """Rotate solid so that `current` direction aligns with `target`."""
    # Normalize
    c = current.normalized()
    t = target.normalized()

    dot = c.dot(t)

    # Already aligned
    if dot > 0.9999:
        return solid

    # Opposite direction — rotate 180° around any perpendicular axis
    if dot < -0.9999:
        if abs(c.X) < 0.9:
            axis = Axis.X
        else:
            axis = Axis.Y
        return solid.rotate(axis, 180)

    # General case: rotate around cross product axis
    cross = c.cross(t)
    angle = math.degrees(math.acos(max(-1, min(1, dot))))

    # Create rotation axis through origin
    rotation_axis = Axis((0, 0, 0), (cross.X, cross.Y, cross.Z))
    return solid.rotate(rotation_axis, angle)
