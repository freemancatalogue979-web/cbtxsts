/** Profile tab: identity, stats, badge collection, friends circle, exam history. */
import {
  Award,
  Briefcase,
  Camera,
  Check,
  Gamepad2,
  Coins,
  CalendarClock,
  Copy,
  HandHelping,
  Loader2,
  Snowflake,
  Sparkles,
  Flame,
  LogOut,
  Medal,
  Music2,
  Palette,
  PartyPopper,
  Pause,
  Play,
  Phone,
  Database,
  ScrollText,
  Search,
  Swords,
  Target,
  Trash2,
  Trophy,
  Type,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap, Gem}from 'lucide-react';
import {motion} from 'motion/react';
import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Avatar, Button, Card, Chip, EmptyState, Field, ProgressRing, SectionHeading, Skeleton, TextInput} from '../components/ui';
import {titleOf, themeOf} from '../lib/cosmetics';
import SeasonBadge from '../components/SeasonBadge';
import DigitalEvolution from '../components/DigitalEvolution';
import {api} from '../lib/api';
import {formatDate, formatNumber, formatPhone, GRADE_STYLES, isValidPhone, normalizePhoneInput, TIER_STYLES} from '../lib/format';
import {iconFor, TIER_GRADIENT} from '../lib/icons';
import {staggerContainer, staggerItem} from '../lib/motion';
import {useSize} from '../lib/responsive';
import Mascot from '../components/Mascot';
import {
  applyFont,
  applyMode,
  applySkin,
  applyTheme,
  currentFont,
  currentMascot,
  currentMode,
  currentSkin,
  currentTheme,
  FONTS,
  MASCOTS,
  MODES,
  setMascot,
  SKINS,
  THEMES,
  type FontName,
  type MascotName,
  type ModeName,
  type SkinName,
  type ThemeName,
} from '../lib/prefs';

const MODE_ICONS = {game: Gamepad2, pro: Briefcase, fun: PartyPopper} as const;
import {music, MUSIC_TRACKS} from '../lib/music';
import {cacheClearAll, cacheStats} from '../lib/cache';
import {invalidatePhoto} from '../lib/photos';
import {sfx} from '../lib/sfx';
import {useSession} from '../store/session';
import type {PlayerSummary, ResultRow} from '../lib/types';

const HUES = [350, 20, 45, 130, 165, 195, 220, 260, 285, 315];

/**
 * Option copy. Phones read the one-line version: the full blurb is written for a
 * desktop column and turns into a wall of text on a 360px screen.
 */
function OptionBlurb({short, blurb, className = ''}: {short: string; blurb: string; className?: string}) {
  return (
    <>
      <span className={`block truncate text-[0.64rem] font-semibold text-mist-500 sm:hidden ${className}`}>{short}</span>
      <span className={`hidden truncate text-[0.64rem] font-semibold text-mist-500 sm:block ${className}`}>{blurb}</span>
    </>
  );
}

export default function ProfilePanel({
  onOpenResult,
  onOpenDuels,
  onSignOut,
}: {
  onOpenResult: (attemptId: number) => void;
  onOpenDuels: () => void;
  onSignOut: () => void;
}) {
  const {profile, setProfile, toast, onlineIds, on} = useSession();
  const [editing, setEditing] = useState(false);
  const [theme, setTheme] = useState<ThemeName>(() => currentTheme());
  const [skin, setSkin] = useState<SkinName>(() => currentSkin());
  // Live view of what the device is holding (updated when it is cleared).
  const [storage, setStorage] = useState(() => cacheStats());
  const [mode, setMode] = useState<ModeName>(() => currentMode());
  const [font, setFont] = useState<FontName>(() => currentFont());
  const [mascot, setMascotName] = useState<MascotName>(() => currentMascot());
  const [sound, setSound] = useState(() => sfx.isEnabled());
  const [musicEnabled, setMusicEnabled] = useState(() => music.isEnabled());
  const [trackId, setTrackId] = useState(() => music.track());
  const [volume, setVolume] = useState(() => music.volume());
  const musicState = useSyncExternalStore(music.subscribe, music.state);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement | null>(null);

  /** Crop to a square, downscale to 256px, upload as a JPEG data URL. */
  const onPickPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast('error', 'Unsupported file', 'Pick a JPEG, PNG or WebP image.');
      return;
    }
    setPhotoBusy(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setPhotoBusy(false);
      toast('error', 'Upload failed', 'That file could not be read.');
    };
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => {
        setPhotoBusy(false);
        toast('error', 'Upload failed', 'That image could not be decoded.');
      };
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 256;
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) {
          setPhotoBusy(false);
          toast('error', 'Upload failed', 'Canvas is unavailable in this browser.');
          return;
        }
        const smallest = Math.min(image.width, image.height);
        context.drawImage(image, (image.width - smallest) / 2, (image.height - smallest) / 2, smallest, smallest, 0, 0, size, size);
        void (async () => {
          try {
            const updated = await api.uploadPhoto(canvas.toDataURL('image/jpeg', 0.82));
            invalidatePhoto(updated.id);
            setProfile(updated);
            toast('success', 'Profile photo updated', 'Everyone sees it now — chat, ranks and duels.');
            sfx.play('levelup');
          } catch (error) {
            toast('error', 'Upload failed', (error as Error).message);
          } finally {
            setPhotoBusy(false);
          }
        })();
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = async () => {
    try {
      const updated = await api.removePhoto();
      invalidatePhoto(updated.id);
      setProfile(updated);
      toast('info', 'Photo removed', 'Your avatar colours are back.');
    } catch (error) {
      toast('error', 'Could not remove the photo', (error as Error).message);
    }
  };
  const [name, setName] = useState('');
  const [hue, setHue] = useState(260);
  const [saving, setSaving] = useState(false);
  const [bio, setBio] = useState('');
  const [statusText, setStatusText] = useState('');
  const [cardSaving, setCardSaving] = useState(false);

  const [friends, setFriends] = useState<{friends: PlayerSummary[]; requests: PlayerSummary[]; rivals: PlayerSummary[]} | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [allBadges, setAllBadges] = useState<{key: string; name: string; description: string; icon: string; tier: string; xp_reward: number; coin_reward: number}[]>([]);
  const [friendPhone, setFriendPhone] = useState('');
  const [searching, setSearching] = useState<PlayerSummary[]>([]);
  const [addBusy, setAddBusy] = useState(false);

  const load = useCallback(() => {
    if (!profile) return;
    api.friends().then(setFriends).catch(() => setFriends(null));
    api.myResults().then(setResults).catch(() => setResults(null));
    api
      .badges()
      .then((rows) => setAllBadges(rows as never))
      .catch(() => setAllBadges([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setHue(profile.avatar_hue);
    setBio(profile.bio ?? '');
    setStatusText(profile.status_text ?? '');
  }, [profile]);

  useEffect(() => on('friend_added', load), [on, load]);

  useEffect(() => {
    if (friendPhone.trim().length < 3) {
      setSearching([]);
      return;
    }
    const id = window.setTimeout(() => {
      api
        .searchPlayers(friendPhone.trim())
        .then(setSearching)
        .catch(() => setSearching([]));
    }, 250);
    return () => window.clearTimeout(id);
  }, [friendPhone]);

  if (!profile) return <Skeleton className="h-96" />;

  const progress = profile.progress;
  const tier = TIER_STYLES[profile.tier] ?? TIER_STYLES.bronze;
  /* Shop cosmetics worn on this screen: a title line and a profile theme. */
  const wornTitle = titleOf(profile.cosmetics);
  const profileTheme = themeOf(profile.cosmetics);
  const ringSize = useSize(92, 112);
  const faceSize = useSize(70, 86);
  const friendFace = useSize(34, 38);
  const owned = new Set(profile.badges.map((badge) => badge.key));
  const badgeCatalogue = allBadges.length ? allBadges : (profile.badges as never);

  const saveIdentity = async () => {
    setSaving(true);
    try {
      const updated = await api.updateMe({name: name.trim() || profile.name, avatar_hue: hue});
      setProfile(updated);
      setEditing(false);
      toast('success', 'Profile updated');
    } catch (error) {
      toast('error', 'Could not save', (error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveCard = async () => {
    setCardSaving(true);
    try {
      const updated = await api.updateMe({bio, status_text: statusText});
      setProfile(updated);
      toast('success', 'Arena card updated');
    } catch (error) {
      toast('error', 'Could not save', (error as Error).message);
    } finally {
      setCardSaving(false);
    }
  };

  const copyCode = () => {
    const code = profile?.player_code ?? '';
    if (!code) return;
    navigator.clipboard
      ?.writeText(code)
      .then(() => toast('success', 'Player code copied', `Share "${code}" — friends add you with it instantly.`))
      .catch(() => toast('info', 'Your player code', code));
  };

  const addFriend = async (player: PlayerSummary) => {
    setAddBusy(true);
    try {
      const result = await api.addFriend({student_id: player.id});
      toast(result.status === 'friends' ? 'success' : 'info', result.status === 'friends' ? 'Friend added' : 'Request sent', player.name);
      setFriendPhone('');
      setSearching([]);
      load();
    } catch (error) {
      toast('error', 'Could not add friend', (error as Error).message);
    } finally {
      setAddBusy(false);
    }
  };

  const removeFriend = async (friendshipId: number) => {
    try {
      await api.removeFriend(friendshipId);
      toast('info', 'Removed from your circle');
      load();
    } catch (error) {
      toast('error', 'Could not remove', (error as Error).message);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-8">
      {/* ---------------------------------------------------- identity */}
      <motion.section variants={staggerContainer} initial="hidden" animate="show">
        <motion.div variants={staggerItem}>
          <Card className={`relative overflow-hidden p-4 sm:p-6 ${profileTheme?.className ?? ''}`}>
            <div className="pointer-events-none absolute inset-0 bg-ink-950/55" />
            <div className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-nova-600/18 blur-3xl" />
            <div className="relative flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-5">
              <div className="flex shrink-0 flex-col items-center gap-1.5">
                <div className="relative">
                  <ProgressRing value={progress.percent} size={ringSize} stroke={8}>
                    <Avatar name={profile.name} hue={hue} initials={profile.initials} size={faceSize} photo={{id: profile.id, has: profile.has_photo}} cosmetics={profile.cosmetics} />
                  </ProgressRing>
                  <button
                    onClick={() => photoInput.current?.click()}
                    disabled={photoBusy}
                    aria-label="Upload a profile photo"
                    className="absolute -right-1 -bottom-1 grid size-9 place-items-center rounded-full border border-white/15 bg-ink-800 text-nova-200 shadow-lg shadow-black/40 transition-transform hover:scale-105 touch-manipulation disabled:opacity-60"
                  >
                    {photoBusy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
                  </button>
                  <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPickPhoto} />
                </div>
                {profile.has_photo && (
                  <button
                    onClick={removePhoto}
                    className="text-[0.66rem] font-bold text-mist-500 underline-offset-2 transition-colors hover:text-flare-300 hover:underline touch-manipulation"
                  >
                    Remove photo
                  </button>
                )}
              </div>

              <div className="min-w-0 flex-1 text-center sm:text-left">
                {editing ? (
                  <div className="space-y-3">
                    <Field label="Display name">
                      <TextInput value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
                    </Field>
                    <Field label="Avatar colour" hint="Pick the glow that represents you in duels and on the board.">
                      <div className="flex flex-wrap gap-2">
                        {HUES.map((value) => (
                          <button
                            key={value}
                            onClick={() => setHue(value)}
                            className={`size-9 rounded-full border-2 transition-transform touch-manipulation ${hue === value ? 'scale-110 border-white' : 'border-transparent'}`}
                            style={{background: `linear-gradient(140deg, hsl(${value} 88% 62%), hsl(${(value + 52) % 360} 84% 54%))`}}
                            aria-label={`Colour ${value}`}
                          />
                        ))}
                      </div>
                    </Field>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveIdentity} loading={saving} icon={<Check className="size-4" />}>
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(false);
                          setName(profile.name);
                          setHue(profile.avatar_hue);
                        }}
                        icon={<X className="size-4" />}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h1 className="text-xl leading-tight font-black tracking-tight text-mist-50 sm:text-2xl">{profile.name}</h1>
                    <p className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-[0.78rem] font-semibold text-mist-400 sm:justify-start sm:gap-2 sm:text-[0.82rem]">
                      <span className="text-nova-300">
                        Level {progress.level} · {progress.title}
                      </span>
                      <Chip className={tier.className} icon={<Medal className="size-3" />}>
                        {tier.label}
                      </Chip>
                      {/* The equipped shop title is what other players read. */}
                      {wornTitle && (
                        <Chip className="border-gold-400/40 bg-gold-500/12 font-display text-gold-200" icon={<Sparkles className="size-3" />}>
                          {wornTitle}
                        </Chip>
                      )}
                      <Chip icon={<Phone className="size-3" />}>{formatPhone(profile.phone)}</Chip>
                    </p>
                    {profile.reg_no && (
                      <p className="mt-1 text-[0.76rem] font-semibold text-mist-600">
                        Reg no {profile.reg_no} · {profile.class_name || profile.level_name} · {profile.faculty}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap justify-center gap-2 sm:mt-4 sm:justify-start">
                      <Button size="sm" variant="outline" onClick={() => setEditing(true)} icon={<Palette className="size-4" />}>
                        Edit profile
                      </Button>
                      <Button size="sm" variant="soft" onClick={onOpenDuels} icon={<Swords className="size-4" />}>
                        Duel someone
                      </Button>
                    </div>
                  </>
                )}
              </div>

              <div className="grid w-full grid-cols-2 gap-1.5 sm:w-auto sm:gap-2">
                {[
                  {label: 'XP', value: formatNumber(profile.xp), icon: Zap, tone: 'text-nova-300'},
                  {label: 'Coins', value: formatNumber(profile.coins), icon: Coins, tone: 'text-gold-300'},
                  {label: 'Data Crystals', value: formatNumber(profile.diamonds ?? 0), icon: Gem, tone: 'text-nova-300', hint: 'milestones only'},
                  {label: 'Streak', value: `${profile.streak}d`, icon: Flame, tone: 'text-flare-300', hint: `best ${profile.best_streak}d`},
                  {label: 'Weekly XP', value: formatNumber(profile.weekly_xp), icon: Trophy, tone: 'text-pulse-300'},
                ].map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div key={stat.label} className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5 sm:px-4 sm:py-3">
                      <Icon className={`size-4 ${stat.tone}`} />
                      <p className="mt-1 truncate text-base leading-none font-black tabular text-mist-50 sm:mt-1.5 sm:text-lg">{stat.value}</p>
 <p className="mt-1 truncate text-[0.58rem] font-bold tracking-[0.08em] text-mist-500 sm:text-[0.62rem] sm:tracking-[0.14em]">
                        {stat.label}
                      </p>
                      {stat.hint && <p className="truncate text-[0.58rem] font-semibold text-mist-600 sm:text-[0.62rem]">{stat.hint}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        </motion.div>
      </motion.section>

      {/* ---------------------------------------------------- digital evolution */}
      <DigitalEvolution level={progress.level} />

      {/* --------------------------------------------- arena card */}
      <section>
        <SectionHeading
          title="Your arena card"
          subtitle="A status line for friends, a share code, and your stored power-ups."
          icon={<HandHelping className="size-4" />}
          action={
            profile.player_code ? (
              <Button size="sm" variant="outline" onClick={copyCode} icon={<Copy className="size-3.5" />}>
                {profile.player_code}
              </Button>
            ) : undefined
          }
        />
        <Card className="p-3.5 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status (shows under your name)">
              <TextInput
                value={statusText}
                onChange={(event) => setStatusText(event.target.value.slice(0, 80))}
                placeholder="e.g. Grinding jurisprudence 📚"
              />
            </Field>
            <Field label="Bio">
              <TextInput value={bio} onChange={(event) => setBio(event.target.value.slice(0, 240))} placeholder="Tell the arena who you are…" />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={saveCard} loading={cardSaving} icon={<Check className="size-4" />}>
              Save card
            </Button>
            {(profile.streak_freezes ?? 0) > 0 && (
              <Chip className="border-pulse-500/28 bg-pulse-500/12 text-pulse-300" icon={<Snowflake className="size-3.5" />}>
                {profile.streak_freezes} streak freeze{(profile.streak_freezes ?? 0) > 1 ? 's' : ''}
              </Chip>
            )}
            {profile.xp_boosted && (
              <Chip className="border-gold-500/28 bg-gold-500/12 text-gold-300" icon={<Zap className="size-3.5" />}>
                2× XP live
              </Chip>
            )}
            {profile.flair && (
              <Chip className="border-nova-500/28 bg-nova-500/12 text-nova-300" icon={<Sparkles className="size-3.5" />}>
                {profile.flair} flair
              </Chip>
            )}
            {(profile.helper_points ?? 0) > 0 && (
              <Chip className="border-mint-500/28 bg-mint-500/12 text-mint-300" icon={<HandHelping className="size-3.5" />}>
                {profile.helper_points} tutor pts
              </Chip>
            )}
          </div>
          <p className="mt-2.5 text-[0.7rem] font-medium text-mist-600">
            Friends add you with your player code — no phone number needed. Streak freezes fire on a missed day.
          </p>
        </Card>
      </section>

      {/* --------------------------------------------- personalisation */}
      <section>
        <SectionHeading
          title="Make it yours"
          subtitle="World, accent, mascot and sound — saved on this device."
          icon={<Palette className="size-4" />}
        />
        <Card className="p-3.5 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:gap-5">
            <div className="min-w-0">
              <p className="text-[0.66rem] font-black tracking-[0.18em] text-mist-500">World</p>
              <div className="mt-2 grid gap-1.5">
                {SKINS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      setSkin(option.id);
                      applySkin(option.id);
                      sfx.play('tap');
                    }}
                    className={`flex items-center gap-2.5 rounded-xl border-2 px-2.5 py-2 text-left transition-colors touch-manipulation ${
                      skin === option.id ? 'border-nova-400/60 bg-nova-500/12' : 'border-white/12 bg-white/[0.03]'
                    }`}
                  >
                    <span className="flex shrink-0 -space-x-1">
                      {option.dots.map((dot) => (
                        <span key={dot} className="size-3.5 rounded-full border border-ink-950/40" style={{background: dot}} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.78rem] font-extrabold text-mist-100">{option.name}</span>
                      <OptionBlurb short={option.short} blurb={option.blurb} />
                    </span>
                    {skin === option.id && <Check className="size-3.5 shrink-0 text-nova-300" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-[0.66rem] font-black tracking-[0.18em] text-mist-500">Accent theme</p>
              <div className="mt-2 grid gap-1.5">
                {THEMES.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      setTheme(option.id);
                      applyTheme(option.id);
                      sfx.play('tap');
                    }}
                    className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors touch-manipulation ${
                      theme === option.id ? 'border-nova-400/50 bg-nova-500/12' : 'border-white/10 bg-white/[0.03]'
                    }`}
                  >
                    <span className="flex shrink-0 -space-x-1">
                      {option.dots.map((dot) => (
                        <span key={dot} className="size-3.5 rounded-full border border-ink-950/60" style={{background: dot}} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.78rem] font-extrabold text-mist-100">{option.name}</span>
                      <OptionBlurb short={option.short} blurb={option.blurb} />
                    </span>
                    {theme === option.id && <Check className="size-3.5 shrink-0 text-nova-300" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Mascot gets its own section so the three fighters can spread out
            instead of being squeezed into a four-up grid on narrow desktops. */}
        <Card className="mt-3 p-3.5 sm:mt-4 sm:p-5">
          <p className="text-[0.66rem] font-black tracking-[0.18em] text-mist-500">Mascot</p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-3 sm:gap-2.5">
                {MASCOTS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      setMascotName(option.id);
                      setMascot(option.id);
                      sfx.play('tap');
                    }}
                    className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors touch-manipulation ${
                      mascot === option.id ? 'border-nova-400/50 bg-nova-500/12' : 'border-white/10 bg-white/[0.03]'
                    }`}
                  >
                    <Mascot name={option.id} mood={mascot === option.id ? 'dance' : 'idle'} size={34} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.78rem] font-extrabold text-mist-100">{option.name}</span>
                      <OptionBlurb short={option.short} blurb={option.blurb} />
                    </span>
                    {mascot === option.id && <Check className="size-3.5 shrink-0 text-nova-300" />}
                  </button>
                ))}
          </div>
        </Card>

        {/* Sound is its own section: toggles on the left, tracks and volume on
            the right at desktop widths — never one endless squashed column. */}
        <Card className="mt-3 p-3.5 sm:mt-4 sm:p-5">
          <p className="text-[0.66rem] font-black tracking-[0.18em] text-mist-500">Sound</p>
          <div className="mt-2 grid gap-4 lg:grid-cols-2 lg:gap-6">
            <div className="min-w-0">
              <button
                onClick={() => {
                  const next = !sound;
                  setSound(next);
                  sfx.setEnabled(next);
                }}
                className="mt-2 flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition-colors touch-manipulation"
              >
                {sound ? <Volume2 className="size-4 shrink-0 text-mint-300" /> : <VolumeX className="size-4 shrink-0 text-mist-500" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.8rem] font-extrabold text-mist-100">{sound ? 'Sounds on' : 'Muted'}</span>
                  <span className="block text-[0.64rem] font-semibold text-mist-500">Answer blips, win fanfares, coin chimes.</span>
                </span>
                <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${sound ? 'bg-mint-500/70' : 'bg-white/12'}`}>
                  <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${sound ? 'left-[1.15rem]' : 'left-0.5'}`} />
                </span>
              </button>
              <button
                onClick={() => {
                  const next = !musicEnabled;
                  setMusicEnabled(next);
                  music.setEnabled(next);
                }}
                className="mt-2 flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition-colors touch-manipulation"
              >
                {musicEnabled ? <Music2 className="size-4 shrink-0 text-nova-300" /> : <VolumeX className="size-4 shrink-0 text-mist-500" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.8rem] font-extrabold text-mist-100">
                    {musicEnabled ? (musicState === 'paused' ? 'Music paused' : 'Background music on') : 'Music off'}
                  </span>
                  <span className="block text-[0.64rem] font-semibold text-mist-500">
                    {musicState === 'paused'
                      ? 'Your place is kept — resume continues from the same second.'
                      : 'The arena soundtrack — pick one of the three tracks below.'}
                  </span>
                </span>
                <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${musicEnabled ? 'bg-nova-500/70' : 'bg-white/12'}`}>
                  <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${musicEnabled ? 'left-[1.15rem]' : 'left-0.5'}`} />
                </span>
              </button>
              {/* Pause keeps the place, resume continues from it. */}
              {musicEnabled && (musicState === 'playing' || musicState === 'paused') ? (
                <button
                  onClick={() => music.toggle()}
                  className="mt-2 flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition-colors touch-manipulation"
                >
                  {musicState === 'paused' ? (
                    <Play className="size-4 shrink-0 text-mint-300" />
                  ) : (
                    <Pause className="size-4 shrink-0 text-nova-300" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.8rem] font-extrabold text-mist-100">
                      {musicState === 'paused' ? 'Resume music' : 'Pause music'}
                    </span>
                    <span className="block text-[0.64rem] font-semibold text-mist-500">
                      {musicState === 'paused' ? 'Continues exactly where it stopped.' : 'Silences the soundtrack and holds your place.'}
                    </span>
                  </span>
                </button>
              ) : null}
            </div>
            <div className="min-w-0">
              <div className="grid gap-1.5">
                {MUSIC_TRACKS.map((track) => (
                  <button
                    key={track.id}
                    onClick={() => {
                      music.setTrack(track.id);
                      setTrackId(track.id);
                      if (!musicEnabled) {
                        setMusicEnabled(true);
                        music.setEnabled(true);
                      } else if (musicState === 'paused') {
                        music.resume();
                      }
                      sfx.play('tick');
                    }}
                    className={`rounded-xl border px-3 py-2 text-left transition-colors touch-manipulation ${
                      trackId === track.id ? 'border-nova-400/50 bg-nova-500/14' : 'border-white/8 bg-white/[0.02] hover:border-nova-400/30'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`block min-w-0 flex-1 truncate text-[0.78rem] font-extrabold ${trackId === track.id ? 'text-nova-200' : 'text-mist-200'}`}>
                        {track.name}
                      </span>
                      <span className="shrink-0 text-[0.6rem] font-black tabular text-mist-600">
                        {Math.floor(track.seconds / 60)}:{String(Math.round(track.seconds % 60)).padStart(2, '0')}
                      </span>
                    </span>
                    <OptionBlurb short={track.short} blurb={track.blurb} className="mt-0.5 text-[0.62rem]" />
                  </button>
                ))}
              </div>
              <label className="mt-2.5 block">
 <span className="flex items-center justify-between text-[0.66rem] font-black tracking-[0.14em] text-mist-500">
                  Music volume <span className="tabular text-mist-300">{volume}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={volume}
                  aria-label="Music volume"
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setVolume(value);
                    music.setVolume(value);
                  }}
                  className="mt-1.5 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/12 accent-nova-400"
                />
              </label>
              <p className="mt-2 text-[0.64rem] leading-relaxed font-semibold text-mist-600">
                Three tracks, looping forever. Pause holds your place and resume continues from the same second,
                and muting never skips or mixes tracks. Track and volume live on this device.
              </p>
            </div>
          </div>
        </Card>

        <Card className="mt-3 p-3.5 sm:mt-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <SectionHeading
              title="Stored on this device"
              subtitle="Cached here so it opens instantly — servers stay the source of truth."
              icon={<Database className="size-4" />}
            />
            <div className="ml-auto flex items-center gap-2">
              <Chip className="border-white/12 bg-white/6 text-mist-300 tabular">{storage.entries} items</Chip>
              <Chip className="border-white/12 bg-white/6 text-mist-300 tabular">{Math.max(1, Math.round(storage.bytes / 1024))} KB</Chip>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  cacheClearAll();
                  setStorage(cacheStats());
                  toast('success', 'Device cache cleared', 'Chats and notifications will re-download as you use the arena.');
                }}
                icon={<Trash2 className="size-3.5" />}
              >
                Clear
              </Button>
            </div>
          </div>
          <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            {[
              {key: 'friends', label: 'Friends & rivals list', detail: 'Opens with no spinner after a reload.'},
              {key: 'thread', label: 'Chat threads', detail: 'Last 200 messages per friend, refreshed live.'},
              {key: 'inbox', label: 'Notifications & unread badges', detail: 'Badge counts paint before the socket connects.'},
              {key: 'music', label: 'Music session', detail: 'Track, volume and the audio graph warm-up.'},
            ].map((row) => (
              <div key={row.key} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                <p className="text-[0.76rem] font-extrabold text-mist-100">{row.label}</p>
                <p className="mt-0.5 text-[0.66rem] font-semibold text-mist-500">{row.detail}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="mt-3 p-3.5 sm:mt-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
            <div className="min-w-0">
 <p className="text-[0.66rem] font-black tracking-[0.18em] text-mist-500">Mode</p>
              <div className="mt-2 grid gap-1.5">
                {MODES.map((option) => {
                  const Icon = MODE_ICONS[option.id];
                  return (
                    <button
                      key={option.id}
                      onClick={() => {
                        setMode(option.id);
                        applyMode(option.id);
                        sfx.play('tap');
                      }}
                      className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors touch-manipulation ${
                        mode === option.id ? 'border-nova-400/50 bg-nova-500/12' : 'border-white/10 bg-white/[0.03]'
                      }`}
                    >
                      <Icon className="size-4 shrink-0 text-nova-300" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.78rem] font-extrabold text-mist-100">{option.name}</span>
                        <OptionBlurb short={option.short} blurb={option.blurb} />
                      </span>
                      {mode === option.id && <Check className="size-3.5 shrink-0 text-nova-300" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-w-0">
 <p className="text-[0.66rem] font-black tracking-[0.18em] text-mist-500">Font</p>
              <div className="mt-2 grid gap-1.5">
                {FONTS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      setFont(option.id);
                      applyFont(option.id);
                      sfx.play('tap');
                    }}
                    className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors touch-manipulation ${
                      font === option.id ? 'border-nova-400/50 bg-nova-500/12' : 'border-white/10 bg-white/[0.03]'
                    }`}
                  >
                    <Type className="size-4 shrink-0 text-nova-300" />
                    <span className="min-w-0 flex-1" style={{fontFamily: option.sans}}>
                      <span className="block text-[0.78rem] font-extrabold text-mist-100">{option.name}</span>
                      <OptionBlurb short={option.short} blurb={option.blurb} />
                    </span>
                    {font === option.id && <Check className="size-3.5 shrink-0 text-nova-300" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------- stats */}
      <section>
        <SectionHeading title="Career stats" icon={<Target className="size-4" />} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
          {[
            {label: 'Exams taken', value: profile.stats.exams_taken},
            {label: 'Best score', value: `${profile.stats.best_percentage.toFixed(0)}%`},
            {label: 'Accuracy', value: `${profile.stats.accuracy}%`},
            {label: 'Duels', value: `${profile.stats.duels_won}W / ${profile.stats.duels_lost ?? 0}L`},
            {label: 'Win rate', value: `${profile.stats.duel_win_rate}%`},
            {label: 'Best run', value: profile.stats.best_run},
          ].map((stat) => (
            <Card key={stat.label} className="px-3 py-2.5 sm:px-4 sm:py-3.5">
              <p className="truncate text-lg leading-none font-black tabular text-mist-50 sm:text-xl">{stat.value}</p>
 <p className="mt-1 truncate text-[0.58rem] font-bold tracking-[0.08em] text-mist-500 sm:mt-1.5 sm:text-[0.64rem] sm:tracking-[0.14em]">
                {stat.label}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ season ladder */}
      {profile.season ? (
        <section>
          <SectionHeading
            title="This season"
            subtitle={`${profile.season.label} — the badge ladder resets on the first of every month.`}
            icon={<Medal className="size-4" />}
            action={
              <Chip className="border-pulse-500/28 bg-pulse-500/12 text-pulse-300" icon={<CalendarClock className="size-3.5" />}>
                {profile.season.days_left}d left
              </Chip>
            }
          />
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <SeasonBadge rank={profile.season.rank} level={profile.season.level} size="lg" current />
              <div className="min-w-0 flex-1">
 <p className="text-[0.62rem] font-black tracking-[0.18em] text-mist-500">Season badge</p>
                <p className="mt-0.5 text-[1.05rem] font-black text-mist-50">
                  {profile.season.rank.label} · level {profile.season.level}/100
                </p>
                <p className="text-[0.76rem] font-semibold text-mist-400">{profile.season.rank.blurb}</p>
                <div className="mt-2">
                  <div className="xpbar">
                    <span className="xpbar-fill" style={{width: `${Math.max(3, profile.season.progress.percent)}%`}} />
                  </div>
                  <p className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[0.7rem] font-bold text-mist-400">
                    <span className="tabular">{formatNumber(profile.season.xp)} season XP</span>
                    <span className="tabular">
                      {profile.season.next_rank
                        ? `${formatNumber(profile.season.progress.needed)} XP to level ${profile.season.level + 1}`
                        : 'Top of the ladder'}
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-1.5 text-right">
 <p className="text-[0.62rem] font-black tracking-wide text-mist-500">Board</p>
                <p className="text-xl font-black text-gold-300 tabular">#{profile.season.board_rank}</p>
              </div>
            </div>
          </Card>
        </section>
      ) : null}

      {/* ------------------------------------------------------ badges */}
      <section>
        <SectionHeading
          title="Badge collection"
          subtitle={`${owned.size} of ${badgeCatalogue.length} unlocked`}
          icon={<Award className="size-4" />}
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {badgeCatalogue.map((badge) => {
            const BadgeIcon = iconFor(badge.icon, Award);
            const unlocked = owned.has(badge.key);
            const awarded = profile.badges.find((item) => item.key === badge.key);
            return (
              <motion.div key={badge.key} variants={staggerItem} initial="hidden" animate="show">
                <Card className={`flex h-full flex-col items-center gap-1.5 p-3 text-center sm:gap-2 sm:p-4 ${unlocked ? '' : 'opacity-45'}`}>
                  <span
                    className={`grid size-11 place-items-center rounded-2xl sm:size-14 ${
                      unlocked ? `bg-gradient-to-br ${TIER_GRADIENT[badge.tier] ?? TIER_GRADIENT.gold} text-ink-950` : 'bg-white/6 text-mist-500'
                    }`}
                  >
                    <BadgeIcon className="size-6 sm:size-7" strokeWidth={2.1} />
                  </span>
                  <p className="text-[0.8rem] font-extrabold text-mist-100 sm:text-[0.86rem]">{badge.name}</p>
                  <p className="line-clamp-2 text-[0.7rem] font-medium leading-snug text-mist-500 sm:text-[0.74rem]">{badge.description}</p>
 <p className="mt-auto pt-1 text-[0.62rem] font-bold tracking-wider text-gold-300 sm:text-[0.68rem]">
                    {unlocked ? formatDate(awarded?.awarded_at) : `+${badge.xp_reward} XP`}
                  </p>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ----------------------------------------------------- friends */}
      <section>
        <SectionHeading
          title="Your circle"
          subtitle="Friends power the friends leaderboard and instant duel invites."
          icon={<Users className="size-4" />}
          action={
            <Chip className="border-mint-500/28 bg-mint-500/12 text-mint-300">
              {friends?.friends.filter((friend) => onlineIds.includes(friend.id)).length ?? 0} online
            </Chip>
          }
        />

        <div className="grid gap-3 sm:gap-4 lg:grid-cols-[1fr_1.3fr]">
          <Card className="p-3.5 sm:p-4">
            <Field label="Add by phone or name">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-mist-500" />
                <TextInput
                  className="pl-11"
                  placeholder="0803… or a name"
                  value={friendPhone}
                  onChange={(event) => setFriendPhone(normalizePhoneInput(event.target.value) || event.target.value)}
                />
              </div>
            </Field>
            {searching.length > 0 && (
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {searching.map((player) => (
                  <li key={player.id}>
                    <button
                      onClick={() => addFriend(player)}
                      disabled={addBusy}
                      className="flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5 text-left transition-colors hover:border-mint-400/40 hover:bg-mint-500/10 disabled:opacity-50"
                    >
                      <Avatar name={player.name} hue={player.avatar_hue} initials={player.initials} size={34} online={onlineIds.includes(player.id)} photo={{id: player.id, has: player.has_photo}} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.84rem] font-bold text-mist-100">{player.name}</span>
                        <span className="block truncate text-[0.72rem] font-semibold text-mist-500">
                          Lv {player.level} · {formatPhone(player.phone)}
                        </span>
                      </span>
                      <UserPlus className="size-4 shrink-0 text-mint-300" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {friendPhone.trim().length >= 10 && isValidPhone(friendPhone) && searching.length === 0 && (
              <Button className="mt-3" size="sm" block onClick={() => addFriend({id: 0, name: friendPhone, phone: friendPhone} as PlayerSummary)} loading={addBusy}>
                Send request to {formatPhone(friendPhone)}
              </Button>
            )}

            {friends && friends.requests.length > 0 && (
              <div className="mt-4">
 <p className="text-[0.68rem] font-black tracking-[0.18em] text-mist-500">Incoming requests</p>
                <ul className="mt-2 space-y-1.5">
                  {friends.requests.map((request) => (
                    <li key={request.id} className="flex items-center gap-3 rounded-2xl border border-gold-500/22 bg-gold-500/8 px-3 py-2">
                      <Avatar name={request.name} hue={request.avatar_hue} initials={request.initials} size={32} photo={{id: request.id, has: request.has_photo}} />
                      <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-mist-100">{request.name}</span>
                      <Button size="sm" variant="gold" onClick={() => addFriend(request)}>
                        Accept
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card className="p-3.5 sm:p-4">
            {!friends ? (
              <Skeleton className="h-32" />
            ) : friends.friends.length === 0 ? (
              <EmptyState icon={<Users className="size-6" />} title="No friends yet" detail="Add rivals by phone number to unlock the friends leaderboard." />
            ) : (
              <ul className="grid gap-1.5 sm:grid-cols-2 sm:gap-2">
                {friends.friends.map((friend) => (
                  <li
                    key={friend.friendship_id ?? friend.id}
                    className="flex items-center gap-2.5 rounded-2xl border border-white/8 bg-white/[0.03] px-2.5 py-2 sm:gap-3 sm:px-3 sm:py-2.5"
                  >
                    <Avatar
                      name={friend.name}
                      hue={friend.avatar_hue}
                      initials={friend.initials}
                      size={friendFace}
                      online={onlineIds.includes(friend.id)}
                      photo={{id: friend.id, has: friend.has_photo}}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.84rem] font-extrabold text-mist-100">{friend.name}</p>
                      <p className="truncate text-[0.72rem] font-semibold text-mist-500">
                        Lv {friend.level} · {formatNumber(friend.xp)} XP
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => removeFriend(friend.friendship_id ?? 0)}>
                      <Trash2 className="size-4 text-flare-400" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>

      {/* ------------------------------------------------------ results */}
      <section>
        <SectionHeading title="Exam history" subtitle="Every attempt, graded and ranked." icon={<ScrollText className="size-4" />} />
        {!results ? (
          <div className="space-y-2">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-16" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <EmptyState icon={<ScrollText className="size-6" />} title="No exams yet" detail="Head to the Play tab and sit your first arena exam." />
        ) : (
          <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="space-y-2">
            {results.map((result) => (
              <motion.li key={result.id} variants={staggerItem}>
                <Card className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-3.5">
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-xl border text-[0.82rem] font-black sm:size-11 sm:text-[0.86rem] ${
                      GRADE_STYLES[result.grade] ?? 'border-white/12 bg-white/6 text-mist-300'
                    }`}
                  >
                    {result.grade}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.88rem] font-extrabold text-mist-50">{result.quiz.title}</p>
                    <p className="truncate text-[0.74rem] font-semibold text-mist-500">
                      {result.quiz.course} · {result.correct_count}/{result.quiz.total_questions} correct ·{' '}
                      {result.percentage.toFixed(0)}% · {formatDate(result.submitted_at, true)}
                    </p>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    <p className="text-[0.78rem] font-black tabular text-mist-100">{result.score} pts</p>
 <p className="text-[0.68rem] font-bold tracking-wider text-gold-300">
                      +{formatNumber(result.xp_awarded)} XP
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onOpenResult(result.id)}>
                    Review
                  </Button>
                </Card>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3.5 sm:gap-3 sm:rounded-3xl sm:px-5 sm:py-4">
        <p className="text-[0.76rem] font-semibold text-mist-500 sm:text-[0.8rem]">
          Joined {formatDate(profile.created_at)} · Last active {profile.last_active ? formatDate(profile.last_active, true) : 'now'}
        </p>
        <Button variant="outline" onClick={onSignOut} icon={<LogOut className="size-4" />}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
