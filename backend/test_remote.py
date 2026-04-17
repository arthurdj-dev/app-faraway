"""
Teste le backend Cloud Run deploye avec la 2eme photo de test
pour diagnostiquer pourquoi #04 et #05 se font remplacer par #36 et #38.
"""
import base64
import json
import sys
import urllib.request
from pathlib import Path

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


def main():
    with open(PHOTO, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    print(f"Photo: {PHOTO.name} ({len(b64)//1024} KB base64)\n")

    # Reprend le schema que Groq renverrait pour la bande sanctuaires
    zones = [
        ("top 33% (reasonable default)", {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.33}),
        ("top 38% (marge un peu plus large)", {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.38}),
    ]

    for label, zone in zones:
        print(f"=== {label} — expected_count=5 ===")
        resp = post_json(URL, {
            "image_base64": b64,
            "zone": zone,
            "expected_count": 5,
        })
        print(f"elapsed: {resp['elapsed_ms']}ms, detections: {len(resp['detections'])}")
        for d in resp["detections"]:
            print(f"  #{d['id']:02d}  inliers={d['inliers']:<5} good={d['good_matches']}")
        print()

    print("=== top 33% — SANS expected_count (strict=100) ===")
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
        print(f"ERROR: cannot reach {URL}")
        print(f"  detail: {e}")
        sys.exit(1)
