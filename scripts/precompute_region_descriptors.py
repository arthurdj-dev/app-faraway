"""
Pre-calcule les descripteurs ORB des 77 cartes Region de reference.
A relancer chaque fois qu'une photo de reference change.

Input:  assets/region-references/region-{00..76}/card.jpg
Output: backend/region_descriptors.pkl
"""
import cv2
import numpy as np
import pickle
from pathlib import Path

ROOT = Path(__file__).parent.parent
REF_DIR = ROOT / "assets" / "region-references"
OUT_PATH = ROOT / "backend" / "region_descriptors.pkl"

ORB_FEATURES = 1500
REF_MAX_DIM = 1000


def main():
    orb = cv2.ORB_create(nfeatures=ORB_FEATURES)
    data = {}

    for i in range(0, 77):
        p = next((REF_DIR / f"{i}{ext}" for ext in (".jpeg", ".jpg", ".png")
                  if (REF_DIR / f"{i}{ext}").exists()), None)
        if p is None:
            print(f"  missing: {REF_DIR}/{i}.jpeg")
            continue
        img = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if img is None:
            print(f"  cannot read: {p}")
            continue
        h, w = img.shape
        if max(h, w) > REF_MAX_DIM:
            s = REF_MAX_DIM / max(h, w)
            img = cv2.resize(img, (int(w * s), int(h * s)))
        kp, des = orb.detectAndCompute(img, None)
        if des is None or len(kp) == 0:
            print(f"  #{i:02d}: no keypoints — image may lack texture")
            continue
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
