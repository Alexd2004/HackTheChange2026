// The winding SVG trail that connects level nodes on the map.
// Completed segments are drawn solid in the brand color, the rest dashed.
import Svg, { Path } from "react-native-svg";
import { colors } from "@/lib/theme";

export interface Point {
  x: number;
  y: number;
}

/** Smooth S-curve from a to b (vertical tangents at both ends). */
function segment(a: Point, b: Point): string {
  const midY = (a.y + b.y) / 2;
  return `M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`;
}

export function MapPath({
  points, width, height, completedSegments,
}: { points: Point[]; width: number; height: number; completedSegments: number }) {
  return (
    <Svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
      {points.slice(1).map((p, i) => {
        const done = i < completedSegments;
        return (
          <Path
            key={i}
            d={segment(points[i], p)}
            stroke={done ? colors.brand : colors.line}
            strokeWidth={done ? 6 : 5}
            strokeDasharray={done ? undefined : "2 12"}
            strokeLinecap="round"
            fill="none"
          />
        );
      })}
    </Svg>
  );
}
