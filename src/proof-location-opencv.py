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


def distance_to_box(x: int, y: int, box: dict) -> float:
    delta_x = max(box["left"] - x, x - box["right"], 0)
    delta_y = max(box["top"] - y, y - box["bottom"], 0)
    return math.hypot(delta_x, delta_y)


def first_contact_point(
    xs: np.ndarray,
    ys: np.ndarray,
    box: dict,
) -> tuple[int, int]:
    """本文の読み順で最初に現れる赤画素を返す。"""
    vertical = (box["bottom"] - box["top"]) > (
        box["right"] - box["left"]
    ) * 1.35
    if vertical:
        index = min(
            range(len(xs)), key=lambda item: (int(ys[item]), -int(xs[item]))
        )
    else:
        index = min(range(len(xs)), key=lambda item: (int(xs[item]), int(ys[item])))
    return int(xs[index]), int(ys[index])


def body_mark_target(
    allowed: np.ndarray,
    word_candidates: list[tuple[int, dict, int]],
    width: int,
    height: int,
    typical_thickness: float,
):
    """本文上の赤い校正記号を、引出線より先に支点として探す。"""
    red_y, red_x = np.nonzero(allowed)
    if red_x.size == 0:
        return None

    contacts = []
    for index, box, thickness in word_candidates:
        margin = max(4, round(max(thickness, typical_thickness) * 0.55))
        near = (
            (red_x >= box["left"] - margin)
            & (red_x <= box["right"] + margin)
            & (red_y >= box["top"] - margin)
            & (red_y <= box["bottom"] + margin)
        )
        contact_x = red_x[near]
        contact_y = red_y[near]
        if contact_x.size == 0:
            continue
        distances = np.array(
            [
                distance_to_box(int(x), int(y), box)
                for x, y in zip(contact_x, contact_y)
            ]
        )
        minimum_distance = float(np.min(distances))
        if minimum_distance > margin:
            continue
        closest = distances <= minimum_distance + 1.5
        point_x, point_y = first_contact_point(
            contact_x[closest], contact_y[closest], box
        )
        size_penalty = max(0.0, typical_thickness * 0.65 - thickness) * 2.0
        center_x = (box["left"] + box["right"]) / 2
        center_y = (box["top"] + box["bottom"]) / 2
        vertical = (box["bottom"] - box["top"]) > (
            box["right"] - box["left"]
        ) * 1.35
        contacts.append(
            {
                "index": index,
                "box": box,
                "distance": minimum_distance,
                "rank": minimum_distance + size_penalty,
                "pointPixels": (point_x, point_y),
                # 同じ取り消し線が複数文字へ触れる場合は本文の先頭を使う。
                "readingOrder": (
                    (-center_x, center_y) if vertical else (center_y, center_x)
                ),
            }
        )

    if not contacts:
        return None
    closest_rank = min(contact["rank"] for contact in contacts)
    comparable = [
        contact for contact in contacts if contact["rank"] <= closest_rank + 2.0
    ]
    best = min(comparable, key=lambda contact: contact["readingOrder"])
    point_x, point_y = best.pop("pointPixels")
    best.pop("readingOrder", None)
    best.pop("rank", None)
    best["bounds"] = normalized_box(best.pop("box"), width, height)
    best["point"] = {"x": point_x / width, "y": point_y / height}
    best["confidence"] = max(
        72,
        min(98, round(98 - (best["distance"] / max(1, typical_thickness)) * 24)),
    )
    best["method"] = "body-mark"
    return best


def point_box(x: int, y: int, size: int, width: int, height: int) -> dict:
    half = max(2, size // 2)
    return {
        "left": max(0, x - half),
        "top": max(0, y - half),
        "right": min(width - 1, x + half),
        "bottom": min(height - 1, y + half),
    }


def body_mark_locations(
    labels: np.ndarray,
    stats: np.ndarray,
    words: list[dict],
    width: int,
    height: int,
    image: np.ndarray,
) -> list[dict]:
    """本文へ触れた赤成分ごとに、読み順の先頭位置だけを返す。"""
    word_candidates = []
    for index, word in enumerate(words):
        box = pixel_box(word, width, height)
        if dark_pixel_count(image, box) < 2:
            continue
        thickness = max(
            1,
            min(box["right"] - box["left"] + 1, box["bottom"] - box["top"] + 1),
        )
        word_candidates.append((index, box, thickness))
    if not word_candidates:
        return []

    typical_thickness = float(
        np.median([candidate[2] for candidate in word_candidates])
    )
    contacts_by_label: dict[int, list[dict]] = {}
    for index, box, thickness in word_candidates:
        margin = max(2, round(max(thickness, typical_thickness) * 0.18))
        left = max(0, box["left"] - margin)
        top = max(0, box["top"] - margin)
        right = min(width - 1, box["right"] + margin)
        bottom = min(height - 1, box["bottom"] + margin)
        label_crop = labels[top : bottom + 1, left : right + 1]
        for label in np.unique(label_crop):
            label = int(label)
            if label <= 0 or int(stats[label, cv2.CC_STAT_AREA]) < 3:
                continue
            component_width = int(stats[label, cv2.CC_STAT_WIDTH])
            component_height = int(stats[label, cv2.CC_STAT_HEIGHT])
            long_span = max(component_width, component_height)
            short_span = max(1, min(component_width, component_height))
            line_like = (
                long_span >= typical_thickness * 0.55
                and (
                    long_span / short_span >= 1.7
                    or int(stats[label, cv2.CC_STAT_AREA])
                    >= typical_thickness * typical_thickness * 0.5
                )
            )
            if not line_like:
                continue
            local_y, local_x = np.nonzero(label_crop == label)
            contact_x = local_x + left
            contact_y = local_y + top
            distances = np.array(
                [
                    distance_to_box(int(x), int(y), box)
                    for x, y in zip(contact_x, contact_y)
                ]
            )
            minimum_distance = float(np.min(distances))
            if minimum_distance > margin:
                continue
            closest = distances <= minimum_distance + 1.5
            point_x, point_y = first_contact_point(
                contact_x[closest], contact_y[closest], box
            )
            center_x = (box["left"] + box["right"]) / 2
            center_y = (box["top"] + box["bottom"]) / 2
            vertical = (box["bottom"] - box["top"]) > (
                box["right"] - box["left"]
            ) * 1.35
            contacts_by_label.setdefault(label, []).append(
                {
                    "index": index,
                    "box": box,
                    "thickness": thickness,
                    "distance": minimum_distance,
                    "point": (point_x, point_y),
                    "readingOrder": (
                        (-center_x, center_y)
                        if vertical
                        else (center_y, center_x)
                    ),
                }
            )

    contact_labels = list(contacts_by_label)
    parent = {label: label for label in contact_labels}

    def find(label: int) -> int:
        while parent[label] != label:
            parent[label] = parent[parent[label]]
            label = parent[label]
        return label

    def union(first: int, second: int) -> None:
        first_root = find(first)
        second_root = find(second)
        if first_root != second_root:
            parent[second_root] = first_root

    merge_gap = max(3, round(typical_thickness * 0.25))
    for first_index, first_label in enumerate(contact_labels):
        first_box = {
            "left": int(stats[first_label, cv2.CC_STAT_LEFT]),
            "top": int(stats[first_label, cv2.CC_STAT_TOP]),
            "right": int(stats[first_label, cv2.CC_STAT_LEFT])
            + int(stats[first_label, cv2.CC_STAT_WIDTH])
            - 1,
            "bottom": int(stats[first_label, cv2.CC_STAT_TOP])
            + int(stats[first_label, cv2.CC_STAT_HEIGHT])
            - 1,
        }
        for second_label in contact_labels[first_index + 1 :]:
            second_box = {
                "left": int(stats[second_label, cv2.CC_STAT_LEFT]),
                "top": int(stats[second_label, cv2.CC_STAT_TOP]),
                "right": int(stats[second_label, cv2.CC_STAT_LEFT])
                + int(stats[second_label, cv2.CC_STAT_WIDTH])
                - 1,
                "bottom": int(stats[second_label, cv2.CC_STAT_TOP])
                + int(stats[second_label, cv2.CC_STAT_HEIGHT])
                - 1,
            }
            x_gap, y_gap = gap(first_box, second_box)
            if x_gap <= merge_gap and y_gap <= merge_gap:
                union(first_label, second_label)

    contact_groups: dict[int, dict] = {}
    for label, contacts in contacts_by_label.items():
        root = find(label)
        group = contact_groups.setdefault(root, {"labels": [], "contacts": []})
        group["labels"].append(label)
        group["contacts"].extend(contacts)

    locations = []
    for group in contact_groups.values():
        contacts = group["contacts"]
        # 同じ赤線が複数文字へ触れても、本文の読み順で最初の一箇所だけにする。
        minimum_distance = min(contact["distance"] for contact in contacts)
        comparable = [
            contact
            for contact in contacts
            if contact["distance"] <= minimum_distance + 2.0
        ]
        first = min(comparable, key=lambda contact: contact["readingOrder"])
        point_x, point_y = first["point"]
        marker_size = max(8, round(max(first["thickness"], typical_thickness)))
        marker = point_box(point_x, point_y, marker_size, width, height)
        locations.append(
            {
                "bounds": None,
                "pixels": sum(
                    int(stats[label, cv2.CC_STAT_AREA]) for label in group["labels"]
                ),
                "targetWordIndex": first["index"],
                "targetBounds": normalized_box(marker, width, height),
                "targetPoint": {
                    "x": point_x / width,
                    "y": point_y / height,
                },
                "confidence": max(
                    70,
                    min(
                        98,
                        round(
                            98
                            - (minimum_distance / max(1, typical_thickness)) * 28
                        ),
                    ),
                ),
                "targetMethod": "body-start",
                "readingOrder": first["readingOrder"],
            }
        )

    locations.sort(key=lambda location: location["readingOrder"])
    deduplicated = []
    minimum_gap = max(6, typical_thickness * 0.8)
    for location in locations:
        point = location["targetPoint"]
        point_x = point["x"] * width
        point_y = point["y"] * height
        duplicate = False
        for existing in deduplicated:
            other = existing["targetPoint"]
            if math.hypot(
                point_x - other["x"] * width,
                point_y - other["y"] * height,
            ) <= minimum_gap:
                duplicate = True
                break
        if not duplicate:
            location.pop("readingOrder", None)
            deduplicated.append(location)
    return deduplicated


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
    typical_thickness = float(
        np.median([candidate[2] for candidate in word_candidates])
    )

    # 校正記号は本文から引き出されるため、本文上の赤画素を最優先する。
    # 欄外注記から線の向きを推測する処理は、本文側で取れない場合だけ使う。
    body_target = body_mark_target(
        allowed,
        word_candidates,
        width,
        height,
        typical_thickness,
    )
    if body_target is not None:
        return body_target

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
    best["method"] = "leader-end"
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
    body_locations = body_mark_locations(
        labels,
        stats,
        words,
        width,
        height,
        image,
    )
    if words:
        return {
            "redPixels": int(np.count_nonzero(mask)),
            "locations": body_locations,
        }

    # 文字座標がないPDFだけは、従来どおり赤字のまとまりを表示する。
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
                "targetMethod": target["method"] if target else None,
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
