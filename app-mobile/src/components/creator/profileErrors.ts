/**
 * #4445: "Pick at least one." shows only after a Save tap or after the chips were
 * touched, never because the name box was focused or blurred.
 */
export function nichesErrorVisible(attemptedSave: boolean, chipsTouched: boolean, nicheCount: number): boolean {
  return (attemptedSave || chipsTouched) && nicheCount === 0;
}
