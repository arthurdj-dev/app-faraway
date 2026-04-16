"""
POC ORB sur un TABLEAU synthetique, avec:
  - validation geometrique de l'homographie (quad convexe, aire & ratio
    raisonnables) pour eliminer les faux positifs
  - NMS sur les quads detectes: on retient le meilleur match par zone

Genere des images de debug dans scripts/poc_output/ avec les quads dessines.

Run:
    py scripts/orb_tableau_poc.py
"""
import cv2
import numpy as np
from pathlib import Path
import random

ROOT = Path(__file__).parent.parent
REF_DIR = ROOT / "assets" / "sanctuary-references"
OUT_DIR = ROOT / "scripts" / "poc_output"
OUT_DIR.mkdir(exist_ok=True, parents=True)

ORB_FEATURES = 5000
LOWE_RATIO = 0.75
MIN_MATCHES = 10
MIN_INLIERS = 20
REF_MAX_DIM = 800
IOU_THRESHOLD = 0.3
MIN_QUAD_AREA_FRAC = 0.005
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


def make_tableau(present_ids, card_fraction=0.4, canvas=(3200, 1800), seed=42):
    rng = np.random.default_rng(seed)
    W, H = canvas
    bg = rng.integers(80, 160, (H, W, 3), dtype=np.uint8)
    noise = cv2.GaussianBlur(
        rng.integers(0, 255, (H, W, 3), dtype=np.uint8), (31, 31), 0
    )
    canvas_img = cv2.addWeighted(bg, 0.5, noise, 0.5, 0)

    card_h = int(H * card_fraction)
    spacing = W // len(present_ids)

    for idx, sid in enumerate(present_ids):
        p = REF_DIR / f"sanctuaire-{sid:02d}" / f"sanctuaire-{sid:02d}-2.jpeg"
        if not p.exists():
            p = REF_DIR / f"sanctuaire-{sid:02d}" / f"sanctuaire_{sid:02d}.jpeg"
        card = load_bgr(p)
        ch, cw = card.shape[:2]
        s = card_h / ch
        nw, nh = int(cw * s), card_h
        card = cv2.resize(card, (nw, nh))
        x = idx * spacing + (spacing - nw) // 2
        y = (H - nh) // 2 + int(rng.integers(-40, 40))
        x, y = max(0, x), max(0, y)
        if x + nw > W or y + nh > H:
            continue
        canvas_img[y:y + nh, x:x + nw] = card

    return canvas_img


def compute_orb(img, orb):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    return orb.detectAndCompute(g, None)


def validate_quad(quad, tableau_shape):
    """Geometric sanity check on the detected quadrilateral."""
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


def match_with_homography(des_q, des_r, kp_q, kp_r, ref_shape, tableau_shape):
    """Returns (good_count, inliers, quad_or_None)."""
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
    if inliers < MIN_INLIERS:
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
    """matches = list of (id, inliers, quad). Draw colored boxes with labels."""
    out = tableau.copy()
    for rid, inl, quad in matches:
        pts = quad.astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(out, [pts], True, (0, 255, 0), 4)
        x, y = quad[0]
        label = f"#{rid:02d} ({inl})"
        cv2.putText(out, label, (int(x), max(0, int(y) - 10)),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)
    return out


def run_scenario(label, present_ids, card_fraction, refs, orb):
    print(f"\n{'=' * 70}")
    print(f"Scenario: {label}")
    print(f"  card height = {card_fraction * 100:.0f}%, placed: {present_ids}")
    print(f"{'=' * 70}")

    tableau = make_tableau(present_ids, card_fraction=card_fraction)
    kp_q, des_q = compute_orb(tableau, orb)
    print(f"  tableau keypoints: {len(kp_q)}")

    candidates = []
    for rid, (kp_r, des_r, shape_r) in refs.items():
        good, inl, quad = match_with_homography(
            des_q, des_r, kp_q, kp_r, shape_r, tableau.shape
        )
        if quad is not None:
            candidates.append((rid, good, inl, quad))

    candidates.sort(key=lambda c: c[2], reverse=True)
    print(f"  candidates passing geometric filter: {len(candidates)}")

    # NMS
    accepted = []
    for rid, good, inl, quad in candidates:
        overlap = False
        for arid, _, _, aquad in accepted:
            if quad_iou(quad, aquad, tableau.shape) > IOU_THRESHOLD:
                overlap = True
                break
        if not overlap:
            accepted.append((rid, good, inl, quad))

    print(f"\n  After NMS: {len(accepted)} detections")
    print(f"  {'ID':<7}{'Good':<8}{'Inliers':<10}{'Present?'}")
    print(f"  {'-' * 35}")
    for rid, good, inl, _ in accepted:
        mark = "YES" if rid in present_ids else "FALSE+"
        print(f"  #{rid:02d}    {good:<8}{inl:<10}{mark}")

    found = [rid for rid, _, _, _ in accepted if rid in present_ids]
    false_pos = [rid for rid, _, _, _ in accepted if rid not in present_ids]
    missed = [s for s in present_ids if s not in found]

    print(f"\n  Expected: {present_ids}")
    print(f"  Found:    {sorted(found)}")
    if missed:
        print(f"  MISSED:   {missed}")
    if false_pos:
        print(f"  FALSE+:   {false_pos}")
    recall = len(found) / len(present_ids)
    precision = len(found) / len(accepted) if accepted else 0
    print(f"  Recall: {recall:.0%}  Precision: {precision:.0%}")

    debug = draw_quads(tableau, [(r, i, q) for r, _, i, q in accepted])
    out_path = OUT_DIR / f"tableau_{label}.jpg"
    cv2.imwrite(str(out_path), debug)
    print(f"  debug image: {out_path.name}")


def main():
    random.seed(7)
    orb = cv2.ORB_create(nfeatures=ORB_FEATURES)

    print(f"Indexing 53 references (max dim {REF_MAX_DIM})...")
    refs = {}
    for i in range(1, 54):
        p = REF_DIR / f"sanctuaire-{i:02d}" / f"sanctuaire_{i:02d}.jpeg"
        if not p.exists():
            continue
        img = load_bgr(p, max_dim=REF_MAX_DIM)
        kp, des = compute_orb(img, orb)
        refs[i] = (kp, des, img.shape)
    print(f"Indexed {len(refs)} refs.")

    run_scenario("3cards_big", sorted(random.sample(range(1, 54), 3)),
                 card_fraction=0.50, refs=refs, orb=orb)
    run_scenario("5cards_med", sorted(random.sample(range(1, 54), 5)),
                 card_fraction=0.35, refs=refs, orb=orb)
    run_scenario("7cards_small", sorted(random.sample(range(1, 54), 7)),
                 card_fraction=0.25, refs=refs, orb=orb)
    run_scenario("8cards_tight", sorted(random.sample(range(1, 54), 8)),
                 card_fraction=0.22, refs=refs, orb=orb)


if __name__ == "__main__":
    main()
