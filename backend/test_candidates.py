"""Verifie que le backend renvoie bien un champ `candidates` par detection."""
import base64
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent
PHOTO = ROOT / "assets" / "exemple-photo-plateau-2.jpeg"
URL = "http://localhost:8765/match-sanctuaries"


def main():
    with open(PHOTO, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    body = {
        "image_base64": b64,
        "zone": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.33},
        "expected_count": 5,
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(URL, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.loads(r.read())

    print(f"elapsed: {resp['elapsed_ms']}ms\n")
    for d in resp["detections"]:
        print(f"DETECTED #{d['id']:02d}  inliers={d['inliers']}  good={d['good_matches']}")
        alts = d.get("candidates", [])
        if alts:
            print(f"  alternatives ({len(alts)}):")
            for c in alts:
                print(f"    #{c['id']:02d}  inliers={c['inliers']}")
        else:
            print("  (no alternatives)")
        print()


if __name__ == "__main__":
    main()
