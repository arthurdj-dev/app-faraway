"""
Teste /match-regions en local. Affiche les 8 detections, leur score NCC (inliers/1000)
et les top-3 candidats alternatifs pour chaque slot.

Run:
    cd backend && py -m uvicorn main:app --port 8001
    py backend/test_regions.py [8001]
"""
import base64
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent
PHOTOS = [
    ROOT / "assets" / "exemple-photo-plateau-de-jeu.jpg",
    ROOT / "assets" / "exemple-photo-plateau-2.jpeg",
]
PORT = sys.argv[1] if len(sys.argv) > 1 else "8001"
URL = f"http://localhost:{PORT}/match-regions"


def post_json(url, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def main():
    for photo in PHOTOS:
        if not photo.exists():
            print(f"skip (missing): {photo.name}")
            continue
        b64 = base64.b64encode(photo.read_bytes()).decode()
        print(f"\n=== {photo.name} ({len(b64)//1024} KB) ===")
        resp = post_json(URL, {"image_base64": b64, "expected_count": 8})
        print(f"elapsed: {resp['elapsed_ms']}ms, detections: {len(resp['detections'])}")
        for d in resp["detections"]:
            score = d["inliers"] / 1000
            alts = ", ".join(f"{c['id']}({c['inliers']/1000:.2f})" for c in d["candidates"][:3])
            cx = sum(p[0] for p in d["quad"]) / 4 if d.get("quad") else 0
            cy = sum(p[1] for p in d["quad"]) / 4 if d.get("quad") else 0
            print(f"  id={d['id']:>2}  ncc={score:.2f}  center=({cx:.0f},{cy:.0f})  alts=[{alts}]")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as e:
        print(f"ERROR: cannot reach {URL} — is uvicorn running?")
        print(f"  detail: {e}")
        sys.exit(1)
