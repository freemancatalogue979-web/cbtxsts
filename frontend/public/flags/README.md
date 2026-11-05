# Bundled country flags

SVG flags copied from `flag-icons` version 7.6.0 (https://github.com/lipis/flag-icons),
under the included MIT `LICENSE`. Only the 249 ISO country/territory 4:3 flags are
included. `src/lib/countries.ts` and `backend/app/countries.py` use the same code list.

Flags are local images rather than Unicode emoji, so they do not depend on Windows,
Android or iOS having a particular emoji font. Images are loaded lazily as needed.
