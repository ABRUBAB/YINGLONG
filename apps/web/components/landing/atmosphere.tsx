"use client";

import { Dithering } from "@paper-design/shaders-react";

/**
 * Hero atmosphere: Paper Shaders Dithering in two greys of the obsidian ramp (bg-0 and a step above
 * bg-2), so the stage reads as a lit room and never as colour. aria-hidden, no pointer events.
 * `moving` is false under reduced motion, the Pause motion control and while off-screen: the shader
 * then holds a single frame.
 */
export default function Atmosphere({ moving }: { moving: boolean }) {
  return (
    <Dithering
      aria-hidden="true"
      colorBack="#0B0C0F"
      colorFront="#15181D"
      shape="warp"
      type="4x4"
      size={2}
      scale={0.9}
      speed={moving ? 0.18 : 0}
      frame={4200}
      maxPixelCount={1920 * 1080}
      minPixelRatio={1}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    />
  );
}
