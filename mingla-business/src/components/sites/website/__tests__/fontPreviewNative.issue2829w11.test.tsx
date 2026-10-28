/*
 * #2829 W11 (A17) — on iPhone and Android, Website design draws each font in
 * itself: the app asks Studio for the TrueType specimen and loads it with
 * expo-font under a private alias; until it is ready (or if it fails) the
 * family name shows in the system face.
 */
import React from "react";
import { Platform, Text } from "react-native";

const mockLoadAsync = jest.fn();
const mockUseFontPreviews = jest.fn();
jest.mock("expo-font", () => ({ loadAsync: (...args: unknown[]) => mockLoadAsync(...args) }));
jest.mock("../../../../sites/contentApi", () => ({ useFontPreviews: (...args: unknown[]) => mockUseFontPreviews(...args) }));

import { previewAlias, useFontSpecimens } from "../fontPreview";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => Promise<void>;
  create: (node: React.ReactElement) => { toJSON: () => unknown; unmount: () => void };
};

function Probe({ families }: { families: string[] }): React.ReactElement {
  const drawable = useFontSpecimens("site-1", families);
  return <Text>{families.map((family) => `${family}=${drawable(family) ?? "system"}`).join(";")}</Text>;
}

const realOS = Object.getOwnPropertyDescriptor(Platform, "OS");
beforeAll(() => { Object.defineProperty(Platform, "OS", { configurable: true, get: () => "ios" }); });
afterAll(() => { if (realOS) Object.defineProperty(Platform, "OS", realOS); });

describe("#2829 W11 native font specimens", () => {
  it("asks for TrueType and loads it with expo-font under the preview alias", async () => {
    let resolve!: () => void;
    mockLoadAsync.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    mockUseFontPreviews.mockReturnValue({ data: [{ family: "Just Another Hand", url: "https://storage.invalid/fonts/a.ttf?sig" }] });
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe families={["Just Another Hand"]} />); });
    expect(mockUseFontPreviews).toHaveBeenCalledWith("site-1", ["Just Another Hand"], "ttf");
    expect(mockLoadAsync).toHaveBeenCalledWith({ [previewAlias("Just Another Hand")]: { uri: "https://storage.invalid/fonts/a.ttf?sig" } });
    expect(JSON.stringify(tree.toJSON())).toContain("Just Another Hand=system");
    await act(async () => { resolve(); });
    expect(JSON.stringify(tree.toJSON())).toContain(`Just Another Hand=${previewAlias("Just Another Hand")}`);
  });

  it("on a phone, a font that can't be loaded, or that Studio has no file for, stays in the system face", async () => {
    mockLoadAsync.mockRejectedValueOnce(new Error("bad font"));
    mockUseFontPreviews.mockReturnValue({ data: [{ family: "Broken Face", url: "https://storage.invalid/b.ttf" }, { family: "No File", url: null }] });
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe families={["Broken Face", "No File"]} />); });
    await act(async () => { await Promise.resolve(); });
    expect(mockUseFontPreviews).toHaveBeenLastCalledWith("site-1", expect.any(Array), "ttf");
    expect(mockLoadAsync).toHaveBeenCalledWith({ [previewAlias("Broken Face")]: { uri: "https://storage.invalid/b.ttf" } });
    expect(JSON.stringify(tree.toJSON())).toContain("Broken Face=system;No File=system");
  });
});
