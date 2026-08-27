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


def target_for_group(group: dict, labels: np.ndarray, words: list[dict], width: int, height: int):
    allowed = np.isin(labels, group["labels"])
    padding = max(6, round(min(width, height) * 0.0045))
    best = None
    for index, word in enumerate(words):
        box = pixel_box(word, width, height)
        left = max(0, box["left"] - padding)
        right = min(width, box["right"] + padding + 1)
        top = max(0, box["top"] - padding)
        bottom = min(height, box["bottom"] + padding + 1)
        ys, xs = np.nonzero(allowed[top:bottom, left:right])
        overlap = int(xs.size)
        if overlap == 0:
            continue
        word_area = max(1, (box["right"] - box["left"] + 1) * (box["bottom"] - box["top"] + 1))
        score = overlap / math.sqrt(word_area)
        candidate = {
            "index": index,
            "box": box,
            "overlap": overlap,
            "score": score,
            "point": {
                "x": float(np.median(xs + left) / width),
                "y": float(np.median(ys + top) / height),
            },
        }
        if best is None or (candidate["score"], candidate["overlap"]) > (
            best["score"],
            best["overlap"],
        ):
            best = candidate
    if best is None:
        return None
    best["bounds"] = normalized_box(best.pop("box"), width, height)
    best["confidence"] = min(100, round(45 + best["overlap"] * 2.5))
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
        target = target_for_group(group, labels, words, width, height)
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
    locations.sort(key=lambda item: (item["bounds"]["top"], item["bounds"]["left"]))
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
