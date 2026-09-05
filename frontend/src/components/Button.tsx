import type { ButtonHTMLAttributes } from "react";

type Variant = "ghost" | "primary" | "danger";
type Size = "sm" | "md";

const VARIANT_CLASS: Record<Variant, string> = {
  ghost: "border-border bg-transparent text-text hover:bg-surface-2",
  primary: "border-violet/60 bg-violet/15 text-violet hover:bg-violet/25",
  danger: "border-red/60 bg-red/10 text-red hover:bg-red/20",
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "h-7 px-2 text-[11px]",
  md: "h-9 px-3 text-[13px]",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: Variant;
  size?: Size;
};

export function Button({
  variant,
  size = "md",
  type = "button",
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`ease-out-expo inline-flex items-center justify-center gap-2 rounded-panel border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`}
      {...rest}
    />
  );
}
