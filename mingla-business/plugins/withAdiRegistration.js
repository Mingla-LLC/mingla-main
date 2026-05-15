const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const ADI_REGISTRATION_TOKEN = "DMRRLJEOZU4NIAAAAAAAAAAAAA";

module.exports = function withAdiRegistration(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const assetsDir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "assets"
      );
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(
        path.join(assetsDir, "adi-registration.properties"),
        ADI_REGISTRATION_TOKEN
      );
      return cfg;
    },
  ]);
};
