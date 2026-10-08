"""Generate shared JSON vectors for the six-face strip-map twin."""
import json
import math
from pathlib import Path

from twin_geometry import ROOT, TwinGeometry


def _shared_edge(g, a, b):
    corners = ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0))
    pairs = []
    for uv_a in corners:
        pa = g.point_mm(a, *uv_a)
        for uv_b in corners:
            pb = g.point_mm(b, *uv_b)
            if math.dist(pa, pb) < 1e-9:
                pairs.append((uv_a, uv_b))
    if len(pairs) != 2:
        raise ValueError(f"faces {a}/{b} do not share two corners")
    return pairs


def build():
    g = TwinGeometry()
    order = g.config["azimuth_order"]
    normals = []
    for index, face in enumerate(order):
        normal = [sum(g.mount[row][col] * g.faces[face].normal[col] for col in range(3)) for row in range(3)]
        normals.append({
            "face": face,
            "normal": normal,
            "azimuth": (math.degrees(math.atan2(normal[1], normal[0])) + 360.0) % 360.0,
            "elevation": math.degrees(math.asin(normal[2])),
        })

    pixels = []
    for face in order:
        for x, y, depth in ((0, 0, 0.1), (119, 119, 0.35), (239, 239, 0.8)):
            pixels.append({"face": face, "x": x, "y": y, "depth": depth, **g.pixel(face, x, y, depth)})

    seams = []
    for index, face in enumerate(order):
        next_face = order[(index + 1) % len(order)]
        edge = _shared_edge(g, face, next_face)
        for t in (0.001, 0.2, 0.4, 0.6, 0.8, 0.999):
            uv_a = tuple(edge[0][0][axis] * (1 - t) + edge[1][0][axis] * t for axis in range(2))
            uv_b = tuple(edge[0][1][axis] * (1 - t) + edge[1][1][axis] * t for axis in range(2))
            a, b = g.strip_point(face, *uv_a), g.strip_point(next_face, *uv_b)
            seams.append({"a": face, "b": next_face, "uv_a": list(uv_a), "uv_b": list(uv_b),
                          "strip_a": list(a), "strip_b": list(b), "depth": 0.35})

    same_y = []
    pairs = (("px", "py"), ("py", "pz"), ("pz", "px"),
             ("nz", "nx"), ("nx", "ny"), ("ny", "nz"))
    for a, b in pairs:
        ia, ib = order.index(a), order.index(b)
        ya = ((1 if ia % 2 == 0 else -1) * g.aim_y_mm)
        yb = ((1 if ib % 2 == 0 else -1) * g.aim_y_mm)
        same_y.append({"a": a, "b": b, "center_y_a": ya, "center_y_b": yb,
                       "same_y": ya == yb, "delta_y": ya - yb})

    aims = []
    for yaw in (0, 30, 60, 90, 119.999, 120, 180, 239.999, 240, 300, 359.999):
        for depth in (0.1, 0.8):
            hit = g.aim(yaw, depth)
            aims.append({"yaw": yaw, "depth": depth, **hit})

    sprites = []
    for seconds in (0.0, 1.25, 7.5):
        poses = g.poses(seconds)
        for depth in (0.1, 0.8):
            scroll = g.strip_scroll_mm(depth)
            for index, subject in enumerate(g.config["subjects"]):
                x, y = poses[index]
                sprites.append({"subject": index, "x_mm": x, "y_mm": y - scroll,
                                "depth": depth, "seconds": seconds})

    scroll_tracks = []
    for index, subject in enumerate(g.config["subjects"]):
        y_near = g.poses(0.0)[index][1] - g.strip_scroll_mm(0.1)
        y_far = g.poses(0.0)[index][1] - g.strip_scroll_mm(0.8)
        scroll_tracks.append({"subject": subject["id"], "y_depth_01": y_near,
                              "y_depth_08": y_far, "delta_y": y_far - y_near})

    crossings = []
    for subject in g.config["subjects"]:
        distance = 2.0
        crossings.append({"subject": subject["id"], "distance_mm": distance,
                          "speed_mm_s": subject["speed_mm_s"],
                          "cross_time_s": distance / abs(subject["speed_mm_s"])})

    data = {
        "schema_version": 4,
        "strip_step_mm": g.step_mm,
        "strip_length_mm": g.strip_length_mm,
        "aim_y_mm": g.aim_y_mm,
        "normals": normals,
        "pixels": pixels,
        "seams": seams,
        "same_y": same_y,
        "aims": aims,
        "sprites": sprites,
        "scroll_tracks": scroll_tracks,
        "crossings": crossings,
        "circle_checks": [{"width_mm": 20.0, "height_mm": 20.0, "pixel_ratio": 1.0}],
    }
    return json.loads(json.dumps(data))


if __name__ == "__main__":
    output = ROOT / "tests" / "vectors" / "twin_vertex_up_vectors.json"
    output.write_text(json.dumps(build(), indent=2) + "\n")
    print(output)
