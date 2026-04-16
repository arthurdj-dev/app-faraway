"""
POC ORB sur une VRAIE photo de plateau.
Matche la photo contre les 53 sanctuaires de reference et sort les quads
detectes apres validation geometrique + NMS.

Run:
    py scripts/orb_real_tableau_poc.py [--top N] [--min-inliers N]
"""
import cv2
import numpy as np
from pathlib import Path
import argparse

ROOT = Path(__file__).parent.parent
REF_DIR = ROOT / "assets" / "sanctuary-references"
OUT_DIR = ROOT / "scripts" / "poc_output"
OUT_DIR.mkdir(exist_ok=True, parents=True)
TABLEAU_PATH = ROOT / "assets" / "exemple-photo-plateau-de-jeu.jpg"

ORB_FEATURES = 15000
LOWE_RATIO = 0.75
MIN_MATCHES = 10
MIN_INLIERS = 20
REF_MAX_DIM = 1000
TABLEAU_MAX_DIM = 3000
IOU_THRESHOLD = 0.3
MIN_QUAD_AREA_FRAC = 0.003
MAX_QUAD_AREA_FRAC = 0.5
MAX_SIDE_RATIO = 4.0


def load_bgr(path, max_dim=None):
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Cannot read {path}")
    if max_dim is not None:
        h, w = img.shape[:2]
        if max(h, w) > max_dim:
            s = max_dim / max(h, w)
            img = cv2.resize(img, (int(w * s), int(h * s)))
    return img


def compute_orb(img, orb):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    return orb.detectAndCompute(g, None)


def validate_quad(quad, tableau_shape):
    quad_i = quad.astype(np.int32)
    if not cv2.isContourConvex(quad_i):
        return False
    area = cv2.contourArea(quad_i)
    th, tw = tableau_shape[:2]
    total = th * tw
    if area < MIN_QUAD_AREA_FRAC * total or area > MAX_QUAD_AREA_FRAC * total:
        return False
    sides = [np.linalg.norm(quad[(i + 1) % 4] - quad[i]) for i in range(4)]
    if min(sides) < 10 or max(sides) / min(sides) > MAX_SIDE_RATIO:
        return False
    return True


def match_with_homography(des_q, des_r, kp_q, kp_r, ref_shape, tableau_shape,
                          min_inliers=MIN_INLIERS):
    if des_q is None or des_r is None or len(des_q) < 2 or len(des_r) < 2:
        return 0, 0, None
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    try:
        knn = bf.knnMatch(des_q, des_r, k=2)
    except cv2.error:
        return 0, 0, None
    good = [m for pair in knn if len(pair) == 2
            for m, n in [pair] if m.distance < LOWE_RATIO * n.distance]
    if len(good) < MIN_MATCHES:
        return len(good), 0, None
    src = np.float32([kp_r[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp_q[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
    if H is None:
        return len(good), 0, None
    inliers = int(mask.sum())
    if inliers < min_inliers:
        return len(good), inliers, None

    h, w = ref_shape[:2]
    corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
    try:
        quad = cv2.perspectiveTransform(corners, H).reshape(4, 2)
    except cv2.error:
        return len(good), inliers, None
    if not validate_quad(quad, tableau_shape):
        return len(good), inliers, None
    return len(good), inliers, quad


def quad_iou(q1, q2, canvas_shape):
    h, w = canvas_shape[:2]
    m1 = np.zeros((h, w), dtype=np.uint8)
    m2 = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(m1, [q1.astype(np.int32)], 1)
    cv2.fillPoly(m2, [q2.astype(np.int32)], 1)
    inter = int((m1 & m2).sum())
    union = int((m1 | m2).sum())
    return inter / union if union else 0.0


def draw_quads(tableau, matches):
    out = tableau.copy()
    palette = [(0, 255, 0), (0, 200, 255), (255, 100, 100),
               (255, 0, 255), (0, 255, 255), (100, 255, 100)]
    for i, (rid, inl, quad) in enumerate(matches):
        color = palette[i % len(palette)]
        pts = quad.astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(out, [pts], True, color, 3)
        x, y = quad[0]
        label = f"#{rid:02d} ({inl})"
        cv2.putText(out, label, (int(x), max(20, int(y) - 10)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--top", type=int, default=15,
                        help="Show top N raw candidates before NMS")
    parser.add_argument("--min-inliers", type=int, default=MIN_INLIERS)
    args = parser.parse_args()

    min_inliers = args.min_inliers

    print(f"Loading tableau {TABLEAU_PATH.name}...")
    tableau = load_bgr(TABLEAU_PATH, max_dim=TABLEAU_MAX_DIM)
    print(f"  size: {tableau.shape[1]}x{tableau.shape[0]}")

    orb = cv2.ORB_create(nfeatures=ORB_FEATURES)
    kp_q, des_q = compute_orb(tableau, orb)
    print(f"  keypoints: {len(kp_q)}")

    print(f"\nIndexing 53 references (max dim {REF_MAX_DIM})...")
    refs = {}
    for i in range(1, 54):
        p = REF_DIR / f"sanctuaire-{i:02d}" / f"sanctuaire_{i:02d}.jpeg"
        if not p.exists():
            continue
        img = load_bgr(p, max_dim=REF_MAX_DIM)
        kp, des = compute_orb(img, orb)
        refs[i] = (kp, des, img.shape)
    print(f"  indexed {len(refs)} refs.")

    print("\nMatching against all references...")
    candidates = []
    for rid, (kp_r, des_r, shape_r) in refs.items():
        good, inl, quad = match_with_homography(
            des_q, des_r, kp_q, kp_r, shape_r, tableau.shape,
            min_inliers=min_inliers,
        )
        candidates.append((rid, good, inl, quad))
    candidates.sort(key=lambda c: c[2], reverse=True)

    print(f"\nTop {args.top} raw candidates (by inliers):")
    print(f"  {'ID':<7}{'Good':<8}{'Inliers':<10}{'Valid quad?'}")
    print(f"  {'-' * 40}")
    for rid, good, inl, quad in candidates[:args.top]:
        vq = "YES" if quad is not None else "no"
        print(f"  #{rid:02d}    {good:<8}{inl:<10}{vq}")

    accepted = []
    for rid, good, inl, quad in candidates:
        if quad is None or inl < min_inliers:
            continue
        overlap = False
        for arid, _, _, aquad in accepted:
            if quad_iou(quad, aquad, tableau.shape) > IOU_THRESHOLD:
                overlap = True
                break
        if not overlap:
            accepted.append((rid, good, inl, quad))

    print(f"\nAfter geometric filter + NMS: {len(accepted)} detections")
    print(f"  {'ID':<7}{'Good':<8}{'Inliers'}")
    print(f"  {'-' * 25}")
    for rid, good, inl, _ in accepted:
        print(f"  #{rid:02d}    {good:<8}{inl}")

    debug = draw_quads(tableau, [(r, i, q) for r, _, i, q in accepted])
    out_path = OUT_DIR / "real_tableau_detections.jpg"
    cv2.imwrite(str(out_path), debug)
    print(f"\nDebug image: {out_path}")


if __name__ == "__main__":
    main()
