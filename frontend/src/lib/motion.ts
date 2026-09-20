/** Shared motion variants so every screen animates with the same rhythm. */
import type {Variants} from 'motion/react';

export const EASE = [0.22, 1, 0.36, 1] as const;

export const fadeUp: Variants = {
  hidden: {opacity: 0, y: 16},
  show: {opacity: 1, y: 0, transition: {duration: 0.45, ease: EASE}},
};

export const fadeIn: Variants = {
  hidden: {opacity: 0},
  show: {opacity: 1, transition: {duration: 0.35, ease: EASE}},
};

export const scaleIn: Variants = {
  hidden: {opacity: 0, scale: 0.92},
  show: {opacity: 1, scale: 1, transition: {duration: 0.38, ease: EASE}},
};

export const popIn: Variants = {
  hidden: {opacity: 0, scale: 0.7},
  show: {opacity: 1, scale: 1, transition: {duration: 0.4, ease: [0.34, 1.56, 0.64, 1]}},
};

export const slideFromRight: Variants = {
  hidden: {opacity: 0, x: 26},
  show: {opacity: 1, x: 0, transition: {duration: 0.34, ease: EASE}},
  exit: {opacity: 0, x: -26, transition: {duration: 0.22, ease: 'easeIn'}},
};

export const slideFromLeft: Variants = {
  hidden: {opacity: 0, x: -26},
  show: {opacity: 1, x: 0, transition: {duration: 0.34, ease: EASE}},
  exit: {opacity: 0, x: 26, transition: {duration: 0.22, ease: 'easeIn'}},
};

export const staggerContainer: Variants = {
  hidden: {},
  show: {transition: {staggerChildren: 0.055, delayChildren: 0.04}},
};

export const staggerItem: Variants = {
  hidden: {opacity: 0, y: 18},
  show: {opacity: 1, y: 0, transition: {duration: 0.42, ease: EASE}},
};

export const overlayVariants: Variants = {
  hidden: {opacity: 0},
  show: {opacity: 1, transition: {duration: 0.22}},
  exit: {opacity: 0, transition: {duration: 0.2}},
};

export const sheetVariants: Variants = {
  hidden: {opacity: 0, y: 28, scale: 0.98},
  show: {opacity: 1, y: 0, scale: 1, transition: {duration: 0.34, ease: EASE}},
  exit: {opacity: 0, y: 18, scale: 0.98, transition: {duration: 0.2, ease: 'easeIn'}},
};

/** Springy press feedback for buttons and cards. */
export const pressable = {
  whileHover: {y: -2},
  whileTap: {scale: 0.97},
  transition: {type: 'spring' as const, stiffness: 420, damping: 26},
};
