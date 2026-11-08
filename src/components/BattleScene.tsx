// Boss fight scene: monkey on the left, boss on the right, each with an HP bar over its head.
// A correct answer → monkey attacks while the boss takes a hit; a wrong one → the reverse.
import { useSettings } from "@/lib/settings";
import { pixelColors as c } from "@/lib/theme";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Sprite, TileBar, type Sheet } from "./pixel";

/** Fight animation speed: milliseconds per frame (lower = faster). */
const FIGHT_FRAME_MS = 120;

const IDLE = [0, 1, 2];
const ATTACK = [2, 3, 4, 5];
const HIT = [6, 7, 8];
// KO frames are 9-11 (frames 0-2 of the *_ko sheet). Each is shown for this many clock ticks.
const KO_TICKS_PER_FRAME = 2;
const KO_LAST = 11;
const KO = [9, 10, 11].flatMap((f) =>
  f === KO_LAST ? [f] : Array<number>(KO_TICKS_PER_FRAME).fill(f),
);

// KO sheets: 3 frames in 724px cells, drawn at their own scale (set so the KO pose matches the idle
// size). `frames` overrides the cell's x range where the art crosses cell edges.
interface KoSheet {
  sheet: Sheet;
  top: number;
  bottom: number; // ground line
  scale: number; // on-screen px per sheet px
  frames?: [number, number][];
}
const koSheet = (src: number, top: number, bottom: number, scale: number, frames?: [number, number][]): KoSheet => ({
  sheet: { src, w: 2172, h: 724 },
  top,
  bottom,
  scale,
  frames,
});

interface FighterSheet {
  sheet: Sheet;
  cols: number[];
  cropW: number;
  rows: [number, number][];
  height: number; // on-screen px of the tallest row
  ko: KoSheet;
}
const monkey: FighterSheet = {
  sheet: {
    src: require("../../assets/monkey_all_frames.png"),
    w: 1536,
    h: 1024,
  },
  cols: [334.5, 760.5, 1175.5],
  cropW: 330,
  rows: [
    [15, 311],
    [358, 637],
    [683, 984],
  ],
  height: 115,
  ko: koSheet(require("../../assets/monkey_ko.png"), 110, 620, 0.226),
};
const bosses: FighterSheet[] = [
  {
    sheet: {
      src: require("../../assets/boss_1_all_frames.png"),
      w: 1312,
      h: 1199,
    },
    cols: [243, 665.5, 1091],
    cropW: 418,
    rows: [
      [25, 363],
      [412, 771],
      [814, 1150],
    ],
    height: 150,
    ko: koSheet(require("../../assets/boss_1_ko.png"), 80, 640, 0.248),
  },
  {
    sheet: {
      src: require("../../assets/boss_2_all_frames.png"),
      w: 1536,
      h: 1024,
    },
    cols: [249, 758.5, 1268],
    cropW: 484,
    rows: [
      [9, 330],
      [335, 680],
      [688, 1008],
    ],
    height: 150,
    ko: koSheet(require("../../assets/boss_2_ko.png"), 150, 630, 0.28),
  },
  {
    sheet: {
      src: require("../../assets/boss_3_all_frames.png"),
      w: 1312,
      h: 1199,
    },
    cols: [222, 656.5, 1087],
    cropW: 430,
    rows: [
      [10, 387],
      [418, 755],
      [799, 1160],
    ],
    height: 150,
    // Boss 3's KO art spills across the 724px cell edges, so each frame gets its own x range.
    ko: koSheet(require("../../assets/boss_3_ko.png"), 30, 668, 0.229, [
      [0, 611],
      [611, 1371],
      [1371, 2172],
    ]),
  },
];

type Anim = { seq: number[]; i: number };
const step = (a: Anim): Anim =>
  a.i + 1 < a.seq.length
    ? { seq: a.seq, i: a.i + 1 }
    : a.seq === KO
      ? a // knocked out: stay down
      : { seq: IDLE, i: 0 }; // other actions fall back to idle

export function BattleScene({
  bossNum,
  bossHp,
  monkeyHp,
  maxHp,
  hit,
}: {
  bossNum: number; // 1-3
  bossHp: number;
  monkeyHp: number;
  maxHp: number;
  /** Bumped once per answer; monkeyWins = the answer was right. */
  hit: { id: number; monkeyWins: boolean } | null;
}) {
  const { motionOff } = useSettings();
  const [anim, setAnim] = useState({
    boss: { seq: IDLE, i: 0 },
    monkey: { seq: IDLE, i: 0 },
  });

  // One clock drives both fighters so the attack and the hit start on the same frame.
  // HP arrives in the same render as the hit, so the clock can tell a lethal hit (→ KO) from a normal one.
  const hitRef = useRef({ hit, bossHp, monkeyHp });
  const seenHit = useRef(hit?.id);
  useEffect(() => {
    hitRef.current = { hit, bossHp, monkeyHp };
  }, [hit, bossHp, monkeyHp]);
  useEffect(() => {
    if (motionOff) return; // reduced motion: both hold their first idle frame
    const t = setInterval(() => {
      const { hit: h, bossHp: bHp, monkeyHp: mHp } = hitRef.current;
      if (h && h.id !== seenHit.current) {
        seenHit.current = h.id;
        setAnim({
          boss: { seq: h.monkeyWins ? (bHp === 0 ? KO : HIT) : ATTACK, i: 0 },
          monkey: { seq: h.monkeyWins ? ATTACK : mHp === 0 ? KO : HIT, i: 0 },
        });
      } else {
        setAnim((a) => ({ boss: step(a.boss), monkey: step(a.monkey) }));
      }
    }, FIGHT_FRAME_MS);
    return () => clearInterval(t);
  }, [motionOff]);

  const boss = bosses[(bossNum - 1) % bosses.length];
  // Reduced motion runs no clock: a fighter at 0 HP just shows its final KO pose.
  const frameOf = (a: Anim, hp: number) => (motionOff && hp === 0 ? KO_LAST : a.seq[a.i]);
  return (
    <View className="flex-row items-end justify-between px-2">
      <Fighter
        fs={monkey}
        frame={frameOf(anim.monkey, monkeyHp)}
        hp={monkeyHp}
        maxHp={maxHp}
        color={c.grassDark}
        label={`Your health ${monkeyHp} of ${maxHp}`}
      />
      <Fighter
        fs={boss}
        frame={frameOf(anim.boss, bossHp)}
        hp={bossHp}
        maxHp={maxHp}
        color={c.red}
        label={`Boss health ${bossHp} of ${maxHp}`}
      />
    </View>
  );
}

function Fighter({
  fs,
  frame,
  hp,
  maxHp,
  color,
  label,
}: {
  fs: FighterSheet;
  frame: number;
  hp: number;
  maxHp: number;
  color: string;
  label: string;
}) {
  const tallest = Math.max(...fs.rows.map(([t, b]) => b - t));
  const width = (fs.cropW * fs.height) / tallest;
  const ko = frame >= 9;
  const [top, bottom] = fs.rows[ko ? 0 : Math.floor(frame / 3)];
  const crop = {
    x: fs.cols[frame % 3] - fs.cropW / 2,
    y: top,
    w: fs.cropW,
    h: bottom - top,
  };
  // KO frame: wider than the fight box (lying down), so it's an overlay centered on the fighter and
  // standing on the same ground line, which keeps the row from reflowing.
  const k = fs.ko;
  const ki = frame - 9;
  const [kx0, kx1] = k.frames?.[ki] ?? [ki * 724, ki * 724 + 724];
  const koCrop = { x: kx0, y: k.top, w: kx1 - kx0, h: k.bottom - k.top };
  const koLeft = width / 2 - (ki * 724 + 362 - kx0) * k.scale; // keep each 724 cell's center on the fighter
  return (
    <View className="items-center gap-2">
      <View style={{ width: 96 }}>
        <TileBar
          filled={hp}
          total={maxHp}
          color={color}
          height={10}
          label={label}
        />
      </View>
      {/* The monkey sheet faces right and the boss sheets face left, so on these sides they face off as drawn. */}
      <View style={{ width, height: fs.height, justifyContent: "flex-end" }}>
        {ko ? (
          <View style={{ position: "absolute", bottom: 0, left: koLeft }}>
            <Sprite sheet={k.sheet} frame={koCrop} width={koCrop.w * k.scale} />
          </View>
        ) : (
          <Sprite sheet={fs.sheet} frame={crop} width={width} />
        )}
      </View>
    </View>
  );
}
