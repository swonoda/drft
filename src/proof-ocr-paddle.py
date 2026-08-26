import json
import os
import sys
import traceback
from pathlib import Path


def emit(payload):
    print("DRFT_JSON:" + json.dumps(payload, ensure_ascii=False), flush=True)


def configure_cache():
    cache_dir = Path(
        os.environ.get("DRFT_OCR_CACHE_DIR", Path.cwd() / ".drft-ocr-cache")
    ).resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)
    profile_dir = cache_dir / "profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    os.environ["USERPROFILE"] = str(profile_dir)
    os.environ["PADDLE_PDX_CACHE_HOME"] = str(cache_dir / "paddlex")
    os.environ["MODELSCOPE_CACHE"] = str(cache_dir / "modelscope")
    os.environ["HF_HOME"] = str(cache_dir / "huggingface")
    os.environ["PADDLE_PDX_MODEL_SOURCE"] = "BOS"
    os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"


configure_cache()

import cv2
import numpy as np
from paddleocr import TextDetection, TextRecognition


def result_data(result):
    data = result.json
    if isinstance(data, str):
        data = json.loads(data)
    return data.get("res", data)


def clean_text(value):
    if not isinstance(value, str):
        return ""
    return "".join(value.split()).replace("|", "").replace("｜", "")


def extract_red_ink(image):
    blue, green, red = cv2.split(image)
    mask = (
        (red >= 115)
        & ((red.astype(np.int16) - green.astype(np.int16)) >= 48)
        & ((red.astype(np.int16) - blue.astype(np.int16)) >= 48)
    ).astype(np.uint8) * 255

    cleaned = mask.copy()
    minimum = 110
    for y in range(cleaned.shape[0]):
        occupied = cleaned[y] > 0
        edges = np.flatnonzero(
            np.diff(np.concatenate(([False], occupied, [False])).astype(np.int8))
        )
        for start, end in edges.reshape(-1, 2):
            if end - start >= minimum:
                cleaned[y, start:end] = 0
    for x in range(cleaned.shape[1]):
        occupied = cleaned[:, x] > 0
        edges = np.flatnonzero(
            np.diff(np.concatenate(([False], occupied, [False])).astype(np.int8))
        )
        for start, end in edges.reshape(-1, 2):
            if end - start >= minimum:
                cleaned[start:end, x] = 0
    return 255 - cleaned


def crop_detected_line(image, polygon, padding=18):
    points = np.asarray(polygon, dtype=np.int32)
    left = max(0, int(points[:, 0].min()) - padding)
    right = min(image.shape[1], int(points[:, 0].max()) + padding + 1)
    top = max(0, int(points[:, 1].min()) - padding)
    bottom = min(image.shape[0], int(points[:, 1].max()) + padding + 1)
    crop = image[top:bottom, left:right]
    vertical = crop.shape[0] > crop.shape[1] * 1.15
    if vertical:
        crop = cv2.rotate(crop, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return crop, (left, top, right, bottom)


class ProofOcr:
    def __init__(self):
        emit(
            {
                "type": "status",
                "message": "PaddleOCRを準備中（初回はモデル取得に数分かかります）",
            }
        )
        self.detector = TextDetection(
            model_name="PP-OCRv5_server_det",
            device="cpu",
            enable_mkldnn=False,
            cpu_threads=8,
        )
        self.recognizer = TextRecognition(
            model_name="PP-OCRv5_server_rec",
            device="cpu",
            enable_mkldnn=True,
            cpu_threads=8,
        )
        emit({"type": "ready"})

    def recognize(self, request):
        request_id = request["id"]
        page = int(request["page"])
        image_path = str(request["imagePath"])
        image = cv2.imread(image_path, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("PDFページ画像を読み込めませんでした。")

        emit(
            {
                "type": "progress",
                "id": request_id,
                "message": f"{page}ページ目の赤色と引出線を整理中",
                "progress": 0.12,
            }
        )
        cleaned = extract_red_ink(image)
        ink_pixels = int(np.count_nonzero(cleaned < 128))
        if ink_pixels < 40:
            emit({"type": "result", "id": request_id, "notes": []})
            return

        emit(
            {
                "type": "progress",
                "id": request_id,
                "message": f"{page}ページ目の手書き位置を検出中",
                "progress": 0.35,
            }
        )
        detector_image = cv2.cvtColor(cleaned, cv2.COLOR_GRAY2BGR)
        detection_output = self.detector.predict(detector_image, batch_size=1)
        detection = result_data(detection_output[0])
        polygons = detection.get("dt_polys", [])
        scores = detection.get("dt_scores", [])
        candidates = []
        for polygon, score in zip(polygons, scores):
            crop, bounds = crop_detected_line(detector_image, polygon)
            if crop.size:
                candidates.append((crop, bounds, float(score)))

        if not candidates:
            emit({"type": "result", "id": request_id, "notes": []})
            return

        emit(
            {
                "type": "progress",
                "id": request_id,
                "message": f"{page}ページ目の赤字 0 / {len(candidates)} を読取中",
                "progress": 0.55,
            }
        )
        recognition_output = self.recognizer.predict(
            [candidate[0] for candidate in candidates], batch_size=4
        )
        height, width = cleaned.shape
        notes = []
        for index, (candidate, output) in enumerate(
            zip(candidates, recognition_output), 1
        ):
            _crop, (left, top, right, bottom), detection_score = candidate
            recognition = result_data(output)
            text = clean_text(recognition.get("rec_text", ""))
            if text:
                recognition_score = float(recognition.get("rec_score", 0.0))
                notes.append(
                    {
                        "id": f"red-note-{page}-{index}",
                        "page": page,
                        "text": text,
                        "confidence": max(
                            0.0,
                            min(100.0, recognition_score * detection_score * 100.0),
                        ),
                        "bounds": {
                            "left": left / width,
                            "top": top / height,
                            "width": (right - left) / width,
                            "height": (bottom - top) / height,
                        },
                    }
                )
            emit(
                {
                    "type": "progress",
                    "id": request_id,
                    "message": f"{page}ページ目の赤字 {index} / {len(candidates)} を読取中",
                    "progress": 0.55 + 0.45 * (index / len(candidates)),
                }
            )
        emit({"type": "result", "id": request_id, "notes": notes})


def main():
    try:
        engine = ProofOcr()
    except Exception as error:
        emit(
            {
                "type": "fatal",
                "message": f"PaddleOCRを準備できません: {error}",
                "detail": traceback.format_exc(),
            }
        )
        return 1

    for raw_line in sys.stdin:
        request = {}
        try:
            request = json.loads(raw_line)
            if request.get("type") == "close":
                return 0
            engine.recognize(request)
        except Exception as error:
            emit(
                {
                    "type": "error",
                    "id": request.get("id"),
                    "message": str(error),
                    "detail": traceback.format_exc(),
                }
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
