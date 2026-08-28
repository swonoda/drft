"""赤ゲラの赤い図形と、図形が指すPDF本文位置をOpenCVで検出する。"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np


def red_mask(image: np.ndarray) -> np.ndarray:
    blue, green, red = cv2.split(image)
    selected = (
        (red >= 115)
        & ((red.astype(np.int16) - green.astype(np.int16)) >= 48)
        & ((red.astype(np.int16) - blue.astype(np.int16)) >= 48)
    )
    return selected.astype(np.uint8) * 255


def gap(left: dict, right: dict) -> tuple[int, int]:
    x = max(0, max(left["left"], right["left"]) - min(left["right"], right["right"]))
    y = max(0, max(left["top"], right["top"]) - min(left["bottom"], right["bottom"]))
    return x, y


def group_components(labels: np.ndarray, stats: np.ndarray, image_shape: tuple[int, ...]):
    height, width = image_shape[:2]
    minimum_area = max(3, round(width * height * 0.0000004))
    components = []
    for label in range(1, stats.shape[0]):
        x, y, w, h, area = [int(value) for value in stats[label]]
        if area < minimum_area:
            continue
        components.append(
            {
                "label": label,
                "left": x,
                "top": y,
                "right": x + w - 1,
                "bottom": y + h - 1,
                "pixels": area,
            }
        )

    parent = list(range(len(components)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(first: int, second: int) -> None:
        first_root = find(first)
        second_root = find(second)
        if first_root != second_root:
            parent[second_root] = first_root

    near = max(14, round(min(width, height) * 0.012))
    for first in range(len(components)):
        for second in range(first + 1, len(components)):
            x_gap, y_gap = gap(components[first], components[second])
            # 文字は縦横どちらにも並ぶ。引出線の端との小さな切れ目も結合する。
            if x_gap <= near and y_gap <= near:
                union(first, second)

    groups: dict[int, dict] = {}
    for index, component in enumerate(components):
        root = find(index)
        if root not in groups:
            groups[root] = {
                "left": component["left"],
                "top": component["top"],
                "right": component["right"],
                "bottom": component["bottom"],
                "pixels": 0,
                "labels": [],
            }
        group = groups[root]
        group["left"] = min(group["left"], component["left"])
        group["top"] = min(group["top"], component["top"])
        group["right"] = max(group["right"], component["right"])
        group["bottom"] = max(group["bottom"], component["bottom"])
        group["pixels"] += component["pixels"]
        group["labels"].append(component["label"])

    minimum_group_pixels = max(12, round(width * height * 0.000002))
    return [
        group
        for group in groups.values()
        if group["pixels"] >= minimum_group_pixels
        and group["right"] - group["left"] >= 4
        and group["bottom"] - group["top"] >= 4
        and group["right"] - group["left"] < width * 0.75
        and group["bottom"] - group["top"] < height * 0.9
    ]


def pixel_box(word: dict, width: int, height: int) -> dict:
    left = round(float(word.get("left", 0)) * width)
    top = round(float(word.get("top", 0)) * height)
    right = round((float(word.get("left", 0)) + float(word.get("width", 0))) * width)
    bottom = round((float(word.get("top", 0)) + float(word.get("height", 0))) * height)
    return {
        "left": max(0, min(width - 1, left)),
        "top": max(0, min(height - 1, top)),
        "right": max(0, min(width - 1, right)),
        "bottom": max(0, min(height - 1, bottom)),
    }


def normalized_box(box: dict, width: int, height: int) -> dict:
    return {
        "left": box["left"] / width,
        "top": box["top"] / height,
        "width": (box["right"] - box["left"] + 1) / width,
        "height": (box["bottom"] - box["top"] + 1) / height,
    }


def dark_pixel_count(image: np.ndarray, box: dict) -> int:
    crop = image[
        box["top"] : box["bottom"] + 1,
        box["left"] : box["right"] + 1,
    ]
    if crop.size == 0:
        return 0
    maximum = np.max(crop, axis=2)
    minimum = np.min(crop, axis=2)
    # 黒・グレーの印刷文字を数え、彩度の高い赤い注記文字は除外する。
    neutral_dark = (maximum <= 190) & ((maximum - minimum) <= 36)
    return int(np.count_nonzero(neutral_dark))


def target_for_group(
    group: dict,
    labels: np.ndarray,
    words: list[dict],
    width: int,
    height: int,
    image: np.ndarray | None = None,
):
    allowed = np.isin(labels, group["labels"])
    maximum_distance = max(24, round(min(width, height) * 0.04))
    red_y, red_x = np.nonzero(allowed)
    if red_x.size == 0:
        return None

    # グループ中で最も長く伸びる連結成分を引出線候補にする。
    # 手書き文字の各画は短いため、ここで支点候補から概ね除外できる。
    components = []
    for label in group["labels"]:
        component_y, component_x = np.nonzero(labels == label)
        if component_x.size == 0:
            continue
        span = max(int(np.ptp(component_x)), int(np.ptp(component_y)))
        components.append((span, component_x, component_y))
    if components:
        longest_span = max(component[0] for component in components)
        leader_cutoff = max(6, longest_span * 0.65)
        leader_components = [
            component
            for component in components
            if component[0] >= leader_cutoff
        ]
        annotation_components = [
            component for component in components if component[0] < leader_cutoff
        ]
        leader_x = np.concatenate([component[1] for component in leader_components])
        leader_y = np.concatenate([component[2] for component in leader_components])
        if annotation_components:
            annotation_x = np.concatenate(
                [component[1] for component in annotation_components]
            )
            annotation_y = np.concatenate(
                [component[2] for component in annotation_components]
            )
        else:
            annotation_x = annotation_y = None
    else:
        leader_x, leader_y = red_x, red_y
        annotation_x = annotation_y = None

    # 引出線を含む赤字グループでは、本文側の端が外接矩形の四隅の
    # いずれかに現れる。各隅に最も近い実際の赤画素を支点候補にする。
    corners = (
        (group["left"], group["top"]),
        (group["right"], group["top"]),
        (group["left"], group["bottom"]),
        (group["right"], group["bottom"]),
    )
    anchors = []
    for corner_x, corner_y in corners:
        distances = (leader_x - corner_x) ** 2 + (leader_y - corner_y) ** 2
        nearest_index = int(np.argmin(distances))
        anchor = (int(leader_x[nearest_index]), int(leader_y[nearest_index]))
        if anchor not in anchors:
            anchors.append(anchor)

    # 引出線の注記側ではなく、短い手書き成分から離れた端を本文側とみなす。
    if annotation_x is not None and len(anchors) > 1:
        anchor_distances = []
        for anchor_x, anchor_y in anchors:
            distances = (annotation_x - anchor_x) ** 2 + (annotation_y - anchor_y) ** 2
            anchor_distances.append(math.sqrt(float(np.min(distances))))
        farthest = max(anchor_distances)
        anchors = [
            anchor
            for anchor, distance in zip(anchors, anchor_distances)
            if distance >= farthest * 0.7
        ]

    word_candidates = []
    for index, word in enumerate(words):
        box = pixel_box(word, width, height)
        if image is not None and dark_pixel_count(image, box) < 2:
            continue
        thickness = max(
            1,
            min(box["right"] - box["left"] + 1, box["bottom"] - box["top"] + 1),
        )
        word_candidates.append((index, box, thickness))
    if not word_candidates:
        return None
    typical_thickness = float(np.median([candidate[2] for candidate in word_candidates]))

    best = None
    for index, box, thickness in word_candidates:
        anchor_candidates = []
        for anchor_x, anchor_y in anchors:
            delta_x = max(box["left"] - anchor_x, anchor_x - box["right"], 0)
            delta_y = max(box["top"] - anchor_y, anchor_y - box["bottom"], 0)
            anchor_candidates.append((math.hypot(delta_x, delta_y), anchor_x, anchor_y))
        distance, point_x, point_y = min(anchor_candidates)
        if distance > maximum_distance:
            continue
        # ルビは本文より小さいため、距離が同程度なら本文文字を優先する。
        size_penalty = max(0.0, typical_thickness * 0.65 - thickness) * 2.0
        candidate = {
            "index": index,
            "box": box,
            "distance": distance,
            "rank": distance + size_penalty,
            "point": {
                "x": point_x / width,
                "y": point_y / height,
            },
        }
        if best is None or candidate["rank"] < best["rank"]:
            best = candidate
    if best is None:
        return None
    best["bounds"] = normalized_box(best.pop("box"), width, height)
    best.pop("rank", None)
    best["confidence"] = max(
        20,
        min(90, round(90 - (best["distance"] / maximum_distance) * 70)),
    )
    return best


def locate(image_path: Path, request: dict) -> dict:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError("PDFページ画像をOpenCVで開けませんでした。")
    mask = red_mask(image)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    del count
    height, width = image.shape[:2]
    words = request.get("words") or []
    groups = group_components(labels, stats, image.shape)
    locations = []
    for group in groups:
        target = target_for_group(group, labels, words, width, height, image)
        locations.append(
            {
                "bounds": normalized_box(group, width, height),
                "pixels": group["pixels"],
                "targetWordIndex": target["index"] if target else None,
                "targetBounds": target["bounds"] if target else None,
                "targetPoint": target["point"] if target else None,
                "confidence": target["confidence"] if target else 0,
            }
        )
    return {"redPixels": int(np.count_nonzero(mask)), "locations": locations}


def main() -> None:
    if len(sys.argv) != 3:
        raise RuntimeError("画像ファイルと解析条件ファイルを指定してください。")
    request = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    result = locate(Path(sys.argv[1]), request)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # 画面側に短い原因を返す
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
