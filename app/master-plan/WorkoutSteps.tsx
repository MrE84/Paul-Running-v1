type Step = {
  type: string;
  description?: string;
  durationType?: string;
  durationValue?: number;
  targetType?: string;
  targetValueLow?: number;
  targetValueHigh?: number;
  extraValueHeartrate?: number;
  repeatValue?: number;
  steps?: Step[];
};

function pace(speed: number) {
  const seconds = Math.round(1000 / speed);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function duration(step: Step) {
  if (step.durationType === "TIME") {
    const seconds = Math.round(step.durationValue ?? 0);
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    if (minutes === 0) return `${remaining} sec`;
    return remaining ? `${minutes} min ${remaining} sec` : `${minutes} min`;
  }
  if (step.durationType === "DISTANCE") return `${(step.durationValue ?? 0) / 1000} km`;
  return "Press lap when ready";
}

function target(step: Step) {
  const low = step.targetValueLow;
  const high = step.targetValueHigh;
  if (low === undefined || high === undefined) return "By feel";
  if (step.targetType === "HEART_RATE") return `${low}–${high} bpm`;
  if (step.targetType === "SPEED") return `${pace(high)}–${pace(low)}/km`;
  return "By feel";
}

export default function WorkoutSteps({ steps }: { steps: Step[] }) {
  return (
    <ol>
      {steps.map((step, index) => (
        <li key={index}>
          {step.steps ? (
            <><strong>Repeat {step.repeatValue} times</strong><WorkoutSteps steps={step.steps} /></>
          ) : (
            <><strong>{step.description}</strong> — {duration(step)} · {target(step)}
              {step.targetType === "SPEED" && step.extraValueHeartrate ? ` · expected HR ~${step.extraValueHeartrate} bpm` : null}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
