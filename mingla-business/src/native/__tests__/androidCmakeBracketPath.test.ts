const {
  bracketSafeCmakeContents,
  ensureBracketSafeCmakeBuildGradle,
} = require("../../../plugins/withAndroidBracketSafeCmake");

const generatedBuildGradle = `
android {
    packagingOptions {
        jniLibs {
            useLegacyPackaging false
        }
    }
    androidResources {
        ignoreAssetsPattern '!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~'
    }
}

// Apply static values from \`gradle.properties\` to the \`android.packagingOptions\`
`;

describe("Android New Architecture CMake in bracketed worktrees", () => {
  test("generates an app-owned CMake file instead of React Native's bracket-unsafe generated-source glob", () => {
    const patchedGradle = ensureBracketSafeCmakeBuildGradle(generatedBuildGradle);

    expect(patchedGradle).toContain('path "src/main/jni/CMakeLists.txt"');
    expect(bracketSafeCmakeContents).toContain(
      '"${AUTOLINKING_JNI_DIR}/autolinking.cpp"',
    );
    expect(bracketSafeCmakeContents).not.toMatch(
      /file\s*\(\s*GLOB[\s\S]*generated\/autolinking\/src\/main\/jni\/\*\.cpp/,
    );
  });
});
