"""
Pre-calcule les descripteurs ORB des 53 sanctuaires de reference.
A relancer chaque fois qu'une photo de reference change.

Output: backend/sanctuary_descriptors.pkl
"""
import cv2
import numpy as np
import pickle
from pathlib import Path

ROOT = Path(__file__).parent.parent
REF_DIR = ROOT / "assets" / "sanctuary-references"
OUT_PATH = ROOT / "backend" / "sanctuary_descriptors.pkl"

ORB_FEATURES = 1500
REF_MAX_DIM = 1000


def main():
    orb = cv2.ORB_create(nfeatures=ORB_FEATURES)
    data = {}

    for i in range(1, 54):
        p = REF_DIR / f"sanctuaire-{i:02d}" / f"sanctuaire_{i:02d}.jpeg"
        if not p.exists():
            print(f"  missing: {p.name}")
            continue
        img = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        h, w = img.shape
        if max(h, w) > REF_MAX_DIM:
            s = REF_MAX_DIM / max(h, w)
            img = cv2.resize(img, (int(w * s), int(h * s)))
        kp, des = orb.detectAndCompute(img, None)
        kp_pts = np.array([k.pt for k in kp], dtype=np.float32)
        data[i] = {
            "descriptors": des,
            "keypoints": kp_pts,
            "shape": img.shape,
        }
        print(f"  #{i:02d}: {len(kp)} keypoints, des shape {des.shape}")

    OUT_PATH.parent.mkdir(exist_ok=True)
    tmp_path = OUT_PATH.with_suffix(".pkl.tmp")
    with open(tmp_path, "wb") as f:
        pickle.dump(data, f)
    tmp_path.rename(OUT_PATH)

    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"\nSaved {len(data)} refs -> {OUT_PATH}")
    print(f"File size: {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
