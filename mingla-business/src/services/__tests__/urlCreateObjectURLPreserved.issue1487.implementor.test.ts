import { expect, jest, test } from "@jest/globals";

test("#1487 preserves Node's native URL.createObjectURL for the next suite", () => {
  // Jest creates per-suite environments but exposes Node's URL constructor object
  // from the worker process. A prior suite must restore this native static instead
  // of deleting it, or every later suite in the worker inherits the missing method.
  const descriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  expect(descriptor).toBeDefined();
  expect(typeof descriptor?.value).toBe("function");
  expect(jest.isMockFunction(URL.createObjectURL)).toBe(false);

  const objectUrl = URL.createObjectURL(new Blob(["#1487"]));
  try {
    expect(objectUrl).toMatch(/^blob:nodedata:/);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
});
