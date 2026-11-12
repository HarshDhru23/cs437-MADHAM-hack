interface CreditStepperProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** The fewest and most credits the buttons step to. The box itself still takes any number: the form says what is wrong. */
  min?: number;
  max?: number;
  invalid?: boolean;
}

/** The credits box with a minus and a plus beside it, so the usual change is one click. The label is the caller's, tied to `id`. */
export function CreditStepper({ id, value, onChange, min = 1, max = 8, invalid }: CreditStepperProps) {
  const n = Number(value);
  const known = value.trim() !== '' && Number.isFinite(n);
  const step = (by: number) => onChange(String(Math.min(max, Math.max(min, (known ? Math.round(n) : min - by) + by))));
  return (
    <div className="stepper">
      <button type="button" className="btn btn-small" aria-label="Fewer credits" disabled={known && n <= min} onClick={() => step(-1)}>
        −
      </button>
      <input id={id} type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid ? true : undefined} />
      <button type="button" className="btn btn-small" aria-label="More credits" disabled={known && n >= max} onClick={() => step(1)}>
        +
      </button>
    </div>
  );
}
