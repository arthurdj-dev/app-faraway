"""
Teste le backend local (doit tourner sur localhost:8000) avec la photo
de plateau d'exemple.

Run:
    # 1. precompute descriptors (une fois):
    py scripts/precompute_sanctuary_descriptors.py

    # 2. start backend:
    cd backend && py -m uvicorn main:app --port 8000

    # 3. dans un autre terminal:
    py backend/test_local.py
"""
import base64
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent
PHOTO = ROOT / "assets" / "exemple-photo-plateau-de-jeu.jpg"
URL = "http://localhost:8000/match-sanctuaries"


def post_json(url: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main():
    with open(PHOTO, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    print(f"Photo: {PHOTO.name} ({len(b64)//1024} KB base64)\n")

    print("=== Full image (no zone) ===")
    resp = post_json(URL, {"image_base64": b64})
    print(f"elapsed: {resp['elapsed_ms']}ms, detections: {len(resp['detections'])}")
    for d in resp["detections"]:
        print(f"  #{d['id']:02d}  inliers={d['inliers']:<5} good={d['good_matches']}")

    print("\n=== Zone: top 33% ===")
    resp = post_json(URL, {
        "image_base64": b64,
        "zone": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.33},
    })
    print(f"elapsed: {resp['elapsed_ms']}ms, detections: {len(resp['detections'])}")
    for d in resp["detections"]:
        print(f"  #{d['id']:02d}  inliers={d['inliers']:<5} good={d['good_matches']}")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as e:
        print(f"ERROR: cannot reach {URL} — is uvicorn running?")
        print(f"  detail: {e}")
        sys.exit(1)
