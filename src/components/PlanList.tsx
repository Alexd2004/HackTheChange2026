// "Your quests" on the start screen: every plan on this account (from the server, so it's the same
// on any phone), ongoing ones first with the last-opened plan on top, finished ones marked with a
// trophy. Shows 3 at first so the build form stays on screen; "Show all" reveals the rest.
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { pixelColors as c } from "@/lib/theme";
import type { PlanSummary } from "@/lib/types";
import { Icon, font } from "./pixel";

const FIRST = 3;

export function PlanList({ plans, currentPlanId }: { plans: PlanSummary[]; currentPlanId: string | null }) {
  const [showAll, setShowAll] = useState(false);
  if (plans.length === 0) return null;

  // The plan opened last goes first (if it's still ongoing); the rest keep their order.
  const current = plans.find((p) => p.plan.id === currentPlanId && !p.complete);
  const ordered = current ? [current, ...plans.filter((p) => p !== current)] : plans;
  const visible = showAll ? ordered : ordered.slice(0, FIRST);
  const ongoing = plans.filter((p) => !p.complete).length;

  return (
    <View className="mt-4 gap-2">
      <Text style={{ ...font(22, c.cream), textShadowColor: c.outline, textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 0 }}
        accessibilityRole="header">
        Your quests{ongoing ? ` · ${ongoing} ongoing` : ""}
      </Text>
      {visible.map((p) => (
        <PlanRow key={p.plan.id} summary={p} isCurrent={p === current} />
      ))}
      {ordered.length > FIRST && (
        <Pressable
          onPress={() => setShowAll((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={showAll ? "Show fewer quests" : `Show all ${ordered.length} quests`}
          className="min-h-[44px] items-center justify-center active:opacity-80">
          <Text style={{ ...font(20, c.cream), textDecorationLine: "underline" }}>
            {showAll ? "Show fewer" : `Show all (${ordered.length})`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function PlanRow({ summary, isCurrent }: { summary: PlanSummary; isCurrent: boolean }) {
  const { plan, stagesTotal, stagesBeaten, complete } = summary;
  const stageNow = Math.min(stagesBeaten + 1, Math.max(stagesTotal, 1));
  const progress = complete
    ? "All stages beaten"
    : stagesTotal
      ? `Stage ${stageNow} of ${stagesTotal}${stagesBeaten ? ` · ${stagesBeaten} beaten` : ""}`
      : "No skill gaps";
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/plan/[id]", params: { id: plan.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${isCurrent ? "Continue" : "Open"} ${plan.job_title}${plan.company ? ` at ${plan.company}` : ""}. ${progress}. ${plan.match_pct}% job match.`}
      className="min-h-[56px] flex-row items-center gap-3 px-3 py-2 active:opacity-80"
      style={{
        backgroundColor: isCurrent ? c.gold : c.parchment,
        borderWidth: 3,
        borderColor: isCurrent ? c.outline : c.wood,
        boxShadow: `4px 4px 0 ${c.outline}`,
      }}>
      <Icon name={complete ? "trophy" : isCurrent ? "play" : "map-outline"} size={24} color={complete ? c.dirtEdge : c.wood} />
      <View className="flex-1">
        <Text numberOfLines={1} style={font(20, c.outline)}>
          {isCurrent ? "Continue: " : ""}{plan.job_title}
        </Text>
        <Text numberOfLines={1} style={font(16, c.wood)}>
          {plan.company ? `${plan.company} · ` : ""}{progress}
        </Text>
      </View>
      <Text style={font(24, c.grassDark)}>{plan.match_pct}%</Text>
    </Pressable>
  );
}
