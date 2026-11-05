# Profile worlds

Six original AI-generated 3D-style environment illustrations made for this app:
space, forest, ocean, volcano, royal academy and neon city. No external image CDN,
third-party game assets, or remotely loaded animation library is used.

- `*.webp`: 1280 × 640 scene artwork, used on profile heroes/public cards.
- `*-thumb.webp`: 360 × 180 compressed previews, lazily loaded in the picker.

The renderer layers the artwork with CSS lighting, foreground haze and motes.
These are rendered 3D-style wallpapers with depth animation, not interactive
WebGL worlds. The saved animation preference and OS reduced-motion preference
both disable every moving layer. Uploaded user banners remain supported.
