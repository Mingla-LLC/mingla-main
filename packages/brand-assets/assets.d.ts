// ISSUE-1001 — keeps @mingla/brand-assets self-typechecking: PNG modules
// resolve to Metro/Expo asset ids (numbers) inside this package.
declare module "*.png" {
  const id: number;
  export default id;
}
