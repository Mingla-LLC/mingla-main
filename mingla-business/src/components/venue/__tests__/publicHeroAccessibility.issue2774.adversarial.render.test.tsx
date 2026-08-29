/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
import { Platform } from "react-native";

import { EventCoverMedia } from "../../../../../packages/offering-rendering/EventCoverMedia";
import {
  buildHeroMediaAccessibleLabel,
  HeroMediaChangeAnnouncer,
} from "../../../../../packages/offering-rendering/heroMediaAccessibility";

const renderToStaticMarkup = (
  require("react-dom/server") as {
    renderToStaticMarkup: (element: React.ReactElement) => string;
  }
).renderToStaticMarkup;

const setPlatform = (os: "ios" | "web"): void => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
};

afterEach(() => setPlatform("web"));

describe("issue #2774 tester adversarial public hero semantics", () => {
  it("A-5 emits one atomic web result and one image owner without leaking its URL", () => {
    setPlatform("web");
    const label = buildHeroMediaAccessibleLabel({
      subject: "Gogi",
      mediaType: "image",
      position: 1,
      total: 2,
      description: null,
    });
    const markup = renderToStaticMarkup(
      <>
        <EventCoverMedia
          mediaUrl="https://storage.example.test/private/path/gogi.jpg?token=secret"
          mediaType="image"
          accessibleLabel={label}
        />
        <HeroMediaChangeAnnouncer
          activeIndex={0}
          accessibleLabel={label}
          testID="issue-2774-adversarial-result"
        />
      </>,
    );

    expect(markup.match(/role="img"/gu) ?? []).toHaveLength(1);
    expect(markup).toContain('aria-label="Photo 1 of 2 for Gogi"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).not.toContain("private/path");
    expect(markup).not.toContain("token=secret");
  });

  it("A-3 refuses malformed sequence truth instead of fabricating an image name", () => {
    expect(
      buildHeroMediaAccessibleLabel({
        subject: "Gogi",
        mediaType: "image",
        position: 0,
        total: 4,
        description: "Dining room",
      }),
    ).toBeNull();
    expect(
      buildHeroMediaAccessibleLabel({
        subject: "Gogi",
        mediaType: "image",
        position: 5,
        total: 4,
        description: "Dining room",
      }),
    ).toBeNull();
    expect(
      buildHeroMediaAccessibleLabel({
        subject: "   ",
        mediaType: "image",
        position: 1,
        total: 1,
        description: "https://storage.example.test/gogi.jpg",
      }),
    ).toBeNull();
  });
});
