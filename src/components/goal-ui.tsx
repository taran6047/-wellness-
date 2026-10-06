import {
  GOAL_METRICS,
  GOAL_STATUS_LABELS,
  formatGoalValue,
} from "@/lib/goals";
import type { GoalWithProgress } from "@/lib/family-goals";

const STATUS_STYLES = {
  in_progress: "bg-sky-100 text-sky-800",
  achieved: "bg-emerald-100 text-emerald-800",
  expired: "bg-slate-200 text-slate-700",
} as const;

function formatDay(date: Date) {
  return date.toISOString().slice(0, 10).split("-").reverse().join(".");
}

// Карточка цели с полосой прогресса; action — необязательный блок (например, удаление)
export function GoalCard({
  goal,
  action,
}: {
  goal: GoalWithProgress;
  action?: React.ReactNode;
}) {
  const info = goal.metric ? GOAL_METRICS[goal.metric] : null;
  const unit = info?.unit ?? "";

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{goal.title}</p>
          <p className="text-sm text-slate-500">
            {info?.label ?? goal.metric} · {formatDay(goal.startDate)} —{" "}
            {formatDay(goal.endDate)}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[goal.status]}`}
        >
          {GOAL_STATUS_LABELS[goal.status]}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={goal.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={goal.title}
        className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="h-full bg-emerald-600"
          style={{ width: `${goal.percent}%` }}
        />
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {formatGoalValue(goal.current)} из {formatGoalValue(goal.targetValue)}{" "}
        {unit} ({goal.percent}%)
        {goal.status === "in_progress" && ` · осталось дней: ${goal.daysLeft}`}
      </p>
      {action}
    </li>
  );
}
