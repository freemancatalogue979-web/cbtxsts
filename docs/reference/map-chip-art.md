# Map Lab chip imagery

The locally bundled files in `frontend/public/map-chips/` are cropped thumbnails of Mobile Legends: Bang Bang game imagery. Game imagery and character designs belong to their respective rights holders. The source pages used for the crops are:

| Chip | Source |
| --- | --- |
| Litho, Lord, Turtle | [Theria Games — Mobile Legends jungle guide](https://theriagames.com/guide/mobile-legends-jungle-guide/) |
| Minion | [VCGamers — types of minions in MLBB](https://www.vcgamers.com/news/en/5-type-minion-in-mlbb/) |
| Turret | [MobileLegendsGame — battlefield turrets](https://www.reddit.com/r/MobileLegendsGame/comments/1q9vx6i/battlefield_turrets_as_the_game_progresses/) |
| Retribution | [NovaZenn — battle spell PNGs](https://www.novazenn.com/2023/07/battle-spell-mlbb-png.html) |

The application serves these files locally rather than depending on the source sites at runtime. Preset IDs are stored separately from display names, so renaming a placed chip does not change its portrait.
