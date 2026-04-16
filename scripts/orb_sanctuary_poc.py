"""
POC ORB pour la reconnaissance des cartes sanctuaires.

Indexe les 53 photos de reference (sanctuaire_XX.jpeg) et teste le matching
contre les photos de variation (-2, -3) des 10 premiers sanctuaires.

Install:
    py -m pip install opencv-python numpy

Run depuis la racine du projet:
    py scripts/orb_sanctuary_poc.py
"""
import cv2
import numpy as np
from pathlib import Path

ROOT = Path(__file__).parent.parent
REF_DIR = ROOT / "assets" / "sanctuary-references"

ORB_FEATURES = 1500
LOWE_RATIO = 0.75
RANSAC_THRESHOLD = 5.0
MIN_MATCHES_FOR_RANSAC = 10
MAX_DIM = 1000


def load_gray(path):
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError(f"Cannot read {path}")
    h, w = img.shape
    if max(h, w) > MAX_DIM:
        scale = MAX_DIM / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
    return img


def match_pair(des_q, des_r, kp_q, kp_r):
    """Return (lowe_good_count, ransac_inliers)."""
    if des_q is None or des_r is None or len(des_q) < 2 or len(des_r) < 2:
        return 0, 0
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    try:
        knn = bf.knnMatch(des_q, des_r, k=2)
    except cv2.error:
        return 0, 0
    good = [m for pair in knn if len(pair) == 2
            for m, n in [pair] if m.distance < LOWE_RATIO * n.distance]
    if len(good) < MIN_MATCHES_FOR_RANSAC:
        return len(good), 0
    src = np.float32([kp_q[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp_r[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, RANSAC_THRESHOLD)
    inliers = int(mask.sum()) if mask is not None else 0
    return len(good), inliers


def main():
    orb = cv2.ORB_create(nfeatures=ORB_FEATURES)

    print(f"Indexing references from {REF_DIR}...")
    refs = {}
    for i in range(1, 54):
        ref_path = REF_DIR / f"sanctuaire-{i:02d}" / f"sanctuaire_{i:02d}.jpeg"
        if not ref_path.exists():
            print(f"  ! missing {ref_path}")
            continue
        img = load_gray(ref_path)
        kp, des = orb.detectAndCompute(img, None)
        refs[i] = (kp, des)
    print(f"Indexed {len(refs)} sanctuaries.\n")

    tests = []
    for i in range(1, 11):
        for variant in ("2", "3"):
            p = REF_DIR / f"sanctuaire-{i:02d}" / f"sanctuaire-{i:02d}-{variant}.jpeg"
            if p.exists():
                tests.append((i, variant, p))

    print(f"Running {len(tests)} matches...\n")
    header = f"{'Test':<14}{'Best':<20}{'2nd':<20}{'Ratio':<10}{'Status'}"
    print(header)
    print("-" * len(header))

    correct = 0
    for expected_id, variant, test_path in tests:
        img = load_gray(test_path)
        kp_q, des_q = orb.detectAndCompute(img, None)

        scores = []
        for ref_id, (kp_r, des_r) in refs.items():
            good, inliers = match_pair(des_q, des_r, kp_q, kp_r)
            scores.append((ref_id, good, inliers))

        scores.sort(key=lambda s: (s[2], s[1]), reverse=True)
        best = scores[0]
        second = scores[1]

        best_score = best[2] if best[2] > 0 else best[1]
        second_score = second[2] if second[2] > 0 else second[1]
        ratio = best_score / max(second_score, 1)
        ok = best[0] == expected_id
        if ok:
            correct += 1

        print(f"#{expected_id:02d}-{variant:<10}"
              f"#{best[0]:02d} [{best[1]}m/{best[2]}i]   "
              f"#{second[0]:02d} [{second[1]}m/{second[2]}i]   "
              f"{ratio:>5.2f}x    "
              f"{'OK' if ok else 'FAIL'}")

    print(f"\nResult: {correct}/{len(tests)} correct "
          f"({100*correct/len(tests):.0f}%)")
    print("\nLegend: [Nm/Ni] = N good matches (Lowe ratio) / N RANSAC inliers")
    print("A healthy signal has ratio >= 3x between best and 2nd match.")


if __name__ == "__main__":
    main()
