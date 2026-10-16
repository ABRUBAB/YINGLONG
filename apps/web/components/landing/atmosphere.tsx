"use client";

import { Dithering } from "@paper-design/shaders-react";
import { useTheme } from "@/components/preferences";

/**
 * Hero atmosphere: Paper Shaders Dithering in two greys of the page ramp (bg-0 and a step above bg-2 in
 * dark; bg-0 and a warm step below it in light), so the stage reads as a lit room and never as colour. aria-hidden, no pointer events.
 * `moving` is false under reduced motion, the Pause motion control and while off-screen: the shader
 * then holds a single frame.
 *
 * Internal resolution: at most 0.9 megapixels whatever the screen (about two thirds of a 1440 x 900
 * hero at DPR 1, less on larger or denser screens), scaled up by the browser. The two greys are 3%
 * apart, so the coarser grain is invisible, while the fragment cost per frame drops by half or more
 * next to the 3D canvas it shares the GPU with.
 */
export default function Atmosphere({ moving }: { moving: boolean }) {
  const light = useTheme() === "light";
  return (
    <Dithering
      aria-hidden="true"
      colorBack={light ? "#F3F2EE" : "#0B0C0F"}
      colorFront={light ? "#E6E4DE" : "#15181D"}
      shape="warp"
      type="4x4"
      size={2}
      scale={0.9}
      speed={moving ? 0.18 : 0}
      frame={4200}
      maxPixelCount={900_000}
      minPixelRatio={1}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    />
  );
}
