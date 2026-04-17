"""
Diagnostique #04/#05 -> #36/#38 :
1. Mimique le pipeline app : resize 1920px JPEG 0.92 puis envoi
2. Teste plusieurs zones pour voir laquelle casse le matching
"""
import base64
import io
import json
import sys
import urllib.request
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).parent.parent
PHOTO = ROOT / "assets" / "exemple-photo-plateau-2.jpeg"
URL = "https://faraway-backend-367452467200.europe-west9.run.app/match-sanctuaries"


def post_json(url: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def resize_1920_jpeg(img_path: Path) -> str:
    """Mimique expo-image-manipulator: resize width=1920, JPEG compress=0.92."""
    img = cv2.imread(str(img_path))
    h, w = img.shape[:2]
    if w != 1920:
        scale = 1920 / w
        img = cv2.resize(img, (1920, int(h * scale)))
    # JPEG quality 92 (cv2 prend 0-100, ImageManipulator prend 0-1)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return base64.b64encode(buf.tobytes()).decode()


def test_zone(label, b64, zone, expected_count=5):
    print(f"=== {label} ===")
    body = {"image_base64": b64, "expected_count": expected_count}
    if zone is not None:
        body["zone"] = zone
    resp = post_json(URL, body)
    print(f"elapsed: {resp['elapsed_ms']}ms")
    for d in resp["detections"]:
        print(f"  #{d['id']:02d}  inliers={d['inliers']:<5} good={d['good_matches']}")
    print()


def main():
    # 1. Envoi direct (fichier brut)
    with open(PHOTO, "rb") as f:
        b64_raw = base64.b64encode(f.read()).decode()
    print(f"Raw file: {len(b64_raw)//1024} KB base64")

    # 2. Resize 1920 JPEG comme l'app
    b64_resized = resize_1920_jpeg(PHOTO)
    print(f"Resized 1920px JPEG92: {len(b64_resized)//1024} KB base64\n")

    # --- BRUT ---
    test_zone("RAW file — zone 33%", b64_raw, {"x": 0, "y": 0, "w": 1, "h": 0.33})

    # --- RESIZED ---
    test_zone("RESIZED 1920 — zone 33%", b64_resized, {"x": 0, "y": 0, "w": 1, "h": 0.33})
    test_zone("RESIZED 1920 — zone 25% (trop serre)", b64_resized, {"x": 0, "y": 0, "w": 1, "h": 0.25})
    test_zone("RESIZED 1920 — zone 30%", b64_resized, {"x": 0, "y": 0, "w": 1, "h": 0.30})
    test_zone("RESIZED 1920 — zone 35%", b64_resized, {"x": 0, "y": 0, "w": 1, "h": 0.35})
    test_zone("RESIZED 1920 — zone 40%", b64_resized, {"x": 0, "y": 0, "w": 1, "h": 0.40})
    test_zone("RESIZED 1920 — zone 45%", b64_resized, {"x": 0, "y": 0, "w": 1, "h": 0.45})
    test_zone("RESIZED 1920 — zone decalee y=0.02 h=0.30", b64_resized, {"x": 0.02, "y": 0.02, "w": 0.96, "h": 0.30})
    test_zone("RESIZED 1920 — PAS DE ZONE", b64_resized, None)


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as e:
        print(f"ERROR: cannot reach {URL}: {e}")
        sys.exit(1)
