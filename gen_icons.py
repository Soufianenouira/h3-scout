from PIL import Image, ImageDraw, ImageFont
import math

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def draw_icon(size):
    img = Image.new("RGB", (size, size), (15, 23, 42))  # --bg
    d = ImageDraw.Draw(img)
    cx, cy = size/2, size*0.42
    r = size*0.27
    accent = (59, 130, 246)
    white = (238, 242, 255)

    # Volleyball-Kreis
    d.ellipse([cx-r, cy-r, cx+r, cy+r], outline=white, width=max(2,int(size*0.018)))
    # Panel-Kurven (vereinfachtes Volleyball-Muster)
    d.arc([cx-r, cy-r*0.5, cx+r*0.3, cy+r], 40, 200, fill=accent, width=max(2,int(size*0.018)))
    d.arc([cx-r*0.3, cy-r, cx+r, cy+r*0.5], 220, 20, fill=accent, width=max(2,int(size*0.018)))
    d.line([cx-r*0.85, cy-r*0.35, cx+r*0.85, cy+r*0.35], fill=accent, width=max(2,int(size*0.018)))

    # Text "H3"
    font_size = int(size*0.24)
    font = ImageFont.truetype(FONT, font_size)
    text = "H3"
    bbox = d.textbbox((0,0), text, font=font)
    tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
    ty = cy + r + size*0.10
    d.text((cx-tw/2, ty-bbox[1]), text, font=font, fill=white)

    return img

for size in [192, 512]:
    img = draw_icon(size)
    img.save(f"icons/icon-{size}.png")

# Apple touch icon (180x180), ohne Transparenz, mit etwas Rand-Padding da iOS selbst rundet
img = draw_icon(180)
img.save("icons/apple-touch-icon.png")

print("done")
