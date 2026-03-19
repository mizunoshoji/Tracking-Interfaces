"""
Generate app icon: 1024×1024 PNG
- Distorted electric field — monochromatic streamlines
- Charges: strong positive at center + off-axis negative + uniform drift field
- White field lines on black background
"""

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

SIZE = 1024
N    = 600  # grid resolution

x = np.linspace(-1.2, 1.2, N)
y = np.linspace(-1.2, 1.2, N)
X, Y = np.meshgrid(x, y)

# ── Charge configuration ─────────────────────────────────────────────────────
# Central positive + two off-axis charges → asymmetric distortion
charges = [
    ( 0.0,  0.0, +2.5),   # dominant positive: radial source
    (-1.4,  0.9, -1.0),   # off-axis negative: bends lines toward it
    ( 1.2, -1.0, -0.6),   # second sink: creates asymmetry
]

Ex = np.zeros_like(X)
Ey = np.zeros_like(Y)

for cx, cy, q in charges:
    ddx = X - cx
    ddy = Y - cy
    r2  = ddx**2 + ddy**2
    r2  = np.maximum(r2, 0.03)   # avoid singularity
    r3  = r2 ** 1.5
    Ex += q * ddx / r3
    Ey += q * ddy / r3

# Slight uniform drift for extra warp
Ex += 0.36

# ── Field magnitude → line width ──────────────────────────────────────────────
E_mag = np.sqrt(Ex**2 + Ey**2)
lw    = np.log1p(E_mag * 0.3)
lw    = np.clip(lw / lw.max() * 40.0, 2.4, 40.0)

# ── Draw ──────────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(10.24, 10.24), dpi=100)
fig.patch.set_facecolor('#000000')
ax.set_facecolor('#000000')

ax.streamplot(
    X, Y, Ex, Ey,
    color='white',
    linewidth=lw,
    density=0.4,
    arrowsize=0,          # no arrows — clean lines only
    minlength=0.3,
    broken_streamlines=False,
)

ax.set_xlim(-1.2, 1.2)
ax.set_ylim(-1.2, 1.2)
ax.set_aspect('equal')
ax.axis('off')

plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
out = '/Users/mizunoshoji/develop/TouchTrackingApp/assets/icon.png'
plt.savefig(out, dpi=100, facecolor='#000000', bbox_inches='tight', pad_inches=0)
plt.close()
print(f'Saved: {out}')
