import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";

type CountUpProps = {
  value: number;
  format?: (value: number) => string;
  className?: string;
};

/**
 * A readout that counts from where it stood to where it is, over 400 ms. Hung off the effect's
 * dependency on `value`, so it starts on a real change and on nothing else.
 */
export function CountUp({ value, format, className }: CountUpProps) {
  const current = useMotionValue(value);
  const text = useTransform(current, (now) => {
    const rounded = Math.round(now);
    return format ? format(rounded) : String(rounded);
  });

  useEffect(() => {
    const controls = animate(current, value, { duration: 0.4, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [value, current]);

  return <motion.span className={className}>{text}</motion.span>;
}
