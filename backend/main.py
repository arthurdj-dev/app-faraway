"""
FastAPI backend: matche une photo de tableau contre les references via ORB + homographie + NMS.

Contract:
    POST /match-sanctuaries
    body: { image_base64: string, zone?: {x,y,w,h} (fractions 0-1), expected_count?: int }
    response: { detections: [{id, inliers, good_matches, quad?}], elapsed_ms }

    POST /match-regions
    body: { image_base64: string, expected_count?: int }
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
import logging

BACKEND_DIR = Path(__file__).parent
DESCRIPTORS_PATH = BACKEND_DIR / "sanctuary_descriptors.pkl"
REGION_DESCRIPTORS_PATH = BACKEND_DIR / "region_descriptors.pkl"
REGION_CORNERS_PATH = BACKEND_DIR / "region_corners.pkl"

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
MAX_IMAGE_B64_BYTES = 10 * 1024 * 1024  # 10 MB

# Corner-template reading (doit coller a scripts/precompute_region_corners.py)
CORNER_CANONICAL_SIZE = 600
CORNER_FRAC = 0.22
CORNER_ADAPT_BLOCK = 21
CORNER_ADAPT_C = 10

logger = logging.getLogger(__name__)


def _load_refs(path: Path) -> dict:
    with open(path, "rb") as f:
        data = pickle.load(f)
    refs = {}
    for rid, d in data.items():
        kp = [cv2.KeyPoint(x=float(pt[0]), y=float(pt[1]), size=1)
              for pt in d["keypoints"]]
        refs[rid] = (kp, d["descriptors"], d["shape"])
    return refs


logging.basicConfig(level=logging.INFO)
logger.info("Loading reference descriptors...")

try:
    REFS = _load_refs(DESCRIPTORS_PATH)
except Exception as exc:
    logger.exception("Failed to load sanctuary descriptors")
    raise RuntimeError(f"Cannot start: {exc}") from exc
logger.info("Loaded %d sanctuaires.", len(REFS))

try:
    REGION_REFS = _load_refs(REGION_DESCRIPTORS_PATH)
    logger.info("Loaded %d régions.", len(REGION_REFS))
except FileNotFoundError:
    REGION_REFS = {}
    logger.warning("region_descriptors.pkl not found — run scripts/precompute_region_descriptors.py first")
except Exception as exc:
    logger.exception("Failed to load region descriptors")
    raise RuntimeError(f"Cannot start: {exc}") from exc

try:
    with open(REGION_CORNERS_PATH, "rb") as f:
        REGION_CORNERS: dict[int, np.ndarray] = pickle.load(f)
    logger.info("Loaded %d region corner templates.", len(REGION_CORNERS))
except FileNotFoundError:
    REGION_CORNERS = {}
    logger.warning("region_corners.pkl not found — run scripts/precompute_region_corners.py first")
except Exception as exc:
    logger.exception("Failed to load region corners")
    raise RuntimeError(f"Cannot start: {exc}") from exc


app = FastAPI(title="Faraway Matcher")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
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
    if len(b64) > MAX_IMAGE_B64_BYTES:
        raise ValueError(f"Image trop grande ({len(b64) // 1024} KB, max {MAX_IMAGE_B64_BYTES // 1024} KB)")
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


def _prepare_image(img: np.ndarray, zone: Optional[Zone] = None) -> np.ndarray:
    if zone is not None:
        h, w = img.shape[:2]
        x0 = int(max(0.0, min(1.0, zone.x)) * w)
        y0 = int(max(0.0, min(1.0, zone.y)) * h)
        x1 = int(max(0.0, min(1.0, zone.x + zone.w)) * w)
        y1 = int(max(0.0, min(1.0, zone.y + zone.h)) * h)
        if x1 <= x0 or y1 <= y0:
            raise ValueError("Invalid zone")
        img = img[y0:y1, x0:x1]
    return resize_max(img, IMAGE_MAX_DIM)


def _orb_match(refs: dict, img: np.ndarray, expected_count: Optional[int]) -> list[Detection]:
    """Core ORB pipeline on an already-prepared image: features, NMS, candidates."""
    orb = cv2.ORB_create(nfeatures=ORB_FEATURES)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    kp_q, des_q = orb.detectAndCompute(gray, None)

    use_relaxed = bool(expected_count and expected_count > 0)
    floor = MIN_INLIERS_RELAXED if use_relaxed else MIN_INLIERS_STRICT

    all_matches = []
    for rid, (kp_r, des_r, shape_r) in refs.items():
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
        accepted = accepted[:expected_count]

    accepted_ids = {rid for rid, _, _, _ in accepted}

    detections = []
    for rid, good, inl, quad in accepted:
        alts = []
        for r2id, g2, i2, q2 in all_matches:
            if r2id == rid or r2id in accepted_ids:
                continue
            if quad_iou(quad, q2, img.shape) > ALT_OVERLAP_THRESHOLD:
                alts.append(Candidate(id=r2id, inliers=i2))
        alts.sort(key=lambda c: c.inliers, reverse=True)

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

    return detections


def _match_against(refs: dict, img: np.ndarray, expected_count: Optional[int],
                   zone: Optional[Zone] = None) -> list[Detection]:
    return _orb_match(refs, _prepare_image(img, zone), expected_count)


# ─── Lecture du numero par template-matching (regions) ────────────────────

def order_quad(quad: np.ndarray) -> np.ndarray:
    """Ordonne les 4 points : top-left, top-right, bottom-right, bottom-left."""
    pts = np.asarray(quad, dtype=np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    d = pts[:, 1] - pts[:, 0]  # y - x
    ordered = np.zeros((4, 2), dtype=np.float32)
    ordered[0] = pts[np.argmin(s)]      # top-left
    ordered[2] = pts[np.argmax(s)]      # bottom-right
    ordered[1] = pts[np.argmin(d)]      # top-right
    ordered[3] = pts[np.argmax(d)]      # bottom-left
    return ordered


def rectify_card(img: np.ndarray, quad: np.ndarray, size: int = CORNER_CANONICAL_SIZE) -> np.ndarray:
    src = order_quad(quad)
    dst = np.array(
        [[0, 0], [size - 1, 0], [size - 1, size - 1], [0, size - 1]],
        dtype=np.float32,
    )
    H = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, H, (size, size))


def _corner_binary(card: np.ndarray) -> np.ndarray:
    size = card.shape[0]
    cp = int(size * CORNER_FRAC)
    corner = card[:cp, :cp]
    if corner.ndim == 3:
        corner = cv2.cvtColor(corner, cv2.COLOR_BGR2GRAY)
    return cv2.adaptiveThreshold(
        corner, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        CORNER_ADAPT_BLOCK, CORNER_ADAPT_C,
    )


def identify_region(card: np.ndarray, corners_db: dict[int, np.ndarray]) -> list[tuple[int, float]]:
    """Retourne tous les ids tries par score NCC decroissant."""
    query = _corner_binary(card)
    scores: list[tuple[int, float]] = []
    for rid, ref in corners_db.items():
        if ref.shape != query.shape:
            ref = cv2.resize(ref, (query.shape[1], query.shape[0]))
        res = cv2.matchTemplate(query, ref, cv2.TM_CCOEFF_NORMED)
        scores.append((rid, float(res[0, 0])))
    scores.sort(key=lambda t: t[1], reverse=True)
    return scores


def _reidentify_via_corners(
    img: np.ndarray,
    orb_detections: list[Detection],
    corners_db: dict[int, np.ndarray],
) -> list[Detection]:
    """Pour chaque quad ORB, rectifie la carte et relit son numero par NCC."""
    used_ids: set[int] = set()
    out: list[Detection] = []
    for d in orb_detections:
        if not d.quad:
            out.append(d)
            continue
        try:
            card = rectify_card(img, np.asarray(d.quad, dtype=np.float32))
        except cv2.error:
            out.append(d)
            continue

        scores = identify_region(card, corners_db)
        # Prend le meilleur score non deja assigne pour respecter l'unicite
        chosen = next(((rid, sc) for rid, sc in scores if rid not in used_ids), scores[0])
        used_ids.add(chosen[0])

        # inliers : on encode le score NCC [-1, 1] -> [0, 1000] pour garder un int
        inliers = max(0, int(chosen[1] * 1000))

        alts = [
            Candidate(id=rid, inliers=max(0, int(sc * 1000)))
            for rid, sc in scores
            if rid != chosen[0]
        ][:MAX_ALTERNATIVES]

        out.append(Detection(
            id=chosen[0],
            inliers=inliers,
            good_matches=d.good_matches,
            quad=d.quad,
            candidates=alts,
        ))
    return out


@app.post("/match-sanctuaries", response_model=MatchResponse)
def match_sanctuaries(req: MatchRequest) -> MatchResponse:
    t0 = time.time()
    try:
        img = decode_image(req.image_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")
    try:
        detections = _match_against(REFS, img, req.expected_count, req.zone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    elapsed_ms = int((time.time() - t0) * 1000)
    return MatchResponse(detections=detections, elapsed_ms=elapsed_ms)


@app.post("/match-regions", response_model=MatchResponse)
def match_regions(req: MatchRequest) -> MatchResponse:
    if not REGION_REFS:
        raise HTTPException(status_code=503, detail="Region descriptors not loaded — run precompute_region_descriptors.py first")
    t0 = time.time()
    try:
        img = decode_image(req.image_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")
    expected = req.expected_count if req.expected_count else 8
    try:
        prepared = _prepare_image(img, req.zone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 1. Localisation via ORB (robuste aux deformations perspective)
    detections = _orb_match(REGION_REFS, prepared, expected)

    # 2. Re-identification par template-matching du coin haut-gauche
    #    (robuste a la luminosite — remplace l'id ORB par le numero lu).
    if REGION_CORNERS and detections:
        detections = _reidentify_via_corners(prepared, detections, REGION_CORNERS)

    elapsed_ms = int((time.time() - t0) * 1000)
    return MatchResponse(detections=detections, elapsed_ms=elapsed_ms)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "sanctuaries_loaded": len(REFS),
        "regions_loaded": len(REGION_REFS),
        "region_corners_loaded": len(REGION_CORNERS),
    }
