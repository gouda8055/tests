"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { FormActionState } from "@/components/shared/action-button-form";

/** Confirmation step for irreversible-from-the-UI actions (archiving). */
export function ConfirmActionDialog({
  action,
  fields,
  triggerLabel,
  title,
  description,
  confirmLabel,
}: {
  action: (state: FormActionState, formData: FormData) => Promise<FormActionState>;
  fields: [string, string][];
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {fields.map(([name, value], index) => (
            <input key={`${name}-${index}`} type="hidden" name={name} value={value} />
          ))}
          {state && "error" in state ? (
            <p className="text-destructive text-sm">{state.error}</p>
          ) : null}
          {state && "success" in state ? (
            <p className="text-sm text-green-700">{state.success}</p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {state && "success" in state ? "Close" : "Cancel"}
              </Button>
            </DialogClose>
            {state && "success" in state ? null : (
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Working…" : confirmLabel}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
