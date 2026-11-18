import React, { useEffect, useRef, useState } from 'react';
import {
  animate,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
} from 'motion/react';

export const FINTECH_EASE = [0.22, 1, 0.36, 1] as const;

export const FINTECH_SPRING_SNAPPY = {
  type: 'spring' as const,
  visualDuration: 0.24,
  bounce: 0,
};

export const FINTECH_SPRING_SURFACE = {
  type: 'spring' as const,
  visualDuration: 0.34,
  bounce: 0,
};

export const ScrollProgressBar: React.FC = () => {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 320,
    damping: 38,
    restDelta: 0.001,
  });

  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX }}
      className="fixed top-0 left-0 right-0 h-[2px] bg-[#2D46E6] origin-left z-50 pointer-events-none"
    />
  );
};

interface MotionRevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}

export const MotionReveal: React.FC<MotionRevealProps> = ({
  children,
  className = '',
  delay = 0,
  y = 10,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.04 }}
      transition={{ duration: 0.32, delay, ease: FINTECH_EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

const staggerContainerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.02,
    },
  },
};

const staggerItemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: FINTECH_EASE,
    },
  },
};

export const StaggerGroup: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => {
  return (
    <motion.div
      variants={staggerContainerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.04 }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

export const StaggerItem: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => {
  return (
    <motion.div variants={staggerItemVariants} className={className}>
      {children}
    </motion.div>
  );
};

interface AnimatedMetricValueProps {
  value: number;
  format: (val: number) => string;
  className?: string;
}

export const AnimatedMetricValue: React.FC<AnimatedMetricValueProps> = ({
  value,
  format,
  className = '',
}) => {
  const prefersReduced = useReducedMotion();
  const prevRef = useRef<number>(value);
  const [display, setDisplay] = useState<string>(() => format(value));

  useEffect(() => {
    const startVal = prevRef.current;
    prevRef.current = value;

    if (prefersReduced || Math.abs(value - startVal) < 1e-6) {
      setDisplay(format(value));
      return;
    }

    const controls = animate(startVal, value, {
      duration: 0.36,
      ease: FINTECH_EASE,
      onUpdate: (latest) => {
        setDisplay(format(latest));
      },
    });

    return () => controls.stop();
  }, [value, format, prefersReduced]);

  return <span className={className}>{display}</span>;
};
