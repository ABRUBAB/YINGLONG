import { cn } from "@yinglong/ui";

/**
 * One illustration, two drawings: the dark glass version and the light ivory version (public/art/<name>.svg
 * and <name>-light.svg). CSS shows the one that matches the theme (fx.css, .yl-art-d and .yl-art-l), so there
 * is no flash and no script. Only the visible one is in the accessibility tree.
 */
export function ThemedImg({
  name,
  alt,
  width,
  height,
  className,
  lazy = false,
}: {
  name: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  lazy?: boolean;
}) {
  const common = { alt, width, height, decoding: "async" as const, loading: lazy ? ("lazy" as const) : undefined };
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/art/${name}.svg`} className={cn(className, "yl-art-d")} {...common} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/art/${name}-light.svg`} className={cn(className, "yl-art-l")} {...common} />
    </>
  );
}
