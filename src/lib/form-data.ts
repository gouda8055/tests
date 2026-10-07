/**
 * FormData.get() returns null for an absent field, which Zod's
 * `.optional()` rejects — normalize to undefined before safeParse.
 */
export function formField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

export function formFields(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string");
}

/** An unchecked checkbox is simply absent from the submitted form. */
export function formCheckbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}
