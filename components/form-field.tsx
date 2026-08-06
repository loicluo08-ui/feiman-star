import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type CommonProps = {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
};

const controlClass =
  "focus-ring mt-2 w-full rounded-lg border border-[#e5e5e7] bg-white px-3.5 py-3 text-sm text-[#1a1a1a] placeholder:text-neutral-400 transition-colors hover:border-neutral-300";

export function TextField({
  id,
  label,
  hint,
  required,
  ...props
}: CommonProps & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required ? <span className="ml-1 text-neutral-400">*</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="mt-1 text-xs leading-5 text-[#8e8e93]">
          {hint}
        </p>
      ) : null}
      <input id={id} name={id} required={required} aria-describedby={hintId} className={controlClass} {...props} />
    </div>
  );
}

export function TextAreaField({
  id,
  label,
  hint,
  required,
  ...props
}: CommonProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required ? <span className="ml-1 text-neutral-400">*</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="mt-1 text-xs leading-5 text-[#8e8e93]">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        name={id}
        required={required}
        aria-describedby={hintId}
        className={`${controlClass} min-h-28 resize-y leading-6`}
        {...props}
      />
    </div>
  );
}

export function SelectField({
  id,
  label,
  hint,
  required,
  children,
  ...props
}: CommonProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required ? <span className="ml-1 text-neutral-400">*</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="mt-1 text-xs leading-5 text-[#8e8e93]">
          {hint}
        </p>
      ) : null}
      <select id={id} name={id} required={required} aria-describedby={hintId} className={controlClass} {...props}>
        {children}
      </select>
    </div>
  );
}
