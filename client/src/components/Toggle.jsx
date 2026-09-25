import { useState } from "react";

export function Toggle({
  checked,
  defaultChecked = false,
  onChange,
  disabled = false,
  label,
}) {
  const [internalChecked, setInternalChecked] = useState(defaultChecked);

  // Permite usar de forma controlada (checked) ou não controlada (defaultChecked)
  const isChecked = checked ?? internalChecked;

  function handleChange() {
    if (disabled) return;

    const nextValue = !isChecked;

    // Atualiza estado interno somente quando não é controlado externamente
    if (checked === undefined) {
      setInternalChecked(nextValue);
    }

    onChange?.(nextValue);
  }

  return (
    <label
      className={[
        "inline-flex items-center gap-3",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      ].join(" ")}
    >
      <button
        type="button"
        role="switch"
        aria-checked={isChecked}
        aria-label={label || "Alternar opção"}
        disabled={disabled}
        onClick={handleChange}
        className={[
          "cursor-pointer relative h-6 w-11 rounded-full p-0.5",
          "transition-colors duration-200 ease-in-out",
          "focus:outline-none focus-visible:ring-2",
          "focus-visible:ring-purple-500 focus-visible:ring-offset-2",
          isChecked ? "bg-purple-500" : "bg-gray-500",
        ].join(" ")}
      >
        <span
          aria-hidden="true"
          className={[
            "block h-5 w-5 rounded-full bg-white shadow-sm",
            "transition-transform duration-200 ease-in-out",
            isChecked ? "translate-x-5" : "translate-x-0",
          ].join(" ")}
        />
      </button>

      {label && (
        <span className="select-none text-sm text-slate-700 dark:text-slate-200">{label}</span>
      )}
    </label>
  );
}
