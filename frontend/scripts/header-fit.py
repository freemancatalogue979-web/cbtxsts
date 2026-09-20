#!/usr/bin/env python3
"""Measure the AppShell header width across 320-1920px using real Quite Magical
font metrics (fontTools), modelling the responsive visibility tiers, so the
no-overcrowding / no-horizontal-overflow guarantees are grounded in real advance
widths instead of eyeball estimates.

Tiers (post-fix):
  <sm          phone: icon-only LivePill, no coins/streak/music/bell/name
  sm..lg-1     small tablet: LivePill label, coins, music, bell, name
  lg..xl-1     compact desktop: short nav labels @0.78rem, tight nav padding;
               no search icon (the / shortcut still works), no coins/streak/
               music/bell/name/LV/livepill-count; shield kept for staff
  xl..2xl-1    medium desktop: + search, streak, music, bell, name, LV;
               nav still short labels; coins + livepill count still hidden
  2xl+         full density: full nav labels + padding, coins, livepill count
"""
from fontTools.ttLib import TTFont

font = TTFont('frontend/public/fonts/quite-magical.woff2')
upm = font['head'].unitsPerEm
cmap = font.getBestCmap()
hmtx = font['hmtx']

BOLD, EXTRA, BLACK = 1.03, 1.045, 1.06  # faux-bold growth for a single-weight font

def w(text: str, px: float, bold: float = 1.0, tracking_em: float = 0.0) -> float:
    total = sum(hmtx[cmap[ord(ch)]][0] if ord(ch) in cmap else upm * 0.5 for ch in text)
    return total / upm * px * bold + tracking_em * px * max(len(text) - 1, 0)

F = {
    'quiz': w('Quiz Arena', 14.72, BLACK, 0.05),
    'lv': w('LV12', 10.56, BLACK, -0.025),
    'name': w('Chinedu', 12.8, BOLD),
    'longname': w('Alexandra', 12.8, BOLD),
    'connected': w('Connected', 11.2, BOLD),
    'online': w('· 12 online', 11.2, BOLD),
    'gems': w('1,234', 11.84, EXTRA),
    'coins': w('9,999', 11.84, EXTRA),
    'streak': w('12d', 11.84, EXTRA),
    'more': w('More', 12.8, BOLD, 0.025),
}
FULL = ['Play', 'Ranked', 'Events', 'Study Lab', 'Game Arena', 'Shop']
SHORT = ['Home', 'Ranked', 'Events', 'Learn', 'Arena', 'Shop']
F['full'] = [w(s, 12.8, BOLD, 0.025) for s in FULL]
F['short'] = [w(s, 12.8, BOLD, 0.025) for s in SHORT]
F['full78'] = [w(s, 12.48, BOLD, 0.025) for s in SHORT]  # compact tier uses shorts @0.78rem

def nav_px(labels, pad, igap, morepad=24):
    btns = sum(pad + 16 + igap + x for x in labels)
    return 8 + 2 + btns + (morepad + 6 + F['more'] + 14) + 7 * 4

def livepill(label: bool, count: bool) -> float:
    px = 16  # px-2 below sm, px-3 (24) from sm — caller passes base
    return None

def livepill_px(px, label, count):
    total = px + 14 + 6
    if label:
        total += 8 + F['connected']
    if count:
        total += 8 + F['online']
    total += 8 + 6  # gap + pulsing dot
    return total

def avatar_px(name: bool, long=False):
    if name:
        return 30 + 8 + 12 + 8 + (F['longname'] if long else F['name'])
    return 30 + 8  # circle: p-1 only

def chip(icon, text):
    return 16 + icon + 4 + text  # px-2 + icon + spacing + text

def header(vw, tier, admin=False, long=False):
    pad = 16 if vw < 640 else 32
    hgap = 12 if vw < 640 else 20  # row gap-1.5 x2 / gap-2.5 x2
    avail = vw - pad - hgap
    lg = vw >= 1024
    xl = vw >= 1280
    xxl = vw >= 1536
    sm = vw >= 640
    xs = vw >= 400
    md = vw >= 768

    # ---- left group (hamburger <lg; logo+title+LV at lg+)
    if lg:
        left = 28 + 6 + F['quiz'] + 6 + (12 + F['lv'] if xl else 0) + 12  # lg:ml-3; LV chip returns at xl
    else:
        left = 36 + 6 + (12 + F['lv'])
    # ---- nav (lg+ only)
    if lg:
        if xxl:
            nav = nav_px(F['full'], 28, 8)
        else:
            nav = nav_px(F['full78'], 24, 6)
    else:
        nav = 0
    # ---- right stack
    livepill = livepill_px(24 if sm else 16, label=sm, count=(sm and not lg) or xxl)  # count: <lg sm+, 2xl+
    items = []
    if not lg or xl:
        items.append(36)  # quick-jump search (hidden lg..xl-1; the / shortcut still works)
    items += [livepill, chip(12, F['gems'])]
    if xs and not lg:
        items.append(chip(12, F['coins']))
    if md and not lg:
        items.append(chip(14, F['streak']))
    if xl:
        items.append(chip(14, F['streak']))
    if xxl:
        items.append(chip(12, F['coins']))
    if sm and not lg:
        items += [40, 40]  # music + bell
    if xl:
        items += [40, 40]
    if admin and lg:
        items.append(40)  # staff console shield
    items.append(avatar_px(name=sm and (not lg or xl), long=long))
    right = sum(items) + 8 * (len(items) - 1)
    total = left + nav + right
    return avail, total, left, nav, right

print('tier plan verification (student unless noted):')
failures = 0
for vw in [320, 360, 390, 400, 414, 430, 640, 768, 820, 1024, 1152, 1280, 1366, 1440, 1536, 1920]:
    for admin in ([False, True] if vw >= 1024 else [False]):
        for long in ([False, True] if vw >= 1024 else [False]):
            avail, total, l, n, r = header(vw, None, admin=admin, long=long)
            ok = total <= avail
            failures += 0 if ok else 1
            who = ('admin ' if admin else '') + ('longname' if long else '')
            print(f'{vw:>5}px {who:<14} total={total:6.0f} / avail={avail:5.0f}  (L{l:.0f} N{n:.0f} R{r:.0f})  {"OK" if ok else "OVER"}')
print('FAILURES:', failures)
