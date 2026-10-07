"use client";

import { useActionState, type ComponentProps } from "react";

import { Button } from "@/components/ui/button";

export type FormActionState = { error: string } | { success: string } | undefined;

/**
 * A single-button form for small state changes (publish/unpublish,
 * archive, reorder) bound to one of the `(prevState, formData)` server
 * actions, with the same inline error rendering as every other form here.
 * Hidden fields are [name, value] pairs so a field may repeat (reorder).
 */
export function ActionButtonForm({
  action,
  fields,
  label,
  pendingLabel,
  variant = "outline",
  size = "sm",
  disabled,
}: {
  action: (state: FormActionState, formData: FormData) => Promise<FormActionState>;
  fields: [string, string][];
  label: string;
  pendingLabel?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      {fields.map(([name, value], index) => (
        <input key={`${name}-${index}`} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} size={size} disabled={disabled || pending}>
        {pending ? (pendingLabel ?? "Saving…") : label}
      </Button>
      {state && "error" in state ? (
        <p className="text-destructive text-xs">{state.error}</p>
      ) : null}
    </form>
  );
}
