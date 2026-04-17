"""
FastAPI backend: matche une photo de tableau contre les 53 sanctuaires
de reference via ORB + homographie + NMS.

Contract:
    POST /match-sanctuaries
    body: { image_base64: string, zone?: {x,y,w,h} (fractions 0-1) }
    response: { detections: [{id, inliers, good_matches, quad?}], elapsed_ms }

Run locally:
    py -m uvicorn main:app --reload --port 8000
"""
import base64
import pickle
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BACKEND_DIR = Path(__file__).parent
DESCRIPTORS_PATH = BACKEND_DIR / "sanctuary_descriptors.pkl"

ORB_FEATURES = 10000
LOWE_RATIO = 0.75
MIN_MATCHES = 10
MIN_INLIERS_STRICT = 100
MIN_INLIERS_RELAXED = 30
MIN_INLIERS_ALT = 15  # seuil bas utilise pour collecter les candidats alternatifs par slot
RANSAC_THRESHOLD = 5.0
IOU_THRESHOLD = 0.3
ALT_OVERLAP_THRESHOLD = 0.2  # IoU mini entre un alt et la detection acceptee pour etre du meme slot
MAX_ALTERNATIVES = 4
MIN_QUAD_AREA_FRAC = 0.01
MAX_QUAD_AREA_FRAC = 0.6
MAX_SIDE_RATIO = 4.0
IMAGE_MAX_DIM = 3000


def _load_refs():
    with open(DESCRIPTORS_PATH, "rb") as f:
        data = pickle.load(f)
    refs = {}
    for rid, d in data.items():
        kp = [cv2.KeyPoint(x=float(pt[0]), y=float(pt[1]), size=1)
              for pt in d["keypoints"]]
        refs[rid] = (kp, d["descriptors"], d["shape"])
    return refs


print("Loading reference descriptors...")
REFS = _load_refs()
print(f"Loaded {len(REFS)} sanctuaires.")


app = FastAPI(title="Faraway Sanctuary Matcher")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Zone(BaseModel):
    x: float
    y: float
    w: float
    h: float


class MatchRequest(BaseModel):
    image_base64: str
    zone: Optional[Zone] = None
    expected_count: Optional[int] = None


class Candidate(BaseModel):
    id: int
    inliers: int


class Detection(BaseModel):
    id: int
    inliers: int
    good_matches: int
    quad: Optional[list[list[float]]] = None
    candidates: list[Candidate] = []


class MatchResponse(BaseModel):
    detections: list[Detection]
    elapsed_ms: int


def decode_image(b64: str) -> np.ndarray:
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    buf = base64.b64decode(b64)
    arr = np.frombuffer(buf, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Cannot decode image")
    return img


def resize_max(img: np.ndarray, max_dim: int) -> np.ndarray:
    h, w = img.shape[:2]
    if max(h, w) > max_dim:
        s = max_dim / max(h, w)
        img = cv2.resize(img, (int(w * s), int(h * s)))
    return img


def validate_quad(quad: np.ndarray, shape: tuple) -> bool:
    q = quad.astype(np.int32)
    if not cv2.isContourConvex(q):
        return False
    area = cv2.contourArea(q)
    total = shape[0] * shape[1]
    if area < MIN_QUAD_AREA_FRAC * total or area > MAX_QUAD_AREA_FRAC * total:
        return False
    sides = [np.linalg.norm(quad[(i + 1) % 4] - quad[i]) for i in range(4)]
    if min(sides) < 10 or max(sides) / min(sides) > MAX_SIDE_RATIO:
        return False
    return True


def match_pair(des_q, des_r, kp_q, kp_r, ref_shape, image_shape,
               min_inliers=MIN_INLIERS_STRICT):
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
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, RANSAC_THRESHOLD)
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
    if not validate_quad(quad, image_shape):
        return len(good), inliers, None
    return len(good), inliers, quad


def quad_iou(q1, q2, shape):
    h, w = shape[:2]
    m1 = np.zeros((h, w), dtype=np.uint8)
    m2 = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(m1, [q1.astype(np.int32)], 1)
    cv2.fillPoly(m2, [q2.astype(np.int32)], 1)
    inter = int((m1 & m2).sum())
    union = int((m1 | m2).sum())
    return inter / union if union else 0.0


@app.post("/match-sanctuaries", response_model=MatchResponse)
def match_sanctuaries(req: MatchRequest) -> MatchResponse:
    t0 = time.time()

    try:
        img = decode_image(req.image_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    if req.zone is not None:
        h, w = img.shape[:2]
        z = req.zone
        x0 = int(max(0.0, min(1.0, z.x)) * w)
        y0 = int(max(0.0, min(1.0, z.y)) * h)
        x1 = int(max(0.0, min(1.0, z.x + z.w)) * w)
        y1 = int(max(0.0, min(1.0, z.y + z.h)) * h)
        if x1 <= x0 or y1 <= y0:
            raise HTTPException(status_code=400, detail="Invalid zone")
        img = img[y0:y1, x0:x1]

    img = resize_max(img, IMAGE_MAX_DIM)

    orb = cv2.ORB_create(nfeatures=ORB_FEATURES)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    kp_q, des_q = orb.detectAndCompute(gray, None)

    # Quand on sait combien de sanctuaires chercher, on assouplit le seuil
    # puis on tronque à top-N après NMS — évite de rater une carte faible.
    use_relaxed = bool(req.expected_count and req.expected_count > 0)
    floor = MIN_INLIERS_RELAXED if use_relaxed else MIN_INLIERS_STRICT

    # On scanne TOUJOURS avec le seuil le plus bas pour collecter les alternatives
    # qui serviront au picker. Les detections gardees utilisent `floor` normal.
    all_matches = []
    for rid, (kp_r, des_r, shape_r) in REFS.items():
        good, inl, quad = match_pair(
            des_q, des_r, kp_q, kp_r, shape_r, img.shape,
            min_inliers=MIN_INLIERS_ALT,
        )
        if quad is not None:
            all_matches.append((rid, good, inl, quad))

    strict = [m for m in all_matches if m[2] >= floor]
    strict.sort(key=lambda c: c[2], reverse=True)

    accepted = []
    for rid, good, inl, quad in strict:
        overlap = any(
            quad_iou(quad, a[3], img.shape) > IOU_THRESHOLD
            for a in accepted
        )
        if not overlap:
            accepted.append((rid, good, inl, quad))

    if use_relaxed:
        accepted = accepted[:req.expected_count]

    accepted_ids = {rid for rid, _, _, _ in accepted}

    detections = []
    for rid, good, inl, quad in accepted:
        # 1) Candidats qui chevauchent spatialement ce slot
        alts = []
        for r2id, g2, i2, q2 in all_matches:
            if r2id == rid or r2id in accepted_ids:
                continue
            if quad_iou(quad, q2, img.shape) > ALT_OVERLAP_THRESHOLD:
                alts.append(Candidate(id=r2id, inliers=i2))
        alts.sort(key=lambda c: c.inliers, reverse=True)

        # 2) Si moins de MAX_ALTERNATIVES, completer avec les meilleurs scores
        #    globaux (pas deja utilises) pour toujours proposer 4 options.
        if len(alts) < MAX_ALTERNATIVES:
            used = {rid} | accepted_ids | {c.id for c in alts}
            global_pool = sorted(all_matches, key=lambda m: m[2], reverse=True)
            for r2id, g2, i2, q2 in global_pool:
                if r2id in used:
                    continue
                alts.append(Candidate(id=r2id, inliers=i2))
                used.add(r2id)
                if len(alts) >= MAX_ALTERNATIVES:
                    break

        detections.append(Detection(
            id=rid, inliers=inl, good_matches=good,
            quad=quad.tolist(),
            candidates=alts[:MAX_ALTERNATIVES],
        ))

    elapsed_ms = int((time.time() - t0) * 1000)
    return MatchResponse(detections=detections, elapsed_ms=elapsed_ms)


@app.get("/health")
def health():
    return {"status": "ok", "references_loaded": len(REFS)}
