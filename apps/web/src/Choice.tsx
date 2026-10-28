import { Check } from "lucide-react";
import type { ReactNode } from "react";

const icon = { size: 20, strokeWidth: 2, "aria-hidden": true as const };

export function Choice({
  id,
  name,
  checked,
  onChange,
  disabled = false,
  title,
  detail,
  glyph,
}: {
  id: string;
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title: string;
  detail: string;
  glyph: ReactNode;
}) {
  return (
    <label className="choice" htmlFor={id}>
      <input
        id={id}
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="choice-icon">{glyph}</span>
      <span className="choice-copy">
        <span className="choice-title">{title}</span>
        <span className="choice-detail">{detail}</span>
      </span>
      {checked ? <Check {...icon} /> : <span className="choice-spacer" />}
    </label>
  );
}
