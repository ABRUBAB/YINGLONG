"use client";

import { MeshGradient, Water } from "@paper-design/shaders-react";
import { useTheme } from "@/components/preferences";

/**
 * Two liquid backdrops from Paper Shaders (WebGL, Apache-2.0), both decorative and aria-hidden.
 *  - WaterArt: our generated ring artwork seen through moving water: caustic light and ripples bend
 *    the picture. Used behind the closing call to action.
 *  - LiquidMesh: a slow mesh of emerald and aqua that swirls like ink in water. Used behind the
 *    receipt chain.
 * `moving` is false under reduced motion, the Pause motion control and while off-screen: each shader
 * then holds a single frame. Callers mount these only when WebGL2 is available and motion is on;
 * otherwise they show the still artwork or nothing.
 */
export function WaterArt({ moving }: { moving: boolean }) {
  const light = useTheme() === "light";
  return (
    <Water
      aria-hidden="true"
      image={light ? "/art/water-poster-light.svg" : "/art/water-poster.svg"}
      colorBack={light ? "#F3F2EE" : "#0B0C0F"}
      colorHighlight={light ? "#2B3AE0" : "#CBFF3C"}
      highlights={0.32}
      layering={0.45}
      edges={0.55}
      caustic={0.32}
      waves={0.28}
      size={0.9}
      speed={moving ? 0.45 : 0}
      frame={2600}
      fit="cover"
      maxPixelCount={520_000}
      minPixelRatio={1}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    />
  );
}

export function LiquidMesh({ moving }: { moving: boolean }) {
  const light = useTheme() === "light";
  return (
    <MeshGradient
      aria-hidden="true"
      colors={light ? ["#F3F2EE", "#E4E8FB", "#E3EEF2", "#EFE6FA"] : ["#0B0C0F", "#102016", "#0E1A24", "#17142E"]}
      distortion={0.85}
      swirl={0.35}
      grainMixer={0}
      grainOverlay={0}
      speed={moving ? 0.22 : 0}
      frame={1800}
      maxPixelCount={380_000}
      minPixelRatio={1}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    />
  );
}
