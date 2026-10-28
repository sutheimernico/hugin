import type { ButtonHTMLAttributes } from "react";

type Variant = "ghost" | "primary" | "danger";
type Size = "sm" | "md";

const VARIANT_CLASS: Record<Variant, string> = {
  ghost: "border-border bg-transparent text-text hover:bg-surface-2",
  primary: "border-text bg-text text-surface-2 hover:bg-text/85",
  danger: "border-red bg-red text-surface-2 hover:bg-red/85",
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "h-8 px-2.5 text-[12px]",
  md: "h-10 px-3.5 text-[14px]",
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
      className={`ease-out-expo inline-flex items-center justify-center gap-2 rounded-part border font-medium transition-colors duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`}
      {...rest}
    />
  );
}
