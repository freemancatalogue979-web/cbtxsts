/**
 * SignIn — the arena's only sign-in view.
 *
 * Secure accounts: players register once with a unique username, a unique
 * phone number and a password, then sign in with username-or-phone plus that
 * password. On a phone this is its own full screen (reached from the landing
 * page), never a column squeezed next to marketing copy.
 */
import {ArrowRight, AtSign, ChevronLeft, Coins, Eye, EyeOff, Gamepad2, Lock, Mail, Phone, Shield, Sparkles, UserPlus} from 'lucide-react';
import {useState} from 'react';
import {motion} from 'motion/react';
import {Button, Field, PhoneInput, TextInput} from '../components/ui';
import {LogoMark} from '../components/Brand';
import {formatNumber, isValidPhone, normalizePhoneInput} from '../lib/format';
import {useSession} from '../store/session';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export default function SignIn({
  onBack,
  onAdminMode,
  initialMode = 'student',
}: {
  onBack: () => void;
  onAdminMode: () => void;
  initialMode?: 'student' | 'admin';
}) {
  const {signIn, register, signInAdmin, toast, config} = useSession();
  // Staff sign-in works on every screen size: the console itself is fully
  // responsive (drawer navigation, stacked cards), so phones are first-class.
  const [mode, setMode] = useState<'student' | 'admin'>(initialMode);
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');

  /* ------------------------------------------------------- sign-in state */
  const [identifier, setIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPass, setShowLoginPass] = useState(false);

  /* ------------------------------------------------------- sign-up state */
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [showSignupPass, setShowSignupPass] = useState(false);
  const [displayName, setDisplayName] = useState('');

  /* -------------------------------------------------------- admin state */
  const [email, setEmail] = useState('admin@quizarena.ng');
  const [password, setPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validPhone = isValidPhone(phone);
  const validUsername = USERNAME_RE.test(username.trim().toLowerCase());
  const strongEnough = signupPassword.length >= 6;
  const signupReady = validUsername && validPhone && strongEnough;

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!identifier.trim() || !loginPassword) {
      setError('Enter your username (or phone number) and password.');
      return;
    }
    setBusy(true);
    try {
      const profile = await signIn(identifier, loginPassword);
      toast('success', `Welcome back, ${profile.name.split(' ')[0]}!`, `Level ${profile.progress.level} · ${profile.progress.title}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitSignup = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validUsername) {
      setError('Username: 3–20 letters, numbers or underscore.');
      return;
    }
    if (!validPhone) {
      setError('Enter a valid 11-digit Nigerian phone number, e.g. 08031234567.');
      return;
    }
    if (!strongEnough) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      const profile = await register({username, phone, password: signupPassword, displayName});
      toast(
        'success',
        `Welcome to the arena, ${profile.name.split(' ')[0]}!`,
        `Your account is live with ${formatNumber(profile.coins)} coins.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInAdmin(email.trim(), password);
      toast('success', 'Signed in as staff', 'Full control of the arena.');
      onAdminMode();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aurora relative min-h-dvh overflow-x-clip">
      <div className="pointer-events-none fixed inset-0 grid-lines opacity-60" />
      <div className="pointer-events-none fixed -top-32 -left-24 size-[26rem] rounded-full bg-flare-600/18 blur-[110px]" />
      <div className="pointer-events-none fixed -right-24 top-16 size-[24rem] rounded-full bg-nova-600/20 blur-[110px]" />

      {/* ---------------------------------------------------- branded head */}
      {/* Just the way back — no bar, no rule, no logo: the crest belongs to the
          landing page and the sign-in card carries the brand. */}
      <header className="sticky top-0 z-50 safe-top">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-ink-950 via-ink-950/70 to-transparent" />
        <div className="relative mx-auto flex min-h-13 max-w-6xl items-center px-2.5 py-1 sm:min-h-16 sm:px-6">
          <Button variant="ghost" size="sm" onClick={onBack} icon={<ChevronLeft className="size-4" />} className="-ml-1.5">
            <span className="hidden sm:inline">Explore the arena</span>
          </Button>
        </div>
      </header>

      <main className="relative mx-auto flex min-h-[calc(100dvh-3.25rem)] max-w-md flex-col justify-center px-3 py-6 sm:max-w-lg sm:py-10">
        {/* ------------------------------------------------------ greeting */}
        <motion.div
          initial={{opacity: 0, y: 16}}
          animate={{opacity: 1, y: 0}}
          transition={{duration: 0.45}}
          className="mb-4 flex flex-col items-center text-center sm:mb-6"
        >
          <LogoMark size={92} className="animate-float-slow" />
          <h1 className="mt-3 font-display text-[1.35rem] leading-tight font-black tracking-tight text-mist-50 sm:text-[1.75rem]">
            Step into the <span className="text-gradient">arena</span>
          </h1>
          <p className="mt-1.5 max-w-sm text-[0.82rem] leading-relaxed font-medium text-mist-400 sm:text-[0.86rem]">
            {mode === 'student'
              ? 'Create your account once — unique username, your phone number and a password. After that it is one quick sign-in to play.'
              : 'Staff sign in with the arena owner’s console credentials.'}
          </p>
        </motion.div>

        {/* ---------------------------------------------------------- card */}
        <motion.div
          initial={{opacity: 0, y: 22}}
          animate={{opacity: 1, y: 0}}
          transition={{duration: 0.5, delay: 0.06}}
          className="glass-strong relative overflow-hidden rounded-[1.4rem] p-4 shadow-[0_50px_120px_-50px_rgba(168,85,247,0.65)] sm:rounded-[1.8rem] sm:p-7"
        >
          <div className="brand-gradient absolute inset-x-0 top-0 h-1" />

          <div className="mb-4 flex gap-1 rounded-2xl border border-white/10 bg-ink-900/70 p-1">
              {(
                [
                  {id: 'student', label: 'Player', icon: Gamepad2},
                  {id: 'admin', label: 'Staff', icon: Shield},
                ] as const
              ).map((option) => {
                const active = mode === option.id;
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      setMode(option.id);
                      setError(null);
                    }}
                    className={`relative flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-[0.82rem] font-extrabold transition-colors touch-manipulation ${
                      active ? 'text-white' : 'text-mist-500 hover:text-mist-200'
                    }`}
                  >
                    {active && <motion.span layoutId="signin-mode" className="brand-gradient absolute inset-0 -z-1 rounded-xl" />}
                    <Icon className="size-4" />
                    {option.label}
                  </button>
                );
              })}
          </div>

          {mode === 'student' ? (
            <>
              {/* ------------------------------------ signin / signup tabs */}
              <div className="mb-4 flex gap-1 rounded-xl border border-white/8 bg-ink-950/50 p-1 text-[0.76rem] font-extrabold">
                {(
                  [
                    {id: 'signin', label: 'Sign in', icon: Lock},
                    {id: 'signup', label: 'Create account', icon: UserPlus},
                  ] as const
                ).map((option) => {
                  const active = tab === option.id;
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.id}
                      onClick={() => {
                        setTab(option.id);
                        setError(null);
                      }}
                      className={`relative flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg py-2 transition-colors touch-manipulation ${
                        active ? 'text-mist-50' : 'text-mist-500 hover:text-mist-300'
                      }`}
                    >
                      {active && <motion.span layoutId="signin-tab" className="absolute inset-0 -z-1 rounded-lg bg-white/12" />}
                      <Icon className="size-3.5" />
                      {option.label}
                    </button>
                  );
                })}
              </div>

              {error && (
                <p className="mb-3 rounded-2xl border border-flare-500/30 bg-flare-500/10 px-4 py-3 text-[0.82rem] font-semibold text-flare-300">
                  {error}
                </p>
              )}

              {tab === 'signin' ? (
                <form onSubmit={submitLogin} className="space-y-3.5">
                  <Field label="Username or phone number">
                    <div className="relative">
                      <AtSign className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-mist-500" />
                      <TextInput
                        className="pl-11"
                        placeholder="ada_love or 08031234567"
                        autoComplete="username"
                        autoCapitalize="none"
                        value={identifier}
                        onChange={(event) => setIdentifier(event.target.value.slice(0, 40))}
                        required
                      />
                    </div>
                  </Field>

                  <Field label="Password">
                    <div className="relative">
                      <Lock className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-mist-500" />
                      <TextInput
                        className="pl-11 pr-11"
                        type={showLoginPass ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={loginPassword}
                        onChange={(event) => setLoginPassword(event.target.value.slice(0, 72))}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPass((show) => !show)}
                        aria-label={showLoginPass ? 'Hide password' : 'Show password'}
                        className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg p-1.5 text-mist-500 transition-colors touch-manipulation hover:text-mist-200"
                      >
                        {showLoginPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </Field>

                  <Button type="submit" size="lg" block loading={busy} icon={<ArrowRight className="size-4" />}>
                    Sign in to the arena
                  </Button>
                  <p className="text-center text-[0.72rem] font-semibold text-mist-600">
                    New here?{' '}
                    <button
                      type="button"
                      className="font-extrabold text-nova-300 underline-offset-2 hover:underline"
                      onClick={() => {
                        setTab('signup');
                        setError(null);
                      }}
                    >
                      Create your account
                    </button>{' '}
                    — it takes ten seconds.
                  </p>
                </form>
              ) : (
                <form onSubmit={submitSignup} className="space-y-3.5">
                  <Field
                    label="Username"
                    hint="3–20 letters, numbers or underscore. Nobody else can take it."
                    error={username && !validUsername ? 'Letters, numbers and underscore only.' : undefined}
                  >
                    <div className="relative">
                      <AtSign className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-mist-500" />
                      <TextInput
                        className="pl-11"
                        placeholder="ada_love"
                        autoCapitalize="none"
                        autoComplete="off"
                        value={username}
                        onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/\s+/g, '').slice(0, 20))}
                        required
                      />
                    </div>
                  </Field>

                  <Field
                    label="Phone number"
                    error={phone && !validPhone ? 'Enter a valid 11-digit Nigerian number.' : undefined}
                  >
                    <PhoneInput
                      invalid={Boolean(phone && !validPhone)}
                      value={phone.replace(/^\+?234|^0/, '')}
                      onChange={(event) => {
                        const cleaned = normalizePhoneInput(event.target.value).replace(/^\+?234/, '').replace(/^0/, '');
                        setPhone(cleaned ? `0${cleaned}` : '');
                      }}
                    />
                  </Field>

                  <Field
                    label="Password"
                    error={signupPassword && !strongEnough ? 'At least 6 characters.' : undefined}
                  >
                    <div className="relative">
                      <Lock className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-mist-500" />
                      <TextInput
                        className="pl-11 pr-11"
                        type={showSignupPass ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={signupPassword}
                        onChange={(event) => setSignupPassword(event.target.value.slice(0, 72))}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowSignupPass((show) => !show)}
                        aria-label={showSignupPass ? 'Hide password' : 'Show password'}
                        className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg p-1.5 text-mist-500 transition-colors touch-manipulation hover:text-mist-200"
                      >
                        {showSignupPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </Field>

                  <Field label="Display name" hint="Optional — the name friends see in rooms and duels.">
                    <TextInput
                      placeholder="e.g. Ada the Assassin"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value.slice(0, 60))}
                    />
                  </Field>

                  {signupReady && (
                    <div className="rise-in flex items-start gap-2.5 rounded-2xl border border-nova-500/25 bg-nova-500/8 px-3.5 py-3">
                      <Sparkles className="mt-0.5 size-4 shrink-0 text-gold-300" />
                      <p className="text-[0.76rem] leading-relaxed font-semibold text-mist-300">
                        You join with <span className="font-black text-gold-300">100 coins</span> and 25 XP — enough for
                        your first duel stake and a shop flair.
                      </p>
                    </div>
                  )}

                  <Button type="submit" size="lg" block loading={busy} disabled={!signupReady} icon={<UserPlus className="size-4" />}>
                    Create my arena account
                  </Button>
                  <p className="flex items-center justify-center gap-1.5 text-center text-[0.72rem] font-semibold text-mist-600">
                    <Phone className="size-3.5" /> Your phone number is private — only used to recover your account.
                  </p>
                </form>
              )}
            </>
          ) : (
            <form onSubmit={submitAdmin} className="space-y-3.5">
              {error && (
                <p className="mb-3 rounded-2xl border border-flare-500/30 bg-flare-500/10 px-4 py-3 text-[0.82rem] font-semibold text-flare-300">
                  {error}
                </p>
              )}
              <Field label="Email">
                <div className="relative">
                  <Mail className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-mist-500" />
                  <TextInput
                    className="pl-11"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
              </Field>

              <Field label="Password">
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-mist-500" />
                  <TextInput
                    className="pl-11"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </div>
              </Field>

              <Button type="submit" size="lg" block variant="danger" loading={busy} icon={<Shield className="size-4" />}>
                Unlock console
              </Button>
              <p className="flex items-center justify-center gap-1.5 text-center text-[0.72rem] font-semibold text-mist-600">
                <Coins className="size-3.5" /> Staff accounts are created by the arena owner.
              </p>
            </form>
          )}
        </motion.div>

        <button
          onClick={onBack}
          className="mt-4 mx-auto flex items-center gap-1.5 text-[0.76rem] font-bold text-mist-500 transition-colors touch-manipulation hover:text-mist-200"
        >
          <ChevronLeft className="size-3.5" />
          Back to the arena tour
        </button>

        <p className="mt-4 text-center text-[0.68rem] font-semibold text-mist-600">
          {config?.campus || 'Enugu, Nigeria'} · Powered by the Quiz Arena engine
        </p>
      </main>
    </div>
  );
}
