"""Optimize source assets for the browser demo.

Reads originals from assets/, writes:
  - river.jpg / coast.jpg / fields.jpg  (1600 px wide, JPEG q85)
  - *.webp for exported.png, Reflow-off.png, Reflow-on.png,
    ILM-GUI.png, PlotEditor-GUI.png (q90)
Originals are kept untouched.
"""
from pathlib import Path
from PIL import Image

ASSETS = Path(__file__).parent / "assets"


def to_jpg(src: str, dst: str, width: int = 1600, quality: int = 85) -> None:
    im = Image.open(ASSETS / src).convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(ASSETS / dst, "JPEG", quality=quality, optimize=True)
    print(dst, im.size)


def to_webp(src: str, dst: str, quality: int = 90) -> None:
    im = Image.open(ASSETS / src)
    im.save(ASSETS / dst, "WEBP", quality=quality)
    print(dst, im.size)


if __name__ == "__main__":
    to_jpg("river.JPG", "river.jpg")
    to_jpg("coast.JPG", "coast.jpg")
    to_jpg("fields.JPG", "fields.jpg")
    for name in ("exported", "Reflow-off", "Reflow-on", "ILM-GUI", "PlotEditor-GUI"):
        to_webp(f"{name}.png", f"{name}.webp")
