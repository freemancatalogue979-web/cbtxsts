/**
 * Welcome — the front door. Two views, one at a time:
 *
 *  - `landing`: the branded pitch (picture reel, live stats, ranks),
 *  - `signin`:  the only place a player or staff member authenticates.
 *
 * On a phone they are strictly separate screens with a button between them;
 * on a desktop they stay separate too, because a sign-in form crammed beside
 * marketing copy reads like an accident.
 */
import {useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import Landing from './Landing';
import SignIn from './SignIn';

type FrontView = 'landing' | 'signin';

export default function Welcome({
  onAdminMode,
  switchTarget,
  onSwitchCancel,
}: {
  onAdminMode: () => void;
  /** Set while the shell is being swapped between Player and Staff: the sign-in
   *  sheet opens straight on the missing role and Back returns to the app. */
  switchTarget?: 'student' | 'admin' | null;
  onSwitchCancel?: () => void;
}) {
  const [view, setView] = useState<FrontView>(switchTarget ? 'signin' : 'landing');
  const [mode, setMode] = useState<'student' | 'admin'>(switchTarget ?? 'student');

  const show = (next: FrontView, nextMode: 'student' | 'admin' = 'student') => {
    window.scrollTo({top: 0, behavior: 'instant' as ScrollBehavior});
    setMode(nextMode);
    setView(next);
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {view === 'landing' ? (
        <motion.div
          key="landing"
          initial={{opacity: 0, x: -26}}
          animate={{opacity: 1, x: 0}}
          exit={{opacity: 0, x: 26}}
          transition={{duration: 0.26, ease: [0.22, 1, 0.36, 1]}}
        >
          <Landing onSignIn={() => show('signin')} onStaff={() => show('signin', 'admin')} />
        </motion.div>
      ) : (
        <motion.div
          key="signin"
          initial={{opacity: 0, x: 26}}
          animate={{opacity: 1, x: 0}}
          exit={{opacity: 0, x: -26}}
          transition={{duration: 0.26, ease: [0.22, 1, 0.36, 1]}}
        >
          <SignIn
            onBack={() => {
              if (switchTarget) {
                onSwitchCancel?.();
                return;
              }
              show('landing');
            }}
            onAdminMode={onAdminMode}
            initialMode={mode}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
