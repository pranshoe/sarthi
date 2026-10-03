"""Generate S16 proof samples with EXACT content:
ticket 48213, date 10 Aug 2026, client ID ZK4821.
PNG: clean raster for OCR. PDF: born-digital text page for text-layer extraction.
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "samples")
os.makedirs(OUT, exist_ok=True)

LINES = [
    "Zerodha Broking Limited",
    "Grievance Acknowledgement",
    "",
    "Ticket No: 48213",
    "Date: 10 Aug 2026",
    "Client ID: ZK4821",
    "",
    "Your complaint has been received.",
]

try:
    FONT = ImageFont.truetype("C:\\Windows\\Fonts\\arial.ttf", 44)
except Exception:
    FONT = ImageFont.load_default()

img = Image.new("RGB", (1200, 800), "white")
d = ImageDraw.Draw(img)
y = 60
for line in LINES:
    d.text((60, y), line, font=FONT, fill="black")
    y += 80
png_path = os.path.join(OUT, "sample_email_proof_zerodha.png")
img.save(png_path)
print("wrote", png_path)

# Minimal born-digital single-page PDF with the same text (Helvetica).
def esc(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

content = "BT /F1 20 Tf 72 720 Td 24 TL "
first = True
for line in LINES:
    if not first:
        content += "T* "
    first = False
    content += "(%s) Tj " % esc(line) if line else "T* "
content += "ET"
cb = content.encode("ascii")

objs = []
objs.append("%PDF-1.4")
objs.append("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj")
objs.append("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj")
objs.append("3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj")
objs.append("4 0 obj << /Length %d >> stream\n" % len(cb) + cb.decode("ascii") + "\nendstream endobj")
objs.append("5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj")

out = bytearray()
offsets = []
for o in objs:
    if o.startswith("%PDF"):
        out += (o + "\n").encode("ascii")
    else:
        offsets.append(len(out))
        out += (o + "\n").encode("ascii")
xref = len(out)
out += ("xref\n0 %d\n" % (len(objs))).encode("ascii")
out += b"0000000000 65535 f \n"
for off in offsets:
    out += ("%010d 00000 n \n" % off).encode("ascii")
out += ("trailer << /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objs), xref)).encode("ascii")

pdf_path = os.path.join(OUT, "sample_email_proof_zerodha.pdf")
with open(pdf_path, "wb") as f:
    f.write(bytes(out))
print("wrote", pdf_path)
