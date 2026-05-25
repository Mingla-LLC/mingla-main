const { withAppBuildGradle, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const CMAKE_RELATIVE_PATH = path.join("app", "src", "main", "jni", "CMakeLists.txt");

const bracketSafeCmakeContents = `# Copyright Mingla.
#
# React Native's default New Architecture app CMake file discovers generated
# sources with \`file(GLOB ... CONFIGURE_DEPENDS ...)\`. CMake converts that glob
# to an internal regex, and bracketed worktree paths such as
# \`ORCH-0950-[trip-capacity-single-source]\` make the regex invalid. Listing the
# generated autolinking source explicitly keeps Android live-fire builds working
# from per-ORCH worktrees without disabling New Architecture.

cmake_minimum_required(VERSION 3.13)
set(CMAKE_VERBOSE_MAKEFILE on)

project(appmodules)

include("\${REACT_ANDROID_DIR}/cmake-utils/folly-flags.cmake")

set(REACT_COMMON_DIR "\${REACT_ANDROID_DIR}/../ReactCommon")
include("\${REACT_COMMON_DIR}/cmake-utils/react-native-flags.cmake")

find_program(CCACHE_FOUND ccache)
if(CCACHE_FOUND)
  set_property(GLOBAL PROPERTY RULE_LAUNCH_COMPILE ccache)
  set_property(GLOBAL PROPERTY RULE_LAUNCH_LINK ccache)
endif()

include(CheckIPOSupported)
check_ipo_supported(RESULT IPO_SUPPORT)
if(IPO_SUPPORT)
  set(CMAKE_INTERPROCEDURAL_OPTIMIZATION TRUE)
endif()

set(BUILD_DIR "\${PROJECT_BUILD_DIR}")
file(TO_CMAKE_PATH "\${BUILD_DIR}" BUILD_DIR)
file(TO_CMAKE_PATH "\${REACT_ANDROID_DIR}" REACT_ANDROID_DIR)

set(DEFAULT_APP_SETUP_DIR "\${REACT_ANDROID_DIR}/cmake-utils/default-app-setup")
set(AUTOLINKING_JNI_DIR "\${BUILD_DIR}/generated/autolinking/src/main/jni")

add_library(\${CMAKE_PROJECT_NAME} SHARED
  "\${DEFAULT_APP_SETUP_DIR}/OnLoad.cpp"
  "\${AUTOLINKING_JNI_DIR}/autolinking.cpp"
)

target_include_directories(\${CMAKE_PROJECT_NAME}
  PUBLIC
    "\${DEFAULT_APP_SETUP_DIR}"
    "\${AUTOLINKING_JNI_DIR}"
)

target_compile_reactnative_options(\${CMAKE_PROJECT_NAME} PRIVATE)

find_package(ReactAndroid REQUIRED CONFIG)
add_library(jsi ALIAS ReactAndroid::jsi)
add_library(reactnative ALIAS ReactAndroid::reactnative)

find_package(fbjni REQUIRED CONFIG)
add_library(fbjni ALIAS fbjni::fbjni)

target_link_libraries(\${CMAKE_PROJECT_NAME}
  fbjni
  jsi
  reactnative
)

add_library(common_flags INTERFACE)
target_compile_options(common_flags INTERFACE \${folly_FLAGS})

if(EXISTS "\${AUTOLINKING_JNI_DIR}/Android-autolinking.cmake")
  include("\${AUTOLINKING_JNI_DIR}/Android-autolinking.cmake")
  target_link_libraries(\${CMAKE_PROJECT_NAME} \${AUTOLINKED_LIBRARIES})
  foreach(autolinked_library \${AUTOLINKED_LIBRARIES})
    target_link_libraries(\${autolinked_library} common_flags)
  endforeach()
endif()

if(EXISTS "\${BUILD_DIR}/generated/source/codegen/jni/CMakeLists.txt")
  add_subdirectory("\${BUILD_DIR}/generated/source/codegen/jni/" codegen_app_build)
  get_property(APP_CODEGEN_TARGET DIRECTORY "\${BUILD_DIR}/generated/source/codegen/jni/" PROPERTY BUILDSYSTEM_TARGETS)
  target_link_libraries(\${CMAKE_PROJECT_NAME} \${APP_CODEGEN_TARGET})
  target_link_libraries(\${APP_CODEGEN_TARGET} common_flags)

  string(REGEX REPLACE "react_codegen_" "" APP_CODEGEN_HEADER "\${APP_CODEGEN_TARGET}")
  target_compile_options(\${CMAKE_PROJECT_NAME}
    PRIVATE
      -DREACT_NATIVE_APP_CODEGEN_HEADER="\${APP_CODEGEN_HEADER}.h"
      -DREACT_NATIVE_APP_COMPONENT_DESCRIPTORS_HEADER="react/renderer/components/\${APP_CODEGEN_HEADER}/ComponentDescriptors.h"
      -DREACT_NATIVE_APP_COMPONENT_REGISTRATION=\${APP_CODEGEN_HEADER}_registerComponentDescriptorsFromCodegen
      -DREACT_NATIVE_APP_MODULE_PROVIDER=\${APP_CODEGEN_HEADER}_ModuleProvider
  )
endif()

set(REACTNATIVE_MERGED_SO true)
`;

const externalNativeBuildBlock = `    externalNativeBuild {
        cmake {
            path "src/main/jni/CMakeLists.txt"
        }
    }
`;

function ensureBracketSafeCmakeBuildGradle(contents) {
  if (contents.includes('path "src/main/jni/CMakeLists.txt"')) {
    return contents;
  }

  const androidResourcesBlock =
    /(\n    androidResources \{\n        ignoreAssetsPattern [^\n]+\n    \}\n)/;

  if (androidResourcesBlock.test(contents)) {
    return contents.replace(androidResourcesBlock, `$1${externalNativeBuildBlock}`);
  }

  const androidBlockEnd = "\n}\n\n// Apply static values";
  if (!contents.includes(androidBlockEnd)) {
    throw new Error("Unable to insert bracket-safe CMake externalNativeBuild block");
  }

  return contents.replace(androidBlockEnd, `\n${externalNativeBuildBlock}}\n\n// Apply static values`);
}

function withAndroidBracketSafeCmake(config) {
  config = withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = ensureBracketSafeCmakeBuildGradle(
      cfg.modResults.contents,
    );
    return cfg;
  });

  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const cmakePath = path.join(cfg.modRequest.platformProjectRoot, CMAKE_RELATIVE_PATH);
      fs.mkdirSync(path.dirname(cmakePath), { recursive: true });
      fs.writeFileSync(cmakePath, bracketSafeCmakeContents);
      return cfg;
    },
  ]);
}

module.exports = withAndroidBracketSafeCmake;
module.exports.ensureBracketSafeCmakeBuildGradle = ensureBracketSafeCmakeBuildGradle;
module.exports.bracketSafeCmakeContents = bracketSafeCmakeContents;
