# iOS 18+ koyu ve tinted ikon varyantlari. Kaynak: assets/brand/icon-1024.png.
# Calistirma: python3 -I scripts/brand-icons.py
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, "assets", "brand")

src = np.asarray(Image.open(os.path.join(BRAND, "icon-1024.png")).convert("RGB")).astype(np.float32)

# Z beyaz/acik, zemin gradyani R kanalinda <= ~90: R uzerinden yumusak maske.
mask = np.clip((src[..., 0] - 110.0) / (200.0 - 110.0), 0.0, 1.0)[..., None]

BG_DARKEN = 0.36
dark_bg = src * BG_DARKEN
dark = dark_bg * (1.0 - mask) + src * mask
Image.fromarray(np.clip(dark + 0.5, 0, 255).astype(np.uint8), "RGB").save(
    os.path.join(BRAND, "icon-1024-dark.png"), optimize=True
)


def luma(a):
    return (a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114)[..., None]


tint_bg = luma(dark_bg) * 0.55
tint = tint_bg * (1.0 - mask) + luma(src) * mask
tint = np.repeat(np.clip(tint + 0.5, 0, 255).astype(np.uint8), 3, axis=2)
Image.fromarray(tint, "RGB").save(os.path.join(BRAND, "icon-1024-tinted.png"), optimize=True)
