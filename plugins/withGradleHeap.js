const { withGradleProperties } = require("expo/config-plugins");

// The prebuild template sets org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m.
// R8 (minifyReleaseWithR8) runs inside the Gradle daemon, and with release
// minify on, that heap ran out ("OutOfMemoryError: Java heap space").
// expo-build-properties has no field for jvmargs, so the line is replaced here.
const KEY = "org.gradle.jvmargs";
const VALUE = "-Xmx6g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8";

module.exports = function withGradleHeap(config) {
  return withGradleProperties(config, (c) => {
    c.modResults = c.modResults.filter(
      (item) => !(item.type === "property" && item.key === KEY)
    );
    c.modResults.push({ type: "property", key: KEY, value: VALUE });
    return c;
  });
};
