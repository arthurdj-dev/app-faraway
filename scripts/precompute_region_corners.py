"""
Extrait le coin haut-gauche binarise de chaque carte Region de reference.
Sert de templates pour lire le numero imprime (duration) d'une carte detectee.

Input:  assets/region-references/{i}.{jpeg,jpg,png}   (i = 0..76)
Output: backend/region_corners.pkl   (dict[int, np.ndarray uint8])
Debug:  scripts/debug_region_corners/{i}.png  (crops visuels pour verification)
"""
import cv2
import numpy as np
import pickle
from pathlib import Path

ROOT = Path(__file__).parent.parent
REF_DIR = ROOT / "assets" / "region-references"
OUT_PATH = ROOT / "backend" / "region_corners.pkl"
DEBUG_DIR = Path(__file__).parent / "debug_region_corners"

CANONICAL_SIZE = 600          # les refs sont carrees (width x width from top)
CORNER_FRAC = 0.22            # 22 % du cote : contient le numero + un peu de marge
ADAPT_BLOCK = 21
ADAPT_C = 10


def binarize_corner(img_gray: np.ndarray) -> np.ndarray:
    return cv2.adaptiveThreshold(
        img_gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        ADAPT_BLOCK, ADAPT_C,
    )


def main():
    DEBUG_DIR.mkdir(exist_ok=True)
    data = {}
    corner_px = int(CANONICAL_SIZE * CORNER_FRAC)

    for i in range(77):
        p = next(
            (REF_DIR / f"{i}{ext}" for ext in (".jpeg", ".jpg", ".png")
             if (REF_DIR / f"{i}{ext}").exists()),
            None,
        )
        if p is None:
            print(f"  missing: {REF_DIR}/{i}.jpeg")
            continue

        img = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if img is None:
            print(f"  cannot read: {p}")
            continue

        # Les references sont supposees carrees. Resize a la taille canonique.
        img = cv2.resize(img, (CANONICAL_SIZE, CANONICAL_SIZE))
        corner = img[:corner_px, :corner_px]
        binary = binarize_corner(corner)

        data[i] = binary
        cv2.imwrite(str(DEBUG_DIR / f"{i:02d}.png"), binary)
        print(f"  #{i:02d}: corner {binary.shape}")

    OUT_PATH.parent.mkdir(exist_ok=True)
    tmp = OUT_PATH.with_suffix(".pkl.tmp")
    with open(tmp, "wb") as f:
        pickle.dump(data, f)
    tmp.rename(OUT_PATH)

    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"\nSaved {len(data)} corner templates -> {OUT_PATH}")
    print(f"File size: {size_kb:.1f} KB")
    print(f"Debug crops -> {DEBUG_DIR}")


if __name__ == "__main__":
    main()
