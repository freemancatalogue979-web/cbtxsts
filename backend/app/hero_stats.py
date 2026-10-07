"""Live-public meta snapshot imported from MLBBDex
(https://mlbbdex.com/en/statistics — measured 2026-10-05, patch 2.2.16).

Stats are community-wiki sourced (CC BY-SA, credit: Mobile Legends Wiki).
Each entry: slug -> (name, tier, win_rate, ban_rate, pick_rate, score, low_sample)
Applied on top of the roster so every hero shows real win/pick/ban rates.
"""
from __future__ import annotations

MEASURED_AT = "2026-10-05T10:57:12.368Z"
PATCH = "2.2.16"

SITE_STATS: dict[str, tuple[str, str, float, float, float, float, bool]] = {
    'hirara': ('Hirara', 'S+', 53.34, 66.43, 0.62, 69.95, False),
    'belerick': ('Belerick', 'S+', 52.48, 56.62, 1.7, 66.63, False),
    'masha': ('Masha', 'S+', 59.27, 28.95, 0.62, 66.51, False),
    'marcel': ('Marcel', 'S+', 58.06, 32.27, 0.27, 66.13, True),
    'eudora': ('Eudora', 'S+', 51.33, 58.64, 1.94, 65.99, False),
    'aulus': ('Aulus', 'S+', 59.78, 23.27, 1.07, 65.6, False),
    'rafaela': ('Rafaela', 'S+', 59.5, 16.74, 1.25, 63.69, False),
    'gloo': ('Gloo', 'S+', 53.77, 39.2, 0.76, 63.57, False),
    'estes': ('Estes', 'S+', 53.14, 38.33, 0.68, 62.72, False),
    'lukas': ('Lukas', 'S+', 52.93, 31.21, 0.99, 60.73, False),
    'paquito': ('Paquito', 'S+', 50.22, 41.68, 1.65, 60.64, False),
    'floryn': ('Floryn', 'S+', 54.31, 12.85, 1.05, 57.52, False),
    'sun': ('Sun', 'S+', 52.3, 20.84, 1.76, 57.51, False),
    'carmilla': ('Carmilla', 'S+', 53.71, 13.01, 1.15, 56.96, False),
    'minotaur': ('Minotaur', 'S+', 55.03, 7.11, 1.02, 56.81, False),
    'obsidia': ('Obsidia', 'S+', 53.57, 12.07, 2.06, 56.59, False),
    'argus': ('Argus', 'S', 55.62, 1.37, 0.57, 55.96, False),
    'saber': ('Saber', 'S', 49.56, 21.89, 0.96, 55.03, False),
    'khufra': ('Khufra', 'S', 54.51, 1.82, 0.3, 54.97, False),
    'atlas': ('Atlas', 'S', 51.79, 11.86, 0.95, 54.76, False),
    'popol-and-kupa': ('Popol and Kupa', 'S', 54.29, 0.31, 0.45, 54.37, False),
    'kaja': ('Kaja', 'S', 49.52, 19.3, 0.57, 54.35, False),
    'diggie': ('Diggie', 'S', 53.34, 3.25, 0.18, 54.15, True),
    'lolita': ('Lolita', 'S', 53.99, 0.18, 0.07, 54.04, True),
    'valir': ('Valir', 'S', 53.51, 1.93, 0.97, 53.99, False),
    'hanabi': ('Hanabi', 'S', 52.14, 5.77, 2.7, 53.58, False),
    'hanzo': ('Hanzo', 'S', 49.6, 15.26, 0.47, 53.42, False),
    'barats': ('Barats', 'S', 52.05, 5.03, 0.76, 53.31, False),
    'bruno': ('Bruno', 'S', 52.98, 0.28, 0.43, 53.05, False),
    'edith': ('Edith', 'A', 52.85, 0.22, 0.33, 52.91, False),
    'gord': ('Gord', 'A', 52.75, 0.58, 0.63, 52.9, False),
    'minsitthar': ('Minsitthar', 'A', 51.39, 5.25, 0.62, 52.7, False),
    'irithel': ('Irithel', 'A', 52.54, 0.26, 0.41, 52.61, False),
    'alice': ('Alice', 'A', 51.18, 5.51, 0.82, 52.56, False),
    'benedetta': ('Benedetta', 'A', 52.46, 0.3, 0.38, 52.54, False),
    'kadita': ('Kadita', 'A', 51.46, 4.24, 0.91, 52.52, False),
    'ling': ('Ling', 'A', 52.14, 0.83, 0.73, 52.35, False),
    'hilda': ('Hilda', 'A', 50.46, 7.38, 0.57, 52.31, False),
    'yve': ('Yve', 'A', 52.26, 0.04, 0.05, 52.27, True),
    'kagura': ('Kagura', 'A', 51.91, 1.16, 0.72, 52.2, False),
    'fredrinn': ('Fredrinn', 'A', 51.72, 1.84, 0.53, 52.18, False),
    'guinevere': ('Guinevere', 'A', 51.47, 2.62, 0.84, 52.13, False),
    'zhask': ('Zhask', 'A', 51.99, 0.36, 0.34, 52.08, False),
    'angela': ('Angela', 'A', 49.71, 9.22, 1.79, 52.02, False),
    'badang': ('Badang', 'A', 50.33, 5.93, 1.52, 51.81, False),
    'zetian': ('Zetian', 'A', 50.81, 3.89, 1.54, 51.78, False),
    'faramis': ('Faramis', 'A', 51.57, 0.29, 0.09, 51.64, True),
    'miya': ('Miya', 'A', 49.61, 7.85, 2.83, 51.57, False),
    'natan': ('Natan', 'A', 51.49, 0.14, 0.3, 51.53, False),
    'brody': ('Brody', 'A', 50.82, 2.52, 1.04, 51.45, False),
    'yi-sun-shin': ('Yi Sun-shin', 'A', 49.67, 6.98, 1.31, 51.42, False),
    'silvanna': ('Silvanna', 'A', 51.01, 1.61, 0.96, 51.41, False),
    'beatrix': ('Beatrix', 'A', 51.19, 0.43, 0.71, 51.3, False),
    'natalia': ('Natalia', 'A', 50.83, 1.29, 0.26, 51.15, True),
    'cyclops': ('Cyclops', 'A', 51.05, 0.26, 0.63, 51.11, False),
    'cecilion': ('Cecilion', 'A', 51, 0.13, 0.64, 51.03, False),
    'bane': ('Bane', 'A', 50.87, 0.17, 0.26, 50.91, True),
    'clint': ('Clint', 'A', 50.66, 0.8, 0.72, 50.86, False),
    'novaria': ('Novaria', 'A', 49.71, 4.18, 1.43, 50.76, False),
    'terizla': ('Terizla', 'A', 50.68, 0.18, 0.33, 50.73, False),
    'sora': ('Sora', 'A', 49.99, 2.89, 0.56, 50.71, False),
    'akai': ('Akai', 'A', 50.33, 1.33, 0.34, 50.66, False),
    'aldous': ('Aldous', 'A', 50.51, 0.59, 0.44, 50.66, False),
    'khaleed': ('Khaleed', 'A', 50.59, 0.08, 0.12, 50.61, True),
    'leomord': ('Leomord', 'A', 50.41, 0.49, 0.3, 50.53, False),
    'x-borg': ('X.Borg', 'B', 50, 1.65, 0.54, 50.41, False),
    'moskov': ('Moskov', 'B', 50.23, 0.28, 0.93, 50.3, False),
    'zhuxin': ('Zhuxin', 'B', 50.17, 0.3, 0.18, 50.25, True),
    'ixia': ('Ixia', 'B', 50.03, 0.73, 0.75, 50.21, False),
    'julian': ('Julian', 'B', 49.99, 0.85, 0.72, 50.2, False),
    'aamon': ('Aamon', 'B', 49.58, 2.27, 0.65, 50.15, False),
    'lesley': ('Lesley', 'B', 48.28, 7.46, 1.87, 50.15, False),
    'vale': ('Vale', 'B', 50.1, 0.19, 0.51, 50.15, False),
    'vexana': ('Vexana', 'B', 49.63, 1.13, 1.54, 49.91, False),
    'xavier': ('Xavier', 'B', 49.86, 0.11, 0.51, 49.89, False),
    'suyou': ('Suyou', 'B', 49.63, 0.95, 0.77, 49.87, False),
    'odette': ('Odette', 'B', 49.75, 0.4, 0.64, 49.85, False),
    'nolan': ('Nolan', 'B', 49.06, 2.86, 1, 49.78, False),
    'lylia': ('Lylia', 'B', 49.57, 0.38, 0.5, 49.67, False),
    'selena': ('Selena', 'B', 48.79, 3.5, 1.36, 49.67, False),
    'ruby': ('Ruby', 'B', 49.54, 0.28, 0.36, 49.61, False),
    'layla': ('Layla', 'B', 49.2, 0.89, 1.1, 49.42, False),
    'yu-zhong': ('Yu Zhong', 'B', 49.08, 0.73, 0.58, 49.26, False),
    'gusion': ('Gusion', 'B', 48.16, 4.28, 1.41, 49.23, False),
    'cici': ('Cici', 'B', 48.94, 0.89, 0.45, 49.16, False),
    'uranus': ('Uranus', 'B', 49.07, 0.37, 0.35, 49.16, False),
    'yin': ('Yin', 'B', 48.75, 1.63, 0.48, 49.16, False),
    'claude': ('Claude', 'B', 49.09, 0.23, 0.78, 49.15, False),
    'thamuz': ('Thamuz', 'B', 48.7, 1.63, 0.86, 49.11, False),
    'roger': ('Roger', 'B', 48.86, 0.11, 0.29, 48.89, True),
    'lapu-lapu': ('Lapu-Lapu', 'B', 48.62, 0.3, 0.34, 48.7, False),
    'johnson': ('Johnson', 'B', 48.18, 1.99, 0.78, 48.68, False),
    'karrie': ('Karrie', 'B', 48.42, 1.02, 0.57, 48.68, False),
    'melissa': ('Melissa', 'B', 48.25, 1.68, 0.45, 48.67, False),
    'lunox': ('Lunox', 'B', 48.61, 0.17, 0.24, 48.65, True),
    'joy': ('Joy', 'B', 48.59, 0.19, 0.15, 48.64, True),
    'harley': ('Harley', 'B', 47.67, 3.77, 0.77, 48.61, False),
    'aurora': ('Aurora', 'B', 48.44, 0.37, 0.6, 48.53, False),
    'hayabusa': ('Hayabusa', 'B', 47.94, 2.15, 0.99, 48.48, False),
    'wanwan': ('Wanwan', 'B', 48.45, 0.11, 0.14, 48.48, True),
    'kimmy': ('Kimmy', 'B', 48.39, 0.3, 0.64, 48.47, False),
    'phoveus': ('Phoveus', 'B', 48.29, 0.54, 0.25, 48.43, True),
    'freya': ('Freya', 'B', 48.05, 1.47, 0.57, 48.42, False),
    'nana': ('Nana', 'B', 47.35, 3.96, 2.13, 48.34, False),
    'alpha': ('Alpha', 'B', 48.07, 0.7, 1.21, 48.25, False),
    'karina': ('Karina', 'B', 47.5, 2.94, 0.79, 48.24, False),
    'esmeralda': ('Esmeralda', 'B', 47.61, 2.28, 0.88, 48.18, False),
    'helcurt': ('Helcurt', 'B', 46.77, 5.64, 0.58, 48.18, False),
    'hylos': ('Hylos', 'B', 47.97, 0.26, 0.29, 48.04, True),
    'dyrroth': ('Dyrroth', 'C', 47.65, 1.36, 1.67, 47.99, False),
    'chang-e': ("Chang'e", 'C', 47.86, 0.34, 0.72, 47.95, False),
    'luo-yi': ('Luo Yi', 'C', 47.86, 0.09, 0.19, 47.88, True),
    'arlott': ('Arlott', 'C', 47.57, 0.29, 0.39, 47.64, False),
    'martis': ('Martis', 'C', 47.3, 0.39, 0.55, 47.4, False),
    'pharsa': ('Pharsa', 'C', 47.27, 0.18, 0.35, 47.32, False),
    'jawhead': ('Jawhead', 'C', 47.19, 0.28, 0.32, 47.26, False),
    'baxia': ('Baxia', 'C', 46.99, 0.1, 0.05, 47.02, True),
    'alucard': ('Alucard', 'C', 46.81, 0.35, 0.72, 46.9, False),
    'chip': ('Chip', 'C', 46.84, 0.24, 0.04, 46.9, True),
    'grock': ('Grock', 'C', 46.71, 0.69, 0.34, 46.88, False),
    'balmond': ('Balmond', 'C', 46.46, 0.41, 0.65, 46.56, False),
    'harith': ('Harith', 'C', 46.33, 0.05, 0.15, 46.34, True),
    'tigreal': ('Tigreal', 'C', 44.35, 5.66, 1.89, 45.77, False),
    'valentina': ('Valentina', 'C', 45.55, 0.17, 0.18, 45.59, True),
    'zilong': ('Zilong', 'C', 45.47, 0.45, 0.63, 45.58, False),
    'mathilda': ('Mathilda', 'C', 45.01, 0.17, 0.14, 45.05, True),
    'kalea': ('Kalea', 'C', 44.91, 0.33, 0.2, 44.99, True),
    'chou': ('Chou', 'C', 44.1, 3.46, 1.28, 44.97, False),
    'gatotkaca': ('Gatotkaca', 'C', 44.69, 0.3, 0.55, 44.77, False),
    'granger': ('Granger', 'C', 42.78, 1.49, 1.43, 43.15, False),
    'lancelot': ('Lancelot', 'C', 42.52, 0.43, 0.54, 42.63, False),
    'franco': ('Franco', 'C', 41.15, 3.24, 0.93, 41.96, False),
    'fanny': ('Fanny', 'C', 41.48, 1.81, 0.67, 41.93, False),
}

TIER_TO_STATUS = {"S+": "META", "S": "STRONG", "A": "VIABLE", "B": "VIABLE", "C": "SITUATIONAL", "D": "WEAK"}


def norm(name: str) -> str:
    return name.lower().replace("’", "'").strip()


BY_NAME: dict[str, str] = {norm(v[0]): k for k, v in SITE_STATS.items()}


def lookup(name: str):
    slug = BY_NAME.get(norm(name))
    return SITE_STATS[slug] if slug else None


def rating_from_score(score: float, low: bool = False) -> float:
    """Score range 41.9..69.9 -> internal 4.2..9.5; thin samples capped at 8.5."""
    span = (69.95 - 41.93)
    r = 4.2 + (score - 41.93) / span * 5.3
    if low:
        r = min(r, 8.5)
    return round(max(4.0, min(9.6, r)), 1)
